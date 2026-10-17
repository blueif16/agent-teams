/*
 * File zones (owner, 2026-10-17: "safe areas and a dangerous zone so that we cannot easily just edit the files").
 * Every path an agent's file tools can name falls in a zone with a severity and a one-sentence reason. Pure: zones and
 * write scopes compile into ordinary policy/v1 tool rules, so every decision is decide()'s, never a second engine.
 *
 * Severity, least to most guarded:
 * - open: scratch for this conversation; read and write.
 * - shared: the project's files (/project/**); every agent reads them, each writes only its deliverables.
 * - deliverable: the agent's own output: its archetype's write scope, each PM task deliverable, and any path the
 *   owner allowed it (an allow on write_file/edit_file with a path_glob). Only that agent writes there.
 * - protected: never written by file tools (the lead's state tools, append_note, dreaming or the owner change them);
 *   still readable. One locked deny on the write tools per zone.
 * - forbidden: never read or written. One locked deny on the read and write tools per zone.
 * Each agent also gets one unlocked deny on writes outside its scope (deliverables and scratch).
 *
 * Paths are normalised by the engine (normPath): "..", "//" and trailing slashes resolve, case and Unicode form fold,
 * and a path that escapes its mount counts as forbidden.
 *
 * Runtime tool gate (not wired here): for every file tool call, build the event with fileArgs (it judges both
 * `file_path` and `path`, since deepagents writes `file_path` when both are sent) and decide over the store's rules
 * plus fileRulesFor(agent, rules, the agent's task deliverables, now).
 */
import type { AgentContext } from "./capabilities";
import { decide, explain, globMatch, inScope, isExpired, normPath } from "./engine";
import type { Archetype, ArgConstraint, PolicyEvent, Rule, ToolRule } from "./types";

export type Severity = "open" | "shared" | "deliverable" | "protected" | "forbidden";

export interface Zone {
  id: string;
  /** Plain words for the Files section: "Team plan & decisions". */
  label: string;
  /** Virtual-path globs. The "outside" zone is everything no mount covers. */
  paths: string[];
  severity: Severity;
  /** One plain sentence: why the zone is guarded the way it is. */
  reason: string;
}

/** What the Files section shows per zone: edit, asks first, read only, protected (locked read only), never. */
export type FileAccess = "edit" | "ask" | "read" | "protected" | "never";

export interface FileZoneView extends Zone {
  access: FileAccess;
  /** A locked rule decided `access`. */
  locked: boolean;
  /** The rules that decided it. */
  ruleIds: string[];
}

export const FILE_WRITE_TOOLS = ["write_file", "edit_file", "delete_file"];
export const FILE_READ_TOOLS = ["read_file", "ls", "glob", "grep"];
const FILE_TOOLS = [...FILE_READ_TOOLS, ...FILE_WRITE_TOOLS];

/** The virtual folders an agent's file tools reach (D §2, F §9.1). `/` itself lists them. */
export const MOUNTS = ["/home", "/project", "/skills", "/conversation_history", "/state", "/company", "/scratch", "/large_tool_results"];
const MOUNT_GLOBS = ["/", ...MOUNTS.flatMap((m) => [m, `${m}/**`])];
const SCRATCH = ["/scratch/**", "/large_tool_results/**"];

