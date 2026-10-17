/*
 * Starting a project (docs/design/team-setup.md §1). Mira replies with one sentence and a ```project fence of JSON
 * (v2): a shared charter (goal, due, metric, scope) and 2–3 options, each triaged to "project" (a PM plus experts)
 * or "solo" (one expert in a DM), with roles named by archetype. parseProject turns the fence into a Proposal;
 * POST /api/projects/plan staffs every option for the option cards; POST /api/projects provisions the one the owner
 * picked (a LaunchPlan). Shared by the client and the server: no I/O.
 */
import type { Composition } from "./skills/types";
import type { Message } from "./types";

export const PROJECT_FENCE = "```project";

/** Quick questions in the chief's menu and her empty DM. Short, because the answers are. */
export const CHIEF_SHORTCUTS: { label: string; ask: string }[] = [
  { label: "Progress across teams", ask: "What's my current progress across all teams?" },
  { label: "Who's performing best?", ask: "Which of my teams has been performing well lately, and which hasn't?" },
  { label: "Anything to reschedule?", ask: "Do we need to reschedule anything?" },
  { label: "How would you reorganize?", ask: "How should we reorganize to boost efficiency?" },
];

export const START_PROJECT = "Start a project: ";

/** "2026-11-07" as "Nov 7". */
export const formatDue = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** What to show while a reply streams: the text before the project block. */
export function visibleText(text: string): string {
  const at = text.indexOf(PROJECT_FENCE);
  return at === -1 ? text : text.slice(0, at).trimEnd();
}

// ------------------------------------------------------------------------------------------- the fence

/** The archetypes a project can hire (src/lib/skills/archetypes.ts minus chief: Mira is the only one). */
export const STAFFABLE = ["lead", "engineer", "designer", "researcher", "analyst", "writer"] as const;
export type StaffableArchetype = (typeof STAFFABLE)[number];
export const isStaffable = (a: unknown): a is StaffableArchetype => typeof a === "string" && (STAFFABLE as readonly string[]).includes(a);

/** Q6: at most 3 experts at launch, besides the PM; the PM asks to hire more later. */
export const MAX_EXPERTS = 3;
/** The option cards in one reply. */
export const MAX_OPTIONS = 3;
export const DEFAULT_BUDGET_USD = 5;
export const MAX_BUDGET_USD = 1000;
const MAX_LIST = 6;

export interface ProposalRole {
  archetype: StaffableArchetype;
  /** "Product designer". */
  role: string;
  /** What this role must get done on the project, one line. */
  need: string;
  /** The needs skills are matched against. */
  qualifications: string[];
}

export type ProjectKind = "project" | "solo";

/** One way to staff the work, shown as one option card. */
export interface ProposalOption {
  /** "Lean", "Balanced", "Full". */
  label: string;
  /** One line on why this option. */
  summary: string;
  kind: ProjectKind;
  /** A project: the PM first, then 1 to MAX_EXPERTS experts. Solo: exactly one role. */
  roles: ProposalRole[];
  budgetUsd: number;
  etaDays?: number;
}

/** What every option shares. */
export interface Charter {
  name: string;
  /** kebab-case; a solo launch has no channel, it lives in a DM. */
  channel: string;
  goal: string;
  /** YYYY-MM-DD. */
  due?: string;
  metric?: string;
  scope: { must: string[]; wont: string[] };
  /** Details Mira left undecided: the PM asks the owner after launch (Mira staffs; the PM scopes). At most 3. */
  open?: string[];
}

export interface Proposal extends Charter {
  /** 1 to MAX_OPTIONS. */
  options: ProposalOption[];
}

/** The PM a project gets when Mira's fence leaves the lead out. */
export const DEFAULT_PM: ProposalRole = {
  archetype: "lead",
  role: "PM",
  need: "write the plan, assign first tasks and accept work on evidence",
  qualifications: ["project planning", "task breakdown"],
};

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");

/** A trimmed, capped string, or "" for anything that isn't one. */
export const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "");
export const cleanList = (v: unknown, max: number, n = MAX_LIST) =>
  (Array.isArray(v) ? v : [])
    .slice(0, 50)
    .map((x) => clean(x, max))
    .filter(Boolean)
    .slice(0, n);

/** A real calendar date as YYYY-MM-DD, else undefined. */
export function cleanDue(v: unknown): string | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : undefined;
}

export function cleanBudget(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n * 100) / 100, MAX_BUDGET_USD) : DEFAULT_BUDGET_USD;
}

function cleanRole(raw: unknown): ProposalRole | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const archetype = clean(r.archetype, 20).toLowerCase();
  if (!isStaffable(archetype)) return null;
  const role = clean(r.role, 60) || (archetype === "lead" ? "PM" : archetype.charAt(0).toUpperCase() + archetype.slice(1));
  return { archetype, role, need: clean(r.need, 200), qualifications: cleanList(r.qualifications, 60) };
}

/** A whole number of days, 1 to a year, else undefined. */
export function cleanEta(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.round(n), 365) : undefined;
}

/**
 * The roles a launch staffs. A project: its first PM role (or DEFAULT_PM) first, then up to MAX_EXPERTS experts.
 * Solo: the first role. Null when nothing is left to staff.
 */
export function staffRoles(kind: ProjectKind, roles: ProposalRole[]): ProposalRole[] | null {
  if (kind === "solo") return roles.length ? [roles[0]] : null;
  const experts = roles.filter((x) => x.archetype !== "lead");
  if (!experts.length) return null;
  return [roles.find((x) => x.archetype === "lead") ?? DEFAULT_PM, ...experts.slice(0, MAX_EXPERTS)];
}

