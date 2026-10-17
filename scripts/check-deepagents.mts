/*
 * Smoke test: LangChain Deep Agents running on Crusoe Managed Inference.
 *
 *   node --env-file=.env.local scripts/check-deepagents.mts
 *
 * Checks the pieces the agent teams will be built on: a team lead on the
 * main tier, delegation to a sub-agent (the performance reviewer) through the
 * `task` tool, a custom tool, a SKILL.md skill, an AGENTS.md memory, and
 * per-call usage (tokens, Crusoe prefix-cache hits, latency) from callbacks.
 * Files live in agent state (StateBackend), so nothing is written to disk.
 */
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent } from "deepagents";
import { modelFallbackMiddleware, modelRetryMiddleware, tool } from "langchain";
import { Client, uuid7 } from "langsmith";
import { z } from "zod";
import { MODELS, modelChain, reasoningFields } from "../src/lib/models.ts";

const BASE_URL = process.env.CRUSOE_BASE_URL ?? "https://api.inference.crusoecloud.com/v1";
if (!process.env.CRUSOE_API_KEY) throw new Error("Set CRUSOE_API_KEY (run with --env-file=.env.local).");

/**
 * Any Crusoe model as a LangChain chat model. Agent loops reason (thinking on),
 * so the token budget leaves room for reasoning plus the answer.
 */
function crusoe(model: string, maxTokens = 8192) {
  return new ChatOpenAI({
    model,
    apiKey: process.env.CRUSOE_API_KEY,
    configuration: { baseURL: BASE_URL },
    temperature: 0.6,
    maxTokens,
    modelKwargs: reasoningFields(model, true),
  });
}

// Override to compare models: LEAD_MODEL=... WORKER_MODEL=... node --env-file=...
const LEAD_MODEL = process.env.LEAD_MODEL ?? MODELS.main;
const REVIEWER_MODEL = process.env.WORKER_MODEL ?? MODELS.main;

/*
 * LangChain throws on a 429 without a retry-after header (Crusoe's RPM cap)
 * instead of retrying, so every agent gets backoff (~1s, doubling, jitter, per
 * Crusoe's guidance), then the model's fixed fallback if it has one
 * (main ↔ advisor; the cheap tier has none).
 */
const resilient = (model: string) => {
  const fallbacks = modelChain(model).slice(1).map((m) => crusoe(m));
  return [
    modelRetryMiddleware({ maxRetries: 3, initialDelayMs: 1000, backoffFactor: 2, onFailure: "error" }),
    ...(fallbacks.length ? [modelFallbackMiddleware(...fallbacks)] : []),
  ];
};

// Seed numbers standing in for what the orchestrator will record per agent.
const teamMetrics = tool(
  async ({ team }) =>
    JSON.stringify({
      team,
      window: "last 24h",
      agents: [
        { name: "Pip", role: "Copywriter", tasks: 14, accepted: 12, redoOrders: 1, avgLatencyS: 6.2, costUsd: 0.41, cacheHit: 0.71 },
        { name: "Juno", role: "Researcher", tasks: 9, accepted: 4, redoOrders: 5, avgLatencyS: 22.8, costUsd: 1.93, cacheHit: 0.12 },
        { name: "Moss", role: "Analyst", tasks: 2, accepted: 2, redoOrders: 0, avgLatencyS: 4.1, costUsd: 0.05, cacheHit: 0.64 },
      ],
    }),
  {
    name: "team_metrics",
    description: "Per-agent performance for a team: tasks, accepted results, redo orders, latency, cost, cache hit rate.",
    schema: z.object({ team: z.string().describe("Channel name, e.g. growth") }),
  },
);

const now = new Date().toISOString();
const file = (content: string) => ({ content, mimeType: "text/markdown", created_at: now, modified_at: now });

const files = {
  "/skills/performance-review/SKILL.md": file(`---
name: performance-review
description: Review each agent on a team from a third-person view and recommend keep, tune, or retire.
---
# Performance review

1. Call team_metrics for the team.
2. For each agent compute acceptance = accepted / tasks.
3. Recommend:
   - RETIRE if acceptance < 0.5 and redoOrders >= 3.
   - TUNE if cacheHit < 0.3 (say: make the system prompt stable so Crusoe's prefix cache hits) or avgLatencyS > 15 (say: move to a faster model).
   - KEEP otherwise. Flag agents with fewer than 3 tasks as "too little data".
4. Answer with one line per agent: NAME: VERDICT, reason with the numbers.
`),
  "/memory/AGENTS.md": file(`# Standing instructions (pinned with 📌)
- This week cost matters more than speed. Mention cost in every recommendation.
`),
};

