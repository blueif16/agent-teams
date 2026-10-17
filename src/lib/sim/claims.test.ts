/*
 * Claims against hand-built tapes. One golden run passes every claim; each variant edits the golden tape the way a
 * real failure would and must break its claim and nothing else, except a claim that follows from it by definition
 * (listed in IMPLIED, with the reason).
 */
import { describe, expect, it } from "vitest";
import { qualityOf, scoreRun, stepVerdict, type ScoreInput } from "./claims";
import { CH, MIRA_DM, TEAM, fakeChecks, scenario, stamp, teamCreated } from "./fixtures";
import { MUST_HAPPEN, MUST_NOT_HAPPEN, type Scenario } from "./scenario";
import { foldRun } from "./state";
import type { ClaimResult, Place, RunSummary, TapeBody } from "./types";

// ---------- the golden run ----------

type T = { tag?: string; body: TapeBody };
const b = (body: TapeBody, tag?: string): T => ({ body, tag });
const sayT = (tag: string, from: string, place: Place, text: string, error?: string): T[] => [
  b({ kind: "msg.start", msgId: tag, place, from }, tag),
  b({ kind: "msg.end", msgId: tag, text, ...(error ? { error } : {}) }, `${tag}.end`),
];

const CHART = '{"type":"bar","x":["Solo","Team"],"series":[{"name":"Price","values":[9,29]}],"unit":"$"}';
const COPY = "Tern helps field sales teams record meetings.\nOne tap, and every meeting is notes.";
const PRICES = "tier,price\nSolo,9\nTeam,29\n";

const SC = scenario({
  expect: {
    triage: "project",
    maxExperts: 3,
    archetypes: ["writer", "analyst"],
    deliverables: [
      { id: "copy", title: "Landing copy", type: "doc", by: "writer", path: "*copy*" },
      { id: "prices", title: "Price table", type: "table", by: "analyst" },
      { id: "chart", title: "Price chart", type: "chart", by: "analyst" },
    ],
    mustHappen: [...MUST_HAPPEN],
    mustNotHappen: [...MUST_NOT_HAPPEN],
  },
  beats: [{ id: "status", why: "A status check.", when: { on: "team.created" }, do: { send: { place: "channel", to: "lead", text: "How is it going?" } } }],
  reactions: [
    { deliverable: "copy", pass: "go", fail: "redo", maxRedos: 1 },
    { deliverable: "prices", pass: "go", fail: "redo", maxRedos: 1 },
    { deliverable: "chart", pass: "go", fail: "redo", maxRedos: 1 },
  ],
});

const call = (cost: number, input: number, output: number): TapeBody => ({
  kind: "ledger",
  row: { t: "call", at: "2026-10-17T12:00:00Z", team: TEAM, agent: "wren", kind: "run", model: "m", asked: "m", input, cached: 0, output, ms: 900, cost, ok: true },
});

