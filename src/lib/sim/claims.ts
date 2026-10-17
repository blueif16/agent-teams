/*
 * Scoring a finished run (docs/design/test-mode.md §6, §7; J §Scoring a team run). scoreRun folds the tape with the
 * same state the driver used and turns it into claims, each with evidence lines that carry the event seq, so a
 * person can check every verdict against the tape. qualityOf and stepVerdict turn claims into the numbers the
 * series compares run over run, and the improvement gate between two runs.
 *
 * What each process claim observes on the tape (only the ids the scenario lists in mustHappen / mustNotHappen):
 * - triage (project): a launch card or a team appeared, and no agent other than Mira or a lead posted in a DM
 *   before the first launch card (or, without one, before the team): nobody took the work solo.
 *   triage (solo): no launch card and no team, and an agent other than Mira posted a finished message in a DM.
 * - launch_card: a launch card (proposal or launch) was shown, and no expert (an agent that is neither Mira nor a
 *   team lead) wrote an artifact or called a tool before the first launch card was approved (anywhere on the tape
 *   if none was).
 * - post_by_each_expert: on the first team, every member but the lead finished at least one non-empty message
 *   without an error in the team's channel. null without a team.
 * - all_accepted: every expected deliverable has an accepted version (a verdict with the reaction's pass order).
 * - relay_by_pm (must not happen): a deliverable's text first appears in a lead's message rather than its
 *   author's. The text is each line of 40+ characters of a version's vault file, or a chart's fence body; the
 *   first finished message containing it decides. null when no deliverable version was written.
 * Plus, always:
 * - one claim per rubric item on the deliverable's current version (accepted, else latest): code items through
 *   the checks, judge items from `judged` (advisory unless gating; null when not judged);
 * - budget: ledger USD ≤ maxUsd and tokens (input + output) ≤ maxTokens;
 * - clean_stop: the tape records a stop and its reason is not "error".
 */
import { CHIEF_ID } from "../data";
import type { CheckRegistry } from "./checks/types";
import type { Scenario } from "./scenario";
import { checkContext, foldRun, isLaunchCard, runCheck, type MsgRec, type RunState, type VersionRec } from "./state";
import type { ClaimResult, RunSummary, StepVerdict, TapeEvent } from "./types";

export interface ScoreInput {
  scenario: Scenario;
  events: readonly TapeEvent[];
  checks: CheckRegistry;
  /** The judge's answer on each judge item's current version, by rubric item id. */
  judged: Record<string, { pass: boolean | null; quote: string }>;
  /** The brief's facts F1…Fn, for the checks. */
  facts: Record<string, string>;
  /** A deliverable version's text from the vault; null when it can't be read. */
  read: (path: string, commit?: string) => string | null;
}

type Evidence = ClaimResult["evidence"][number];
const OWNER = "you";
/** Lines shorter than this are too generic to call a relay ("Thanks!", a heading). */
const RELAY_MIN = 40;

const ev = (at: { seq: number; t: number } | undefined, note: string, path?: string): Evidence => ({ ...(at ? { seq: at.seq, t: at.t } : {}), ...(path ? { path } : {}), note });
const code = (id: string, label: string, pass: boolean | null, evidence: Evidence[]): ClaimResult => ({ id, label, kind: "code", gating: true, pass, evidence });

export function scoreRun(i: ScoreInput): ClaimResult[] {
  const sc = i.scenario;
  const s = foldRun(i.events, sc);
  const leads = new Set(s.teams.map((t) => t.leadId));
  const textOf = (v: VersionRec) => (v.source === "chart" ? v.text : (i.read(v.path, v.commit) ?? ""));

  const process: Record<string, () => ClaimResult> = {
    triage: () => triage(s, leads),
    launch_card: () => launchCard(s, i.events, leads),
    post_by_each_expert: () => postByEachExpert(s),
    all_accepted: () => allAccepted(s),
    relay_by_pm: () => relayByPm(s, leads, textOf),
  };
  const out: ClaimResult[] = [];
  for (const id of [...sc.expect.mustHappen, ...sc.expect.mustNotHappen]) if (process[id]) out.push(process[id]());

  for (const item of sc.rubric) {
    const d = sc.expect.deliverables.find((x) => x.id === item.deliverable)!;
    const ctx = checkContext(s, d, textOf, i.facts);
    const cur = ctx.current(d.id);
    const v = s.versions[d.id]?.find((x) => x.version === cur?.version);
    const where = cur ? `version ${cur.version} of ${d.id}` : `${d.id} was never written`;
    if (item.kind === "code") {
      const r = runCheck(i.checks, item, ctx);
      out.push({ id: item.id, label: item.label, kind: "code", gating: item.gating, pass: r.pass, evidence: (r.evidence.length ? r.evidence : [where]).map((n) => ev(v, `${where}: ${n}`, cur?.path)) });
    } else {
      const j = i.judged[item.id];
      const note = j ? `${where}: judge said ${j.pass === null ? "nothing usable" : j.pass ? "yes" : "no"}${j.quote ? `: "${j.quote}"` : ""}` : `${where}: not judged`;
      out.push({ id: item.id, label: item.label, kind: "judge", gating: item.gating, pass: j ? j.pass : null, evidence: [ev(v, note, cur?.path)] });
    }
  }

  const tokens = s.usage.input + s.usage.output;
  const lastRow = [...i.events].reverse().find((e) => e.kind === "ledger");
  out.push(code("budget", "The run stayed within its budget", s.usd <= sc.budget.maxUsd && tokens <= sc.budget.maxTokens, [ev(lastRow, `$${s.usd.toFixed(2)} of $${sc.budget.maxUsd.toFixed(2)}; ${tokens} of ${sc.budget.maxTokens} tokens`)]));
  out.push(code("clean_stop", "The run ended on a stop condition, not an error", s.stop ? s.stop.reason !== "error" : false, [ev(s.stop, s.stop ? `stopped: ${s.stop.reason}` : "the tape records no stop")]));
  return out;
}

