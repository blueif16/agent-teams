/*
 * The owner driver against a scripted FakeApp on a fake clock: every behavior is observed through what the driver
 * did to the app (its actions and notes on the tape), never through its internals.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runOwner, type Judge, type Phrase } from "./driver";
import { CH, MIRA_DM, TEAM, fakeChecks, scenario, teamCreated } from "./fixtures";
import { FakeApp, fakeTime, type FakeEmit, type FakeRule } from "./port";
import type { Scenario, ScenarioInput } from "./scenario";
import type { OwnerAction, Place, TapeEvent } from "./types";

// ---------- the world ----------

const isSend = (to: string) => (a: OwnerAction) => a.kind === "send" && a.place.kind === "dm" && a.place.agentId === to;
const isDecide = (cardId: string, decision?: string) => (a: OwnerAction) => a.kind === "decide" && a.cardId === cardId && (!decision || a.decision === decision);
const isOrder = (order: string) => (a: OwnerAction) => a.kind === "order" && a.order === order;
const say = (from: string, place: Place, text: string, msgId?: string): FakeEmit => ({ kind: "say", from, place, text, ...(msgId ? { msgId } : {}) });
const launchCard = (cardId: string, title = "Launch Kit"): FakeEmit => ({ kind: "card", cardId, card: "launch", from: "pip", place: MIRA_DM, title });
const copy = (version: number, text: string): FakeEmit => ({ kind: "artifact", agentId: "wren", teamId: TEAM, path: "projects/kit/copy.md", type: "doc", commit: `copy-${version}`, version, text });

const KICKOFF = say("pip", CH, "Kickoff: Wren writes the copy, Ada builds the price table.", "kickoff");

/** Request → Mira's reply and a launch card; approve → the team and the kickoff; then whatever `after` adds. */
function world(after: FakeEmit[] = [], more: FakeRule[] = []): FakeRule[] {
  return [
    { when: isSend("mira"), then: [say("mira", MIRA_DM, "On it: a project with Pip as PM."), launchCard("l1")] },
    { when: isDecide("l1", "approve"), then: [teamCreated(), KICKOFF, ...after] },
    ...more,
  ];
}

const passJudge: Judge = async () => ({ pass: true, quote: "" });
const noPhrase: Phrase = async () => {
  throw new Error("phrase should not be called");
};

async function run(sc: Scenario, script: FakeRule[], o: { judge?: Judge; phrase?: Phrase; sleep?: (time: ReturnType<typeof fakeTime>, app: FakeApp) => (ms: number) => Promise<void> } = {}) {
  const time = fakeTime();
  const app = new FakeApp({ clock: time.clock, script });
  const result = await runOwner({
    scenario: sc,
    port: app,
    clock: time.clock,
    sleep: o.sleep ? o.sleep(time, app) : time.sleep,
    checks: fakeChecks(),
    judge: o.judge ?? passJudge,
    phrase: o.phrase ?? noPhrase,
    facts: {},
  });
  return { result, app, time };
}

const owner = (tape: TapeEvent[]) => tape.filter((e): e is Extract<TapeEvent, { kind: "owner" }> => e.kind === "owner");
const sends = (tape: TapeEvent[]) => owner(tape).filter((e) => e.action.kind === "send");
const seqOf = (tape: TapeEvent[], pred: (e: TapeEvent) => boolean) => tape.findIndex(pred);
const stopNote = (app: FakeApp) => app.notes.find((n) => n.what === "stop");

/** A scenario with one deliverable (the copy), reacted to with go/redo. */
const copyOnly = (over: Partial<ScenarioInput> = {}) =>
  scenario({
    expect: { triage: "project", maxExperts: 3, archetypes: ["writer"], deliverables: [{ id: "copy", title: "Landing copy", type: "doc", by: "writer", path: "*copy*" }] },
    rubric: [
      { id: "copy-tern", deliverable: "copy", kind: "code", check: "mentions", params: { all: ["Tern"] }, label: "The copy names Tern" },
      { id: "copy-short", deliverable: "copy", kind: "code", check: "max_words", params: { max: 50 }, label: "The copy is at most 50 words" },
      { id: "copy-clear", deliverable: "copy", kind: "judge", question: "Does the copy say who Tern is for?", label: "The copy names the buyer" },
    ],
    reactions: [{ deliverable: "copy", pass: "go", fail: "redo", maxRedos: 1 }],
    ...over,
  });

