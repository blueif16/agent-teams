/*
 * Test mode contracts (docs/design/test-mode.md): what a run records (the tape), what the simulated owner can do,
 * and how a run is scored and summarized. Shared by the driver, the recorder, replay, claims, the run index and
 * the UI. Scenario files have their own schema in ./scenario.ts.
 *
 * Change these deliberately: every test-mode module codes against them.
 */
import type { LedgerEvent } from "../ledger";
import type { OrderKey } from "../orders";
import type { Archetype } from "../policy/types";
import type { ArtifactType } from "../tools/types";
import type { AgentStatus } from "../types";
import type { VaultSource } from "../vault/types";

/** Where a message lives. Same shape as the app's View. */
export type Place = { kind: "dm"; agentId: string } | { kind: "channel"; teamId: string };

/** Who an owner action or a trigger points at, resolved against the live roster at run time. */
export type Who = "mira" | "lead" | "any-expert" | "any" | Archetype;

export type CardType = "proposal" | "launch" | "approval";
export type Decision = "approve" | "decline" | "revise";

/** Everything the simulated owner (or a human in test mode) can do. Adapters turn these into app calls. */
export type OwnerAction =
  | { kind: "send"; place: Place; text: string; mention?: string }
  | { kind: "order"; msgId: string; order: OrderKey; note?: string }
  | { kind: "decide"; cardId: string; decision: Decision; note?: string }
  /** Test clock: fire the next heartbeat, run dreaming now, or close the project (which triggers its dream). */
  | { kind: "advance"; to: "heartbeat" | "dream" | "close"; teamId?: string }
  | { kind: "stop"; reason: StopReason };

export type StopReason = "done" | "max_actions" | "max_wall" | "budget" | "idle" | "error" | "aborted";

export interface Usage {
  input: number;
  cached: number;
  output: number;
}

/** A team member as the roster shows it. `rehired` = an existing agent brought back (Q3), not created. */
export interface Member {
  agentId: string;
  name: string;
  archetype: Archetype;
  rehired: boolean;
  assignment?: string;
  skills?: string[];
}

/** The driver's own decisions, written to the tape so the director strip and the fidelity check can read them. */
export type SimNote =
  | { what: "beat"; beat: string }
  | { what: "gate"; cardId: string; decision: Decision; rule: string }
  | { what: "verdict"; deliverable: string; pass: boolean; failed: string[]; order: OrderKey }
  | { what: "answer"; question: string; fromKnown: number[] }
  | { what: "stop"; reason: StopReason }
  | { what: "skip"; why: string };

/** Ordering and timing. `t` is the only field playback schedules on. */
export interface Timing {
  /** Total order across the run; equal `t` keeps `seq` order. */
  seq: number;
  /** Milliseconds since the run started, on a monotonic clock (performance.now() - t0), never Date. */
  t: number;
  /** Epoch ms, for display only ("10:42"). */
  wall?: number;
  /** Span events: how long it took when recorded, so instant playback can still say "took 3.2 s". */
  dur?: number;
}

export interface Scope {
  /** Runtime run id or thread id. */
  run?: string;
  agent?: string;
  team?: string;
  /** seq of the event that caused this one (an owner message → the reply). */
  cause?: number;
}

export type TapeBody =
  | { kind: "owner"; action: OwnerAction; by: "sim" | "human"; beat?: string }
  | { kind: "msg.start"; msgId: string; place: Place; from: string; quote?: string }
  | { kind: "msg.delta"; msgId: string; text: string }
  | { kind: "msg.end"; msgId: string; text: string; usage?: Usage; trace?: string; error?: string }
  | { kind: "agent.status"; agentId: string; status: AgentStatus; line?: string }
  | { kind: "card"; cardId: string; card: CardType; from: string; place: Place; title: string; detail?: unknown }
  | { kind: "card.decided"; cardId: string; decision: Decision; by: "sim" | "human"; note?: string }
  | { kind: "team.created"; teamId: string; channel: string; name: string; goal: string; leadId: string; members: Member[] }
  | { kind: "member.hired"; teamId: string; member: Member }
  | { kind: "tool.call"; callId: string; agentId: string; name: string; args: unknown }
  | { kind: "tool.result"; callId: string; ok: boolean; summary: string }
  /** A deliverable-like file an agent wrote: a vault path and the commit that wrote it. */
  | { kind: "artifact"; agentId: string; teamId?: string; path: string; type: ArtifactType; commit?: string; version: number }
  /** A change to an agent-facing file (memory, soul, skill, composition), from the vault. */
  | { kind: "file.commit"; path: string; commit: string; source: VaultSource; agentId?: string }
  | { kind: "project.closed"; teamId: string }
  | { kind: "timer"; name: "heartbeat" | "dream" | "budget"; agentId?: string; detail?: string }
  | { kind: "ledger"; row: LedgerEvent }
  | { kind: "bus"; topic: string; version: number }
  /** A pointer into the L1 cassette: which exchange answered this model call. */
  | { kind: "model.http"; key: string; n: number; status: number; ttfbMs: number; model: string }
  | { kind: "sim"; note: SimNote }
  | { kind: "marker"; label: string }
  /** The UI's full state, every keyframeEveryMs, so seeking doesn't fold the whole tape. */
  | { kind: "keyframe"; state: unknown };