// ---------- process claims ----------

function triage(s: RunState, leads: Set<string>): ClaimResult {
  const label = `Mira triaged it as ${s.scenario.expect.triage === "project" ? "a project" : "solo work"}`;
  const card = s.cards.find(isLaunchCard);
  const team = s.teams[0];
  const soloDm = (m: MsgRec) => m.place.kind === "dm" && m.ended && m.from !== CHIEF_ID && m.from !== OWNER && !leads.has(m.from);
  if (s.scenario.expect.triage === "solo") {
    const handoff = s.messages.find(soloDm);
    if (card || team) return code("triage", label, false, [ev(card ?? team, card ? `launch card ${card.cardId} shown` : `team ${team.teamId} created`)]);
    return code("triage", label, !!handoff, [ev(handoff, handoff ? `${handoff.from} took it in a DM` : "no expert picked it up in a DM")]);
  }
  if (!card && !team) return code("triage", label, false, [ev(undefined, "no launch card and no team")]);
  const boundary = (card ?? team).seq;
  const solo = s.messages.find((m) => soloDm(m) && m.seq < boundary);
  if (solo) return code("triage", label, false, [ev(solo, `${solo.from} took the work alone in a DM before the launch card`)]);
  return code("triage", label, true, [ev(card ?? team, card ? `launch card ${card.cardId} shown` : `team ${team.teamId} created`)]);
}

function launchCard(s: RunState, events: readonly TapeEvent[], leads: Set<string>): ClaimResult {
  const label = "The launch card came before any work";
  const card = s.cards.find(isLaunchCard);
  if (!card) return code("launch_card", label, false, [ev(undefined, "no launch card was shown")]);
  const approved = s.cards.filter((c) => isLaunchCard(c) && c.decided?.decision === "approve").map((c) => c.decided!.seq);
  const until = approved.length ? Math.min(...approved) : Infinity;
  const expert = (id: string) => id !== CHIEF_ID && !leads.has(id);
  const early = events.filter((e) => e.seq < until && ((e.kind === "artifact" && expert(e.agentId)) || (e.kind === "tool.call" && expert(e.agentId))));
  if (early.length) return code("launch_card", label, false, early.map((e) => ev(e, e.kind === "artifact" ? `${e.agentId} wrote ${e.path} before the launch was approved` : e.kind === "tool.call" ? `${e.agentId} called ${e.name} before the launch was approved` : "")));
  return code("launch_card", label, true, [ev(card, `launch card ${card.cardId} shown${approved.length ? "; no expert work before its approval" : ""}`)]);
}

function postByEachExpert(s: RunState): ClaimResult {
  const label = "Every expert posted in the team channel";
  const team = s.teams[0];
  if (!team) return code("post_by_each_expert", label, null, [ev(undefined, "no team was created")]);
  const experts = team.members.filter((m) => m.agentId !== team.leadId);
  if (!experts.length) return code("post_by_each_expert", label, null, [ev(team, "the team has no experts")]);
  const evidence: Evidence[] = [];
  let pass = true;
  for (const m of experts) {
    const post = s.messages.find((x) => x.from === m.agentId && x.ended && !x.error && x.text.trim() && x.place.kind === "channel" && x.place.teamId === team.teamId);
    if (!post) pass = false;
    evidence.push(post ? ev(post, `${m.name} posted in ${team.channel}`) : ev(team, `${m.name} never posted in ${team.channel}`));
  }
  return code("post_by_each_expert", label, pass, evidence);
}

function allAccepted(s: RunState): ClaimResult {
  const evidence = s.scenario.expect.deliverables.map((d) => {
    const a = s.accepted[d.id];
    return a ? ev(a, `${d.id} version ${a.version} accepted`) : ev(undefined, `${d.id} was never accepted`);
  });
  return code("all_accepted", "Every deliverable was accepted", s.scenario.expect.deliverables.every((d) => d.id in s.accepted), evidence);
}