// ---------- the opening and the beats ----------

describe("runOwner: the opening and the beats", () => {
  it("sends request.text to Mira's DM as its first action", async () => {
    const sc = scenario();
    const { app } = await run(sc, world());
    expect(app.acted[0]).toEqual({ kind: "send", place: MIRA_DM, text: sc.request.text });
  });

  it("fires a team.created beat once, after the team exists, to the lead in the channel without a mention", async () => {
    const sc = scenario({ beats: [{ id: "status", why: "A status check.", when: { on: "team.created" }, do: { send: { place: "channel", to: "lead", text: "How is it going?" } } }] });
    const { app } = await run(sc, world([say("pip", CH, "Going well."), say("pip", CH, "Still going.")]));
    const fired = sends(app.tape).filter((e) => e.action.kind === "send" && e.action.text === "How is it going?");
    expect(fired).toHaveLength(1);
    expect(fired[0].action).toEqual({ kind: "send", place: CH, text: "How is it going?" });
    expect(fired[0].beat).toBe("status");
    expect(fired[0].seq).toBeGreaterThan(seqOf(app.tape, (e) => e.kind === "team.created"));
    expect(app.notes.filter((n) => n.what === "beat")).toEqual([{ what: "beat", beat: "status" }]);
  });

  it("fires a message beat at the nth matching message in its place, @-mentioning an archetype in the channel", async () => {
    const nudge = (id: string, nth: number, text: string) => ({ id, why: "A new requirement.", when: { on: "message" as const, from: "writer" as const, place: "channel" as const, nth }, do: { send: { place: "channel" as const, to: "writer" as const, text } } });
    // three channel messages and one DM: nth 3 fires, nth 4 must not (the DM doesn't count)
    const sc = scenario({ beats: [nudge("third", 3, "Add the launch date, please."), nudge("fourth", 4, "Add the price too.")] });
    const { app } = await run(sc, world([say("wren", CH, "Draft one.", "w1"), say("wren", { kind: "dm", agentId: "wren" }, "A DM, not counted.", "wdm"), say("wren", CH, "Draft two.", "w2"), say("wren", CH, "Draft three.", "w3")]));
    const fired = sends(app.tape).filter((e) => e.beat === "third");
    expect(fired).toHaveLength(1);
    expect(fired[0].action).toEqual({ kind: "send", place: CH, text: "Add the launch date, please.", mention: "wren" });
    expect(sends(app.tape).some((e) => e.beat === "fourth")).toBe(false);
  });

  it("waits afterSec on the clock after the beat it follows, then DMs the lead", async () => {
    const sc = scenario({
      beats: [
        { id: "first", why: "Opening check.", when: { on: "team.created" }, do: { send: { place: "channel", to: "lead", text: "Hello team." } } },
        { id: "later", why: "A follow-up.", when: { on: "beat", id: "first", afterSec: 30 }, do: { send: { place: "dm", to: "lead", text: "Any blockers?" } } },
      ],
    });
    const { app } = await run(sc, world());
    const first = sends(app.tape).find((e) => e.beat === "first")!;
    const later = sends(app.tape).filter((e) => e.beat === "later");
    expect(later).toHaveLength(1);
    expect(later[0].action).toEqual({ kind: "send", place: { kind: "dm", agentId: "pip" }, text: "Any blockers?" });
    expect(later[0].t - first.t).toBeGreaterThanOrEqual(30_000);
    expect(later[0].t - first.t).toBeLessThan(32_000);
  });

  it("fires an idle beat once, when no agent event came for its seconds", async () => {
    const sc = scenario({ beats: [{ id: "tick", why: "Wakes the team.", when: { on: "idle", sec: 120 }, do: { advance: "heartbeat" } }] });
    const { app } = await run(sc, world([], [{ when: (a) => a.kind === "advance", then: [{ kind: "timer", name: "heartbeat", agentId: "mira" }, say("mira", MIRA_DM, "All quiet.")], repeat: true }]));
    const advances = owner(app.tape).filter((e) => e.action.kind === "advance");
    expect(advances).toHaveLength(1);
    expect(advances[0].action).toEqual({ kind: "advance", to: "heartbeat", teamId: TEAM });
    const lastBefore = app.tape.filter((e) => e.seq < advances[0].seq && e.kind !== "owner" && e.kind !== "sim").at(-1)!;
    expect(advances[0].t - lastBefore.t).toBeGreaterThanOrEqual(120_000);
    expect(advances[0].t - lastBefore.t).toBeLessThan(122_000);
  });

  it("orders on the member's latest message when a deliverable lands", async () => {
    const sc = scenario({ beats: [{ id: "keep", why: "A standing instruction.", when: { on: "deliverable", id: "copy" }, do: { order: { on: "writer", order: "pin", note: "Always name Tern." } } }] });
    const { app } = await run(sc, world([say("wren", CH, "Starting.", "w1"), copy(1, "Tern for field teams."), say("wren", CH, "Copy v1 is up.", "w2")]));
    const orders = owner(app.tape).filter((e) => e.action.kind === "order" && e.action.order === "pin");
    expect(orders).toHaveLength(1);
    expect(orders[0].action).toEqual({ kind: "order", msgId: "w2", order: "pin", note: "Always name Tern." });
  });
});

