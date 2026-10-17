import { describe, expect, it } from "vitest";
import type { CallEvent, LedgerEvent, OrderEvent, ToolEvent } from "@/lib/ledger";
import type { RunSummary } from "@/lib/sim/types";
import { MAX_OUTPUT_CHARS, MAX_TEAMS, teamStatsTool } from "./team-stats";

const T0 = Date.UTC(2026, 9, 17, 10, 0, 0);
/** ISO time `min` minutes after 10:00 UTC. */
const at = (min: number) => new Date(T0 + Math.round(min * 60_000)).toISOString();

function call(team: string, min: number, input: number, cached: number, output: number, cost: number, ok = true): CallEvent {
  return { t: "call", kind: "run", at: at(min), team, agent: `${team}-lead`, model: "m-main", asked: "m-main", input, cached, output, ms: 900, cost, ok };
}

function paid(team: string, min: number, cost: number, ok = true): ToolEvent {
  return { t: "tool", at: at(min), team, agent: `${team}-lead`, tool: "web_search", endpoint: "ydc-index.io/v1/search", ms: 300, cost, ok };
}

const order = (team: string, min: number): OrderEvent => ({ t: "order", at: at(min), team, agent: `${team}-lead`, order: "go" });

// Beta's first call comes before alpha's; "company" is Mira's HQ team.
const LEDGER: LedgerEvent[] = [
  call("company", 0, 5000, 0, 100, 0.01),
  call("p-beta", 1, 1000, 200, 50, 0.00012),
  call("p-alpha", 2, 2000, 500, 300, 0.00034),
  paid("p-alpha", 3, 0.005),
  call("p-alpha", 10, 3000, 1500, 400, 0.00052),
  paid("p-beta", 20, 0.001),
  paid("p-beta", 21, 0, false),
  call("p-beta", 45.34, 4000, 0, 250, 0.00071, false),
  // An owner order long after the work: an owner signal, not team activity.
  order("p-alpha", 90),
];

// Hand-computed from LEDGER.
const ALPHA = {
  team: "p-alpha",
  tokensIn: 5000,
  cached: 2000,
  tokensOut: 700,
  usd: 0.0009, // 0.00034 + 0.00052 = 0.00086
  calls: 2,
  toolUsd: 0.005,
  firstAt: at(2),
  lastAt: at(10),
  wallMin: 8,
};
const BETA = {
  team: "p-beta",
  tokensIn: 5000,
  cached: 200,
  tokensOut: 300,
  usd: 0.0008, // 0.00012 + 0.00071 = 0.00083
  calls: 2,
  toolUsd: 0.001,
  firstAt: at(1),
  lastAt: at(45.34),
  wallMin: 44.3, // 44.34 minutes
};

/** A complete run summary; tests override what they look at. */
function summary(runId: string, over: Partial<RunSummary> & { projectId?: string } = {}): RunSummary {
  return {
    runId,
    scenarioId: "launch-site",
    family: "launch",
    variant: "base",
    trial: 1,
    arm: "team",
    tapeId: `tape-${runId}`,
    series: { family: "launch", scenarioHash: "h1", appCommit: "c1", baseVaultCommit: "v1" },
    startedAt: at(0),
    wallMs: 3_600_000,
    timeToDoneMs: 1_800_000,
    phases: [],
    stop: "done",
    tokens: { input: 9000, cached: 1000, output: 900 },
    usd: 0.01,
    calls: 12,
    cacheHit: 0.11,
    quality: { score: 0.5, firstPass: 0.5, judge: null },
    redos: 0,
    team: { size: 3, rehired: 0, created: 3, members: [] },
    owner: { actions: 4, revisions: 0, orders: {} },
    claims: [],
    passed: true,
    valid: true,
    company: { dir: ".data/test-company", vaultCommit: "v1", ledgerRows: 0 },
    ...over,
  };
}

const stats = async (deps: Partial<Parameters<typeof teamStatsTool>[0]>, input: { teams?: string[] } = {}) => {
  const t = teamStatsTool({ readLedger: async () => LEDGER, ...deps });
  const out = await t.invoke(input);
  expect(typeof out).toBe("string");
  return JSON.parse(out) as { teams: Record<string, unknown>[]; more?: number };
};