function relayByPm(s: RunState, leads: Set<string>, textOf: (v: VersionRec) => string): ClaimResult {
  const label = "Experts posted their own work (the lead didn't relay it)";
  const versions = Object.values(s.versions).flat();
  if (!versions.length) return code("relay_by_pm", label, null, [ev(undefined, "no deliverable version was written")]);
  const ended = s.messages.filter((m) => m.ended).sort((a, b) => (a.endSeq ?? 0) - (b.endSeq ?? 0));
  const relays: Evidence[] = [];
  for (const v of versions) {
    const units = v.source === "chart" ? [v.text] : textOf(v).split("\n").map((l) => l.trim()).filter((l) => l.length >= RELAY_MIN);
    for (const unit of units) {
      const first = ended.find((m) => m.text.includes(unit));
      if (first && leads.has(first.from) && first.from !== v.agentId) {
        relays.push(ev({ seq: first.endSeq ?? first.seq, t: first.endT ?? first.t }, `${first.from} posted ${v.deliverable} v${v.version} before ${v.agentId} did: "${unit.slice(0, 60)}"`, v.path));
        break;
      }
    }
  }
  if (relays.length) return code("relay_by_pm", label, false, relays);
  return code("relay_by_pm", label, true, [ev(undefined, `${versions.length} deliverable version(s); no lead posted their text first`)]);
}

// ---------- quality and the improvement gate ----------

/**
 * score: rubric pass rate (code and judge items) over the items that got a verdict; firstPass: deliverables
 * accepted without a fail verdict, over all deliverables; judge: pass rate of the judge items that got one.
 */
export function qualityOf(results: ClaimResult[], state: RunState): RunSummary["quality"] {
  const sc = state.scenario;
  const rubric = new Set(sc.rubric.map((r) => r.id));
  const rated = results.filter((r) => rubric.has(r.id) && r.pass !== null);
  const judged = rated.filter((r) => r.kind === "judge");
  const rate = (rs: ClaimResult[]) => rs.filter((r) => r.pass).length / rs.length;
  const firstPass = sc.expect.deliverables.filter((d) => {
    const fail = sc.reactions.find((r) => r.deliverable === d.id)?.fail ?? "redo";
    return d.id in state.accepted && !state.verdicts.some((v) => v.deliverable === d.id && v.order === fail);
  }).length;
  return { score: rated.length ? rate(rated) : 0, firstPass: firstPass / sc.expect.deliverables.length, judge: judged.length ? rate(judged) : null };
}

const EPS = 1e-9;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number) => `${Math.round(Math.abs(x) * 100)} points`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const total = (s: RunSummary) => s.tokens.input + s.tokens.output;

/**
 * The improvement gate (design §7): quality up by minQualityGain (or both runs at the ceiling), time to done and
 * tokens each down by their cut. improving = every bar cleared; regressed = something got worse (quality fell
 * below the ceiling, time or tokens rose, or the run no longer reached done); else stalled. One reason per missed bar.
 */
export function stepVerdict(prev: RunSummary, next: RunSummary, improve: Scenario["improve"]): StepVerdict {
  const reasons: string[] = [];
  let worse = false;

  const q0 = prev.quality.score;
  const q1 = next.quality.score;
  const qualityGain = q1 - q0;
  const atCeiling = q0 >= improve.qualityCeiling - EPS && q1 >= improve.qualityCeiling - EPS;
  if (!atCeiling && qualityGain < improve.minQualityGain - EPS) {
    reasons.push(`quality ${qualityGain < 0 ? "fell" : "rose"} ${pts(qualityGain)} (${pct(q0)} → ${pct(q1)}); the bar is ${pts(improve.minQualityGain)}, or both runs at ${pct(improve.qualityCeiling)}`);
    if (qualityGain < -EPS) worse = true;
  }

  const t0 = prev.timeToDoneMs;
  const t1 = next.timeToDoneMs;
  const timeCut = t0 !== null && t1 !== null && t0 > 0 ? (t0 - t1) / t0 : null;
  if (t1 === null) {
    reasons.push(`time to done: run ${next.trial} never reached done; the bar is a ${pct(improve.minTimeCut)} cut`);
    if (t0 !== null) worse = true;
  } else if (timeCut !== null && timeCut < improve.minTimeCut - EPS) {
    reasons.push(`time to done ${timeCut < 0 ? "rose" : "fell"} ${pct(Math.abs(timeCut))} (${secs(t0!)} → ${secs(t1)}); the bar is ${pct(improve.minTimeCut)}`);
    if (timeCut < -EPS) worse = true;
  }

  const k0 = total(prev);
  const k1 = total(next);
  const tokenCut = k0 > 0 ? (k0 - k1) / k0 : 0;
  if (tokenCut < improve.minTokenCut - EPS) {
    reasons.push(`tokens ${tokenCut < 0 ? "rose" : "fell"} ${pct(Math.abs(tokenCut))} (${k0.toLocaleString("en-US")} → ${k1.toLocaleString("en-US")}); the bar is a ${pct(improve.minTokenCut)} cut`);
    if (tokenCut < -EPS) worse = true;
  }

  return { from: prev.trial, to: next.trial, verdict: worse ? "regressed" : reasons.length ? "stalled" : "improving", qualityGain, timeCut, tokenCut, reasons };
}
