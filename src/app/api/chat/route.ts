import { after } from "next/server";
import { uuid7 } from "langsmith";
import { addStandingInstruction, readAgentFiles } from "@/lib/agent-files";
import { chiefPrompt, HEARTBEAT } from "@/lib/chief-prompt";
import { CHIEF_ID } from "@/lib/data";
import { readLedger, record } from "@/lib/ledger";
import { costOf, modelChain, reasoningFields } from "@/lib/models";
import { excerpt, type OrderKey } from "@/lib/orders";
import { systemPrompt, toChatMessages, type ProjectContext, type Turn } from "@/lib/prompt";
import { endLLMRun, orderFeedback, startLLMRun } from "@/lib/tracing";
import type { AgentStatus, OrgSnapshot } from "@/lib/types";
import { isImageUpload } from "@/lib/uploads";
import { getAgent, getTeam } from "@/server/directory";
import { imageParts, inlineTexts, type ImagePart } from "@/server/uploads";

/** Prompts look agents and teams up in the directory: the constants, then the runtime db. */
const DIRECTORY = { agent: getAgent, team: getTeam };

const BASE_URL = process.env.CRUSOE_BASE_URL ?? "https://api.inference.crusoecloud.com/v1";

export async function GET() {
  return Response.json({ live: Boolean(process.env.CRUSOE_API_KEY) });
}

async function callCrusoe(body: unknown, signal: AbortSignal, retries = 2): Promise<Response> {
  // Backoff on 429/503 per Crusoe guidance: ~1s, doubling, with jitter.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CRUSOE_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    });
    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt + Math.random() * 400));
      continue;
    }
    return res;
  }
}

const cap = (v: unknown, n = 300) => String(v ?? "").slice(0, n);
const STATUSES = new Set<AgentStatus>(["working", "needs-you", "idle", "done"]);

/** The app's live org state, trimmed to known agents and sane sizes before it reaches a prompt. */
function cleanOrg(raw: OrgSnapshot | undefined): OrgSnapshot {
  return {
    teams: (raw?.teams ?? []).slice(0, 30).map((t) => ({
      id: cap(t.id, 40),
      channel: cap(t.channel, 40),
      name: cap(t.name, 60),
      goal: cap(t.goal),
      leadId: cap(t.leadId, 40),
      launched: Boolean(t.launched),
      pending: (t.pending ?? []).slice(0, 10).map((p) => cap(p, 160)),
      agents: (t.agents ?? [])
        .filter((a) => getAgent(a.id))
        .slice(0, 12)
        .map((a) => ({ id: a.id, status: STATUSES.has(a.status) ? a.status : "idle", doing: cap(a.doing, 200) })),
    })),
  };
}

function cleanProject(raw: ProjectContext | undefined): ProjectContext | undefined {
  if (!raw?.id || !Array.isArray(raw.members)) return undefined;
  return {
    id: cap(raw.id, 40),
    channel: cap(raw.channel, 40),
    name: cap(raw.name, 60),
    goal: cap(raw.goal),
    leadId: cap(raw.leadId, 40),
    members: raw.members.filter((m) => getAgent(m.id)).slice(0, 8).map((m) => ({ id: m.id, assignment: cap(m.assignment, 200) })),
    spec: cap(raw.spec, 4000),
  };
}

