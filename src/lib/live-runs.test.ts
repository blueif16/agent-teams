import { describe, expect, it } from "vitest";
import { applyRunEvent, inFlight, type Runs } from "./live-runs";

/* What the page knows about runs from GET /api/runs: each event folded into one record per run. */
const T = "a:pat:p:p1";
const fold = (events: Parameters<typeof applyRunEvent>[1][]) => events.reduce<Runs>(applyRunEvent, {});

describe("applyRunEvent", () => {
  it("picks a run up from its snapshot and adds the tokens after it", () => {
    const runs = fold([
      { type: "live", thread: T, run: "r1", text: "Sizing the " },
      { type: "token", thread: T, run: "r1", text: "market." },
      { type: "now", thread: T, run: "r1", text: "Reading brief.md" },
    ]);
    expect(runs.r1).toMatchObject({ thread: T, text: "Sizing the market.", now: "Reading brief.md" });
    expect(inFlight(runs).map((r) => r.run)).toEqual(["r1"]);
  });

  it("settles a run on done with its final text and transcript row, and it's no longer in flight", () => {
    const runs = fold([
      { type: "start", thread: T, run: "r1" },
      { type: "token", thread: T, run: "r1", text: "Let me check." },
      { type: "done", thread: T, run: "r1", text: "US market: $2.1B.", message: 12 },
    ]);
    expect(runs.r1).toMatchObject({ text: "US market: $2.1B.", done: true, message: 12 });
    expect(inFlight(runs)).toEqual([]);
  });

  it("marks a failed run with its error", () => {
    const runs = fold([
      { type: "start", thread: T, run: "r1" },
      { type: "error", thread: T, run: "r1", message: "Crusoe returned 503" },
    ]);
    expect(runs.r1).toMatchObject({ error: "Crusoe returned 503" });
    expect(inFlight(runs)).toEqual([]);
  });
});