function cleanOption(raw: unknown, i: number): ProposalOption | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const all = (Array.isArray(r.roles) ? r.roles : []).slice(0, 50).map(cleanRole).filter((x): x is ProposalRole => !!x);
  // Without a kind, one expert is solo (default to one expert, design §0) and anything more is a project.
  const kind: ProjectKind = r.kind === "solo" || r.kind === "project" ? r.kind : all.length === 1 && all[0].archetype !== "lead" ? "solo" : "project";
  const roles = staffRoles(kind, all);
  if (!roles) return null;
  return { label: clean(r.label, 24) || `Option ${i + 1}`, summary: clean(r.summary, 140), kind, roles, budgetUsd: cleanBudget(r.budgetUsd), etaDays: cleanEta(r.etaDays) };
}

/** The shared charter from untrusted JSON: null without a goal. */
export function normalizeCharter(raw: unknown): Charter | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const goal = clean(r.goal, 300);
  if (!goal) return null;
  const name = clean(r.name, 60) || goal.split(" ").slice(0, 4).join(" ");
  const scope = (r.scope && typeof r.scope === "object" ? r.scope : {}) as Record<string, unknown>;
  return {
    name,
    channel: slug(clean(r.channel, 60) || name) || "new-project",
    goal,
    due: cleanDue(r.due),
    metric: clean(r.metric, 200) || undefined,
    scope: { must: cleanList(scope.must, 160), wont: cleanList(scope.wont, 160) },
    ...(cleanList(r.open, 200, 3).length ? { open: cleanList(r.open, 200, 3) } : {}),
  };
}

/** A proposal from untrusted JSON (the fence, or a client): null when unusable; lists capped, strings trimmed. */
export function normalizeProposal(raw: unknown): Proposal | null {
  const charter = normalizeCharter(raw);
  if (!charter) return null;
  const options = ((raw as Record<string, unknown>).options as unknown[] | undefined) ?? [];
  const usable = (Array.isArray(options) ? options : [])
    .slice(0, 20)
    .map(cleanOption)
    .filter((o): o is ProposalOption => !!o)
    .slice(0, MAX_OPTIONS);
  return usable.length ? { ...charter, options: usable } : null;
}

/** Read the project block from a finished reply; null when there is none or it's unusable. Never throws. */
export function parseProject(text: string): Proposal | null {
  const at = text.indexOf(PROJECT_FENCE);
  if (at === -1) return null;
  let body = text.slice(at + PROJECT_FENCE.length);
  const end = body.indexOf("```");
  if (end !== -1) body = body.slice(0, end);
  body = body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1);
  try {
    return normalizeProposal(JSON.parse(body));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------ the plan

/** A skill picked for a role, with why it matched (for the chip's title). */
export interface SkillPick {
  id: string;
  name: string;
  why: string;
}

/** An idle agent of the role's archetype that could be rehired (Q3), with its record from the ledger. */
export interface RehireCandidate {
  id: string;
  name: string;
  /** "12 calls · 80% accepted", or null with no record yet. */
  record: string | null;
}

export interface RosterEntry {
  role: string;
  archetype: StaffableArchetype;
  need: string;
  qualifications: string[];
  /** The new hire's name, from the archetype's name list (provisioning may pick another if it's taken). */
  name: string;
  composition: Composition;
  skills: SkillPick[];
  /** Needs the library has no skill for yet. */
  uncovered: string[];
  /** At most one, shown on the card. */
  candidate?: RehireCandidate;
  /** Set to the candidate's id to rehire it instead of creating a new agent. */
  rehire?: string;
}

/** One option, staffed: what its card shows. */
export interface OptionPlan {
  label: string;
  summary: string;
  kind: ProjectKind;
  etaDays?: number;
  budgetUsd: number;
  /** A project: the PM first. Solo: one entry. */
  roster: RosterEntry[];
}

/** POST /api/projects/plan: every option staffed, under the shared charter. */
export interface LaunchOptions {
  charter: Charter;
  options: OptionPlan[];
}

/** POST /api/projects: the option the owner picked, with the charter as they edited it. */
export interface LaunchPlan {
  charter: Charter & { kind: ProjectKind };
  /** A project: the PM first. Solo: one entry. */
  roster: RosterEntry[];
  budgetUsd: number;
  /** Which option this was, for the charter. */
  option?: { label: string; summary: string; etaDays?: number };
  /** Upload ids from the conversation that led here; its text documents become the project's /project/inputs/. */
  uploads?: string[];
}

/**
 * What a launch carries into the project: the owner's upload ids from the conversation that led to the card
 * `cardId`, i.e. since the last launched card before it, each once.
 */
export function openingUploads(msgs: Message[], cardId: string): string[] {
  const at = msgs.findIndex((m) => m.id === cardId);
  const opening = msgs.slice(0, at === -1 ? msgs.length : at);
  const since = opening.findLastIndex((m) => m.kind === "proposal" && m.state === "launched") + 1;
  return [...new Set(opening.slice(since).flatMap((m) => (m.kind === "text" && m.from === "you" ? (m.images ?? []) : [])))];
}

/** The LaunchPlan for one option card, with the owner's edits to the shared charter and the budget. */
export function launchPlanOf(options: LaunchOptions, index: number, edits: { goal?: string; due?: string | null; budgetUsd?: number } = {}): LaunchPlan {
  const o = options.options[index];
  const due = edits.due === null ? undefined : (edits.due ?? options.charter.due);
  return {
    charter: { ...options.charter, goal: edits.goal?.trim() || options.charter.goal, due, kind: o.kind },
    roster: o.roster,
    budgetUsd: edits.budgetUsd ?? o.budgetUsd,
    option: { label: o.label, summary: o.summary, etaDays: o.etaDays },
  };
}