export const ZONES: Zone[] = [
  {
    id: "project",
    label: "Project files",
    paths: ["/project/**"],
    severity: "shared",
    reason: "The team's shared files: every agent reads them, and each edits only its own deliverables.",
  },
  { id: "scratch", label: "Scratch space", paths: SCRATCH, severity: "open", reason: "Throwaway notes for this conversation only; nothing here reaches the project." },
  {
    id: "home",
    label: "Its soul, memory & notes",
    paths: ["/home/**"],
    severity: "protected",
    reason: "Who it is and what it remembers change only through you or its dreaming; it adds notes with append_note.",
  },
  {
    id: "state",
    label: "Team plan & decisions",
    paths: ["/project/state/**", "/state/**", "/company/**"],
    severity: "protected",
    reason: "The plan, decisions and roster change only through the lead's planning tools or you, so every change is checked and logged.",
  },
  { id: "skills", label: "Skills library", paths: ["/skills/**"], severity: "protected", reason: "Every agent shares these skills, so only you change them." },
  {
    id: "history",
    label: "Past conversations",
    paths: ["/conversation_history/**"],
    severity: "protected",
    reason: "The record of what was said stays as it happened; dreaming reads it.",
  },
  {
    id: "secrets",
    label: "Secrets & settings",
    paths: ["**/.env*", "**/.git", "**/.git/**", "**/.ssh/**", "**/*.pem"],
    severity: "forbidden",
    reason: "Keys, passwords and version-control internals: no agent reads or writes them.",
  },
  {
    id: "stores",
    label: "Databases & app data",
    paths: ["**/.data/**", "**/*.db", "**/*.db-*", "**/*.sqlite", "**/*.sqlite3", "**/*.sqlite-*"],
    severity: "forbidden",
    reason: "The app's own records (runs, approvals, checkpoints) change only through its code, never by hand.",
  },
  {
    id: "outside",
    label: "Anything outside its folders",
    paths: ["/**"],
    severity: "forbidden",
    reason: "A path that leads outside the agent's folders, or climbs out of one with .., is never opened.",
  },
];

/** Where each archetype writes by default (its deliverables). The PM's assign_task deliverable widens it per task. */
export const WRITE_SCOPES: Record<Archetype, string[]> = {
  // Sources go through add_source (sources.json), so the report is the researcher's only file.
  researcher: ["/project/research.md"],
  writer: ["/project/docs/**"],
  designer: ["/project/design/**"],
  analyst: ["/project/data/**"],
  engineer: ["/project/code/**"],
  // Project state goes through the lead's tools; briefs are its only files.
  lead: ["/project/briefs/**"],
  chief: [],
  coordinator: [],
};

const SCOPE_LABEL: Record<Archetype, string> = {
  researcher: "Its report",
  writer: "Its docs",
  designer: "Its designs",
  analyst: "Its data",
  engineer: "Its code",
  lead: "Its briefs",
  chief: "",
  coordinator: "",
};

const ROLE: Record<Archetype, string> = {
  researcher: "A researcher",
  writer: "A writer",
  designer: "A designer",
  analyst: "An analyst",
  engineer: "An engineer",
  lead: "The lead",
  chief: "The chief",
  coordinator: "A coordinator",
};

