/*
 * The PM's state files (src/server/project-state) as the state views' models (src/components/state/types.ts):
 * the ordering, linking and derived fields live here, once, so the views only draw. Server only: it reads the
 * vault (per-file last change) and the ledger (context fill, compactions, spend).
 */
import type { CompactionEvent, ContextStatus } from "@/lib/compaction";
import { compactionTriggers, contextFill, type ContextRole } from "@/lib/context-budget";
import { AGENTS } from "@/lib/data";
import { readLedger, type CallEvent } from "@/lib/ledger";
import { MODELS } from "@/lib/models";
import { agentVault } from "@/lib/agent-files";
import {
  STATE_FILES,
  type CharterVM,
  type DecisionVM,
  type EvidenceVM,
  type FileStamp,
  type JournalVM,
  type MemberVM,
  type OpenItemVM,
  type OpenVM,
  type PlanVM,
  type PmStatusVM,
  type ProjectStateVM,
  type StateFileName,
  type TaskVM,
  type Who,
} from "@/components/state/types";
import {
  isOpen,
  journalPath,
  readState,
  statePath,
  type Charter,
  type Dag,
  type Decision,
  type Item,
  type JournalLine,
  type Member,
  type OpenItems,
  type Roster,
  type Task,
} from "@/server/project-state";

export type WhoOf = (id: string | null | undefined) => Who;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (id: string) => Number(id.replace(/^\D+/, ""));
const byIdDesc = (a: { id: string }, b: { id: string }) => num(b.id) - num(a.id);
const byIdAsc = (a: { id: string }, b: { id: string }) => num(a.id) - num(b.id);

/**
 * Who an id in the state files is. "pm", the lead's agent id and the PM's thread-style ids (pm-p_42) are the PM;
 * "owner" is you; anyone else is an agent, named as the app knows them (else by their id) with the roster's archetype.
 */
export function whoResolver(members: readonly Member[], lead?: string): WhoOf {
  const byId = new Map(members.map((m) => [m.agentId, m]));
  return (id) => {
    if (!id) return { kind: "none" };
    if (id === "pm" || id === lead || /^pm-/.test(id)) return { kind: "pm" };
    if (id === "owner") return { kind: "owner" };
    return { kind: "agent", id, name: AGENTS[id]?.name ?? cap(id), archetype: byId.get(id)?.archetype ?? null };
  };
}

// ------------------------------------------------------------------------------------------------- plan

const hhmm = (iso: string) => (/T(\d{2}:\d{2})/.exec(iso)?.[1] ?? "");
const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

/** A ref (F §3, G §3 grammar) as a short chip: a file's name, a report, a ledger event's kind and time, a message. */
export function evidenceOf(ref: string): EvidenceVM {
  const led = /^led:([^/]+)\/(.+)$/.exec(ref);
  if (led) return { ref, kind: "ledger", label: `${led[2]} ${hhmm(led[1])}`.trim() };
  const msg = /^msg:.+:(\d+)$/.exec(ref);
  if (msg) return { ref, kind: "message", label: `message ${msg[1]}` };
  const file = /^(?:file:|rep:)?(\/?[^\s,:]+\/[^\s,]+)$/.exec(ref);
  if (file) {
    const name = base(file[1]);
    return /\/reports\//.test(file[1]) ? { ref, kind: "report", label: `report ${name.replace(/\.md$/, "")}` } : { ref, kind: "file", label: name };
  }
  return { ref, kind: "other", label: ref.length > 32 ? `${ref.slice(0, 31)}…` : ref };
}

/** In review, and its acceptance names you (F §3.1: an approval card for the owner). */
const needsYou = (t: Task) => t.status === "review" && (t.owner === "owner" || /\bowner\b/i.test(t.acceptance));

function toTask(t: Task, who: WhoOf): TaskVM {
  return {
    id: t.id,
    kind: t.kind === "todo" ? "todo" : "work",
    title: t.title,
    status: t.status,
    owner: who(t.owner),
    deps: t.deps,
    milestone: t.milestone ?? null,
    due: t.due ?? null,
    acceptance: t.acceptance,
    detail: t.detail ?? null,
    blocker: t.blocker ? { text: t.blocker.text, on: t.blocker.on ?? null, since: t.blocker.since } : null,
    evidence: t.evidence.map(evidenceOf),
    lastReport: t.lastReport ? { at: t.lastReport.at, by: who(t.lastReport.by), status: t.lastReport.status, summary: t.lastReport.summary } : null,
    notes: [...t.notes].reverse().map((n) => ({ at: n.at, text: n.text })),
    updated: t.updated,
    reopened: t.reopened,
    needsYou: needsYou(t),
  };
}