function golden(): T[] {
  return [
    b({ kind: "owner", by: "sim", action: { kind: "send", place: MIRA_DM, text: SC.request.text } }, "request"),
    ...sayT("mira1", "mira", MIRA_DM, "On it: a project with Pip as PM."),
    b({ kind: "artifact", agentId: "pip", path: "projects/kit/charter.md", type: "doc", commit: "ch1", version: 1 }, "charter"),
    b({ kind: "card", cardId: "l1", card: "launch", from: "pip", place: MIRA_DM, title: "Launch Kit" }, "card"),
    b({ kind: "sim", note: { what: "gate", cardId: "l1", decision: "approve", rule: "launch.sequence[0]" } }, "gate"),
    b({ kind: "owner", by: "sim", action: { kind: "decide", cardId: "l1", decision: "approve" } }, "decide"),
    b({ kind: "card.decided", cardId: "l1", decision: "approve", by: "sim" }, "decided"),
    b(teamCreated(), "team"),
    ...sayT("kickoff", "pip", CH, "Kickoff: Wren writes the landing copy, Ada builds the price table and its chart."),
    b({ kind: "sim", note: { what: "beat", beat: "status" } }),
    b({ kind: "owner", by: "sim", beat: "status", action: { kind: "send", place: CH, text: "How is it going?" } }, "beat-send"),
    ...sayT("q1", "pip", CH, "Quick one: when is the launch?"),
    b({ kind: "sim", note: { what: "answer", question: "Quick one: when is the launch?", fromKnown: [0] } }),
    b({ kind: "owner", by: "sim", action: { kind: "send", place: CH, text: "It launches on 2026-11-02." } }, "answer"),
    b({ kind: "tool.call", callId: "k1", agentId: "wren", name: "web_search", args: { q: "Tern" } }),
    b({ kind: "tool.result", callId: "k1", ok: true, summary: "Tern records in-person meetings." }),
    b({ kind: "artifact", agentId: "wren", teamId: TEAM, path: "projects/kit/copy.md", type: "doc", commit: "cp1", version: 1 }, "copy"),
    ...sayT("w1", "wren", CH, "Copy v1 is up."),
    b({ kind: "sim", note: { what: "verdict", deliverable: "copy", pass: true, failed: [], order: "go" } }),
    b({ kind: "owner", by: "sim", action: { kind: "order", msgId: "w1", order: "go" } }, "go-copy"),
    b({ kind: "artifact", agentId: "ada", teamId: TEAM, path: "projects/kit/prices.csv", type: "table", commit: "pr1", version: 1 }, "prices"),
    ...sayT("a1", "ada", CH, "Prices table is up.\n```chart\n" + CHART + "\n```"),
    b({ kind: "sim", note: { what: "verdict", deliverable: "prices", pass: true, failed: [], order: "go" } }),
    b({ kind: "owner", by: "sim", action: { kind: "order", msgId: "a1", order: "go" } }),
    b({ kind: "sim", note: { what: "verdict", deliverable: "chart", pass: true, failed: [], order: "go" } }, "verdict-chart"),
    b({ kind: "owner", by: "sim", action: { kind: "order", msgId: "a1", order: "go" } }, "go-chart"),
    b(call(0.5, 10_000, 1_000), "ledger"),
    b({ kind: "project.closed", teamId: TEAM }, "closed"),
    b({ kind: "file.commit", path: "agents/wren/MEMORY.md", commit: "d1", source: "dream", agentId: "wren" }, "dream"),
    b({ kind: "sim", note: { what: "stop", reason: "done" } }, "stop-note"),
    b({ kind: "owner", by: "sim", action: { kind: "stop", reason: "done" } }, "stop"),
  ];
}

// ---------- tape edits ----------

const at = (list: T[], tag: string) => {
  const i = list.findIndex((x) => x.tag === tag);
  if (i < 0) throw new Error(`no event tagged ${tag}`);
  return i;
};
const without = (list: T[], ...tags: string[]) => list.filter((x) => !x.tag || !tags.includes(x.tag));
const after = (list: T[], tag: string, ...items: T[]) => [...list.slice(0, at(list, tag) + 1), ...items, ...list.slice(at(list, tag) + 1)];
const before = (list: T[], tag: string, ...items: T[]) => [...list.slice(0, at(list, tag)), ...items, ...list.slice(at(list, tag))];
const replace = (list: T[], tag: string, body: TapeBody) => list.map((x) => (x.tag === tag ? { ...x, body } : x));

const FILES: Record<string, string> = { "projects/kit/charter.md@ch1": "# Charter\nShip the kit.", "projects/kit/copy.md@cp1": COPY, "projects/kit/prices.csv@pr1": PRICES };

interface Over {
  scenario?: Scenario;
  judged?: ScoreInput["judged"];
  files?: Record<string, string>;
}
function score(list: T[], o: Over = {}): ClaimResult[] {
  const files = { ...FILES, ...o.files };
  return scoreRun({
    scenario: o.scenario ?? SC,
    events: stamp(list.map((x) => x.body)),
    checks: fakeChecks(),
    judged: o.judged ?? { "copy-clear": { pass: true, quote: "field sales teams" } },
    facts: { F1: "Tern records in-person meetings." },
    read: (path, commit) => files[`${path}@${commit}`] ?? null,
  });
}
const failing = (rs: ClaimResult[]) => rs.filter((r) => r.pass !== true).map((r) => r.id);

