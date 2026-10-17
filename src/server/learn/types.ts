/*
 * Shapes of the learning step at project close (test-mode design §7b, T11): what a run hands in, and what a close
 * reports back.
 */
import type { OrderKey } from "@/lib/orders";

/** A rubric item's evidence: where on the tape or in the vault it was checked. */
export interface FeedbackEvidence {
  seq?: number;
  t?: number;
  path?: string;
  note: string;
}

export type PhaseName = "triage" | "charter" | "staffing" | "launch" | "work" | "review" | "close" | "learn";

/**
 * What a finished run hands to the learning step. COPIED from `src/lib/sim/types.ts` `RunFeedback` on the test-mode
 * branch (with `ClaimResult["evidence"]` and `Phase["name"]` inlined), which isn't on main yet. When that branch
 * merges, replace this with `import type { RunFeedback } from "@/lib/sim/types"`.
 */
export interface RunFeedback {
  runId: string;
  scenarioId: string;
  trial: number;
  /** Rubric items that failed on the version the owner reacted to, per deliverable and author. */
  failed: { itemId: string; label: string; deliverable: string; agentId: string; version: number; evidence: FeedbackEvidence[] }[];
  /** Every 🔁 (and ✋, 👀) the owner gave, with the note that said why. */
  orders: { order: OrderKey; agentId: string; deliverable?: string; note?: string; seq: number }[];
  /** Phases slower than the previous run of the series, for the retro. */
  slow: { phase: PhaseName; ms: number; prevMs: number }[];
}

export type LearnStep = "retro" | "dream" | "skill" | "composition";

export interface LearnCommit {
  step: LearnStep;
  agentId?: string;
  paths: string[];
  /** The vault change id: what History and Undo (restore) take. */
  change: string;
  subject: string;
  evidence: string[];
}

/** An edit the close didn't make, and why: a dropped op, a refused leak, an edit that needs the owner (Q8). */
export interface Skipped {
  step: LearnStep | "close";
  agentId?: string;
  reason: string;
  /** The op or edit as the model proposed it, shortened. */
  item?: string;
}

export interface CloseSummary {
  projectId: string;
  /** False when a step failed (a model or vault error): the project stays open and a retry redoes only what's missing. */
  closed: boolean;
  commits: LearnCommit[];
  skipped: Skipped[];
  /** What the close's own model calls cost. */
  usd: number;
}
