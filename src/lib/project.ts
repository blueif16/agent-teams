/*
 * Starting a project (docs/design/team-setup.md §1). Mira triages a request to "project" (a PM plus experts) or
 * "solo" (one expert in a DM) and replies with one sentence and a ```project fence of JSON (v2), naming roles by
 * archetype. parseProject turns the fence into a Proposal; POST /api/projects/plan staffs it into a LaunchPlan for
 * the launch card; POST /api/projects provisions the approved plan. Shared by the client and the server: no I/O.
 */
import type { Composition } from "./skills/types";

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

export interface Proposal {
  kind: "project" | "solo";
  name: string;
  /** kebab-case; a solo proposal has no channel once launched, it lives in a DM. */
  channel: string;
  goal: string;
  /** YYYY-MM-DD. */
  due?: string;
  metric?: string;
  scope: { must: string[]; wont: string[] };
  /** A project: the PM first, then 1 to MAX_EXPERTS experts. Solo: exactly one role. */
  roles: ProposalRole[];
  budgetUsd: number;
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

/** A proposal from untrusted JSON (the fence, or a client): null when unusable; lists capped, strings trimmed. */
export function normalizeProposal(raw: unknown): Proposal | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const goal = clean(r.goal, 300);
  if (!goal) return null;
  const roles = (Array.isArray(r.roles) ? r.roles : []).slice(0, 50).map(cleanRole).filter((x): x is ProposalRole => !!x);
  const experts = roles.filter((x) => x.archetype !== "lead");
  const kind = r.kind === "solo" || r.kind === "project" ? r.kind : roles.length > 1 ? "project" : "solo";
  let staffed: ProposalRole[];
  if (kind === "solo") {
    if (!roles.length) return null;
    staffed = [roles[0]];
  } else {
    if (!experts.length) return null;
    staffed = [roles.find((x) => x.archetype === "lead") ?? DEFAULT_PM, ...experts.slice(0, MAX_EXPERTS)];
  }
  const name = clean(r.name, 60) || goal.split(" ").slice(0, 4).join(" ");
  const scope = (r.scope && typeof r.scope === "object" ? r.scope : {}) as Record<string, unknown>;
  return {
    kind,
    name,
    channel: slug(clean(r.channel, 60) || name) || "new-project",
    goal,
    due: cleanDue(r.due),
    metric: clean(r.metric, 200) || undefined,
    scope: { must: cleanList(scope.must, 160), wont: cleanList(scope.wont, 160) },
    roles: staffed,
    budgetUsd: cleanBudget(r.budgetUsd),
  };
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

export interface LaunchPlan {
  charter: Pick<Proposal, "kind" | "name" | "channel" | "goal" | "due" | "metric" | "scope">;
  /** A project: the PM first. Solo: one entry. */
  roster: RosterEntry[];
  budgetUsd: number;
}