export function toPlan(dag: Dag, who: WhoOf): PlanVM {
  const tasks = dag.tasks.filter((t) => t.kind !== "milestone").sort(byIdAsc);
  const work = tasks.filter((t) => t.kind === "work");
  const count = (s: Task["status"], list = work) => list.filter((t) => t.status === s).length;
  return {
    tasks: tasks.map((t) => toTask(t, who)),
    milestones: dag.tasks
      .filter((t) => t.kind === "milestone")
      .sort(byIdAsc)
      .map((m) => {
        const mine = work.filter((t) => t.milestone === m.id);
        return { id: m.id, title: m.title, status: m.status, due: m.due ?? null, done: count("done", mine), total: mine.length };
      }),
    progress: { done: count("done"), total: work.length, blocked: count("blocked"), review: count("review"), inProgress: count("in_progress") },
  };
}

// -------------------------------------------------------------------------------------------- decisions

/** Active decisions first, then superseded and revoked ones; newest first within each. */
export function toDecisions(decisions: readonly Decision[], who: WhoOf): DecisionVM[] {
  const vm = decisions.map((d): DecisionVM => {
    const by = /^superseded by (D-\d+)$/.exec(d.status)?.[1] ?? null;
    return {
      id: d.id,
      date: d.date,
      title: d.title,
      status: d.status === "active" ? "active" : by ? "superseded" : "revoked",
      supersededBy: by,
      supersedes: d.supersedes ?? null,
      decision: d.decision,
      why: d.why,
      approvedBy: d.approvedBy,
      proposedBy: who(d.proposedBy),
      links: d.links,
    };
  });
  const active = vm.filter((d) => d.status === "active").sort(byIdDesc);
  const rest = vm.filter((d) => d.status !== "active").sort(byIdDesc);
  return [...active, ...rest];
}

// ------------------------------------------------------------------------------------------------- open

const SEVERITY = { high: 0, medium: 1, low: 2 } as const;
const t = (iso: string | undefined) => (iso ? Date.parse(iso) : 0);

function groupOf(i: Item): OpenItemVM["group"] {
  if (i.status === "resolved") return "resolved";
  if (i.kind === "question" && i.askOf === "owner") return "you";
  return i.kind === "risk" ? "risk" : "other";
}

/** Your questions first (the longest waiting first), then risks by severity, then the rest; resolved last. */
export function toOpen(open: OpenItems, dag: Dag, who: WhoOf): OpenVM {
  const ORDER = { you: 0, risk: 1, other: 2, resolved: 3 } as const;
  const items = open.items
    .map(
      (i): OpenItemVM => ({
        id: i.id,
        kind: i.kind,
        askOf: who(i.askOf),
        text: i.text,
        raised: i.raised,
        due: i.due ?? null,
        severity: i.severity ?? null,
        status: i.status,
        links: i.links,
        resolution: i.resolution ?? null,
        resolvedAt: i.resolvedAt ?? null,
        group: groupOf(i),
      }),
    )
    .sort((a, b) => {
      if (a.group !== b.group) return ORDER[a.group] - ORDER[b.group];
      if (a.group === "resolved") return t(b.resolvedAt ?? b.raised) - t(a.resolvedAt ?? a.raised);
      if (a.group === "risk") {
        const s = (a.severity ? SEVERITY[a.severity] : 3) - (b.severity ? SEVERITY[b.severity] : 3);
        if (s) return s;
      }
      return t(a.raised) - t(b.raised);
    });
  const approvals = dag.tasks
    .filter(needsYou)
    .sort(byIdAsc)
    .map((x) => ({ id: x.id, title: x.title, owner: who(x.owner) }));
  return { items, approvals };
}

// ------------------------------------------------------------------------------------------- team, context

const isCall = (e: unknown): e is CallEvent => (e as { t?: unknown }).t === "call";

