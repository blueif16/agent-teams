/*
 * A worker: the persistent Deep Agent for one agent row on one project (research D §1, §2, §7), bound to its
 * thread `a:{agent}:p:{project}`.
 *   - Tools: its archetype's ready toolset (resolveToolset; with the sandbox only when the runtime binds bash). The
 *     file tools are deepagents'; the fences (charts, Markdown, project cards) and bash's box are prompt notes;
 *     every other tool comes in through deps.tools (the runtime's toolkit.ts). write_todos is added for the plan
 *     stream. deepagents' execute, delete and task are not built: bash is the workbench's, and helpers would
 *     double the RPM.
 *   - Files: workerBackend (backends.ts); /home/ is read-only.
 *   - Prompt: a stable identity + tool notes first (prefix cache), HomeFiles' SOUL/MEMORY block last.
 *   - Model: the agent's tier on Crusoe through the process limiter, thinking on, fallback outside retry.
 *   - Summarization at the role's hard compaction trigger (Mira 80K, workers 128K on V4.1 Flash), not deepagents'
 *     170K default for unprofiled models (D finding 7).
 * Server only.
 */
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createFilesystemMiddleware, createSummarizationMiddleware } from "deepagents";
import { createMiddleware, modelCallLimitMiddleware, todoListMiddleware, type AgentMiddleware } from "langchain";
import { compactionTriggers, type ContextRole } from "@/lib/context-budget";
import { STARTING } from "@/lib/chief-prompt";
import { MODELS } from "@/lib/models";
import { getArchetype } from "@/lib/skills/archetypes";
import { resolveToolset } from "@/lib/tools/resolve";
import { buildAgent } from "./agents";
import { workerBackend } from "./backends";
import type { AgentRow, ProjectRow } from "./db";
import { homeFiles } from "./home-files";
import { getLimiter, limitFetch, type Limiter } from "./limiter";
import { crusoe } from "./models";
import { resilient } from "./resilience";
import { startTeamTool } from "./tools/start-team";

type FileToolNames = NonNullable<Parameters<typeof createFilesystemMiddleware>[0]>["tools"];
type FileTool = Extract<NonNullable<FileToolNames>, readonly unknown[]>[number];

/** deepagents' file tools a registry entry may grant. `execute` is not among them: it needs a sandbox. */
const FILE_TOOLS = new Set<string>(["ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep"]);

/** D §9: agent steps think, with room for deliverables written as tool arguments. */
const MAX_TOKENS = 16_384;
/** Compaction before the next model call at the role's hard trigger from its model's TPM (context-budget.ts), not 170K (D finding 7). */
const roleOf = (a: AgentRow): ContextRole => (a.archetype === "chief" ? "chief" : a.archetype === "lead" ? "lead" : "worker");
const KEEP = { type: "messages", value: 20 } as const;
/** D §1: a run cap protects the shared 30 RPM. */
const RUN_LIMIT = 40;

export interface WorkerDeps {
  checkpointer: BaseCheckpointSaver;
  /** Under the limiter; default the global fetch. Tests pass a fake Crusoe. */
  fetch?: typeof fetch;
  limiter?: Limiter;
  /** Implementations of non-file tools (assign, web, bash, …): the runtime's toolkit.ts. */
  tools?: StructuredToolInterface[];
  /** A sandboxed bash is among `tools`: resolve the toolset with the sandbox, so T7 entries (and their notes) stay. */
  sandbox?: boolean;
  /** Run between the built-ins and HomeFiles (the runtime's InboxDrain). */
  middleware?: AgentMiddleware[];
}

const STYLE = `Write like a teammate in a chat app: lead with the point in 1 to 3 short sentences. Markdown renders, so use it lightly: **bold** the one number or decision that matters, a short list only for 3 or more parallel items, and no headings. Never claim you sent, bought, merged or scheduled something that needs approval; ask first.`;

const FILES = `Your files: /home/ holds your SOUL.md and MEMORY.md (read-only to you). /project/ is this project's shared folder: put deliverables and hand-offs there. /skills/ is the skill library (read-only). Any other path is scratch for this conversation only.`;

/** The stable head of the system prompt: same bytes on every call of a thread, so Crusoe's prefix cache hits. */
export function identityPrompt(agent: AgentRow, project: ProjectRow, notes: string[]): string {
  const archetype = getArchetype(agent.archetype);
  const where =
    project.kind === "dm"
      ? `You are in a direct message with the owner, the human who owns this company of AI agent teams. Call them "you".`
      : `You work on the project "${project.name}"${project.goal ? `. Goal: ${project.goal}` : ""}. The owner is the human who owns this company of AI agent teams.`;
  const role = `You are ${agent.name}, an AI agent in the owner's company of agent teams. Archetype: ${archetype?.name ?? agent.archetype}. ${archetype?.summary ?? ""}`;
  return [role.trim(), where, FILES, STYLE, ...notes]
    .filter(Boolean)
    .join("\n\n");
}

export function buildWorker(agent: AgentRow, project: ProjectRow, deps: WorkerDeps) {
  const archetype = getArchetype(agent.archetype);
  if (!archetype) throw new Error(`Agent ${agent.id} has an unknown archetype "${agent.archetype}"`);
  const toolset = resolveToolset(archetype, agent.config.composition, { sandbox: deps.sandbox ?? false });
  const calls = toolset.tools.flatMap((t) => t.calls);
  const fileTools = calls.filter((c): c is FileTool => FILE_TOOLS.has(c));
  // deepagents requires read_file in any explicit list; an archetype without file tools still reads.
  if (!fileTools.includes("read_file")) fileTools.unshift("read_file");

  const fetch = limitFetch(deps.fetch ?? globalThis.fetch, deps.limiter ?? getLimiter());
  const chat = (model: string) => crusoe(model, { maxTokens: MAX_TOKENS, think: true, fetch });
  const modelId = MODELS[agent.modelTier];
  const backend = workerBackend(agent.id, project.id);

  const middleware: AgentMiddleware[] = [
    // Same names as deepagents' built-ins, so these replace them in place (and in its general-purpose helper).
    createFilesystemMiddleware({ backend, tools: fileTools }),
    createMiddleware({ name: "subAgentMiddleware" }),
    createSummarizationMiddleware({ backend, trigger: { type: "tokens", value: compactionTriggers(roleOf(agent), { model: modelId }).hard }, keep: KEEP }),
    todoListMiddleware(),
    modelCallLimitMiddleware({ runLimit: RUN_LIMIT, exitBehavior: "end" }),
    ...(deps.middleware ?? []),
    ...resilient(modelId, chat),
    // Innermost model wrapper: its block lands last in the system message.
    homeFiles(agent.id),
  ];

  return buildAgent({
    agentId: agent.id,
    projectId: project.id,
    // Mira's project fence has no registry note: its rules (triage, options, archetypes) live with her prompt.
    systemPrompt: identityPrompt(agent, project, agent.archetype === "chief" ? [...toolset.notes, STARTING] : toolset.notes),
    model: chat(modelId),
    checkpointer: deps.checkpointer,
    backend,
    // Mira starts teams herself; every other non-file tool comes from the runtime's factory.
    tools: agent.archetype === "chief" ? [...(deps.tools ?? []), startTeamTool()] : deps.tools,
    middleware,
  });
}

export type Worker = ReturnType<typeof buildWorker>;
