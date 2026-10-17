/*
 * Performance stats computed from the ledger. Shared by the Performance tabs
 * (via GET /api/stats) and, later, the HR agent. Kept to the numbers that say
 * how efficiently an agent works: spend, tokens, cache hits, latency, failures,
 * and how often the human accepts or redoes its work.
 */
import type { LedgerEvent } from "./ledger";
import type { OrderKey } from "./orders";

export interface Totals {
  calls: number;
  errors: number;
  /** Calls answered by a different model than asked (fallback or vision route). */
  rerouted: number;
  /** Prompt tokens, cached included. */
  input: number;
  cached: number;
  output: number;
  cost: number;
  /** cached / input; null with no calls. */
  cacheHit: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  orders: Record<OrderKey, number>;
  approved: number;
  declined: number;
  /** 👍 orders plus approvals. */
  accepted: number;
  /** 🔁 orders plus declines. */
  rejected: number;
  /** accepted / (accepted + rejected); null with no signal yet. */
  acceptRate: number | null;
  costPerAccepted: number | null;
  /** Calls per model. */
  models: Record<string, number>;
  lastAt: string | null;
}

export interface AgentStats extends Totals {
  agent: string;
  team: string;
}

export interface CallPoint {
  at: string;
  model: string;
  input: number;
  cached: number;
  output: number;
  ms: number;
  ok: boolean;
}

export interface HourPoint {
  /** Start of the hour, ISO. */
  hour: string;
  calls: number;
  tokens: number;
  cost: number;
}

export interface TeamReport {
  team: string;
  totals: Totals;
  agents: AgentStats[];
  /** The last 24 hours, oldest first. */
  hourly: HourPoint[];
}

export interface AgentReport extends AgentStats {
  /** The most recent calls, oldest first. */
  recent: CallPoint[];
}

const ORDER_KEYS: OrderKey[] = ["go", "dig", "redo", "hold", "pin"];

export function totals(events: LedgerEvent[]): Totals {
  const orders = Object.fromEntries(ORDER_KEYS.map((k) => [k, 0])) as Record<OrderKey, number>;
  const t: Totals = {
    calls: 0,
    errors: 0,
    rerouted: 0,
    input: 0,
    cached: 0,
    output: 0,
    cost: 0,
    cacheHit: null,
    avgMs: null,
    p95Ms: null,
    orders,
    approved: 0,
    declined: 0,
    accepted: 0,
    rejected: 0,
    acceptRate: null,
    costPerAccepted: null,
    models: {},
    lastAt: null,
  };
  const latencies: number[] = [];
  for (const e of events) {
    if (!t.lastAt || e.at > t.lastAt) t.lastAt = e.at;
    if (e.t === "call") {
      t.calls++;
      if (!e.ok) t.errors++;
      if (e.model !== e.asked) t.rerouted++;
      t.input += e.input;
      t.cached += e.cached;
      t.output += e.output;
      t.cost += e.cost;
      t.models[e.model] = (t.models[e.model] ?? 0) + 1;
      if (e.ok) latencies.push(e.ms);
    } else if (e.t === "order") {
      t.orders[e.order]++;
    } else if (e.t === "approval") {
      t[e.decision]++;
    }
    // Tool rows (web search, page fetch) only move lastAt for now; their spend isn't in these totals yet.
  }
  t.accepted = t.orders.go + t.approved;
  t.rejected = t.orders.redo + t.declined;
  if (t.input > 0) t.cacheHit = t.cached / t.input;
  if (latencies.length) {
    latencies.sort((a, b) => a - b);
    t.avgMs = latencies.reduce((s, x) => s + x, 0) / latencies.length;
    t.p95Ms = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
  }
  if (t.accepted + t.rejected > 0) t.acceptRate = t.accepted / (t.accepted + t.rejected);
  if (t.accepted > 0) t.costPerAccepted = t.cost / t.accepted;
  return t;
}

export function agentReport(events: LedgerEvent[], agent: string, team: string, recent = 30): AgentReport {
  const mine = events.filter((e) => e.agent === agent);
  const calls = mine.filter((e) => e.t === "call");
  return {
    agent,
    team,
    ...totals(mine),
    recent: calls.slice(-recent).map(({ at, model, input, cached, output, ms, ok }) => ({ at, model, input, cached, output, ms, ok })),
  };
}

export function teamReport(events: LedgerEvent[], team: string, agentIds: string[], now = new Date()): TeamReport {
  const mine = events.filter((e) => e.team === team);
  const agents = agentIds.map((agent) => ({ agent, team, ...totals(mine.filter((e) => e.agent === agent)) }));

  const end = new Date(now);
  end.setMinutes(0, 0, 0);
  const hourly: HourPoint[] = Array.from({ length: 24 }, (_, i) => ({
    hour: new Date(end.getTime() - (23 - i) * 3_600_000).toISOString(),
    calls: 0,
    tokens: 0,
    cost: 0,
  }));
  const first = new Date(hourly[0].hour).getTime();
  for (const e of mine) {
    if (e.t !== "call") continue;
    const i = Math.floor((new Date(e.at).getTime() - first) / 3_600_000);
    if (i < 0 || i > 23) continue;
    hourly[i].calls++;
    hourly[i].tokens += e.input + e.output;
    hourly[i].cost += e.cost;
  }

  return { team, totals: totals(mine), agents, hourly };
}
