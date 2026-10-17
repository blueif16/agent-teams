/*
 * What one compaction did, for the context bar and its history (owner, 2026-10-17: show how compression happens
 * automatically and which files were saved before each one). Written by the compaction middleware (F §9.4, built in
 * M3–M5) as a ledger row; read by the team UI. The steps mirror F §9.4 in order, so the UI shows exactly what ran.
 */

/** One step of a compaction, in the order they ran. */
export type CompactionStep =
  /** "File before you forget": anything the agent hadn't filed yet went into its state files first. */
  | { kind: "filed"; files: { path: string; change: string }[]; items: number }
  /** The 9-section summary was merged into the previous one. */
  | { kind: "summarized" }
  /** A fresh opener was built from the state files as they were then. */
  | { kind: "rebuilt" }
  /** The recall check after compacting: known-answer questions, scored by code. */
  | { kind: "checked"; passed: number; total: number };

export interface CompactionEvent {
  t: "compaction";
  at: string;
  agent: string;
  project: string;
  thread: string;
  /** 1 for the first compaction on this thread. */
  window: number;
  trigger: "soft" | "hard";
  /** Context before and after, as a share of the agent's hard trigger (0..1). The UI shows no raw token counts. */
  before: number;
  after: number;
  steps: CompactionStep[];
  /** The recall check failed twice, so a longer tail was kept and Mira was told. */
  degraded: boolean;
  ms: number;
  usd: number;
}

/** An agent's context right now, for the bar. */
export interface ContextStatus {
  agentId: string;
  /** Share of the hard trigger in use, 0..1; null before the agent's first model call. */
  used: number | null;
  /** Where on the same scale the agent compacts when idle. */
  compactsAt: number;
  /** Newest first, at most 3. */
  compactions: CompactionEvent[];
}
