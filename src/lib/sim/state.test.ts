import { describe, expect, it } from "vitest";
import { ADA, CH, MIRA_DM, PIP, ROSTER, TEAM, WREN, say, scenario, stamp, teamCreated } from "./fixtures";
import { foldRun, initialState, step } from "./state";
import type { LedgerEvent } from "../ledger";
import type { TapeBody } from "./types";

const S = scenario();
const fold = (bodies: (TapeBody & { at?: number })[]) => foldRun(stamp(bodies), S);
const call = (cost: number, input: number, cached: number, output: number): LedgerEvent => ({
  t: "call", at: "2026-10-17T12:00:00Z", team: TEAM, agent: "wren", kind: "run", model: "m", asked: "m", input, cached, output, ms: 900, cost, ok: true,
});

describe("foldRun: roster", () => {
  it("records the team, its lead and each member's archetype", () => {
    const s = fold([teamCreated()]);
    expect(s.teams).toHaveLength(1);
    expect(s.teams[0].leadId).toBe("pip");
    expect(s.teams[0].members.map((m) => m.agentId)).toEqual(["pip", "wren", "ada"]);
    expect(s.archetypeOf).toMatchObject({ pip: "lead", wren: "writer", ada: "analyst" });
  });

  it("adds a hired member to the team's roster", () => {
    const s = fold([teamCreated([PIP, WREN]), { kind: "member.hired", teamId: TEAM, member: ADA }]);
    expect(s.teams[0].members.map((m) => m.agentId)).toEqual(["pip", "wren", "ada"]);
    expect(s.archetypeOf.ada).toBe("analyst");
  });
});

describe("foldRun: cards", () => {
  it("keeps a card pending until it is decided", () => {
    const pending = fold([{ kind: "card", cardId: "c1", card: "launch", from: "pip", place: MIRA_DM, title: "Launch Kit" }]);
    expect(pending.cards[0].decided).toBeUndefined();
    const decided = fold([
      { kind: "card", cardId: "c1", card: "launch", from: "pip", place: MIRA_DM, title: "Launch Kit" },
      { kind: "card.decided", cardId: "c1", decision: "revise", by: "sim", note: "Smaller" },
    ]);
    expect(decided.cards[0].decided).toMatchObject({ decision: "revise", by: "sim", note: "Smaller", seq: 1 });
  });

  it("numbers launch cards (proposal and launch together) apart from approval cards", () => {
    const s = fold([
      { kind: "card", cardId: "p1", card: "proposal", from: "mira", place: MIRA_DM, title: "Kit" },
      { kind: "card", cardId: "a1", card: "approval", from: "pip", place: CH, title: "Hire Kai" },
      { kind: "card", cardId: "l2", card: "launch", from: "pip", place: MIRA_DM, title: "Kit v2" },
    ]);
    expect(s.cards.map((c) => [c.cardId, c.n])).toEqual([["p1", 0], ["a1", 0], ["l2", 1]]);
  });
});

describe("foldRun: messages", () => {
  it("takes a message's text from msg.end and counts messages per author and place", () => {
    const s = fold([
      ...say("m1", "pip", CH, "Kickoff."),
      ...say("m2", "pip", CH, "Status: on track."),
      ...say("m3", "pip", { kind: "dm", agentId: "pip" }, "A private note."),
    ]);
    expect(s.messages.map((m) => [m.msgId, m.text, m.nth])).toEqual([["m1", "Kickoff.", 1], ["m2", "Status: on track.", 2], ["m3", "A private note.", 1]]);
    expect(s.counts[`pip|channel:${TEAM}`]).toBe(2);
    expect(s.counts["pip|dm:pip"]).toBe(1);
  });

  it("keeps a message open until msg.end, and records an error", () => {
    const open = fold([{ kind: "msg.start", msgId: "m1", place: CH, from: "ada" }, { kind: "msg.delta", msgId: "m1", text: "Work" }]);
    expect(open.messages[0].ended).toBe(false);
    const failed = fold(say("m1", "ada", CH, "", "model timeout"));
    expect(failed.messages[0]).toMatchObject({ ended: true, error: "model timeout" });
  });
});