/** Compaction rows (src/lib/compaction.ts) aren't in the ledger's event union yet; read them defensively. */
function isCompaction(e: unknown): e is CompactionEvent {
  const c = e as Partial<CompactionEvent>;
  return c.t === "compaction" && typeof c.agent === "string" && typeof c.project === "string" && typeof c.at === "string" && Array.isArray(c.steps);
}

/**
 * An agent's context on this project: the fill of its latest model call here (prompt tokens against its role's
 * triggers for that model), where it compacts on its own, and its last three compactions here. No call yet → no fill.
 */
export function contextFor(events: readonly unknown[], agentId: string, pid: string, role: ContextRole): ContextStatus {
  let last: CallEvent | undefined;
  for (const e of events) if (isCall(e) && e.agent === agentId && e.team === pid && (!last || e.at >= last.at)) last = e;
  const model = last?.model ?? AGENTS[agentId]?.model ?? MODELS.main;
  const fill = contextFill(last?.input ?? 0, compactionTriggers(role, { model }));
  const compactions = events
    .filter(isCompaction)
    .filter((c) => c.agent === agentId && c.project === pid)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, 3);
  return { agentId, used: last ? fill.used : null, compactsAt: fill.compactsAt, compactions };
}

const CURRENT: Task["status"][] = ["in_progress", "blocked", "review"];

/** The roster with each member's current task and load derived from the plan (F §3.3: never stored twice). */
export function toTeam(roster: Roster, dag: Dag, context: (agentId: string) => ContextStatus): MemberVM[] {
  return roster.members.map((m) => {
    const mine = dag.tasks.filter((x) => x.owner === m.agentId && x.kind !== "milestone");
    const current = CURRENT.map((s) => mine.filter((x) => x.status === s).sort((a, b) => t(b.updated) - t(a.updated))[0]).find(Boolean);
    const blocker = m.blockers[0];
    return {
      id: m.agentId,
      name: AGENTS[m.agentId]?.name ?? cap(m.agentId),
      role: m.role,
      archetype: m.archetype,
      state: m.state,
      lastCheckIn: m.lastCheckIn,
      lastReport: m.lastReport,
      blocker: blocker ? { text: blocker.text, on: blocker.on ?? null } : null,
      pmNote: m.pmNote,
      current: current ? { id: current.id, title: current.title, status: current.status } : null,
      load: { open: mine.filter((x) => isOpen(x.status)).length, done: mine.filter((x) => x.status === "done").length },
      context: context(m.agentId),
    };
  });
}

// --------------------------------------------------------------------------------------- charter, journal

const list = (s: string) =>
  s
    .split(/\s*[;,]\s*/)
    .map((x) => x.replace(/\.$/, "").trim())
    .filter(Boolean)
    .map(cap);

export function toCharter(c: Charter | null, spent: number): CharterVM | null {
  if (!c) return null;
  const roles = c.qualifications
    .split(/\s*;\s*/)
    .map((x) => x.replace(/\.$/, "").trim())
    .filter(Boolean)
    .map((x) => {
      const m = /^([^—–:]+?)\s*(?:—|–|:| - )\s*(.+)$/.exec(x);
      return m ? { role: cap(m[1].trim()), quals: m[2].trim() } : { role: cap(x), quals: "" };
    });
  const usd = /\$\s?(\d+(?:\.\d+)?)/.exec(c.budget);
  return {
    title: c.title,
    goal: c.goal,
    metric: c.metric,
    deadline: c.deadline,
    scope: list(c.scope),
    outOfScope: list(c.outOfScope),
    roles,
    budget: { text: c.budget, usd: usd ? Number(usd[1]) : null, spent },
  };
}

/** A journal line in the owner's words: statuses spelled out, refs shortened to a file name or kind. */
export function humanizeLine(text: string): string {
  return text
    .replace(/\b(in_progress|ready|todo|review|blocked|done|failed|dropped)\b/g, (s) => (s === "in_progress" ? "in progress" : s))
    .replace(/\bfile:(?:[^\s,()]*\/)?([^\s,/()]+)/g, "$1")
    .replace(/\bled:[^\s,()]+\/([a-z]+)/g, "$1")
    .replace(/\bmsg:[^\s,()]+/g, "a message")
    .replace(/→ pm\b/g, "→ PM");
}

