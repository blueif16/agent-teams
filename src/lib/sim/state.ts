/*
 * The run state, folded from tape events (docs/design/test-mode.md §3, §6). The owner driver folds the live stream
 * with it to decide what to do next, and the claims fold a finished tape with it to score the run, so both read the
 * same facts the same way: who is on the team, which cards are pending, what each agent posted, which deliverable
 * versions landed and which were accepted, what the owner did, and what the run cost.
 *
 * Pure and incremental: step(state, event) returns a new state and never changes the one it was given.
 */
import { splitCharts } from "../charts";
import type { OrderKey } from "../orders";
import { globMatch } from "../policy/glob";
import type { Archetype } from "../policy/types";
import type { Deliverable, Scenario } from "./scenario";
import type { CardType, Decision, Member, OwnerAction, Place, SimNote, StopReason, TapeEvent, TapeKind, Usage } from "./types";

export interface TeamRec {
  teamId: string;
  channel: string;
  name: string;
  goal: string;
  leadId: string;
  /** In roster order: the members of team.created, then each member.hired. */
  members: Member[];
  seq: number;
  t: number;
}

export interface CardRec {
  cardId: string;
  card: CardType;
  from: string;
  place: Place;
  title: string;
  detail?: unknown;
  /** 0-based position among the cards of the same gate: launch cards (proposal and launch) count together. */
  n: number;
  seq: number;
  t: number;
  decided?: { decision: Decision; by: "sim" | "human"; note?: string; seq: number; t: number };
}

export interface MsgRec {
  msgId: string;
  from: string;
  place: Place;
  quote?: string;
  /** The final text from msg.end; empty while streaming. */
  text: string;
  ended: boolean;
  error?: string;
  seq: number;
  t: number;
  endSeq?: number;
  endT?: number;
  /** 1-based count of this author's messages in this place, at the time this one started. */
  nth: number;
}

/** One version of a scenario deliverable. Artifact text lives in the vault; chart text is the fence body. */
export interface VersionRec {
  deliverable: string;
  /** 1-based, in landing order for this deliverable. */
  version: number;
  source: "artifact" | "chart";
  agentId: string;
  /** Vault path for artifacts; `msg:<msgId>` for charts. */
  path: string;
  commit?: string;
  /** The chart fence body; "" for artifacts (read it from the vault by path and commit). */
  text: string;
  /** For charts, the message that carried it. */
  msgId?: string;
  seq: number;
  t: number;
}

export interface VerdictRec {
  deliverable: string;
  pass: boolean;
  failed: string[];
  order: OrderKey;
  seq: number;
  t: number;
}

export interface OwnerRec {
  action: OwnerAction;
  by: "sim" | "human";
  beat?: string;
  seq: number;
  t: number;
}

export interface OrderRec {
  msgId: string;
  order: OrderKey;
  note?: string;
  by: "sim" | "human";
  /** Author of the message the order targets, when that message is on the tape. */
  target?: string;
  seq: number;
  t: number;
}

export interface RunState {
  scenario: Scenario;
  /** seq and t of the last event folded. */
  seq: number;
  t: number;
  teams: TeamRec[];
  /** Archetype of every agent seen on a roster. */
  archetypeOf: Record<string, Archetype>;
  cards: CardRec[];
  /** In start order. */
  messages: MsgRec[];
  /** Messages started per author and place: key `${from}|${placeKey(place)}`. */
  counts: Record<string, number>;
  versions: Record<string, VersionRec[]>;
  /** Deliverable id → the version accepted and when (a verdict note whose order is the reaction's pass order). */
  accepted: Record<string, { version: number; seq: number; t: number }>;
  verdicts: VerdictRec[];
  owner: OwnerRec[];
  orders: OrderRec[];
  notes: { note: SimNote; seq: number; t: number }[];
  /** Totals from ledger rows: tokens from call rows, USD from call and paid tool rows. */
  usage: Usage;
  usd: number;
  calls: number;
  /** t of the last event an agent caused (not owner, sim, marker, keyframe or bus events). */
  lastActivity: number;
  timers: { name: "heartbeat" | "dream" | "budget"; agentId?: string; detail?: string; seq: number; t: number }[];
  closed: { teamId: string; seq: number; t: number }[];
  /** ```chart fences in finished messages, parsed, in posting order. */
  charts: { agentId: string; spec: unknown; body: string; msgId: string; seq: number; t: number }[];
  /** Summaries of successful tool results, for the verbatim checks. */
  fetched: string[];
  stop?: { reason: StopReason; seq: number; t: number };
}