/** The claims the demo scores: the process claims below, one per rubric item, the budget and the stop. */
const ALL_IDS = ["triage", "launch_card", "post_by_each_expert", "all_accepted", "relay_by_pm", "copy-tern", "copy-short", "copy-clear", "prices-rows", "chart-exists", "budget", "clean_stop"];

// ---------- one variant per claim ----------

const VARIANTS: Record<string, { why: string; tape: () => T[]; over?: Over }> = {
  triage: { why: "an expert took the work alone in a DM before any launch card", tape: () => before(golden(), "charter", ...sayT("solo", "wren", { kind: "dm", agentId: "wren" }, "I'll just write it myself.")) },
  launch_card: { why: "Wren searched before the launch card was approved", tape: () => before(golden(), "card", b({ kind: "tool.call", callId: "k0", agentId: "wren", name: "web_search", args: { q: "Tern pricing" } })) },
  post_by_each_expert: { why: "Ada posted only in a DM, never in the channel", tape: () => replace(golden(), "a1", { kind: "msg.start", msgId: "a1", place: { kind: "dm", agentId: "ada" }, from: "ada" }) },
  all_accepted: { why: "the chart was never accepted", tape: () => without(golden(), "verdict-chart", "go-chart") },
  relay_by_pm: { why: "Pip pasted Wren's copy into the channel", tape: () => after(golden(), "w1.end", ...sayT("relay", "pip", CH, "Here is the copy:\nTern helps field sales teams record meetings.")) },
  "copy-tern": { why: "the copy doesn't name Tern", tape: golden, over: { files: { "projects/kit/copy.md@cp1": "A new app helps field sales teams record meetings." } } },
  "copy-short": { why: "the copy runs long", tape: golden, over: { files: { "projects/kit/copy.md@cp1": `Tern ${"helps field teams record every meeting ".repeat(10)}` } } },
  "copy-clear": { why: "the judge said no", tape: golden, over: { judged: { "copy-clear": { pass: false, quote: "" } } } },
  "prices-rows": { why: "the table has one row", tape: golden, over: { files: { "projects/kit/prices.csv@pr1": "tier,price\nSolo,9\n" } } },
  "chart-exists": { why: "Ada's message carries no chart", tape: () => replace(golden(), "a1.end", { kind: "msg.end", msgId: "a1", text: "Prices table is up." }) },
  budget: { why: "a call pushed spend past maxUsd", tape: () => after(golden(), "ledger", b(call(6, 1_000, 100))) },
  clean_stop: { why: "the run stopped on an error", tape: () => replace(without(golden(), "stop-note"), "stop", { kind: "owner", by: "sim", action: { kind: "stop", reason: "error" } }) },
};

/** Claims that fail along with a variant by definition. */
const IMPLIED: Record<string, string[]> = {
  // a chart that was never written can't be accepted
  "chart-exists": ["all_accepted"],
};

