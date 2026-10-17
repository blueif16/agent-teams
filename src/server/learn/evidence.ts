/*
 * The evidence a close's model calls may cite: every item gets a short id that code assigns (F1 a failed rubric item,
 * O1 an owner order, S1 a slow phase, N1 a number from the ledger, t3 a task, J4 a journal line, D-002 a decision), so
 * an edit can't cite something that doesn't exist (team-setup §5). Code maps each id to a stable ref for the commit
 * trailers (`rubric:landing-copy/prices_supported@v2`). The numbers are computed here from the ledger and the PM's
 * state files, never by a model.
 */
import type { LedgerEvent } from "@/lib/ledger";
import { ORDERS_BY_KEY } from "@/lib/orders";
import { totals, type Totals } from "@/lib/stats";
import type { Dag, Decision, JournalLine } from "@/server/project-state/schema";
import type { RunFeedback } from "./types";

export interface Evidence {
  id: string;
  /** Stable reference, written to the `Evidence:` trailer. */
  ref: string;
  /** One line for the model. */
  text: string;
  kind: "failed" | "order" | "slow" | "numbers" | "task" | "journal" | "decision";
  /** Whose work it's about, when that's known. */
  agentId?: string;
}

export interface MemberInfo {
  agentId: string;
  name: string;
  role: string;
  archetype: string;
  skills: string[];
}

export interface EvidenceInput {
  pid: string;
  createdAt: string;
  now: Date;
  budgetUsd: number | null;
  feedback?: RunFeedback;
  /** This project's ledger rows only. */
  ledger: LedgerEvent[];
  members: MemberInfo[];
  dag: Dag | null;
  journal: { window: number; lines: JournalLine[] }[];
  decisions: Decision[];
}

export interface EvidenceTable {
  items: Evidence[];
  byId: Map<string, Evidence>;
  project: Totals;
  perAgent: Map<string, Totals>;
  wallMs: number;
}

const MAX_TASKS = 25;
const MAX_JOURNAL = 30;
const MAX_DECISIONS = 15;

export const usd = (n: number) => `$${n.toFixed(4)}`;

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

const oneLine = (s: string, max = 240) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** A ref usable as a trailer value: no spaces or control characters. */
const refPart = (s: string) => s.replace(/[^A-Za-z0-9_.:@/-]+/g, "-").slice(0, 80) || "-";

const modelMs = (events: LedgerEvent[]) => events.reduce((s, e) => s + (e.t === "call" ? e.ms : 0), 0);

function numbersLine(t: Totals, ms: number): string {
  const tokens = `${t.input} in (${t.cached} cached), ${t.output} out`;
  return `${usd(t.cost)} over ${t.calls} model call${t.calls === 1 ? "" : "s"} (${t.errors} failed); tokens ${tokens}; model time ${duration(ms)}`;
}

export function buildEvidence(input: EvidenceInput): EvidenceTable {
  const items: Evidence[] = [];
  const { pid, feedback } = input;

  feedback?.failed.forEach((f, i) => {
    const where = f.evidence.map((e) => e.note).filter(Boolean).join("; ");
    items.push({
      id: `F${i + 1}`,
      ref: `rubric:${refPart(f.deliverable)}/${refPart(f.itemId)}@v${f.version}`,
      text: oneLine(`failed rubric item "${f.label}" (${f.itemId}) on ${f.deliverable} v${f.version}, by ${f.agentId}${where ? `: ${where}` : ""}`),
      kind: "failed",
      agentId: f.agentId,
    });
  });
  feedback?.orders.forEach((o, i) => {
    const emoji = ORDERS_BY_KEY[o.order]?.emoji ?? o.order;
    items.push({
      id: `O${i + 1}`,
      ref: `order:${o.order}@${o.seq}`,
      text: oneLine(`the owner gave ${emoji} (${o.order}) to ${o.agentId}${o.deliverable ? ` on ${o.deliverable}` : ""}${o.note ? `: "${o.note}"` : ""}`),
      kind: "order",
      agentId: o.agentId,
    });
  });
  feedback?.slow.forEach((s, i) => {
    const pct = s.prevMs > 0 ? Math.round(((s.ms - s.prevMs) / s.prevMs) * 100) : null;
    items.push({
      id: `S${i + 1}`,
      ref: `phase:${s.phase}`,
      text: `the ${s.phase} phase took ${duration(s.ms)}, ${pct === null ? "slower than" : `${pct}% longer than`} the previous run (${duration(s.prevMs)})`,
      kind: "slow",
    });
  });

  const project = totals(input.ledger);
  const wallMs = Math.max(0, input.now.getTime() - new Date(input.createdAt).getTime());
  const budget = input.budgetUsd === null ? "no budget set" : `budget ${usd(input.budgetUsd)}`;
  items.push({
    id: "N1",
    ref: `ledger:${pid}`,
    text: `the whole project: ${numbersLine(project, modelMs(input.ledger))}; ${budget}; ${duration(wallMs)} from launch to close; owner orders 👍 ${project.orders.go}, 🔁 ${project.orders.redo}`,
    kind: "numbers",
  });
  const perAgent = new Map<string, Totals>();
  input.members.forEach((m, i) => {
    const mine = input.ledger.filter((e) => e.agent === m.agentId);
    const t = totals(mine);
    perAgent.set(m.agentId, t);
    items.push({
      id: `N${i + 2}`,
      ref: `ledger:${pid}/${m.agentId}`,
      text: `${m.name} (${m.role}, ${m.archetype}): ${numbersLine(t, modelMs(mine))}`,
      kind: "numbers",
      agentId: m.agentId,
    });
  });

  const tasks = (input.dag?.tasks ?? []).filter((t) => t.kind !== "todo").slice(-MAX_TASKS);
  for (const t of tasks) {
    const took = t.status === "done" || t.status === "failed" || t.status === "dropped" ? `, took ${duration(Date.parse(t.updated) - Date.parse(t.created))}` : "";
    items.push({
      id: t.id,
      ref: `task:${t.id}`,
      text: oneLine(`task "${t.title}", owner ${t.owner ?? "nobody"}, ${t.status}${took}${t.reopened ? `, reopened ${t.reopened}×` : ""}`),
      kind: "task",
      agentId: t.owner ?? undefined,
    });
  }

  const journal = input.journal.flatMap((w) => w.lines.map((l) => ({ ...l, window: w.window }))).slice(-MAX_JOURNAL);
  journal.forEach((l, i) => {
    items.push({ id: `J${i + 1}`, ref: `journal:${l.window}/r${l.rev}`, text: oneLine(`${l.at} ${l.text}`), kind: "journal" });
  });

  for (const d of input.decisions.filter((d) => d.status === "active").slice(-MAX_DECISIONS)) {
    items.push({ id: d.id, ref: `decision:${d.id}`, text: oneLine(`decision "${d.title}": ${d.decision}`), kind: "decision" });
  }

  return { items, byId: new Map(items.map((e) => [e.id, e])), project, perAgent, wallMs };
}

/** The table as the model reads it: `id: text`, one per line. */
export const renderEvidence = (items: Evidence[]) => items.map((e) => `${e.id}: ${e.text}`).join("\n");

/**
 * Checks a list of cited ids: the reason it fails ("no evidence", "unknown evidence F9"), or null when every id is in
 * the table and there is at least one.
 */
export function evidenceProblem(ids: string[], table: Map<string, Evidence>): string | null {
  if (!ids.length) return "no evidence cited";
  const unknown = ids.filter((id) => !table.has(id));
  return unknown.length ? `unknown evidence ${unknown.slice(0, 3).join(", ")}` : null;
}
