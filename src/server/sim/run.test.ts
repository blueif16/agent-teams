/*
 * One trial end to end against a scripted FakeApp: the owner drives it, the tape records it, and the run's summary
 * and feedback land on disk where the comparison (and Mira's team_stats) read them.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Judge } from "@/lib/sim/driver";
import { CH, MIRA_DM, PIP, TEAM, WREN, fakeChecks, scenario, teamCreated } from "@/lib/sim/fixtures";
import type { LoadedScenario } from "@/lib/sim/load";
import { FakeApp, fakeTime, type FakeEmit, type FakeRule } from "@/lib/sim/port";
import type { OwnerAction, RunFeedback, RunSummary } from "@/lib/sim/types";
import { simDir } from "./dir";
import { readTape } from "./tape";
import { inlineInputs, listRuns, runTrial } from "./run";

beforeEach(() => vi.stubEnv("DATA_DIR", mkdtempSync(path.join(tmpdir(), "sim-run-"))));
afterEach(() => vi.unstubAllEnvs());

const isSend = (a: OwnerAction) => a.kind === "send" && a.place.kind === "dm" && a.place.agentId === "mira";
const isApprove = (a: OwnerAction) => a.kind === "decide" && a.decision === "approve";
const isRedo = (a: OwnerAction) => a.kind === "order" && a.order === "redo";
const say = (from: string, place: typeof CH, text: string): FakeEmit => ({ kind: "say", from, place, text });
const copy = (version: number, text: string): FakeEmit => ({ kind: "artifact", agentId: "wren", teamId: TEAM, path: "copy.md", type: "doc", version, text });
const call = (input: number, output: number, cost: number): FakeEmit => ({
  kind: "ledger",
  row: { t: "call", kind: "run", at: "2026-10-17T20:00:00.000Z", team: TEAM, agent: "wren", model: "m", asked: "m", input, cached: 0, output, ms: 900, cost, ok: true },
});

/** One deliverable, the copy: it must mention Tern. */
const sc = () =>
  scenario({
    expect: { triage: "project", maxExperts: 3, archetypes: ["writer"], deliverables: [{ id: "copy", title: "Copy", type: "doc", by: "writer" }] },
    rubric: [{ id: "copy-tern", deliverable: "copy", kind: "code", check: "mentions", params: { all: ["Tern"] }, label: "The copy names Tern" }],
    reactions: [{ deliverable: "copy", maxRedos: 1 }],
  });

const loaded = (s = sc()): LoadedScenario => ({ scenario: s, file: "kit.yaml", hash: "h".repeat(64), story: "", brief: "", facts: {}, terms: ["Tern"], inputs: [] });

/** Mira proposes, the owner approves, the team forms and the writer posts `first`; a redo gets `second`. */
function world(first: string, second = first): FakeRule[] {
  return [
    { when: isSend, then: [say("mira", MIRA_DM as unknown as typeof CH, "A small team: Pip leads, Wren writes."), { kind: "card", cardId: "l1", card: "launch", from: "mira", place: MIRA_DM, title: "Kit" }] },
    { when: isApprove, then: [teamCreated([PIP, WREN]), say("pip", CH, "Kickoff: Wren writes the copy by today."), call(1000, 200, 0.01), copy(1, first), say("wren", CH, "Copy v1 is up.")] },
    { when: isRedo, then: [call(800, 150, 0.008), copy(2, second), say("wren", CH, "Copy v2 is up.")] },
  ];
}

const passJudge: Judge = async () => ({ pass: true, quote: "" });

async function trial(script: FakeRule[], n = 1) {
  const time = fakeTime();
  const app = new FakeApp({ clock: time.clock, script });
  const summary = await runTrial(loaded(), n, {
    port: app,
    judge: passJudge,
    checks: fakeChecks(),
    clock: time.clock,
    sleep: time.sleep,
    appCommit: "abc123",
    company: { dir: "/tmp/co", vaultCommit: "v0", ledgerRows: 0 },
  });
  return { summary, app };
}

describe("runTrial", () => {
  it("drives a passing run to done and writes its summary where listRuns finds it", async () => {
    const { summary } = await trial(world("Tern writes your CRM notes."));
    expect(summary.stop).toBe("done");
    expect(summary.claims.filter((c) => c.gating && c.pass !== true).map((c) => c.id)).toEqual([]);
    expect(summary.passed).toBe(true);
    expect(summary.trial).toBe(1);
    expect(summary.tokens).toEqual({ input: 1000, cached: 0, output: 200 });
    expect(summary.usd).toBeCloseTo(0.01);
    expect(summary.team.size).toBe(2);
    expect(summary.timeToDoneMs).not.toBeNull();
    expect((await listRuns()).map((r) => r.runId)).toEqual([summary.runId]);
  });

  it("records the whole run on a tape: the owner's first message, the team and the copy", async () => {
    const { summary } = await trial(world("Tern writes your CRM notes."));
    const tape = await readTape(summary.tapeId);
    const kinds = tape!.events.map((e) => e.kind);
    expect(tape!.header.scenarioId).toBe("kit");
    expect(kinds).toContain("team.created");
    expect(kinds).toContain("artifact");
    // The last thing on the tape is the owner's stop, recorded after the driver finished.
    const last = tape!.events.at(-1)!;
    expect(last.kind === "owner" && last.action.kind).toBe("stop");
  });

  it("counts a redo and scores the final version, and its feedback names what failed first", async () => {
    const { summary } = await trial(world("We write your CRM notes.", "Tern writes your CRM notes."));
    expect(summary.redos).toBe(1);
    expect(summary.quality.score).toBe(1);
    expect(summary.quality.firstPass).toBe(0);
    const feedback = JSON.parse(readFileSync(path.join(simDir(), "runs", `${summary.runId}.feedback.json`), "utf8")) as RunFeedback;
    expect(feedback.failed.map((f) => f.itemId)).toEqual(["copy-tern"]);
    expect(feedback.orders.some((o) => o.order === "redo" && o.agentId === "wren")).toBe(true);
  });

  it("puts trials of one scenario, code and starting company in one series", async () => {
    const a = await trial(world("Tern writes your CRM notes."), 1);
    const b = await trial(world("Tern writes your CRM notes."), 2);
    expect(b.summary.series).toEqual(a.summary.series);
    const saved = JSON.parse(readFileSync(path.join(simDir(), "runs", `${b.summary.runId}.json`), "utf8")) as RunSummary;
    expect(saved.trial).toBe(2);
  });
});

describe("inlineInputs", () => {
  it("appends each input file to the opening request, marking confidential ones", () => {
    const l = loaded();
    l.inputs = [
      { path: "clients/x/spec.md", label: "public", text: "# Spec\nThree files." },
      { path: "clients/x/packages.md", label: "owner_private", text: "Pro $24" },
    ];
    const text = inlineInputs(l).request.text;
    expect(text.startsWith(l.scenario.request.text)).toBe(true);
    expect(text).toContain("spec.md");
    expect(text).toContain("Three files.");
    expect(text).toMatch(/packages\.md.*confidential/i);
  });
});
