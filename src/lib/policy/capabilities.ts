/*
 * The Permissions view: per capability ("Send email"), what one agent may do with no special conditions, what can
 * tighten it, and whether its toolset has it; per data family ("Secrets and keys"), what the flow rules do. Pure: the
 * route passes the rules, the agent's toolset and the clock, so relevance can switch to resolveToolset later.
 */
import { REGISTRY } from "../tools/registry";
import { explain, globMatch, inScope, isExpired } from "./engine";
import { readBack } from "./readback";
import { TOOL_CATALOG } from "./tiers";
import type { Access, Archetype, DataGuard, FlowAction, Outcome, Permission, PolicyEvent, Rule, ToolRule } from "./types";

export interface Capability {
  id: string;
  label: string;
  /** Tool names or globs ("http_*"); every tiered tool and registry call sits in exactly one capability. */
  tools: string[];
}

// model_call and trace_export are the runtime's own egress, not something an agent chooses to do: no capability.
export const CAPABILITIES: Capability[] = [
  { id: "files.read", label: "Read files", tools: ["read_file", "ls", "glob", "grep", "repo_read", "doc_read", "canvas_read", "describe"] },
  {
    id: "files.write",
    label: "Write and edit files",
    tools: ["write_file", "edit_file", "doc_write", "doc_suggest", "doc_comment", "write_table", "write_mockup", "canvas_edit", "canvas_export", "propose_patch", "add_source"],
  },
  {
    id: "plan",
    label: "Plan and track work",
    tools: ["write_todos", "add_task", "update_task", "assign_task", "record_decision", "raise_item", "resolve_item", "note_owner_pref", "update_member", "log_progress", "report"],
  },
  // search_skills staffs a role from the local library (no egress); find_skill stays a web search, since a miss goes out.
  { id: "team", label: "Work with teammates", tools: ["task", "dispatch", "find_agent", "request_review", "search_skills"] },
  { id: "memory", label: "Update its own memory", tools: ["dream_write", "propose_soul"] },
  { id: "web.search", label: "Search the web", tools: ["web_search", "research", "answer", "find_skill"] },
  { id: "web.open", label: "Open web pages", tools: ["fetch_page", "web_fetch", "fetch_image"] },
  { id: "email", label: "Send email", tools: ["send_email"] },
  { id: "post", label: "Post messages", tools: ["post_message"] },
  { id: "calendar", label: "Change your calendar", tools: ["create_calendar_event", "update_calendar_event", "delete_calendar_event"] },
  { id: "delete", label: "Delete files", tools: ["delete_file"] },
  { id: "apis", label: "Call outside services", tools: ["http_*", "api_*"] },
  { id: "money", label: "Spend money", tools: ["purchase_*", "pay_*"] },
  { id: "accounts", label: "Use passwords and accounts", tools: ["connect_oauth", "read_credential"] },
  { id: "code", label: "Run code", tools: ["execute", "shell", "bash", "run_tests"] },
];

/** One call in an agent's toolset; `planned` when no ready registry entry provides it. */
export interface ToolsetEntry {
  call: string;
  planned: boolean;
}

export interface AgentContext {
  agentId: string;
  archetype: Archetype;
  projectId: string;
}

/**
 * The calls an archetype gets from the registry: the base set's and its own, planned included, minus T7 (no sandbox
 * yet, so resolveToolset drops them the same way).
 */
export function toolsetOf(archetype: Archetype): ToolsetEntry[] {
  const planned = new Map<string, boolean>();
  for (const d of REGISTRY) {
    if (d.tier === "T7" || !(d.archetypes.includes("*") || d.archetypes.includes(archetype))) continue;
    for (const call of d.calls) planned.set(call, (planned.get(call) ?? true) && d.status === "planned");
  }
  return [...planned].map(([call, p]) => ({ call, planned: p }));
}

const ACCESS_RANK: Record<Access, number> = { deny: 0, ask: 1, allow: 2 };
const toAccess = (o: Outcome): Access => (o === "block" || o === "deny" ? "deny" : o === "ask" ? "ask" : "allow");
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const textOf = (r: Rule) => r.reason ?? readBack(r);

const eventFor = (agent: AgentContext, tool: string): PolicyEvent => ({ ...agent, tool, args: {}, argSpans: [], contextLabels: [], sinks: [] });

/** One tool with no args, labels or sinks: its access, and the enforced rules (or grant) that produced it. */
function decideTool(agent: AgentContext, tool: string, rules: Rule[], now: Date) {
  const x = explain(eventFor(agent, tool), rules, [], now);
  const access = toAccess(x.decision.effect);
  const by = x.contributions.filter((c) => c.ruleId !== null && toAccess(c.outcome) === access);
  return { access, ruleIds: [...by.map((c) => c.ruleId!), ...(x.liftedBy ? [x.liftedBy] : [])], locked: by.some((c) => c.locked) };
}