export type TapeEvent = Timing & Scope & TapeBody;
export type TapeKind = TapeBody["kind"];

export type Arm = "team" | "solo";

/** Line 1 of a tape file. */
export interface TapeHeader {
  kind: "header";
  v: 1;
  tapeId: string;
  runId: string;
  scenarioId: string;
  family: string;
  trial: number;
  arm: Arm;
  title: string;
  /** ISO wall clock at t = 0. */
  recordedAt: string;
  /** t of the last event; written when the tape closes. */
  durationMs?: number;
  clock: "monotonic";
  /** Playback shrinks any gap longer than this. */
  idleCapMs: number;
  keyframeEveryMs: number;
  app: { commit: string; promptHash?: string };
  /** The test company at t = 0: the vault commit and how many ledger rows existed, so runs can be reset and diffed. */
  company: { dir: string; vaultCommit: string; ledgerRows: number };
  /** The L1 cassette recorded alongside, if any. */
  cassette?: string;
  markers: { t: number; label: string }[];
}

/** One claim's outcome. `pass: null` = the run never reached the point where it could be checked. */
export interface ClaimResult {
  id: string;
  label: string;
  kind: "code" | "judge" | "fidelity";
  /** Gating claims decide pass/fail; advisory ones (uncalibrated judges) are shown but don't. */
  gating: boolean;
  pass: boolean | null;
  evidence: { seq?: number; t?: number; path?: string; note: string }[];
}

/**
 * What makes runs comparable: the same scenario file (hash), the same app code and one starting company. Changing
 * the scenario or the code starts a new series at trial 1, so an improvement can't come from us editing either.
 */
export interface SeriesKey {
  family: string;
  scenarioHash: string;
  appCommit: string;
  /** The company snapshot trial 1 started from. */
  baseVaultCommit: string;
}

/** Where a run's time went, for "time to finish" and for the rethink when a run doesn't improve. */
export interface Phase {
  name: "triage" | "charter" | "staffing" | "launch" | "work" | "review" | "close" | "learn";
  ms: number;
  /** Time spent waiting on the model (vs. tools, the owner, or the rate limiter). */
  modelMs: number;
  calls: number;
}

export interface RunSummary {
  runId: string;
  scenarioId: string;
  family: string;
  variant: string;
  trial: number;
  arm: Arm;
  tapeId: string;
  series: SeriesKey;
  startedAt: string;
  wallMs: number;
  /** First owner message → every deliverable accepted; null if it never got there. */
  timeToDoneMs: number | null;
  phases: Phase[];
  stop: StopReason;
  tokens: Usage;
  usd: number;
  calls: number;
  cacheHit: number;
  /** Rubric pass rate on the final versions (0–1), deliverables accepted without a redo (0–1), judge pass rate. */
  quality: { score: number; firstPass: number; judge: number | null };
  redos: number;
  team: { size: number; rehired: number; created: number; members: Member[] };
  owner: { actions: number; revisions: number; orders: Partial<Record<OrderKey, number>> };
  claims: ClaimResult[];
  /** Every gating claim passed. */
  passed: boolean;
  /** False when the simulated owner misbehaved (leaked, invented, went off script): the run doesn't count. */
  valid: boolean;
  company: TapeHeader["company"];
}

/**
 * What a finished run hands to the learning step (retro, dream, skill tuning; design §7b), written as
 * `feedback.json` next to the tape. Every item carries an evidence ref, so a learning edit can cite it.
 */
export interface RunFeedback {
  runId: string;
  scenarioId: string;
  trial: number;
  /** Rubric items that failed on the version the owner reacted to, per deliverable and author. */
  failed: { itemId: string; label: string; deliverable: string; agentId: string; version: number; evidence: ClaimResult["evidence"] }[];
  /** Every 🔁 (and ✋, 👀) the owner gave, with the note that said why. */
  orders: { order: OrderKey; agentId: string; deliverable?: string; note?: string; seq: number }[];
  /** Phases slower than the previous run of the series, for the retro. */
  slow: { phase: Phase["name"]; ms: number; prevMs: number }[];
}

/** A file that changed between two runs' start snapshots, with how many commits and from which sources. */
export interface FileChange {
  path: string;
  area: "memory" | "soul" | "skill" | "composition" | "other";
  agentId?: string;
  commits: number;
  sources: VaultSource[];
  added: number;
  removed: number;
}

/**
 * The improvement gate between consecutive runs of a series (scenario `improve`). "stalled" or "regressed" stops
 * the series: the owner's rule is that a second run without a visible gain means stop and rethink.
 */
export interface StepVerdict {
  from: number;
  to: number;
  verdict: "improving" | "stalled" | "regressed";
  qualityGain: number;
  timeCut: number | null;
  tokenCut: number;
  /** One line per bar missed, e.g. "time to done fell 8%; the bar is 20%". */
  reasons: string[];
}

/** Runs 1…N of one series side by side, and what changed in the company between them. */
export interface RunComparison {
  series: SeriesKey;
  runs: RunSummary[];
  /** between[i] = the changes from runs[i]'s start to runs[i + 1]'s start. */
  between: FileChange[][];
  steps: StepVerdict[];
  /** pass^k per scenario and arm: true only if all k trials passed. */
  passK: { scenarioId: string; arm: Arm; k: number; passed: number; all: boolean }[];
}