export const placeKey = (p: Place): string => (p.kind === "dm" ? `dm:${p.agentId}` : `channel:${p.teamId}`);

export function initialState(scenario: Scenario): RunState {
  return {
    scenario,
    seq: -1,
    t: 0,
    teams: [],
    archetypeOf: {},
    cards: [],
    messages: [],
    counts: {},
    versions: {},
    accepted: {},
    verdicts: [],
    owner: [],
    orders: [],
    notes: [],
    usage: { input: 0, cached: 0, output: 0 },
    usd: 0,
    calls: 0,
    lastActivity: 0,
    timers: [],
    closed: [],
    charts: [],
    fetched: [],
  };
}

const LAUNCH_CARDS: ReadonlySet<CardType> = new Set(["proposal", "launch"]);
export const isLaunchCard = (c: { card: CardType }) => LAUNCH_CARDS.has(c.card);

/** Events the team or the app caused; owner, sim, marker, keyframe, timer and bus events are not agent activity. */
const ACTIVITY: ReadonlySet<TapeKind> = new Set([
  "msg.start", "msg.delta", "msg.end", "agent.status", "card", "team.created", "member.hired", "tool.call", "tool.result",
  "artifact", "file.commit", "project.closed", "ledger", "model.http",
]);

/** The first closed ```chart fence in a message: its body. */
function chartBody(text: string): string | null {
  const seg = splitCharts(text).find((s) => s.kind === "chart" && !s.open);
  return seg && seg.kind === "chart" ? seg.code.trim() : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function addVersion(s: RunState, v: Omit<VersionRec, "version">): RunState {
  const list = s.versions[v.deliverable] ?? [];
  return { ...s, versions: { ...s.versions, [v.deliverable]: [...list, { ...v, version: list.length + 1 }] } };
}

/** An artifact matches a deliverable by type, then by the author's archetype equal to `by`, then by the optional path glob. */
function deliverableFor(s: RunState, agentId: string, type: string, path: string): Deliverable | undefined {
  const archetype = s.archetypeOf[agentId];
  return s.scenario.expect.deliverables.find((d) => d.type === type && d.by === archetype && (!d.path || globMatch(d.path, path)));
}

function withMember(s: RunState, teamId: string, m: Member): RunState {
  const teams = s.teams.map((tm) => (tm.teamId === teamId && !tm.members.some((x) => x.agentId === m.agentId) ? { ...tm, members: [...tm.members, m] } : tm));
  return { ...s, teams, archetypeOf: { ...s.archetypeOf, [m.agentId]: m.archetype } };
}

const passOrder = (s: RunState, deliverable: string): OrderKey => s.scenario.reactions.find((r) => r.deliverable === deliverable)?.pass ?? "go";

/** Fold one event. */
export function step(state: RunState, e: TapeEvent): RunState {
  let s: RunState = { ...state, seq: e.seq, t: e.t };
  if (ACTIVITY.has(e.kind)) s.lastActivity = e.t;
  const at = { seq: e.seq, t: e.t };

  switch (e.kind) {
    case "team.created": {
      if (s.teams.some((tm) => tm.teamId === e.teamId)) return s;
      const team: TeamRec = { teamId: e.teamId, channel: e.channel, name: e.name, goal: e.goal, leadId: e.leadId, members: [...e.members], ...at };
      const archetypeOf = { ...s.archetypeOf };
      for (const m of e.members) archetypeOf[m.agentId] = m.archetype;
      return { ...s, teams: [...s.teams, team], archetypeOf };
    }
    case "member.hired":
      return withMember(s, e.teamId, e.member);
    case "card": {
      if (s.cards.some((c) => c.cardId === e.cardId)) return s;
      const launch = LAUNCH_CARDS.has(e.card);
      const n = s.cards.filter((c) => LAUNCH_CARDS.has(c.card) === launch).length;
      const card: CardRec = { cardId: e.cardId, card: e.card, from: e.from, place: e.place, title: e.title, detail: e.detail, n, ...at };
      return { ...s, cards: [...s.cards, card] };
    }
    case "card.decided":
      return { ...s, cards: s.cards.map((c) => (c.cardId === e.cardId ? { ...c, decided: { decision: e.decision, by: e.by, note: e.note, ...at } } : c)) };
    case "msg.start": {
      if (s.messages.some((m) => m.msgId === e.msgId)) return s;
      const key = `${e.from}|${placeKey(e.place)}`;
      const nth = (s.counts[key] ?? 0) + 1;
      const msg: MsgRec = { msgId: e.msgId, from: e.from, place: e.place, quote: e.quote, text: "", ended: false, nth, ...at };
      return { ...s, messages: [...s.messages, msg], counts: { ...s.counts, [key]: nth } };
    }
    case "msg.end": {
      const msg = s.messages.find((m) => m.msgId === e.msgId);
      // A message the tape never started has no author or place: nothing to attribute it to.
      if (!msg) return s;
      const done: MsgRec = { ...msg, text: e.text, ended: true, error: e.error, endSeq: e.seq, endT: e.t };
      s = { ...s, messages: s.messages.map((m) => (m.msgId === e.msgId ? done : m)) };
      const body = chartBody(e.text);
      if (body === null) return s;
      s = { ...s, charts: [...s.charts, { agentId: msg.from, spec: parseJson(body), body, msgId: msg.msgId, ...at }] };
      const d = s.scenario.expect.deliverables.find((x) => x.type === "chart" && x.by === s.archetypeOf[msg.from]);
      return d ? addVersion(s, { deliverable: d.id, source: "chart", agentId: msg.from, path: `msg:${msg.msgId}`, text: body, msgId: msg.msgId, ...at }) : s;
    }
    case "artifact": {
      const d = deliverableFor(s, e.agentId, e.type, e.path);
      return d ? addVersion(s, { deliverable: d.id, source: "artifact", agentId: e.agentId, path: e.path, commit: e.commit, text: "", ...at }) : s;
    }
    case "tool.result":
      return e.ok ? { ...s, fetched: [...s.fetched, e.summary] } : s;
    case "owner": {
      s = { ...s, owner: [...s.owner, { action: e.action, by: e.by, beat: e.beat, ...at }] };
      const a = e.action;
      if (a.kind === "order") {
        const target = s.messages.find((m) => m.msgId === a.msgId)?.from;
        s = { ...s, orders: [...s.orders, { msgId: a.msgId, order: a.order, note: a.note, by: e.by, target, ...at }] };
      }
      if (a.kind === "stop" && !s.stop) s = { ...s, stop: { reason: a.reason, ...at } };
      return s;
    }
    case "sim": {
      s = { ...s, notes: [...s.notes, { note: e.note, ...at }] };
      const n = e.note;
      if (n.what !== "verdict") return s;
      s = { ...s, verdicts: [...s.verdicts, { deliverable: n.deliverable, pass: n.pass, failed: n.failed, order: n.order, ...at }] };
      const latest = s.versions[n.deliverable]?.at(-1);
      if (n.order === passOrder(s, n.deliverable) && latest) s = { ...s, accepted: { ...s.accepted, [n.deliverable]: { version: latest.version, ...at } } };
      return s;
    }
    case "ledger": {
      const r = e.row;
      if (r.t === "call") {
        const usage = { input: s.usage.input + r.input, cached: s.usage.cached + r.cached, output: s.usage.output + r.output };
        return { ...s, usage, usd: s.usd + r.cost, calls: s.calls + 1 };
      }
      return r.t === "tool" ? { ...s, usd: s.usd + r.cost } : s;
    }
    case "timer":
      return { ...s, timers: [...s.timers, { name: e.name, agentId: e.agentId, detail: e.detail, ...at }] };
    case "project.closed":
      return { ...s, closed: [...s.closed, { teamId: e.teamId, ...at }] };
    default:
      return s;
  }
}

export function foldRun(events: readonly TapeEvent[], scenario: Scenario): RunState {
  return events.reduce(step, initialState(scenario));
}