/** "/project/docs/**" → "docs/", "/project/research.md" → "research.md". */
const short = (glob: string) => glob.replace(/^\/project\//, "").replace(/\*\*$/, "");

// ---------- rules ----------

const pathIs = (op: ArgConstraint["op"], value: string[]): ArgConstraint[] => [{ path: "path", op, value }];

function zoneRule(z: Zone): ToolRule {
  return {
    id: `r_zone${z.id}`,
    kind: "tool",
    scope: {},
    match: { tools: z.severity === "forbidden" ? FILE_TOOLS : FILE_WRITE_TOOLS },
    effect: "deny",
    args: z.id === "outside" ? pathIs("path_not_glob", MOUNT_GLOBS) : pathIs("path_glob", z.paths),
    locked: true,
    createdBy: "default",
    reason: z.reason,
  };
}

/** One locked deny per protected and forbidden zone, the same for every agent. */
export const ZONE_RULES: ToolRule[] = ZONES.filter((z) => z.severity === "protected" || z.severity === "forbidden").map(zoneRule);

/** A concrete path a glob covers ("**" and "*" → "x"; a leading "**\/" lands in /project). */
function sampleOf(glob: string): string {
  return (glob.startsWith("**/") ? `/project/${glob.slice(3)}` : glob).replace(/\*\*|\*|\?/g, "x");
}

const zoneOf = (id: string) => ZONES.find((z) => z.id === id)!;

/** Why a path or glob can't be an agent's deliverable, in one sentence, or null when it can. */
export function deliverableProblem(path: string): string | null {
  const norm = normPath(path);
  if (norm === null) return "It climbs out of its folder or isn't an absolute path.";
  const zone = zoneHit(norm, "write_file");
  if (zone) return zone;
  if (!/^\/project\/[^/]/i.test(norm)) return "Deliverables live in the project's shared files, under /project/.";
  if (/^\/project\/[^/]*[*?]/i.test(norm)) return "That's the whole shared folder; name a file, or a folder of its own.";
  return null;
}

/** The protected or forbidden zone a path or glob lands in for this tool, as one sentence with its reason. */
function zoneHit(glob: string, tool: string): string | null {
  const probe: PolicyEvent = { agentId: "", archetype: "chief", projectId: "", tool, args: { path: sampleOf(glob) }, argSpans: [], contextLabels: [], sinks: [] };
  const hit = ZONE_RULES.find((r) => decide(probe, [r], [], new Date(0)).firedRuleIds.includes(r.id));
  if (!hit) return null;
  const z = zoneOf(hit.id.slice("r_zone".length));
  return `"${z.label}" is ${z.severity}: ${z.reason}`;
}

/**
 * Why an allow (or grant) on file tools can't open this path or glob, or null when it can. A write may only widen an
 * agent's scope to a deliverable (deliverableProblem); a read may go anywhere but a forbidden zone.
 */
export function fileAccessProblem(glob: string, writes: boolean): string | null {
  if (writes) return deliverableProblem(glob);
  const norm = normPath(glob);
  return norm === null ? "It climbs out of its folder or isn't an absolute path." : zoneHit(norm, "read_file");
}

/** The deliverables that pass deliverableProblem, normalised, without duplicates. */
function accepted(paths: string[]): string[] {
  return [...new Set(paths.filter((p) => deliverableProblem(p) === null).map((p) => normPath(p)!))];
}

function scopeReason(archetype: Archetype, extra: number): string {
  const own = WRITE_SCOPES[archetype].map((g) => (archetype === "researcher" ? "its report (research.md)" : short(g)));
  const what = [...own, ...(extra ? [extra === 1 ? "its task deliverable" : "its task deliverables"] : []), "scratch"];
  const list = what.length === 1 ? what[0] : `${what.slice(0, -1).join(", ")} and ${what[what.length - 1]}`;
  return `${ROLE[archetype]} writes only ${list}; the rest of the project is read-only to it.`;
}

/**
 * The file rules for one agent: the locked zone rules, then one deny on writes outside its scope (its archetype's
 * folder, each acceptable deliverable, scratch). Unacceptable deliverables (see deliverableProblem) are dropped.
 */
export function scopeRules(agentId: string, archetype: Archetype, projectId: string, deliverables: string[] = []): ToolRule[] {
  const extra = accepted(deliverables).filter((d) => !WRITE_SCOPES[archetype].includes(d));
  const scope: ToolRule = {
    id: "r_zonescope",
    kind: "tool",
    scope: { agents: [agentId], ...(projectId ? { projects: [projectId] } : {}) },
    match: { tools: FILE_WRITE_TOOLS },
    effect: "deny",
    args: pathIs("path_not_glob", [...WRITE_SCOPES[archetype], ...extra, ...SCRATCH]),
    createdBy: "default",
    reason: scopeReason(archetype, extra.length),
  };
  return [scope, ...ZONE_RULES];
}

/**
 * Paths the owner let this agent write: enforced allow rules (not defaults) on write_file or edit_file, in scope for
 * it, whose only constraints are path_glob on "path". Each widens its scope like a deliverable; deleting there still
 * asks (tier T5), and a protected or forbidden zone stays locked.
 */
export function grantedPaths(rules: Rule[], agent: AgentContext, now: Date): string[] {
  const probe: PolicyEvent = { ...agent, tool: "", args: {}, argSpans: [], contextLabels: [], sinks: [] };
  return rules.flatMap((r) => {
    if (r.kind !== "tool" || r.effect !== "allow" || r.createdBy === "default" || r.mode === "shadow" || r.when || isExpired(r, now)) return [];
    if (!inScope(r.scope, probe) || !r.match.tools.some((p) => globMatch(p, "write_file") || globMatch(p, "edit_file"))) return [];
    if (!r.args?.length || !r.args.every((c) => c.path === "path" && c.op === "path_glob")) return [];
    return r.args.flatMap((c) => [c.value].flat().filter((v): v is string => typeof v === "string"));
  });
}

/** The integration point: every file rule for one agent, given the rules in force and its task deliverables. */
export function fileRulesFor(agent: AgentContext, rules: Rule[], deliverables: string[], now: Date): ToolRule[] {
  return scopeRules(agent.agentId, agent.archetype, agent.projectId, [...deliverables, ...grantedPaths(rules, agent, now)]);
}

// ---------- events ----------

/**
 * A file call's args for the policy: `path` becomes every path the call names (`file_path` and `path`), so neither can
 * smuggle the other past a rule. A write that names none is judged as "" (outside every folder); a listing as "/".
 * A glob or grep pattern with ".." in it is judged joined to its path.
 */
export function fileArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  const named = [args.file_path, args.path].filter((v) => v !== undefined && v !== null);
  const paths = named.length ? named : [tool === "ls" || tool === "glob" || tool === "grep" ? "/" : ""];
  for (const key of ["pattern", "glob"]) {
    const pattern = args[key];
    if ((tool === "glob" || tool === "grep") && typeof pattern === "string" && /(^|\/)\.\.(\/|$)/.test(pattern)) {
      paths.push(...paths.filter((p): p is string => typeof p === "string").map((p) => `${p.replace(/\/$/, "")}/${pattern}`));
    }
  }
  return { ...args, path: paths };
}