/** "urls[*]" → "urls", "message.url" → "message". */
const argRoot = (path: string) => path.split(/[.[]/)[0];

/** The arg roots the catalog knows for a tool or tool glob ("http_*" → http_post's), or null when it has no entry. */
function catalogArgs(tool: string): Set<string> | null {
  const entries = Object.entries(TOOL_CATALOG).filter(([key]) => globMatch(key, tool) || globMatch(tool, key));
  return entries.length ? new Set(entries.flatMap(([, e]) => e.args.map(argRoot))) : null;
}

/**
 * Whether a conditional tool rule can apply to this tool: its globs match, and every arg it constrains is one the tool
 * takes. A tool the catalog doesn't know only gets rules that name it, never a bare "*".
 */
function limitApplies(r: ToolRule, tool: string): boolean {
  const patterns = r.match?.tools ?? [];
  if (!patterns.some((p) => globMatch(p, tool))) return false;
  const args = catalogArgs(tool);
  if (!args) return patterns.some((p) => p !== "*" && globMatch(p, tool));
  return (r.args ?? []).every((c) => args.has(argRoot(c.path)));
}

/** Each capability for one agent, in CAPABILITIES order. `tools` is its toolset (toolsetOf or resolveToolset). */
export function permissionsFor(agent: AgentContext, rules: Rule[], tools: ToolsetEntry[], now: Date): Permission[] {
  const conditional = rules.filter(
    (r): r is ToolRule =>
      r.kind === "tool" && r.mode !== "shadow" && !isExpired(r, now) && Boolean(r.args?.length || r.when) && inScope(r.scope, eventFor(agent, "")),
  );
  return CAPABILITIES.map((cap) => {
    const mine = tools.filter((t) => cap.tools.some((p) => globMatch(p, t.call)));
    // Not in the toolset: still answer for the capability as a whole, over all its tools.
    const considered = mine.length ? uniq(mine.map((t) => t.call)) : cap.tools;
    const decided = considered.map((tool) => decideTool(agent, tool, rules, now));
    const access = decided.reduce<Access>((acc, d) => (ACCESS_RANK[d.access] < ACCESS_RANK[acc] ? d.access : acc), "allow");
    const deciding = decided.filter((d) => d.access === access);

    const limits: Permission["limits"] = [];
    for (const r of conditional) {
      const text = textOf(r);
      if (limits.some((l) => l.text === text) || !considered.some((tool) => limitApplies(r, tool))) continue;
      limits.push({ text, access: r.effect, ruleId: r.id });
    }

    return {
      id: cap.id,
      label: cap.label,
      access,
      inToolset: mine.length > 0,
      planned: mine.length > 0 && mine.every((t) => t.planned),
      locked: deciding.some((d) => d.locked),
      limits,
      ruleIds: uniq(deciding.flatMap((d) => d.ruleIds)).sort(),
    };
  });
}

type Guard = DataGuard["outcome"];
const GUARD_RANK: Record<Guard, number> = { block: 0, ask: 1, hidden: 2, allow: 3 };
const GUARD_OF: Record<FlowAction, Guard> = { block: "block", ask: "ask", tokenize: "hidden", redact: "hidden", mask: "hidden", hash: "hidden", allow: "allow" };

const FAMILIES: { id: string; label: string; has: (label: string) => boolean }[] = [
  { id: "secret", label: "Secrets and keys", has: (l) => l === "secret" || l.startsWith("secret.") },
  { id: "pii", label: "Personal info", has: (l) => l === "pii" || l.startsWith("pii.") },
  { id: "project", label: "Project data", has: (l) => l.startsWith("project:") },
  { id: "owner_private", label: "Your private notes", has: (l) => l === "owner_private" },
];
const familyOf = (label: string) => FAMILIES.find((f) => f.has(label)) ?? { id: label, label };

/** Enforced flow rules grouped by what they protect: the known families first, then any other label as itself. */
export function dataGuards(rules: Rule[], now: Date): DataGuard[] {
  const groups = new Map<string, DataGuard>();
  for (const r of rules) {
    if (r.kind !== "flow" || r.mode === "shadow" || isExpired(r, now)) continue;
    const outcome = GUARD_OF[r.action];
    // A rule on two families ("secret.*", "pii.*") shows in both, once each.
    for (const fam of new Map(r.labels.map(familyOf).map((f) => [f.id, f])).values()) {
      const g = groups.get(fam.id) ?? { id: fam.id, label: fam.label, outcome: "allow", locked: false, rules: [] };
      g.rules.push({ ruleId: r.id, text: textOf(r), outcome, locked: Boolean(r.locked) });
      if (GUARD_RANK[outcome] < GUARD_RANK[g.outcome]) g.outcome = outcome;
      g.locked ||= Boolean(r.locked);
      groups.set(fam.id, g);
    }
  }
  const known = FAMILIES.flatMap((f) => groups.get(f.id) ?? []);
  return [...known, ...[...groups.values()].filter((g) => !FAMILIES.some((f) => f.id === g.id))];
}