const agent = createDeepAgent({
  name: "growth-lead",
  model: crusoe(LEAD_MODEL),
  middleware: resilient(LEAD_MODEL),
  systemPrompt:
    "You are Nova, lead of the #growth agent team. For any question about how the team's agents are performing, delegate to the performance-reviewer sub-agent with the task tool, then pass its verdicts on to the human in a short reply.",
  memory: ["/memory/AGENTS.md"],
  subagents: [
    {
      name: "performance-reviewer",
      description: "Third-person reviewer that checks each agent's performance and recommends keep, tune, or retire.",
      systemPrompt: "You are the team's performance reviewer. Use your performance-review skill: read its SKILL.md first, then follow it exactly.",
      model: crusoe(REVIEWER_MODEL),
      tools: [teamMetrics],
      middleware: resilient(REVIEWER_MODEL),
      skills: ["/skills/"],
    },
  ],
});

// Per-call usage: the raw material for performance tracking.
type Call = { agent: string; model: string; start: number; ms?: number; input?: number; cached?: number; output?: number };
const calls = new Map<string, Call>();
const toolCalls: string[] = [];

// With LANGSMITH_TRACING=true every run is traced; this ID becomes the trace ID.
const runId = uuid7();

const result = await agent.invoke(
  { messages: [{ role: "user", content: "How is everyone on #growth doing? Anyone we should retire?" }], files },
  {
    runId,
    runName: "growth-lead",
    tags: ["team:growth", "check-deepagents"],
    metadata: { team: "growth" },
    callbacks: [
      {
        handleChatModelStart(llm, _messages, runId, _parent, extra, _tags, metadata) {
          const model = String((extra?.invocation_params as { model?: string } | undefined)?.model ?? llm.id.at(-1));
          calls.set(runId, { agent: String(metadata?.lc_agent_name ?? "?"), model, start: performance.now() });
        },
        handleLLMEnd(output, runId) {
          const call = calls.get(runId);
          if (!call) return;
          type Usage = { input_tokens?: number; output_tokens?: number; input_token_details?: { cache_read?: number } };
          const usage = (output.generations[0]?.[0] as { message?: { usage_metadata?: Usage } } | undefined)?.message?.usage_metadata;
          call.ms = Math.round(performance.now() - call.start);
          call.input = usage?.input_tokens;
          call.cached = usage?.input_token_details?.cache_read;
          call.output = usage?.output_tokens;
        },
        handleToolStart(_tool, input, _runId, _parent, _tags, metadata, runName) {
          toolCalls.push(`${metadata?.lc_agent_name ?? "?"} → ${runName}(${input.slice(0, 90)})`);
        },
      },
    ],
  },
);

console.log("\nTool calls");
for (const line of toolCalls) console.log(`  ${line}`);

console.log("\nModel calls");
for (const c of calls.values())
  console.log(`  ${c.agent.padEnd(22)} ${c.model.padEnd(42)} in ${c.input ?? "?"} (cached ${c.cached ?? 0})  out ${c.output ?? "?"}  ${c.ms}ms`);

const last = result.messages.at(-1);
console.log(`\nNova (lead) replies:\n${typeof last?.content === "string" ? last.content : JSON.stringify(last?.content)}`);

const delegated =
  toolCalls.some((t) => t.startsWith("growth-lead → task(")) &&
  [...calls.values()].some((c) => c.agent === "performance-reviewer");
const readSkill = toolCalls.some((t) => t.includes("read_file") && t.includes("SKILL.md"));
const usedMetrics = toolCalls.some((t) => t.includes("team_metrics"));
console.log(`\nChecks: delegated ${delegated ? "yes" : "NO"} · read skill ${readSkill ? "yes" : "NO"} · called tool ${usedMetrics ? "yes" : "NO"}`);

// Expected verdicts from the skill's rules: Juno retire, Pip keep, Moss flagged for too little data.
const answer = typeof last?.content === "string" ? last.content : "";
const verdicts = {
  juno: /Juno[^\n]*retir/i.test(answer),
  pip: /Pip[^\n]*\b(keep|kept)\b/i.test(answer),
  moss: /Moss[^\n]*(little|insufficient|not enough|limited|more (data|tasks|activity)|small sample|only (2|two)|2 tasks)/i.test(answer),
};
console.log(`SUMMARY ${JSON.stringify({ lead: LEAD_MODEL, worker: REVIEWER_MODEL, delegated, readSkill, usedMetrics, verdicts, calls: [...calls.values()] })}`);

if (process.env.LANGSMITH_TRACING === "true") {
  // Traces upload in the background; flush before exiting or they are lost.
  await awaitAllCallbacks();
  const langsmith = new Client();
  const project = await langsmith.readProject({ projectName: process.env.LANGSMITH_PROJECT ?? "default" });
  const { url } = await langsmith.runs.getURL(runId, { project_id: project.id, trace_id: runId });
  console.log(`Trace: ${url}`);
}
process.exit(delegated && usedMetrics ? 0 : 1);
