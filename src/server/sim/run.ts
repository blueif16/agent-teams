/*
 * One trial of a scenario, end to end (design §3–§7): record a tape, let the simulated owner drive the app through
 * the port, then score the run and write what the comparison, the learning step and Mira's team_stats read:
 *   <simDir>/runs/<runId>.json           the RunSummary
 *   <simDir>/runs/<runId>.feedback.json  the RunFeedback (failed items and owner orders, with evidence)
 * The port decides what is driven: the real runtime in the test company, or a FakeApp in tests.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { qualityOf, scoreRun } from "@/lib/sim/claims";
import { runOwner, type Judge, type Phrase } from "@/lib/sim/driver";
import type { LoadedScenario } from "@/lib/sim/load";
import type { AppPort } from "@/lib/sim/port";
import type { Scenario } from "@/lib/sim/scenario";
import type { CheckRegistry } from "@/lib/sim/checks/types";
import { foldRun, type RunState } from "@/lib/sim/state";
import type { OrderKey } from "@/lib/orders";
import type { Phase, RunFeedback, RunSummary, SeriesKey, TapeEvent, TapeHeader } from "@/lib/sim/types";
import { simDir } from "./dir";
import { activeRecording, startRecording, stopRecording } from "./recorder";

export interface TrialDeps {
  port: AppPort;
  judge: Judge;
  /** Words an answer to a question from the known facts; without it the owner says `unknownReply`. */
  phrase?: Phrase;
  checks: CheckRegistry;
  clock: () => number;
  sleep: (ms: number) => Promise<void>;
  appCommit: string;
  company: TapeHeader["company"];
}

const runsDir = () => path.join(simDir(), "runs");

/** The opening request with each input file pasted in, until the thread route carries attachments. */
export function inlineInputs(l: LoadedScenario): Scenario {
  if (!l.inputs.length) return l.scenario;
  const files = l.inputs.map((i) => `--- ${path.basename(i.path)}${i.label === "owner_private" ? " (confidential: don't share or search with it)" : ""} ---\n${i.text.trim()}`);
  return { ...l.scenario, request: { text: `${l.scenario.request.text}\n\n${files.join("\n\n")}` } };
}

/** Every run summary on disk, oldest first. */
export async function listRuns(): Promise<RunSummary[]> {
  let names: string[];
  try {
    names = await readdir(runsDir());
  } catch {
    return [];
  }
  const runs = await Promise.all(
    names.filter((n) => n.endsWith(".json") && !n.endsWith(".feedback.json")).map(async (n) => JSON.parse(await readFile(path.join(runsDir(), n), "utf8")) as RunSummary),
  );
  return runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.trial - b.trial);
}

/** Same scenario file, same code: the series trial 1 started; a fresh one starts from this company. */
async function seriesFor(l: LoadedScenario, deps: TrialDeps): Promise<SeriesKey> {
  const key = { family: l.scenario.family, scenarioHash: l.hash, appCommit: deps.appCommit };
  const first = (await listRuns()).find((r) => r.trial === 1 && r.series.family === key.family && r.series.scenarioHash === key.scenarioHash && r.series.appCommit === key.appCommit);
  return { ...key, baseVaultCommit: first?.series.baseVaultCommit ?? deps.company.vaultCommit };
}