export async function POST(req: Request) {
  if (!process.env.CRUSOE_API_KEY) {
    return Response.json(
      { error: "Live replies are off. Add CRUSOE_API_KEY to .env.local and restart the dev server." },
      { status: 503 },
    );
  }

  const body = (await req.json()) as {
    agentId: string;
    mode: "channel" | "dm";
    history: Turn[];
    /** Image URLs (https or data:) attached to the newest message. */
    images?: string[];
    /** Ids from POST /api/uploads attached to the newest message: images (at most 4) as data: URLs, text documents inline. */
    uploads?: string[];
    /** Set when this message is a reaction order on one of the agent's replies. */
    order?: { key: OrderKey; text: string; trace?: string };
    /** For the chief: every team's live state, as the app shows it. */
    org?: OrgSnapshot;
    /** For the chief: a quiet check-in; she replies QUIET unless something needs the owner. */
    heartbeat?: boolean;
    /** For a team the chief launched: its goal, members and spec. */
    project?: ProjectContext;
  };
  const { agentId, mode, history, images = [], order } = body;
  const agent = getAgent(agentId);
  if (!agent) return Response.json({ error: `Unknown agent "${agentId}".` }, { status: 400 });
  // Uploads reach the model inline: Crusoe can't fetch this machine's /api/uploads. Images as image parts;
  // text documents as <attachment> blocks on the newest user turn.
  let uploaded: ImagePart[];
  let attached: string;
  try {
    const ids = Array.isArray(body.uploads) ? body.uploads : [];
    uploaded = await imageParts(ids.filter(isImageUpload));
    attached = await inlineTexts(ids.filter((id) => !isImageUpload(id)));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  const chief = agentId === CHIEF_ID;
  const project = chief ? undefined : cleanProject(body.project);
  const teamId = project?.id ?? agent.teamId;
  const started = Date.now();
  const at = new Date().toISOString();

  // Orders are performance signals: ledger, LangSmith feedback, and 📌 becomes a standing instruction.
  if (order) {
    if (order.key === "pin") await addStandingInstruction(agentId, excerpt(order.text, 200));
    await record({ t: "order", at, team: teamId, agent: agentId, order: order.key, trace: order.trace });
    const { trace, key } = order;
    if (trace) after(() => orderFeedback(trace, key));
  }

  const files = await readAgentFiles(agentId);
  const home = { soul: files.soul.content, memory: files.memory.content };
  const today = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
  const system = chief ? chiefPrompt(cleanOrg(body.org), await readLedger(), home, today) : systemPrompt(agentId, mode, home, project, DIRECTORY);
  const turns = history.slice(-16);
  if (chief && body.heartbeat) turns.push({ from: "you", text: HEARTBEAT });
  const messages: { role: string; content: unknown }[] = [{ role: "system", content: system }, ...toChatMessages(agentId, turns, DIRECTORY)];
  // Images ride on the newest user turn as OpenAI-style content parts: ready-made URLs first, then uploads.
  const parts = [...images.map((url) => ({ type: "image_url", image_url: { url } })), ...uploaded];
  const lastUser = messages.findLast((m) => m.role === "user");
  if (attached && lastUser) lastUser.content = `${lastUser.content}\n\n${attached}`;
  if (parts.length && lastUser) lastUser.content = [{ type: "text", text: lastUser.content }, ...parts];
  const hasImage = parts.length > 0;

  // Chat replies are short, so reasoning stays off and the whole budget goes to the answer.
  const request = (model: string) => ({
    model,
    stream: true,
    stream_options: { include_usage: true },
    // The chief writes project specs, so she gets more room.
    max_tokens: chief ? 2500 : 1500,
    temperature: 0.8,
    messages,
    ...reasoningFields(model, false),
  });

  // The fixed chain: main ↔ advisor for text, the vision model for images it can't handle.
  const chain = process.env.CRUSOE_MODEL ? [process.env.CRUSOE_MODEL] : modelChain(agent.model, { hasImage });
  const traceId = process.env.LANGSMITH_TRACING === "true" ? uuid7() : undefined;
  const run = startLLMRun({
    id: traceId,
    name: agent.name,
    model: chain[0],
    inputs: { messages: messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "[text + images]" })) },
    metadata: { agent: agentId, team: teamId, mode, order: order?.key, heartbeat: body.heartbeat || undefined },
    tags: [`team:${teamId}`, `agent:${agentId}`],
  });

  let model = chain[0];
  let upstream = await callCrusoe(request(model), req.signal);
  for (const next of chain.slice(1)) {
    if (upstream.ok) break;
    model = next;
    upstream = await callCrusoe(request(model), req.signal, 1);
  }

  const call = { t: "call", kind: "reply", at, team: teamId, agent: agentId, asked: chain[0], vision: hasImage || undefined, trace: traceId } as const;

  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text()).slice(0, 240);
    const error =
      upstream.status === 429
        ? `${agent.name} couldn't reply: Crusoe is rate-limiting ${model} right now. Try again in a minute.`
        : upstream.status === 503
          ? `${agent.name} couldn't reply: Crusoe is overloaded for ${model} right now. Try again in a minute.`
          : `${agent.name} couldn't reply: Crusoe returned ${upstream.status} for ${model}. ${detail}`;
    await record({ ...call, model, input: 0, cached: 0, output: 0, ms: Date.now() - started, cost: 0, ok: false });
    after(() => run.then((r) => endLLMRun(r, { error, model, input: 0, cached: 0, output_tokens: 0 })));
    return Response.json({ error }, { status: 502 });
  }

  // Re-stream only the answer text; reasoning deltas are dropped. Usage arrives in the last chunk.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let text = "";
  let usage = { prompt_tokens: 0, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } };

  const finish = async () => {
    const input = usage.prompt_tokens;
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    const output = usage.completion_tokens;
    await record({ ...call, model, input, cached, output, ms: Date.now() - started, cost: costOf(model, input, cached, output), ok: true });
    await endLLMRun(await run, { output: text, model, input, cached, output_tokens: output });
  };
  // Record once the stream ends; after() keeps a Vercel function alive until it's done.
  let ended = () => {};
  const streamEnded = new Promise<void>((resolve) => {
    ended = resolve;
  });
  after(() => streamEnded.then(finish).catch((e) => console.warn("Couldn't record the call:", (e as Error).message)));

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const data = line.trim();
            if (!data.startsWith("data:")) continue;
            const payload = data.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const chunk = JSON.parse(payload);
              if (chunk.usage) usage = chunk.usage;
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) {
                text += delta;
                controller.enqueue(encoder.encode(delta));
              }
            } catch {
              // Partial or keep-alive line; skip.
            }
          }
        }
        controller.close();
      } finally {
        ended();
      }
    },
    cancel() {
      reader.cancel();
      ended();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Model": model,
      ...(traceId && { "X-Trace-Id": traceId }),
    },
  });
}