describe("foldRun: deliverables", () => {
  const artifact = (agentId: string, path: string, type: "doc" | "table", commit: string): TapeBody => ({ kind: "artifact", agentId, path, type, commit, version: 1 });

  it("maps an artifact to a deliverable by type, then the author's archetype, then the path glob", () => {
    const s = fold([
      teamCreated(),
      artifact("wren", "projects/kit/copy.md", "doc", "c1"),
      // wrong archetype: the lead's doc is not the writer's copy
      artifact("pip", "projects/kit/copy-notes.md", "doc", "c2"),
      // right author and type, but the path doesn't match "*copy*"
      artifact("wren", "projects/kit/faq.md", "doc", "c3"),
      artifact("ada", "projects/kit/prices.csv", "table", "c4"),
    ]);
    expect(s.versions.copy.map((v) => v.commit)).toEqual(["c1"]);
    expect(s.versions.prices.map((v) => v.commit)).toEqual(["c4"]);
    expect(s.versions.copy[0]).toMatchObject({ deliverable: "copy", version: 1, source: "artifact", agentId: "wren", path: "projects/kit/copy.md" });
  });

  it("numbers versions per deliverable in landing order", () => {
    const s = fold([teamCreated(), artifact("wren", "copy.md", "doc", "c1"), artifact("ada", "p.csv", "table", "c2"), artifact("wren", "copy.md", "doc", "c3")]);
    expect(s.versions.copy.map((v) => v.version)).toEqual([1, 2]);
    expect(s.versions.prices.map((v) => v.version)).toEqual([1]);
  });

  it("takes a chart fence in a finished message from the deliverable's archetype as a chart version", () => {
    const body = '{"type":"bar","x":["Solo","Team"],"series":[{"name":"Price","values":[9,29]}],"unit":"$"}';
    const s = fold([
      teamCreated(),
      ...say("m1", "pip", CH, "Here is a chart:\n```chart\n" + body + "\n```"),
      ...say("m2", "ada", CH, "Prices by tier.\n```chart\n" + body + "\n```\nDone."),
    ]);
    expect(s.versions.chart).toHaveLength(1);
    expect(s.versions.chart[0]).toMatchObject({ source: "chart", agentId: "ada", text: body, msgId: "m2", path: "msg:m2" });
    expect(s.charts.map((c) => c.agentId)).toEqual(["pip", "ada"]);
    expect(s.charts[1].spec).toMatchObject({ type: "bar", unit: "$" });
  });

  it("accepts a deliverable on a verdict with the reaction's pass order, not on a fail", () => {
    const sc = scenario({ reactions: [{ deliverable: "copy", pass: "go", fail: "redo", maxRedos: 1 }] });
    const events = stamp([
      teamCreated(),
      artifact("wren", "copy.md", "doc", "c1"),
      { kind: "sim", note: { what: "verdict", deliverable: "copy", pass: false, failed: ["The copy names Tern"], order: "redo" } },
      artifact("wren", "copy.md", "doc", "c2"),
      { kind: "sim", note: { what: "verdict", deliverable: "copy", pass: true, failed: [], order: "go" } },
    ]);
    expect(foldRun(events.slice(0, 3), sc).accepted.copy).toBeUndefined();
    expect(foldRun(events, sc).accepted.copy).toMatchObject({ version: 2, seq: 4 });
    expect(foldRun(events, sc).verdicts.map((v) => v.order)).toEqual(["redo", "go"]);
  });
});

describe("foldRun: owner, cost, activity", () => {
  it("records owner orders with the author of the message they target", () => {
    const s = fold([
      ...say("m1", "wren", CH, "Copy v1."),
      { kind: "owner", by: "sim", action: { kind: "order", msgId: "m1", order: "redo", note: "Failed: The copy names Tern" } },
    ]);
    expect(s.owner).toHaveLength(1);
    expect(s.orders[0]).toMatchObject({ msgId: "m1", order: "redo", target: "wren", by: "sim" });
  });

  it("adds tokens and USD from ledger call rows, and USD only from paid tool rows", () => {
    const tool: LedgerEvent = { t: "tool", at: "2026-10-17T12:00:00Z", team: TEAM, agent: "ada", tool: "web_search", ms: 300, cost: 0.01, ok: true };
    const s = fold([{ kind: "ledger", row: call(0.2, 1000, 200, 300) }, { kind: "ledger", row: call(0.3, 500, 0, 100) }, { kind: "ledger", row: tool }]);
    expect(s.usage).toEqual({ input: 1500, cached: 200, output: 400 });
    expect(s.usd).toBeCloseTo(0.51, 10);
    expect(s.calls).toBe(2);
  });

  it("moves the last activity on agent events, not on owner or sim events", () => {
    const s = fold([
      { kind: "agent.status", agentId: "pip", status: "working", at: 4000 },
      { kind: "owner", by: "sim", action: { kind: "send", place: MIRA_DM, text: "Hi" }, at: 9000 },
      { kind: "sim", note: { what: "beat", beat: "b1" }, at: 9500 },
    ]);
    expect(s.lastActivity).toBe(4000);
  });

  it("records timers, closed projects and the stop", () => {
    const s = fold([
      { kind: "timer", name: "heartbeat", agentId: "mira" },
      { kind: "project.closed", teamId: TEAM },
      { kind: "owner", by: "sim", action: { kind: "stop", reason: "done" } },
    ]);
    expect(s.timers.map((x) => x.name)).toEqual(["heartbeat"]);
    expect(s.closed.map((c) => c.teamId)).toEqual([TEAM]);
    expect(s.stop).toMatchObject({ reason: "done", seq: 2 });
  });

  it("never changes the state it is given", () => {
    const s0 = foldRun(stamp([teamCreated(), ...say("m1", "pip", CH, "Kickoff.")]), S);
    const before = JSON.stringify(s0);
    step(s0, { seq: 9, t: 9000, kind: "member.hired", teamId: TEAM, member: { agentId: "kai", name: "Kai", archetype: "designer", rehired: false } });
    step(s0, { seq: 10, t: 9000, kind: "msg.end", msgId: "m1", text: "Changed" });
    expect(JSON.stringify(s0)).toBe(before);
    expect(initialState(S).teams).toEqual([]);
    expect(ROSTER).toHaveLength(3);
  });
});