describe("team_stats tool", () => {
  it("is a LangChain tool named team_stats that says when to use it and that it is read-only", () => {
    const t = teamStatsTool({ readLedger: async () => LEDGER });
    expect(t.name).toBe("team_stats");
    expect(t.description).toMatch(/comparing teams' token use, cost, time and quality/i);
    expect(t.description).toMatch(/read-only/i);
  });

  it("rejects input that doesn't fit its schema", async () => {
    const t = teamStatsTool({ readLedger: async () => LEDGER });
    await expect(t.invoke({ teams: "p-alpha" as never })).rejects.toThrow();
  });

  it("sums each team's tokens, model spend and paid tool spend, in first-call order, without HQ", async () => {
    const out = await stats({});
    expect(out.teams).toEqual([BETA, ALPHA]);
  });

  it("returns only the requested teams, in the requested order, with zeros for an unknown id", async () => {
    const out = await stats({}, { teams: ["p-alpha", "p-nope", "p-beta"] });
    expect(out.teams).toEqual([
      ALPHA,
      { team: "p-nope", tokensIn: 0, cached: 0, tokensOut: 0, usd: 0, calls: 0, toolUsd: 0, firstAt: null, lastAt: null, wallMin: 0 },
      BETA,
    ]);
  });

  it("names a team the lookup knows and leaves the name out for one it doesn't", async () => {
    const out = await stats({ teamName: (id) => (id === "p-alpha" ? "Launch site" : undefined) });
    expect(out.teams).toEqual([BETA, { ...ALPHA, name: "Launch site" }]);
    expect(out.teams[0]).not.toHaveProperty("name");
  });

  it("merges trial, quality and time to done from the run that made the team", async () => {
    const runs = [
      summary("run-a", { trial: 2, quality: { score: 0.75, firstPass: 1, judge: null }, timeToDoneMs: 754_000 }),
      // No projectOf entry: matched by its own projectId field. It never finished.
      summary("run-b", { trial: 3, quality: { score: 0.4, firstPass: 0, judge: 0.5 }, timeToDoneMs: null, projectId: "p-beta" }),
      // A run for a team that isn't asked about changes nothing.
      summary("run-c", { trial: 9 }),
    ];
    const out = await stats({
      runSummaries: async () => runs,
      projectOf: (runId) => ({ "run-a": "p-alpha", "run-c": "p-other" })[runId],
    });
    expect(out.teams).toEqual([
      { ...BETA, trial: 3, quality: 0.4, timeToDoneMin: null },
      { ...ALPHA, trial: 2, quality: 0.75, timeToDoneMin: 12.6 }, // 754 s = 12.57 min
    ]);
  });

  describe("with 25 teams", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `p-team-${String(i).padStart(2, "0")}`);
    // Big numbers, long names and a run summary each: the widest entries the tool can make.
    const wide: Partial<Parameters<typeof teamStatsTool>[0]> = {
      readLedger: async () => ids.flatMap((id, i) => [call(id, i, 12_345_678, 1_234_567, 123_456, 12.345678), paid(id, 300 + i, 1.234567)]),
      teamName: (id) => `${id} ${"a very long team name that keeps going ".repeat(4)}`,
      runSummaries: async () => ids.map((id) => summary(`run-${id}`, { trial: 3, quality: { score: 2 / 3, firstPass: 0, judge: null }, projectId: id })),
    };

    it("lists the first 20 teams by first call and says how many more there are", async () => {
      const out = await stats(wide);
      expect(out.teams.map((t) => t.team)).toEqual(ids.slice(0, MAX_TEAMS));
      expect(out.more).toBe(5);
    });

    it("caps 25 requested teams at 20, in the requested order", async () => {
      const asked = [...ids].reverse();
      const out = await stats(wide, { teams: asked });
      expect(out.teams.map((t) => t.team)).toEqual(asked.slice(0, MAX_TEAMS));
      expect(out.more).toBe(5);
    });

    it("keeps the output under the size cap", async () => {
      const t = teamStatsTool({ readLedger: async () => [], ...wide });
      const out: string = await t.invoke({});
      expect(out.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
      expect((JSON.parse(out) as { teams: unknown[] }).teams).toHaveLength(MAX_TEAMS);
    });
  });
});
