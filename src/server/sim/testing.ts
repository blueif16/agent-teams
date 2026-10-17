/* Test helpers for test mode's server side. Not imported by app code. */
import type { TapeHeaderInput } from "./tape";

/** A tape header as a trial of the launch-kit scenario would open it. */
export function headerInput(over: Partial<TapeHeaderInput> = {}): TapeHeaderInput {
  return {
    kind: "header",
    v: 1,
    tapeId: "tape-1",
    runId: "run-1",
    scenarioId: "launch-kit",
    family: "launch-kit",
    trial: 1,
    arm: "team",
    title: "Launch kit, trial 1",
    recordedAt: "2026-10-17T10:00:00.000Z",
    clock: "monotonic",
    idleCapMs: 2000,
    keyframeEveryMs: 10_000,
    app: { commit: "abc1234" },
    company: { dir: "/tmp/company", vaultCommit: "def5678", ledgerRows: 0 },
    ...over,
  };
}