/** The last 8 journal lines, newest first; a line that starts with "<agent>: " names who did it. */
export function toJournal(lines: readonly JournalLine[], who: WhoOf, known: (id: string) => boolean): JournalVM[] {
  return lines
    .slice(-8)
    .reverse()
    .map((l) => {
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*): (.+)$/.exec(l.text);
      const actor = m && known(m[1]) ? who(m[1]) : null;
      return { at: l.at, rev: l.rev, text: humanizeLine(actor && m ? m[2] : l.text), actor };
    });
}

export function toPm(plan: PlanVM, open: OpenVM, journal: JournalVM[], context: ContextStatus | null): PmStatusVM {
  const reports = plan.tasks.flatMap((x) => (x.lastReport ? [x.lastReport] : [])).sort((a, b) => t(b.at) - t(a.at));
  const own = plan.tasks.find((x) => x.owner.kind === "pm" && x.status === "in_progress");
  const said = journal.find((l) => l.actor?.kind === "pm");
  return {
    progress: { done: plan.progress.done, total: plan.progress.total, blocked: plan.progress.blocked },
    waiting: { questions: open.items.filter((i) => i.group === "you").length, approvals: open.approvals.length },
    lastReport: reports[0] ? { at: reports[0].at, by: reports[0].by } : null,
    now: own?.title ?? said?.text ?? null,
    context,
  };
}

/** USD the project's agents have spent, from the ledger's model calls. */
export const projectSpend = (events: readonly unknown[], pid: string) =>
  events.reduce<number>((sum, e) => (isCall(e) && e.team === pid ? sum + e.cost : sum), 0);

// ------------------------------------------------------------------------------------------------ build

type Stamps = Record<StateFileName, FileStamp | null>;
const stampMemo = new Map<string, { rev: number; stamps: Stamps }>();

/**
 * Each state file's last change, from the vault (a git log per file: the slow part of a read). Every state write
 * bumps the project rev, so the stamps are kept per vault, project and rev: a read with nothing new skips git.
 */
async function fileStamps(vault: Awaited<ReturnType<typeof agentVault>>, pid: string, rev: number, window: number): Promise<Stamps> {
  const key = `${vault.dir}\0${pid}`;
  const memo = stampMemo.get(key);
  if (memo?.rev === rev) return memo.stamps;
  const pathOf = (f: StateFileName) => (f === "journal" ? journalPath(pid, window) : statePath(pid, f));
  const entries = await Promise.all(
    STATE_FILES.map(async (f): Promise<[StateFileName, FileStamp | null]> => {
      const p = pathOf(f);
      const last = (await vault.history(p)).commits[0];
      return [f, last ? { path: p, updated: last.at, change: last.change } : null];
    }),
  );
  const stamps = Object.fromEntries(entries) as Stamps;
  stampMemo.set(key, { rev, stamps });
  return stamps;
}

/** Everything the state views show for one project, in one consistent read. `lead` is the team lead's agent id. */
export async function buildStateView(pid: string, { lead }: { lead?: string } = {}): Promise<ProjectStateVM> {
  const [state, vault, events] = await Promise.all([readState(pid), agentVault(), readLedger()]);
  const who = whoResolver(state.roster.members, lead);
  const roster = new Set(state.roster.members.map((m) => m.agentId));
  const known = (id: string) => id === "pm" || id === "owner" || id === lead || /^pm-/.test(id) || roster.has(id);

  const plan = toPlan(state.dag, who);
  const open = toOpen(state.open, state.dag, who);
  const journal = toJournal(state.journal.lines, who, known);
  const files = await fileStamps(vault, pid, state.rev, state.journal.window);

  return {
    pid,
    rev: state.rev,
    plan,
    decisions: toDecisions(state.decisions, who),
    open,
    team: toTeam(state.roster, state.dag, (id) => contextFor(events, id, pid, "worker")),
    charter: toCharter(state.charter, projectSpend(events, pid)),
    journal,
    prefs: state.prefs.map((p) => ({ id: p.id, text: p.text })),
    pm: toPm(plan, open, journal, lead ? contextFor(events, lead, pid, "lead") : null),
    files,
  };
}