// ---------- gates ----------

describe("runOwner: the launch card and approval cards", () => {
  it("decides a revise-then-approve launch script in order", async () => {
    const sc = scenario({ gates: { launch: { sequence: [{ decision: "revise", note: "Two experts at most." }, { decision: "approve" }], maxRevisions: 1 } } });
    const script: FakeRule[] = [
      { when: isSend("mira"), then: [launchCard("l1")] },
      { when: isDecide("l1", "revise"), then: [launchCard("l2", "Launch Kit (smaller)")] },
      { when: isDecide("l2", "approve"), then: [teamCreated(), KICKOFF] },
    ];
    const { app } = await run(sc, script);
    const decisions = app.acted.filter((a) => a.kind === "decide");
    expect(decisions).toEqual([
      { kind: "decide", cardId: "l1", decision: "revise", note: "Two experts at most." },
      { kind: "decide", cardId: "l2", decision: "approve" },
    ]);
    expect(app.notes.filter((n) => n.what === "gate").map((n) => n.what === "gate" && [n.cardId, n.decision])).toEqual([["l1", "revise"], ["l2", "approve"]]);
    expect(app.tape.some((e) => e.kind === "team.created")).toBe(true);
  });

  it("declines a launch card beyond the script when onExtra is decline, and keeps going", async () => {
    const sc = scenario({ gates: { launch: { sequence: [{ decision: "approve" }], onExtra: "decline" } } });
    const { app, result } = await run(sc, world([launchCard("l2", "Launch Kit again")]));
    expect(app.acted.filter((a) => a.kind === "decide")).toEqual([
      { kind: "decide", cardId: "l1", decision: "approve" },
      { kind: "decide", cardId: "l2", decision: "decline" },
    ]);
    expect(result.stop).not.toBe("error");
  });

  it("stops with error on a launch card beyond the script when onExtra is fail", async () => {
    const sc = scenario({ gates: { launch: { sequence: [{ decision: "approve" }], onExtra: "fail" } } });
    const { app, result } = await run(sc, world([launchCard("l2", "Launch Kit again")]));
    expect(result.stop).toBe("error");
    expect(app.acted.filter((a) => a.kind === "decide").map((a) => a.kind === "decide" && a.cardId)).toEqual(["l1"]);
    expect(app.acted.at(-1)).toEqual({ kind: "stop", reason: "error" });
  });

  it("applies an approval rule only when its maxUsd covers the card's cost, else the default", async () => {
    const sc = scenario({ gates: { approval: { default: "decline", rules: [{ match: "^Hire ", decision: "approve", maxUsd: 2 }] } } });
    const card = (cardId: string, title: string, usd: number): FakeEmit => ({ kind: "card", cardId, card: "approval", from: "pip", place: CH, title, detail: { usd } });
    const { app } = await run(sc, world([card("a1", "Hire Kai, a designer", 5), card("a2", "Hire Ivy, a researcher", 1.5), card("a3", "Buy a stock photo", 1)]));
    expect(app.acted.filter((a) => a.kind === "decide" && a.cardId.startsWith("a"))).toEqual([
      { kind: "decide", cardId: "a1", decision: "decline" },
      { kind: "decide", cardId: "a2", decision: "approve" },
      { kind: "decide", cardId: "a3", decision: "decline" },
    ]);
  });
});