export async function runTrial(l: LoadedScenario, trial: number, deps: TrialDeps): Promise<RunSummary> {
  const scenario = inlineInputs(l);
  const runId = `${l.scenario.id}-t${trial}-${Date.now().toString(36)}`;
  const series = await seriesFor(l, deps);
  const startedAt = new Date().toISOString();
  const tapeId = await startRecording({
    tapeId: runId,
    runId,
    scenarioId: l.scenario.id,
    family: l.scenario.family,
    trial,
    arm: "team",
    title: `${l.scenario.title} · run ${trial}`,
    idleCapMs: 5000,
    keyframeEveryMs: 10_000,
    app: { commit: deps.appCommit, promptHash: l.hash },
    company: deps.company,
  });
  const writer = activeRecording()!.writer;

  // One pump reads the app's stream to its end and puts every event on the tape, stamped with the run's clock;
  // the driver reads a copy. The pump outlives the driver so the events after its last decision (the stop) are kept.
  const events: TapeEvent[] = [];
  const waiting: ((e: TapeEvent | undefined) => void)[] = [];
  const queued: TapeEvent[] = [];
  let ended = false;
  const pump = (async () => {
    try {
      for await (const e of deps.port.events()) {
        const body: Record<string, unknown> = { ...e };
        for (const k of ["seq", "t", "wall", "dur"]) delete body[k];
        writer.append(body as never, undefined, { t: e.t, dur: e.dur });
        events.push(e);
        const next = waiting.shift();
        if (next) next(e);
        else queued.push(e);
      }
    } finally {
      ended = true;
      for (const w of waiting.splice(0)) w(undefined);
    }
  })();
  const port: AppPort = {
    async *events() {
      for (;;) {
        const e = queued.shift() ?? (ended ? undefined : await new Promise<TapeEvent | undefined>((r) => waiting.push(r)));
        if (!e) return;
        yield e;
      }
    },
    act: (a) => deps.port.act(a),
    note: (n) => deps.port.note(n),
    read: (p, c) => deps.port.read(p, c),
  };

  let stop: RunSummary["stop"] = "error";
  let actions = 0;
  try {
    const out = await runOwner({
      scenario,
      port,
      clock: deps.clock,
      sleep: deps.sleep,
      checks: deps.checks,
      judge: deps.judge,
      phrase: deps.phrase ?? (async () => ({ text: scenario.owner.unknownReply, fromKnown: [] })),
      facts: l.facts,
    });
    stop = out.stop;
    actions = out.actions;
    // The driver's stop closes the app's stream; give the pump a moment to record what was still in flight.
    await Promise.race([pump, new Promise((r) => setTimeout(r, 2000))]);
  } finally {
    await stopRecording(tapeId);
  }

  const state = foldRun(events, scenario);
  const texts = new Map<string, string>();
  for (const vs of Object.values(state.versions)) for (const v of vs) texts.set(`${v.path}@${v.commit ?? ""}`, (await deps.port.read(v.path, v.commit)) ?? v.text);
  const judged: Record<string, { pass: boolean | null; quote: string }> = {};
  for (const item of scenario.rubric) {
    if (item.kind !== "judge") continue;
    const v = current(state, item.deliverable);
    judged[item.id] = v ? await deps.judge(texts.get(`${v.path}@${v.commit ?? ""}`) ?? v.text, item.question) : { pass: null, quote: "" };
  }
  const claims = scoreRun({ scenario, events, checks: deps.checks, judged, facts: l.facts, read: (p, c) => texts.get(`${p}@${c ?? ""}`) ?? null });

  const members = state.teams[0]?.members ?? [];
  const firstOwner = state.owner[0]?.t ?? 0;
  const deliverables = scenario.expect.deliverables.map((d) => d.id);
  const allAccepted = deliverables.every((d) => state.accepted[d]);
  const orders: Partial<Record<OrderKey, number>> = {};
  for (const o of state.orders) orders[o.order] = (orders[o.order] ?? 0) + 1;

  const summary: RunSummary = {
    runId,
    scenarioId: l.scenario.id,
    family: l.scenario.family,
    variant: l.scenario.variant,
    trial,
    arm: "team",
    tapeId,
    series,
    startedAt,
    wallMs: state.t,
    timeToDoneMs: allAccepted ? Math.max(...deliverables.map((d) => state.accepted[d].t)) - firstOwner : null,
    phases: phasesOf(state, events),
    stop,
    tokens: state.usage,
    usd: state.usd,
    calls: state.calls,
    cacheHit: state.usage.input ? state.usage.cached / state.usage.input : 0,
    quality: qualityOf(claims, state),
    redos: orders.redo ?? 0,
    team: { size: members.length, rehired: members.filter((m) => m.rehired).length, created: members.filter((m) => !m.rehired).length, members },
    owner: {
      actions,
      revisions: state.owner.filter((o) => o.action.kind === "decide" && o.action.decision === "revise").length,
      orders,
    },
    claims,
    passed: claims.filter((c) => c.gating).every((c) => c.pass === true),
    valid: true,
    company: deps.company,
  };

  await mkdir(runsDir(), { recursive: true });
  await writeFile(path.join(runsDir(), `${runId}.json`), JSON.stringify(summary, null, 2));
  await writeFile(path.join(runsDir(), `${runId}.feedback.json`), JSON.stringify(feedbackOf(summary, scenario, state), null, 2));
  return summary;
}

const current = (s: RunState, id: string) => {
  const vs = s.versions[id] ?? [];
  const accepted = s.accepted[id];
  return (accepted && vs.find((v) => v.version === accepted.version)) || vs.at(-1);
};

/** Failed items on every version the owner reacted to, and every order with its note. */
function feedbackOf(summary: RunSummary, scenario: Scenario, s: RunState): RunFeedback {
  const failed: RunFeedback["failed"] = [];
  for (const v of s.verdicts) {
    if (v.pass) continue;
    const versions = s.versions[v.deliverable] ?? [];
    const version = [...versions].reverse().find((x) => x.seq < v.seq);
    for (const label of v.failed) {
      const item = scenario.rubric.find((r) => r.deliverable === v.deliverable && r.label === label);
      failed.push({
        itemId: item?.id ?? label,
        label,
        deliverable: v.deliverable,
        agentId: version?.agentId ?? "",
        version: version?.version ?? 0,
        evidence: [{ seq: v.seq, t: v.t, ...(version ? { path: version.path } : {}), note: `failed on version ${version?.version ?? "?"}` }],
      });
    }
  }
  const authorOf = (msgId: string) => s.messages.find((m) => m.msgId === msgId)?.from ?? "";
  return {
    runId: summary.runId,
    scenarioId: summary.scenarioId,
    trial: summary.trial,
    failed,
    orders: s.orders.map((o) => ({ order: o.order, agentId: o.target ?? authorOf(o.msgId), ...(o.note ? { note: o.note } : {}), seq: o.seq })),
    slow: [],
  };
}

/** Rough phases from the tape: request → first card (triage), card → team (launch), team → last acceptance (work). */
function phasesOf(s: RunState, events: TapeEvent[]): Phase[] {
  const start = s.owner[0]?.t ?? 0;
  const card = s.cards[0]?.t ?? start;
  const team = s.teams[0]?.t ?? card;
  const done = Math.max(team, ...Object.values(s.accepted).map((a) => a.t));
  const span = (name: Phase["name"], from: number, to: number): Phase => {
    const rows = events.filter((e) => e.kind === "ledger" && e.row.t === "call" && e.t >= from && e.t < to);
    return { name, ms: Math.max(0, to - from), modelMs: rows.reduce((n, e) => n + (e.kind === "ledger" && e.row.t === "call" ? e.row.ms : 0), 0), calls: rows.length };
  };
  return [span("triage", start, card), span("launch", card, team), span("work", team, done)];
}
