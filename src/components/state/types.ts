/*
 * View models for the PM's project state (docs/research/F-orchestrator-memory.md §3): what the state views draw,
 * built on the server from the state module's files (src/server/state-view.ts) and served whole by
 * GET /api/projects/[id]/state. Plain data, no server imports, so components and tests share them.
 * Ids the owner sees are the shared vocabulary only: t7, m1, D-007, Q-2, R-1.
 */
import type { ContextStatus } from "@/lib/compaction";

export type TaskStatus = "todo" | "ready" | "in_progress" | "review" | "blocked" | "done" | "failed" | "dropped";

/** Who owns, asks or reports something. "pm" is the team's lead; "owner" is you. */
export type Who =
  | { kind: "pm" }
  | { kind: "owner" }
  | { kind: "agent"; id: string; name: string; archetype: string | null }
  | { kind: "none" };

/** A pointer that proves a task: a project file, a report, a ledger event or a message. */
export interface EvidenceVM {
  ref: string;
  kind: "file" | "report" | "ledger" | "message" | "other";
  /** Short, human: "copy.md", "report 2", "approval 21:04". */
  label: string;
}

export interface TaskVM {
  id: string;
  kind: "work" | "todo";
  title: string;
  status: TaskStatus;
  owner: Who;
  deps: string[];
  milestone: string | null;
  due: string | null;
  acceptance: string;
  detail: string | null;
  blocker: { text: string; on: string | null; since: string } | null;
  evidence: EvidenceVM[];
  lastReport: { at: string; by: Who; status: "progress" | "blocked" | "review" | "done"; summary: string } | null;
  /** The PM's notes on it, newest first. */
  notes: { at: string; text: string }[];
  updated: string;
  /** Times it went back from review to in progress. */
  reopened: number;
  /** In review, and its acceptance names you: an approval waiting on you (F §3.1). */
  needsYou: boolean;
}

export interface MilestoneVM {
  id: string;
  title: string;
  status: TaskStatus;
  due: string | null;
  /** Work tasks in it that are done, and all of them. */
  done: number;
  total: number;
}

export interface PlanVM {
  /** Work and todos; milestones are in `milestones`. */
  tasks: TaskVM[];
  milestones: MilestoneVM[];
  /** Over kind "work" only (F §3.1). */
  progress: { done: number; total: number; blocked: number; review: number; inProgress: number };
}

export interface DecisionVM {
  id: string;
  date: string;
  title: string;
  status: "active" | "superseded" | "revoked";
  /** The decision that replaced this one. */
  supersededBy: string | null;
  supersedes: string | null;
  decision: string;
  why: string;
  approvedBy: "owner" | "pm";
  proposedBy: Who;
  links: string[];
}

export interface OpenItemVM {
  id: string;
  kind: "question" | "risk";
  askOf: Who;
  text: string;
  raised: string;
  due: string | null;
  severity: "low" | "medium" | "high" | null;
  status: "open" | "resolved";
  links: string[];
  resolution: string | null;
  resolvedAt: string | null;
  /** Where the Open view lists it: your questions first, then risks, then the rest; resolved folded away. */
  group: "you" | "risk" | "other" | "resolved";
}

export interface OpenVM {
  /** In display order. */
  items: OpenItemVM[];
  /** Review tasks waiting on your approval, listed with your questions. */
  approvals: { id: string; title: string; owner: Who }[];
}

export interface MemberVM {
  id: string;
  name: string;
  role: string;
  archetype: string;
  state: "working" | "idle" | "blocked" | "waiting_owner";
  lastCheckIn: string | null;
  lastReport: string | null;
  blocker: { text: string; on: string | null } | null;
  pmNote: string | null;
  /** The member's in-progress (else blocked or review) task, from the plan. */
  current: { id: string; title: string; status: TaskStatus } | null;
  load: { open: number; done: number };
  context: ContextStatus;
}

export interface CharterVM {
  title: string;
  goal: string;
  metric: string;
  deadline: string;
  scope: string[];
  outOfScope: string[];
  roles: { role: string; quals: string }[];
  /** `usd` is the first dollar amount in the budget line, when there is one; `spent` is the ledger's cost for the project. */
  budget: { text: string; usd: number | null; spent: number };
}

export interface JournalVM {
  at: string;
  rev: number;
  text: string;
  /** The agent the line starts with ("ana: …"), when it does. */
  actor: Who | null;
}

export interface PmStatusVM {
  progress: { done: number; total: number; blocked: number };
  waiting: { questions: number; approvals: number };
  /** The newest report from any member. */
  lastReport: { at: string; by: Who } | null;
  /** The PM's own in-progress todo, else its latest journal line. */
  now: string | null;
  /** The lead's context, when the request named the lead. */
  context: ContextStatus | null;
}

/** The state files, by the name the route and the History sheet use. `journal` is the current window. */
export const STATE_FILES = ["dag.json", "roster.json", "open.json", "decisions.md", "prefs.md", "charter.md", "journal"] as const;
export type StateFileName = (typeof STATE_FILES)[number];

export interface FileStamp {
  /** Vault path, e.g. projects/p_42/state/dag.json. */
  path: string;
  /** Last change, ISO. */
  updated: string;
  /** Change id of the last commit (c_…), for History. */
  change: string;
}

export interface ProjectStateVM {
  pid: string;
  rev: number;
  plan: PlanVM;
  /** Active first, newest first. */
  decisions: DecisionVM[];
  open: OpenVM;
  team: MemberVM[];
  charter: CharterVM | null;
  /** The last 8 lines, newest first. */
  journal: JournalVM[];
  prefs: { id: string; text: string }[];
  pm: PmStatusVM;
  /** Null for a file the PM hasn't written yet. */
  files: Record<StateFileName, FileStamp | null>;
}