describe("scoreRun", () => {
  it("passes every claim on the golden run, one claim per id, each with evidence", () => {
    const rs = score(golden());
    expect(rs.map((r) => r.id).sort()).toEqual([...ALL_IDS].sort());
    expect(failing(rs)).toEqual([]);
    for (const r of rs) expect(r.evidence.length, r.id).toBeGreaterThan(0);
  });

  it("has a failing variant for every claim id", () => {
    expect(Object.keys(VARIANTS).sort()).toEqual([...ALL_IDS].sort());
  });

  for (const [id, v] of Object.entries(VARIANTS)) {
    it(`breaks ${id} and nothing else when ${v.why}`, () => {
      const rs = score(v.tape(), v.over);
      expect(failing(rs).sort()).toEqual([id, ...(IMPLIED[id] ?? [])].sort());
      expect(rs.find((r) => r.id === id)!.pass).toBe(false);
    });
  }

  it("carries the event seq on evidence lines", () => {
    const rs = score(VARIANTS.launch_card.tape());
    const r = rs.find((x) => x.id === "launch_card")!;
    const seq = stamp(VARIANTS.launch_card.tape().map((x) => x.body)).find((e) => e.kind === "tool.call" && e.callId === "k0")!.seq;
    expect(r.evidence.map((e) => e.seq)).toContain(seq);
  });

  it("scores triage for a solo scenario: one expert in a DM passes, a launch card fails", () => {
    const solo = scenario({ expect: { ...SC.expect, triage: "solo", mustHappen: ["triage"], mustNotHappen: [] } });
    const handoff: T[] = [golden()[0], ...sayT("mira1", "mira", MIRA_DM, "Wren will take this."), ...sayT("w0", "wren", { kind: "dm", agentId: "wren" }, "On it.")];
    expect(score(handoff, { scenario: solo }).find((r) => r.id === "triage")!.pass).toBe(true);
    const proposed = [...handoff, b({ kind: "card", cardId: "l1", card: "launch", from: "mira", place: MIRA_DM, title: "Launch" })];
    expect(score(proposed, { scenario: solo }).find((r) => r.id === "triage")!.pass).toBe(false);
  });

  it("marks advisory judge items non-gating and unjudged ones null", () => {
    const rs = score(golden(), { judged: {} });
    expect(rs.find((r) => r.id === "copy-clear")).toMatchObject({ kind: "judge", gating: false, pass: null });
    expect(rs.find((r) => r.id === "copy-tern")).toMatchObject({ kind: "code", gating: true, pass: true });
  });
});

// ---------- quality, pass^k, the improvement gate ----------

const result = (id: string, pass: boolean | null, kind: ClaimResult["kind"] = "code"): ClaimResult => ({ id, label: id, kind, gating: kind === "code", pass, evidence: [{ note: "x" }] });

describe("qualityOf", () => {
  it("is the rubric pass rate over judged items, first-pass acceptance and the judge pass rate", () => {
    // copy accepted after one redo, prices on the first pass, the chart never
    const tape = stamp([
      teamCreated(),
      { kind: "artifact", agentId: "wren", path: "copy.md", type: "doc", version: 1 },
      { kind: "sim", note: { what: "verdict", deliverable: "copy", pass: false, failed: ["x"], order: "redo" } },
      { kind: "artifact", agentId: "wren", path: "copy.md", type: "doc", version: 2 },
      { kind: "sim", note: { what: "verdict", deliverable: "copy", pass: true, failed: [], order: "go" } },
      { kind: "artifact", agentId: "ada", path: "p.csv", type: "table", version: 1 },
      { kind: "sim", note: { what: "verdict", deliverable: "prices", pass: true, failed: [], order: "go" } },
    ]);
    const results = [result("copy-tern", true), result("copy-short", false), result("copy-clear", true, "judge"), result("prices-rows", true), result("chart-exists", null), result("budget", false), result("launch", false)];
    const q = qualityOf(results, foldRun(tape, SC));
    expect(q.score).toBeCloseTo(3 / 4, 10);
    expect(q.firstPass).toBeCloseTo(1 / 3, 10);
    expect(q.judge).toBe(1);
  });

  it("has no judge rate when no judge item was judged", () => {
    expect(qualityOf([result("copy-tern", true), result("copy-clear", null, "judge")], foldRun([], SC)).judge).toBeNull();
  });
});