// ---------- reactions ----------

describe("runOwner: reactions to deliverables", () => {
  it("orders redo naming the failed items, then go at the redo cap", async () => {
    const sc = copyOnly();
    const script = world([copy(1, "A new app for field sales teams."), say("wren", CH, "Copy v1 is up.", "w1")], [
      { when: isOrder("redo"), then: [copy(2, "A better app for field sales teams."), say("wren", CH, "Copy v2 is up.", "w2")] },
    ]);
    const { app, result } = await run(sc, script);
    const orders = app.acted.filter((a) => a.kind === "order");
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({ kind: "order", msgId: "w1", order: "redo" });
    expect(orders[0].kind === "order" && orders[0].note).toContain("The copy names Tern");
    expect(orders[0].kind === "order" && orders[0].note).not.toContain("at most 50 words");
    expect(orders[1]).toMatchObject({ kind: "order", msgId: "w2", order: "go" });
    expect(orders[1].kind === "order" && orders[1].note).toMatch(/redo cap/);
    expect(app.notes.filter((n) => n.what === "verdict")).toEqual([
      { what: "verdict", deliverable: "copy", pass: false, failed: ["The copy names Tern"], order: "redo" },
      { what: "verdict", deliverable: "copy", pass: false, failed: ["The copy names Tern"], order: "go" },
    ]);
    expect(result.stop).toBe("done");
  });

  it("orders go when every gating code item passes, whatever an advisory judge item says", async () => {
    const sc = copyOnly();
    const asked: string[] = [];
    const judge: Judge = async (text, question) => {
      asked.push(`${question} | ${text}`);
      return { pass: false, quote: "" };
    };
    const { app } = await run(sc, world([copy(1, "Tern records field meetings."), say("wren", CH, "Copy v1 is up.", "w1")]), { judge });
    expect(app.acted.filter((a) => a.kind === "order")).toEqual([{ kind: "order", msgId: "w1", order: "go" }]);
    expect(asked).toEqual(["Does the copy say who Tern is for? | Tern records field meetings."]);
  });

  it("waits for the author's message after the artifact, else after 5 s orders on their latest earlier message", async () => {
    const sc = copyOnly();
    const { app } = await run(sc, world([say("wren", CH, "Working on the copy.", "w0"), copy(1, "Tern for field teams.")]));
    const order = owner(app.tape).find((e) => e.action.kind === "order")!;
    expect(order.action).toMatchObject({ msgId: "w0", order: "go" });
    const landed = app.tape.find((e) => e.kind === "artifact")!;
    expect(order.t - landed.t).toBeGreaterThanOrEqual(5_000);
  });
});

// ---------- questions ----------

