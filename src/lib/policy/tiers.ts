/*
 * Tool tiers (design §6, E §6): the default outcome when no tool rule matches. Flow rules still apply on top.
 * A call no tier lists takes its registry ToolDef's tier; a tool in neither asks. The tool catalog says where each tool's data can go (its possible sinks) and which args
 * it takes; the NL compiler sees it as trusted context and the conflict check enumerates it.
 */
import { REGISTRY } from "../tools/registry";
import { globMatch } from "./glob";
import type { Sink, TierDefault } from "./types";

export const TIERS: TierDefault[] = [
  // Plus the runtime's own egress events (model_call, trace_export): flow rules rewrite them, they never ask.
  { tier: "T0", name: "Internal read", tools: ["read_file", "ls", "glob", "grep", "write_todos", "model_call", "trace_export"], effect: "allow" },
  {
    tier: "T1",
    name: "Internal write",
    tools: [
      "write_file",
      "edit_file",
      "task",
      "report",
      "add_task",
      "update_task",
      "assign_task",
      "record_decision",
      "raise_item",
      "resolve_item",
      "note_owner_pref",
      "update_member",
      "log_progress",
      "set_charter",
      // Mira's launch: the owner's "go" on the option card is the approval, so the tool gate doesn't ask again.
      "start_team",
    ],
    effect: "allow",
  },
  // memory:self is free; cross-project memory asks through the project-boundary rule, SOUL.md through its card.
  { tier: "T2", name: "Memory", tools: ["dream_write", "propose_soul"], effect: "allow" },
  { tier: "T3", name: "Public read egress", tools: ["web_search", "fetch_page", "web_fetch", "research", "answer", "find_skill"], effect: "allow" },
  { tier: "T4", name: "Communicate", tools: ["send_email", "post_message", "create_calendar_event"], effect: "ask" },
  {
    tier: "T5",
    name: "State-changing APIs",
    tools: ["http_*", "api_*", "delete_file", "update_calendar_event", "delete_calendar_event"],
    effect: "ask",
  },
  { tier: "T6", name: "Money and credentials", tools: ["purchase_*", "pay_*", "connect_oauth", "read_credential"], effect: "ask" },
  // Deep Agents doesn't enforce filesystem permissions on execute; enable only with a sandbox and network off.
  { tier: "T7", name: "Code execution", tools: ["execute", "shell"], effect: "deny" },
];

const rank = { deny: 0, ask: 1, allow: 2 } as const;
const tierCache = new Map<string, TierDefault | undefined>();

const stricter = (hits: TierDefault[]) => hits.sort((a, b) => rank[a.effect] - rank[b.effect])[0];

/**
 * The tier a tool falls in; when two tiers claim it, the stricter one. A call no tier lists falls back to the tier
 * of the registry ToolDef that provides it (canvas_edit → T1), so registry tools don't ask just for being new.
 */
export function tierOf(tool: string): TierDefault | undefined {
  if (tierCache.has(tool)) return tierCache.get(tool);
  if (tierCache.size > 2000) tierCache.clear();
  const hit =
    stricter(TIERS.filter((t) => t.tools.some((p) => globMatch(p, tool)))) ??
    stricter(REGISTRY.filter((d) => d.calls.includes(tool)).flatMap((d) => TIERS.filter((t) => t.tier === d.tier)));
  tierCache.set(tool, hit);
  return hit;
}

export interface CatalogEntry {
  /** Where its data can go; the runtime picks the actual sinks per call. */
  sinks: Sink[];
  /** Arg paths rules can constrain. */
  args: string[];
}

export const TOOL_CATALOG: Record<string, CatalogEntry> = {
  read_file: { sinks: [], args: ["path"] },
  ls: { sinks: [], args: ["path"] },
  glob: { sinks: [], args: ["pattern", "path"] },
  grep: { sinks: [], args: ["pattern", "path"] },
  write_todos: { sinks: [], args: ["todos"] },
  model_call: { sinks: ["model:crusoe"], args: ["messages"] },
  trace_export: { sinks: ["trace:langsmith"], args: ["inputs", "outputs"] },
  write_file: { sinks: ["memory:self", "memory:global", "project:other"], args: ["path", "content"] },
  edit_file: { sinks: ["memory:self", "memory:global", "project:other"], args: ["path", "old_string", "new_string"] },
  task: { sinks: [], args: ["description", "subagent_type"] },
  report: { sinks: [], args: ["taskId", "status", "summary", "evidence[*]"] },
  dream_write: { sinks: ["memory:self", "memory:global"], args: ["file", "text"] },
  propose_soul: { sinks: ["memory:self"], args: ["text"] },
  web_search: { sinks: ["web"], args: ["query"] },
  fetch_page: { sinks: ["web"], args: ["url", "urls[*]"] },
  web_fetch: { sinks: ["web"], args: ["url"] },
  research: { sinks: ["web"], args: ["question", "tier", "output_schema"] },
  answer: { sinks: ["web"], args: ["query"] },
  find_skill: { sinks: ["web"], args: ["need"] },
  send_email: { sinks: ["email"], args: ["to[*]", "cc[*]", "bcc[*]", "subject", "body"] },
  post_message: { sinks: ["project:other", "api:slack.com"], args: ["channel", "text"] },
  create_calendar_event: { sinks: ["calendar"], args: ["title", "start", "attendees[*]"] },
  http_post: { sinks: ["api:*"], args: ["url", "body"] },
  delete_file: { sinks: [], args: ["path"] },
  "purchase_*": { sinks: ["api:*"], args: ["item", "amount", "merchant"] },
  "pay_*": { sinks: ["api:*"], args: ["payee", "amount"] },
  execute: { sinks: [], args: ["command"] },
};