function summary(over: Partial<RunSummary> & { trial: number }): RunSummary {
  return {
    runId: `r${over.trial}`,
    scenarioId: "kit",
    family: "kit",
    variant: "base",
    arm: "team",
    tapeId: `t${over.trial}`,
    series: { family: "kit", scenarioHash: "h", appCommit: "c", baseVaultCommit: "v" },
    startedAt: "2026-10-17T12:00:00Z",
    wallMs: 0,
    timeToDoneMs: 100_000,
    phases: [],
    stop: "done",
    tokens: { input: 800_000, cached: 100_000, output: 200_000 },
    usd: 1,
    calls: 10,
    cacheHit: 0.1,
    quality: { score: 0.6, firstPass: 0.5, judge: null },
    redos: 1,
    team: { size: 3, rehired: 0, created: 3, members: [] },
    owner: { actions: 5, revisions: 0, orders: {} },
    claims: [],
    passed: true,
    valid: true,
    company: { dir: ".data/test-company", vaultCommit: "v", ledgerRows: 0 },
    ...over,
  };
}

describe("stepVerdict", () => {
  const BAR = SC.improve;
  const tok = (total: number) => ({ input: total * 0.8, cached: 0, output: total * 0.2 });

  it("is improving when quality, time to done and tokens all clear the bar", () => {
    const v = stepVerdict(summary({ trial: 1 }), summary({ trial: 2, quality: { score: 0.75, firstPass: 1, judge: null }, timeToDoneMs: 70_000, tokens: tok(800_000) }), BAR);
    expect(v).toMatchObject({ from: 1, to: 2, verdict: "improving", reasons: [] });
    expect(v.qualityGain).toBeCloseTo(0.15, 10);
    expect(v.timeCut).toBeCloseTo(0.3, 10);
    expect(v.tokenCut).toBeCloseTo(0.2, 10);
  });

  it("is improving at the quality ceiling without a quality gain", () => {
    const v = stepVerdict(summary({ trial: 2, quality: { score: 0.96, firstPass: 1, judge: null } }), summary({ trial: 3, quality: { score: 0.96, firstPass: 1, judge: null }, timeToDoneMs: 70_000, tokens: tok(800_000) }), BAR);
    expect(v.verdict).toBe("improving");
  });

  it("is stalled when nothing got worse but bars were missed, one reason line per missed bar", () => {
    const v = stepVerdict(summary({ trial: 1 }), summary({ trial: 2, quality: { score: 0.64, firstPass: 1, judge: null }, timeToDoneMs: 92_000, tokens: tok(800_000) }), BAR);
    expect(v.verdict).toBe("stalled");
    expect(v.reasons).toHaveLength(2);
    expect(v.reasons[0]).toMatch(/quality rose 4 points \(60% → 64%\); the bar is 10 points/);
    expect(v.reasons[1]).toMatch(/time to done fell 8% \(100\.0 s → 92\.0 s\); the bar is 20%/);
  });

  it("is regressed when tokens rose, naming the token bar", () => {
    const v = stepVerdict(summary({ trial: 1 }), summary({ trial: 2, quality: { score: 0.75, firstPass: 1, judge: null }, timeToDoneMs: 70_000, tokens: tok(1_100_000) }), BAR);
    expect(v.verdict).toBe("regressed");
    expect(v.reasons).toEqual([expect.stringMatching(/tokens rose 10% \(1,000,000 → 1,100,000\); the bar is a 15% cut/)]);
  });

  it("is regressed when quality fell below the ceiling", () => {
    const v = stepVerdict(summary({ trial: 1, quality: { score: 0.8, firstPass: 1, judge: null } }), summary({ trial: 2, quality: { score: 0.7, firstPass: 1, judge: null }, timeToDoneMs: 70_000, tokens: tok(800_000) }), BAR);
    expect(v.verdict).toBe("regressed");
    expect(v.reasons).toEqual([expect.stringMatching(/quality fell 10 points \(80% → 70%\)/)]);
  });

  it("is regressed when the next run never reached done", () => {
    const v = stepVerdict(summary({ trial: 1 }), summary({ trial: 2, quality: { score: 0.75, firstPass: 1, judge: null }, timeToDoneMs: null, tokens: tok(800_000) }), BAR);
    expect(v.verdict).toBe("regressed");
    expect(v.timeCut).toBeNull();
    expect(v.reasons).toEqual([expect.stringMatching(/run 2 never reached done/)]);
  });
});