describe("runOwner: questions", () => {
  it("answers a question the known facts can't answer with unknownReply, never the model's guess", async () => {
    const sc = scenario();
    const phrase: Phrase = async () => ({ text: "Blue, obviously.", fromKnown: [] });
    const { app } = await run(sc, world([say("pip", CH, "What colour should the logo be?", "q1")]), { phrase });
    const answer = sends(app.tape).find((e) => e.action.kind === "send" && e.action.place.kind === "channel")!;
    expect(answer.action).toEqual({ kind: "send", place: CH, text: sc.owner.unknownReply });
    expect(app.notes.find((n) => n.what === "answer")).toEqual({ what: "answer", question: "What colour should the logo be?", fromKnown: [] });
  });

  it("answers from the known facts with the phrased text, 5 s after the question", async () => {
    const sc = scenario();
    const calls: [string, string[], string][] = [];
    const phrase: Phrase = async (q, known, persona) => {
      calls.push([q, known, persona]);
      return { text: "It launches on 2026-11-02.", fromKnown: [0] };
    };
    const { app } = await run(sc, world([say("pip", CH, "Kickoff done. When is the launch?", "q1")]), { phrase });
    expect(calls).toEqual([["Kickoff done. When is the launch?", sc.owner.known, sc.owner.persona]]);
    const answer = sends(app.tape).find((e) => e.action.kind === "send" && e.action.place.kind === "channel")!;
    expect(answer.action).toEqual({ kind: "send", place: CH, text: "It launches on 2026-11-02." });
    const asked = app.tape.find((e) => e.kind === "msg.end" && e.msgId === "q1")!;
    expect(answer.t - asked.t).toBeGreaterThanOrEqual(5_000);
    expect(app.notes.find((n) => n.what === "answer")).toEqual({ what: "answer", question: "Kickoff done. When is the launch?", fromKnown: [0] });
  });

  it("answers Mira's DM questions and needs-input lines, but not statements", async () => {
    const sc = scenario();
    const asked: string[] = [];
    const phrase: Phrase = async (q) => {
      asked.push(q);
      return { text: "x", fromKnown: [] };
    };
    const script: FakeRule[] = [
      { when: isSend("mira"), then: [say("mira", MIRA_DM, "Is this for the November launch?"), say("mira", MIRA_DM, "Noted."), say("ada", CH, "Prices are drafted.\nneeds input: which currency to use"), say("ada", CH, "Prices drafted. Next: the chart.")] },
    ];
    await run(sc, script, { phrase });
    expect(asked).toEqual(["Is this for the November launch?", "which currency to use"]);
  });

  it("leaves a question alone when a beat answered it within 5 s", async () => {
    const sc = scenario({ beats: [{ id: "budget", why: "Gives the ads budget.", when: { on: "message", from: "lead", contains: "budget" }, do: { send: { place: "channel", to: "lead", text: "The ads budget is $500." } } }] });
    let phrased = 0;
    const phrase: Phrase = async () => {
      phrased++;
      return { text: "x", fromKnown: [] };
    };
    const { app } = await run(sc, world([say("pip", CH, "What is the ads budget?", "q1")]), { phrase });
    expect(phrased).toBe(0);
    expect(app.notes.some((n) => n.what === "answer")).toBe(false);
    expect(sends(app.tape).filter((e) => e.beat === "budget")).toHaveLength(1);
  });
});

// ---------- stops ----------

