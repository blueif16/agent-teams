/*
 * The composition note (test-mode design §7b step 4, team-setup §2): the roster that did one project (archetypes,
 * roles, skills), what it cost and how it came out, at company/compositions/<kind>/<pid>.md, so Mira and the PM can
 * adapt it the next time they staff the same kind of work. Written by code from the db, the ledger and the feedback;
 * no model writes any of it.
 */
import type { Totals } from "@/lib/stats";
import type { Dag } from "@/server/project-state/schema";
import { duration, usd, type Evidence, type MemberInfo } from "./evidence";
import type { RunFeedback } from "./types";

export const compositionPath = (kind: string, pid: string) => `company/compositions/${kind}/${pid}.md`;

export interface CompositionInput {
  pid: string;
  kind: string;
  closedAt: string;
  members: MemberInfo[];
  project: Totals;
  perAgent: Map<string, Totals>;
  wallMs: number;
  budgetUsd: number | null;
  dag: Dag | null;
  feedback?: RunFeedback;
  /** The refs the note stands on, for its Evidence section. */
  refs: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function renderComposition(c: CompositionInput): string {
  const fb = c.feedback;
  const roster = c.members.map((m) => {
    const t = c.perAgent.get(m.agentId);
    const failed = fb?.failed.filter((f) => f.agentId === m.agentId).length ?? 0;
    const redos = fb?.orders.filter((o) => o.agentId === m.agentId && o.order === "redo").length ?? 0;
    const skills = m.skills.length ? m.skills.join(", ") : "none";
    const cost = t ? `${usd(t.cost)} over ${plural(t.calls, "call")}` : "no calls";
    return `- ${m.role} · ${m.archetype} · ${m.agentId} · skills: ${skills} · ${cost} · failed rubric items ${failed} · 🔁 ${redos}`;
  });

  const outcome = [`- Cost: ${usd(c.project.cost)} over ${plural(c.project.calls, "model call")}${c.budgetUsd === null ? "" : `; budget $${c.budgetUsd}`}`];
  outcome.push(`- Time: ${duration(c.wallMs)} from launch to close`);
  const tasks = (c.dag?.tasks ?? []).filter((t) => t.kind === "work");
  if (tasks.length) {
    const done = tasks.filter((t) => t.status === "done").length;
    const reopened = tasks.reduce((s, t) => s + t.reopened, 0);
    outcome.push(`- Tasks: ${done} of ${tasks.length} done; reopened ${reopened}×`);
  }
  if (fb) {
    const items = fb.failed.map((f) => `${f.itemId} on ${f.deliverable}`);
    const count = (k: string) => fb.orders.filter((o) => o.order === k).length;
    outcome.push(`- Owner feedback: ${plural(fb.failed.length, "failed rubric item")}${items.length ? ` (${items.join("; ")})` : ""}; 👍 ${count("go")}, 🔁 ${count("redo")}`);
    if (fb.slow.length) outcome.push(`- Slower than the previous run: ${fb.slow.map((s) => `${s.phase} ${duration(s.ms)} (was ${duration(s.prevMs)})`).join("; ")}`);
  } else {
    outcome.push(`- Owner orders: 👍 ${c.project.orders.go}, 🔁 ${c.project.orders.redo}`);
  }

  return [
    `# Composition: ${c.kind}`,
    "",
    `Project ${c.pid}, closed ${c.closedAt.slice(0, 10)}. Written by code at the close, for Mira and the PM when they staff this kind of work again.`,
    "",
    "## Roster",
    "",
    ...roster,
    "",
    "## Outcome",
    "",
    ...outcome,
    "",
    "## Evidence",
    "",
    ...c.refs.map((r) => `- ${r}`),
    "",
  ].join("\n");
}

/** The refs a composition stands on: the ledger, then every piece of owner feedback. */
export const compositionRefs = (pid: string, table: Evidence[]) => [`ledger:${pid}`, ...table.filter((e) => e.kind === "failed" || e.kind === "order" || e.kind === "slow").map((e) => e.ref)];