export function fileEvent(agent: AgentContext, tool: string, args: Record<string, unknown>): PolicyEvent {
  return { ...agent, tool, args: fileArgs(tool, args), argSpans: [], contextLabels: [], sinks: [] };
}

// ---------- the Files section ----------

/** The agent's own zones: its archetype's scope, each task deliverable, each path the owner allowed it. */
function ownZones(agent: AgentContext, rules: Rule[], deliverables: string[], now: Date): Zone[] {
  const own = WRITE_SCOPES[agent.archetype];
  const seen = new Set(own);
  const zone = (id: string, label: string, glob: string, reason: string): Zone => ({ id: `${id}:${glob}`, label: `${label} (${short(glob)})`, paths: [glob], severity: "deliverable", reason });
  const fresh = (gs: string[]) => accepted(gs).filter((g) => !seen.has(g) && seen.add(g));
  return [
    ...own.map((g) => zone("own", SCOPE_LABEL[agent.archetype], g, "Its own output: only it writes here, and teammates read it.")),
    ...fresh(deliverables).map((g) => zone("task", "Task deliverable", g, "The lead assigned it this deliverable, so only it writes here for that task.")),
    ...fresh(grantedPaths(rules, agent, now)).map((g) => zone("granted", "You let it edit", g, "You allowed it to edit this, on top of its own files.")),
  ];
}

/**
 * The Files section for one agent: one row per zone, its own deliverables first. Access is what decide() says for a
 * write and a read of a path in the zone, over the rules in force plus the agent's file rules.
 */
export function filesFor(agent: AgentContext, rules: Rule[], deliverables: string[], now: Date): FileZoneView[] {
  const all = [...rules, ...fileRulesFor(agent, rules, deliverables, now)];
  const judge = (tool: string, path: string) => {
    const x = explain(fileEvent(agent, tool, { file_path: path }), all, [], now);
    const by = x.contributions.filter((c) => c.outcome === x.decision.effect);
    return { effect: x.decision.effect, locked: by.some((c) => c.locked), ruleIds: by.flatMap((c) => (c.ruleId ? [c.ruleId] : [])) };
  };
  return [...ownZones(agent, rules, deliverables, now), ...ZONES].map((z) => {
    const sample = z.id === "outside" ? "/tmp/x" : sampleOf(z.paths[0]);
    const r = judge("read_file", sample);
    const w = judge("write_file", sample);
    const [access, by]: [FileAccess, typeof w] =
      r.effect === "deny" ? ["never", r] : r.effect === "ask" ? ["ask", r] : w.effect === "allow" ? ["edit", w] : w.effect === "ask" ? ["ask", w] : [w.locked ? "protected" : "read", w];
    return { ...z, access, locked: by.locked, ruleIds: by.ruleIds };
  });
}