describe("runOwner: stop conditions (fake clock)", () => {
  const expectStop = (app: FakeApp, reason: string) => {
    expect(stopNote(app)).toEqual({ what: "stop", reason });
    expect(app.acted.at(-1)).toEqual({ kind: "stop", reason });
    // the note comes before the action on the tape
    expect(seqOf(app.tape, (e) => e.kind === "sim" && e.note.what === "stop")).toBeLessThan(seqOf(app.tape, (e) => e.kind === "owner" && e.action.kind === "stop"));
  };

  it("stops with done when every deliverable is accepted", async () => {
    const { app, result } = await run(copyOnly(), world([copy(1, "Tern records field meetings."), say("wren", CH, "Copy v1 is up.", "w1")]));
    expect(result).toEqual({ stop: "done", actions: 3 });
    expectStop(app, "done");
  });

  it("stops with done when the project closed, for stop.when project_closed", async () => {
    const sc = scenario({ stop: { when: "project_closed", maxOwnerActions: 40, maxWallMin: 60, idleMin: 10 } });
    const { app, result } = await run(sc, world([{ kind: "project.closed", teamId: TEAM }]));
    expect(result.stop).toBe("done");
    expectStop(app, "done");
  });

  it("stops with max_actions instead of taking an action past the cap", async () => {
    const sc = scenario({
      stop: { when: "all_accepted", maxOwnerActions: 2, maxWallMin: 60, idleMin: 10 },
      beats: [{ id: "status", why: "A status check.", when: { on: "team.created" }, do: { send: { place: "channel", to: "lead", text: "How is it going?" } } }],
    });
    const { app, result } = await run(sc, world());
    expect(result).toEqual({ stop: "max_actions", actions: 2 });
    expect(app.acted.filter((a) => a.kind !== "stop")).toHaveLength(2);
    expect(app.notes.some((n) => n.what === "beat")).toBe(false);
    expectStop(app, "max_actions");
  });

  it("stops with max_wall at maxWallMin, even while the team is busy", async () => {
    const sc = scenario({ stop: { when: "all_accepted", maxOwnerActions: 40, maxWallMin: 1, idleMin: 0.5 } });
    // the team keeps working: a status event every 10 s
    const busy = (time: ReturnType<typeof fakeTime>, app: FakeApp) => async (ms: number) => {
      await time.sleep(ms);
      if (time.clock() % 10_000 === 0) app.emit({ kind: "agent.status", agentId: "pip", status: "working" });
    };
    const { app, result } = await run(sc, world(), { sleep: busy });
    expect(result.stop).toBe("max_wall");
    const stop = owner(app.tape).find((e) => e.action.kind === "stop")!;
    expect(stop.t).toBeGreaterThanOrEqual(60_000);
    expect(stop.t).toBeLessThan(62_000);
    expectStop(app, "max_wall");
  });

  it("stops with budget when ledger USD reaches maxUsd", async () => {
    const row = { t: "call", at: "2026-10-17T12:00:00Z", team: TEAM, agent: "pip", kind: "run", model: "m", asked: "m", input: 1000, cached: 0, output: 100, ms: 800, cost: 5, ok: true } as const;
    const { app, result } = await run(scenario(), world([{ kind: "ledger", row }]));
    expect(result.stop).toBe("budget");
    expectStop(app, "budget");
  });

  it("stops with budget when ledger tokens reach maxTokens", async () => {
    const row = { t: "call", at: "2026-10-17T12:00:00Z", team: TEAM, agent: "pip", kind: "run", model: "m", asked: "m", input: 1_500_000, cached: 1_000_000, output: 500_000, ms: 800, cost: 0.5, ok: true } as const;
    const { app, result } = await run(scenario(), world([{ kind: "ledger", row }]));
    expect(result.stop).toBe("budget");
    expectStop(app, "budget");
  });

  it("stops with idle after idleMin without agent activity, counted from the last activity", async () => {
    const sc = scenario({ stop: { when: "all_accepted", maxOwnerActions: 40, maxWallMin: 60, idleMin: 1 } });
    // one late agent event at 30 s pushes the idle stop to 90 s
    let late = false;
    const lateStatus = (time: ReturnType<typeof fakeTime>, app: FakeApp) => async (ms: number) => {
      await time.sleep(ms);
      if (!late && time.clock() >= 30_000) {
        late = true;
        app.emit({ kind: "agent.status", agentId: "ada", status: "working" });
      }
    };
    const { app, result } = await run(sc, world(), { sleep: lateStatus });
    expect(result.stop).toBe("idle");
    const stop = owner(app.tape).find((e) => e.action.kind === "stop")!;
    expect(stop.t).toBeGreaterThanOrEqual(90_000);
    expect(stop.t).toBeLessThan(92_000);
    expectStop(app, "idle");
  });

  it("stops with aborted when the app ends the event stream", async () => {
    const script: FakeRule[] = [{ when: isSend("mira"), then: (_a, app) => (app.close(), []) }];
    const { app, result } = await run(scenario(), script);
    expect(result.stop).toBe("aborted");
    expect(stopNote(app)).toEqual({ what: "stop", reason: "aborted" });
  });
});

describe("runOwner: determinism fences", () => {
  it("reads no wall clock, no randomness and no network in the driver", () => {
    const src = readFileSync(new URL("./driver.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(/\bDate\b/);
    expect(src).not.toMatch(/Math\.random/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/performance\.now/);
  });
});
