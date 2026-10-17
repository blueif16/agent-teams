/*
 * Every change to a project's state (F §3, §9.2): the lead's tools, the worker's report, and the runtime's staffing.
 * Each runs under the project lock as read → check the rules → write ONE vault commit (the changed files plus a
 * journal line) with Tool/Task/Rev/Project/Agent trailers. A refusal is a StateError and writes nothing.
 */
import { AGENTS } from "@/lib/data";
import { readLedger, type LedgerEvent } from "@/lib/ledger";
import type { TrailerInput, VaultAuthor } from "@/lib/vault/types";
import { RUNTIME } from "@/server/runtime/vault";
import { estimateTokens } from "./digest";
import { minute, renderCharter, renderDecisions, renderJournal, renderJson, renderPrefs } from "./format";
import {
  checkAcyclic,
  checkApproval,
  checkBlocked,
  checkCap,
  checkDepsKnown,
  checkDone,
  checkDropReason,
  checkMove,
  checkOwner,
  checkPin,
  checkRev,
  refreshReady,
  StateError,
} from "./rules";
import { Charter, Dag, isOpen, LIMITS, OpenItems, OWNER_ID, PM, Roster, type ProjectState, type ReportStatus, type Status, type Task } from "./schema";
import { commitFiles, FILES, journalPath, loadSnapshot, reportNumbers, reportPath, statePath, withProject, writerVault } from "./store";

export interface StateDeps {
  /** Clock; default the real one. */
  now?: () => Date;
  /** The ledger approvals and 📌 orders are checked against; default the app's ledger. */
  ledger?: () => Promise<readonly LedgerEvent[]>;
  /**
   * Whether a `msg:<thread>:<idx>` ref is a message the owner wrote. The runtime wires a thread-backed check;
   * without one, a well-formed msg ref is taken as given (ledger refs are always checked).
   */
  isOwnerMessage?: (ref: string) => boolean | Promise<boolean>;
}

export interface DispatchRequest {
  projectId: string;
  taskId: string;
  agentId: string;
  brief: string;
  title: string;
  acceptance: string;
  /** The project rev the assignment is written at. */
  rev: number;
}
/** Hands an assignment to the worker's thread (D §5). Resolve once it is queued; throw if it can't be delivered. */
export type Dispatch = (req: DispatchRequest) => void | Promise<void>;

type FileKey = keyof typeof FILES;

interface Ctx {
  pid: string;
  agentId: string;
  /** The rev this write will have. */
  rev: number;
  at: string;
  deps: StateDeps;
}

interface Change<R> {
  touched: FileKey[];
  /** Code-written; goes after `state(<pid>): `. Never model text (G §3). */
  subject: string;
  journal: string;
  task?: string;
  trailers?: TrailerInput;
  /** Files outside state/ that belong to the same commit (a report body). */
  extra?: { path: string; content: string }[];
  /** Runs after every check, before the commit; a throw writes nothing. */
  before?: () => Promise<void>;
  result: R;
}

export interface Applied<R> {
  rev: number;
  state: ProjectState;
  result: R;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
function clip(s: string, max: number) {
  const t = clean(s);
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
const uniq = <T>(xs: readonly T[]) => [...new Set(xs)];
const num = (id: string) => Number(id.replace(/^\D+/, ""));
const nextNum = (ids: string[]) => ids.reduce((n, id) => Math.max(n, num(id)), 0) + 1;

export const agentAuthor = (agentId: string): VaultAuthor => ({ kind: "agent", id: agentId, name: AGENTS[agentId]?.name ?? agentId });

const ledgerOf = (deps: StateDeps) => (deps.ledger ? deps.ledger() : readLedger());

function render(key: FileKey, s: ProjectState): string {
  switch (key) {
    case "dag":
      return renderJson(Dag.parse(s.dag));
    case "roster":
      return renderJson(Roster.parse(s.roster));
    case "open":
      return renderJson(OpenItems.parse(s.open));
    case "decisions":
      return renderDecisions(s.pid, s.decisions);
    case "prefs":
      return renderPrefs(s.pid, s.prefs);
    case "charter":
      return renderCharter(s.pid, Charter.parse(s.charter));
  }
}

/** Read, check, write one commit, all under the project lock. */
async function mutate<R>(
  pid: string,
  author: VaultAuthor,
  tool: string,
  source: "tool" | "report",
  deps: StateDeps,
  fn: (s: ProjectState, ctx: Ctx) => Change<R> | Promise<Change<R>>,
): Promise<Applied<R>> {
  const vault = await writerVault();
  return withProject(vault, pid, async () => {
    const snap = await loadSnapshot(vault, pid);
    const s = structuredClone(snap.state);
    const at = (deps.now?.() ?? new Date()).toISOString();
    const ctx: Ctx = { pid, agentId: author.id, rev: snap.state.rev + 1, at, deps };
    let change: Change<R>;
    let files: { path: string; content: string }[];
    try {
      change = await fn(s, ctx);
      if (change.touched.includes("dag")) {
        const readied = refreshReady(s.dag, ctx.rev, at);
        checkAcyclic(s.dag);
        if (readied.length) change.journal += ` · now ready: ${readied.join(", ")}`;
      }
      s.rev = ctx.rev;
      for (const k of change.touched) {
        if (k === "dag" || k === "roster" || k === "open") {
          s[k].rev = ctx.rev;
          s[k].updatedAt = at;
        }
      }
      s.journal.lines.push({ at: minute(at), rev: ctx.rev, text: clip(change.journal, 400) });
      try {
        files = [
          ...change.touched.map((k) => ({ path: statePath(pid, FILES[k]), content: render(k, s) })),
          { path: journalPath(pid, s.journal.window), content: renderJournal(pid, s.journal.window, s.journal.lines) },
          ...(change.extra ?? []),
        ];
      } catch (e) {
        // A field past its schema limit: the model can shorten it and call again.
        throw new StateError("invalid", `That doesn't fit the state format: ${(e as Error).message.slice(0, 300)}`);
      }
      await change.before?.();
    } catch (e) {
      if (e instanceof StateError) e.state = snap.state;
      throw e;
    }
    await commitFiles(vault, snap, {
      files,
      author,
      source,
      subject: `state(${pid}): ${change.subject}`,
      trailers: { Tool: tool, Task: change.task, Rev: String(ctx.rev), Project: pid, Agent: author.id, ...change.trailers },
    });
    return { rev: ctx.rev, state: s, result: change.result };
  });
}

function findTask(dag: Dag, id: string): Task {
  const t = dag.tasks.find((x) => x.id === id);
  if (!t) {
    const open = dag.tasks.filter((x) => isOpen(x.status)).map((x) => x.id);
    throw new StateError("unknown_id", `There is no task ${id}. Open tasks: ${open.slice(0, 20).join(", ") || "none"}.`);
  }
  return t;
}

/** The lead may name itself by its agent id; the DAG stores it as "pm". */
const ownerName = (owner: string, lead: string) => (owner === lead ? PM : owner);

function checkLinks(s: ProjectState, links: readonly string[]) {
  for (const l of links) {
    if (/^[tm][0-9]+$/.test(l) && !s.dag.tasks.some((t) => t.id === l)) throw new StateError("unknown_id", `Link ${l}: there is no such task.`);
    if (/^[QR]-[0-9]+$/.test(l) && !s.open.items.some((i) => i.id === l)) throw new StateError("unknown_id", `Link ${l}: there is no such open item.`);
    if (/^D-[0-9]+$/.test(l) && !s.decisions.some((d) => d.id === l)) throw new StateError("unknown_id", `Link ${l}: there is no such decision.`);
  }
}

function checkBlockerOn(s: ProjectState, on: string | undefined) {
  if (!on) return;
  const known = /^[QR]-/.test(on) ? s.open.items.some((i) => i.id === on) : s.dag.tasks.some((t) => t.id === on);
  if (!known) throw new StateError("unknown_id", `The blocker is on ${on}, which doesn't exist. Raise it first with raise_item, or leave "on" out.`);
}

// --------------------------------------------------------------------------------------------- the lead

export interface AddTaskArgs {
  title: string;
  kind: Task["kind"];
  acceptance: string;
  owner?: string;
  deps?: string[];
  milestone?: string;
  due?: string;
  detail?: string;
  source?: string;
}

export function addTask(pid: string, lead: string, a: AddTaskArgs, deps: StateDeps = {}) {
  return mutate(pid, agentAuthor(lead), "add_task", "tool", deps, (s, ctx) => {
    const owner = a.owner === undefined ? null : ownerName(a.owner, lead);
    if (owner) checkOwner(s.roster, owner, { allowPm: true });
    const taskDeps = uniq(a.deps ?? []);
    checkDepsKnown(s.dag, taskDeps);
    if (a.milestone && !s.dag.tasks.some((t) => t.id === a.milestone && t.kind === "milestone"))
      throw new StateError("unknown_id", `There is no milestone ${a.milestone}. Add it first with kind "milestone".`);
    checkCap("open tasks", s.dag.tasks.filter((t) => isOpen(t.status)).length, LIMITS.openTasks, "finish, merge or drop a task first");
    const prefix = a.kind === "milestone" ? "m" : "t";
    const id = `${prefix}${nextNum(s.dag.tasks.filter((t) => t.id.startsWith(prefix)).map((t) => t.id))}`;
    s.dag.tasks.push({
      id,
      kind: a.kind,
      title: clean(a.title),
      status: "todo",
      owner,
      deps: taskDeps,
      ...(a.milestone ? { milestone: a.milestone } : {}),
      ...(a.due ? { due: a.due } : {}),
      acceptance: clean(a.acceptance),
      ...(a.detail?.trim() ? { detail: a.detail.trim() } : {}),
      blocker: null,
      evidence: [],
      notes: [],
      created: ctx.at,
      updated: ctx.at,
      reopened: 0,
      rev: ctx.rev,
      source: a.source ?? "tool:add_task",
    });
    const meta = [a.kind, ...(owner ? [owner] : []), ...(taskDeps.length ? [`deps ${taskDeps.join(",")}`] : [])].join(", ");
    return { touched: ["dag"], subject: `add ${id}`, task: id, journal: `pm: added ${id} "${clip(a.title, 60)}" (${meta})`, result: { id } };
  });
}

export interface UpdateTaskArgs {
  id: string;
  expectedRev: number;
  status?: Status;
  owner?: string | null;
  addDeps?: string[];
  removeDeps?: string[];
  blocker?: { text: string; on?: string } | null;
  note?: string;
  evidence?: string[];
}

export function updateTask(pid: string, lead: string, a: UpdateTaskArgs, deps: StateDeps = {}) {
  return mutate(pid, agentAuthor(lead), "update_task", "tool", deps, (s, ctx) => {
    const t = findTask(s.dag, a.id);
    checkRev(t, a.expectedRev, s.rev);
    const from = t.status;
    const to = a.status ?? from;
    const changes: string[] = [];

    if (a.owner !== undefined) {
      const owner = a.owner === null ? null : ownerName(a.owner, lead);
      if (owner !== t.owner) {
        if (from !== "todo" && from !== "ready")
          throw new StateError("use_assign_task", `${t.id} is ${from}; change its owner with assign_task so the new owner gets the brief.`);
        if (owner) checkOwner(s.roster, owner, { allowPm: true });
        t.owner = owner;
        changes.push(`owner ${owner ?? "none"}`);
      }
    }
    const add = uniq(a.addDeps ?? []).filter((d) => !t.deps.includes(d));
    if (add.length) {
      checkDepsKnown(s.dag, add, t.id);
      t.deps = [...t.deps, ...add];
      changes.push(`deps +${add.join(" +")}`);
    }
    const drop = (a.removeDeps ?? []).filter((d) => t.deps.includes(d));
    if (drop.length) {
      t.deps = t.deps.filter((d) => !drop.includes(d));
      changes.push(`deps -${drop.join(" -")}`);
    }
    const ev = uniq(a.evidence ?? []).filter((e) => !t.evidence.includes(e));
    if (ev.length) {
      t.evidence = [...t.evidence, ...ev];
      changes.push(`evidence ${ev.join(" ")}`);
    }
    if (a.note?.trim()) {
      t.notes = [...t.notes, { at: ctx.at, rev: ctx.rev, text: clip(a.note, 300) }].slice(-LIMITS.taskNotes);
      changes.push("note");
    }
    if (a.blocker !== undefined) {
      if (a.blocker === null) t.blocker = null;
      else {
        if (to !== "blocked") throw new StateError("invalid", `A blocker goes with status "blocked". To clear one, move ${t.id} to in_progress.`);
        checkBlockerOn(s, a.blocker.on);
        t.blocker = { text: clean(a.blocker.text), ...(a.blocker.on ? { on: a.blocker.on } : {}), since: ctx.at };
        changes.push(`blocker${a.blocker.on ? ` on ${a.blocker.on}` : ""}`);
      }
    }
    if (to !== from) {
      checkMove(t.id, from, to);
      if (to === "dropped") checkDropReason(t.id, a.note);
      if (from === "review" && to === "in_progress") t.reopened += 1;
      if (from === "blocked") t.blocker = null;
      t.status = to;
    }
    if (t.status === "done") checkDone(t);
    checkBlocked(t);
    if (to === from && !changes.length) throw new StateError("no_change", `Nothing to change on ${t.id}; it is ${from} as you asked.`);

    t.rev = ctx.rev;
    t.updated = ctx.at;
    const moved = to !== from;
    return {
      touched: ["dag"],
      subject: moved ? `${t.id} ${from} -> ${to}` : `update ${t.id}`,
      task: t.id,
      trailers: moved && to === "done" && t.evidence.length ? { Evidence: t.evidence.join(", ") } : undefined,
      journal: `pm: ${t.id} ${moved ? `${from} → ${to}` : "updated"}${changes.length ? ` (${changes.join(", ")})` : ""}`,
      result: { id: t.id },
    };
  });
}

export interface AssignTaskArgs {
  id: string;
  agentId: string;
  brief: string;
}

export function assignTask(pid: string, lead: string, a: AssignTaskArgs, dispatch: Dispatch | undefined, deps: StateDeps = {}) {
  return mutate(pid, agentAuthor(lead), "assign_task", "tool", deps, (s, ctx) => {
    const t = findTask(s.dag, a.id);
    checkOwner(s.roster, a.agentId, { allowPm: false });
    const from = t.status;
    if (from !== "in_progress") checkMove(t.id, from, "in_progress");
    if (from === "review") t.reopened += 1;
    const before = t.owner;
    t.owner = a.agentId;
    t.status = "in_progress";
    t.blocker = null;
    t.brief = a.brief.trim();
    t.rev = ctx.rev;
    t.updated = ctx.at;
    return {
      touched: ["dag"],
      subject: `assign ${t.id} to ${a.agentId}`,
      task: t.id,
      journal: `pm: assigned ${t.id} to ${a.agentId}${before && before !== a.agentId ? ` (was ${before})` : ""}${from !== "in_progress" ? ` · ${from} → in_progress` : ""}`,
      before: async () => {
        if (!dispatch) throw new StateError("not_wired", "Assignments can't be delivered yet (no dispatch is wired); nothing was changed. Tell the owner.");
        try {
          await dispatch({ projectId: pid, taskId: t.id, agentId: a.agentId, brief: t.brief!, title: t.title, acceptance: t.acceptance, rev: ctx.rev });
        } catch (e) {
          throw new StateError("dispatch_failed", `The brief couldn't be delivered to ${a.agentId} (${clip((e as Error).message, 120)}); nothing was changed.`);
        }
      },
      result: { id: t.id },
    };
  });
}

export interface RecordDecisionArgs {
  title: string;
  decision: string;
  why: string;
  approvedBy: "pm" | "owner";
  approvalRef?: string;
  supersedes?: string;
  links?: string[];
  source?: string;
}

export function recordDecision(pid: string, lead: string, a: RecordDecisionArgs, deps: StateDeps = {}) {
  return mutate(pid, agentAuthor(lead), "record_decision", "tool", deps, async (s, ctx) => {
    if (a.approvedBy === OWNER_ID) checkApproval(await ledgerOf(deps), a.approvalRef);
    const sup = a.supersedes ? s.decisions.find((d) => d.id === a.supersedes) : undefined;
    if (a.supersedes && !sup) throw new StateError("unknown_id", `There is no decision ${a.supersedes}.`);
    if (sup && sup.status !== "active") throw new StateError("invalid", `${sup.id} is already ${sup.status}.`);
    const links = uniq(a.links ?? []);
    checkLinks(s, links);
    const active = s.decisions.filter((d) => d.status === "active").length - (sup ? 1 : 0);
    checkCap("active decisions", active, LIMITS.activeDecisions, "supersede an old one (pass supersedes) instead of adding");
    const id = `D-${String(nextNum(s.decisions.map((d) => d.id))).padStart(3, "0")}`;
    if (sup) sup.status = `superseded by ${id}`;
    s.decisions.push({
      id,
      date: ctx.at.slice(0, 10),
      title: clean(a.title),
      status: "active",
      decision: clean(a.decision),
      why: clean(a.why),
      approvedBy: a.approvedBy,
      ...(a.approvalRef ? { approvalRef: a.approvalRef } : {}),
      proposedBy: lead,
      ...(sup ? { supersedes: sup.id } : {}),
      links,
      source: a.source ?? "tool:record_decision",
    });
    return {
      touched: ["decisions"],
      subject: `record ${id}${sup ? ` superseding ${sup.id}` : ""}`,
      trailers: {
        Supersedes: sup ? `${id} -> ${sup.id}` : undefined,
        "Approved-By": a.approvedBy === OWNER_ID ? `owner ${a.approvalRef}` : undefined,
      },
      journal: `pm: decision ${id} "${clip(a.title, 60)}" (${a.approvedBy})${sup ? ` supersedes ${sup.id}` : ""}`,
      result: { id },
    };
  });
}

export interface RaiseItemArgs {
  kind: "question" | "risk";
  text: string;
  askOf: string;
  links?: string[];
  due?: string;
  severity?: "low" | "medium" | "high";
  source?: string;
}

export function raiseItem(pid: string, lead: string, a: RaiseItemArgs, deps: StateDeps = {}) {
  return mutate(pid, agentAuthor(lead), "raise_item", "tool", deps, (s, ctx) => {
    const askOf = ownerName(a.askOf, lead);
    checkOwner(s.roster, askOf, { allowPm: true });
    const links = uniq(a.links ?? []);
    checkLinks(s, links);
    checkCap("open items", s.open.items.filter((i) => i.status === "open").length, LIMITS.openItems, "resolve one first");
    const prefix = a.kind === "question" ? "Q" : "R";
    const id = `${prefix}-${nextNum(s.open.items.filter((i) => i.id.startsWith(prefix)).map((i) => i.id))}`;
    s.open.items.push({
      id,
      kind: a.kind,
      askOf,
      text: clean(a.text),
      raised: ctx.at,
      ...(a.due ? { due: a.due } : {}),
      ...(a.severity ? { severity: a.severity } : {}),
      status: "open",
      links,
      source: a.source ?? "tool:raise_item",
    });
    return { touched: ["open"], subject: `raise ${id}`, journal: `pm: raised ${id} → ${askOf} "${clip(a.text, 80)}"`, result: { id } };
  });
}

export function resolveItem(pid: string, lead: string, a: { id: string; resolution: string }, deps: StateDeps = {}) {
  return mutate(pid, agentAuthor(lead), "resolve_item", "tool", deps, (s, ctx) => {
    const item = s.open.items.find((i) => i.id === a.id);
    if (!item) throw new StateError("unknown_id", `There is no item ${a.id}.`);
    if (item.status !== "open") throw new StateError("invalid", `${a.id} is already resolved.`);
    item.status = "resolved";
    item.resolution = clip(a.resolution, 300);
    item.resolvedAt = ctx.at;
    const waiting = s.dag.tasks.filter((t) => t.status === "blocked" && t.blocker?.on === a.id).map((t) => t.id);
    return {
      touched: ["open"],
      subject: `resolve ${a.id}`,
      journal: `pm: resolved ${a.id}: ${clip(a.resolution, 80)}${waiting.length ? ` · still blocked on it: ${waiting.join(", ")}` : ""}`,
      result: { id: a.id },
    };
  });
}

export function noteOwnerPref(pid: string, lead: string, a: { text: string; sourceRef: string }, deps: StateDeps = {}) {
  return mutate(pid, agentAuthor(lead), "note_owner_pref", "tool", deps, async (s) => {
    if (a.sourceRef.startsWith("led:")) checkPin(await ledgerOf(deps), a.sourceRef);
    else if (a.sourceRef.startsWith("msg:")) {
      if (deps.isOwnerMessage && !(await deps.isOwnerMessage(a.sourceRef))) throw new StateError("unknown_source", `${a.sourceRef} isn't a message from the owner.`);
    } else throw new StateError("unknown_source", `An owner preference must cite the owner's message (msg:<thread>:<n>) or the 📌 (led:<at>/order).`);
    checkCap("owner prefs", s.prefs.length, LIMITS.prefs, "ask the owner which to retire");
    const id = `P-${nextNum(s.prefs.map((p) => p.id))}`;
    s.prefs.push({ id, text: clean(a.text), source: a.sourceRef });
    return { touched: ["prefs"], subject: `add owner pref ${id}`, journal: `pm: owner pref ${id} "${clip(a.text, 80)}"`, result: { id } };
  });
}

export function updateMember(pid: string, lead: string, a: { agentId: string; pmNote?: string | null; blocker?: { text: string; on?: string } | null }, deps: StateDeps = {}) {
  return mutate(pid, agentAuthor(lead), "update_member", "tool", deps, (s) => {
    const m = s.roster.members.find((x) => x.agentId === a.agentId);
    if (!m) throw new StateError("unknown_owner", `${a.agentId} isn't on this project's roster. Members: ${s.roster.members.map((x) => x.agentId).join(", ") || "none"}.`);
    const before = JSON.stringify(m);
    if (a.pmNote !== undefined) m.pmNote = a.pmNote === null ? null : clip(a.pmNote, 200);
    if (a.blocker !== undefined) {
      if (a.blocker) checkBlockerOn(s, a.blocker.on);
      const fromReports = m.blockers.filter((b) => b.task);
      m.blockers = a.blocker ? [...fromReports, { text: clean(a.blocker.text), ...(a.blocker.on ? { on: a.blocker.on } : {}) }] : fromReports;
    }
    if (JSON.stringify(m) === before) throw new StateError("no_change", `Nothing to change on ${a.agentId}.`);
    const what = [...(a.pmNote !== undefined ? [a.pmNote ? `"${clip(a.pmNote, 60)}"` : "note cleared"] : []), ...(a.blocker !== undefined ? [a.blocker ? `blocker "${clip(a.blocker.text, 40)}"` : "blocker cleared"] : [])];
    return { touched: ["roster"], subject: `note on ${a.agentId}`, journal: `pm: noted ${a.agentId}: ${what.join(", ")}`, result: {} };
  });
}

export function logProgress(pid: string, lead: string, a: { line: string }, deps: StateDeps = {}) {
  return mutate(pid, agentAuthor(lead), "log_progress", "tool", deps, () => ({ touched: [], subject: "log progress", journal: `pm: ${clip(a.line, 380)}`, result: {} }));
}

export interface SetCharterArgs {
  title?: string;
  goal: string;
  metric: string;
  deadline: string;
  scope: string;
  outOfScope: string;
  qualifications: string;
  budget: string;
  approvalRef: string;
}

export const CHARTER_MAX_TOKENS = 1500;

export function setCharter(pid: string, lead: string, a: SetCharterArgs, deps: StateDeps = {}) {
  return mutate(pid, agentAuthor(lead), "set_charter", "tool", deps, async (s) => {
    checkApproval(await ledgerOf(deps), a.approvalRef);
    const charter: Charter = {
      title: clean(a.title ?? s.charter?.title ?? `Project ${pid}`),
      goal: clean(a.goal),
      metric: clean(a.metric),
      deadline: a.deadline,
      scope: clean(a.scope),
      outOfScope: clean(a.outOfScope),
      qualifications: clean(a.qualifications),
      budget: clean(a.budget),
      approvalRef: a.approvalRef,
    };
    if (estimateTokens(renderCharter(pid, charter)) > CHARTER_MAX_TOKENS) throw new StateError("too_long", `The charter must fit in ${CHARTER_MAX_TOKENS} tokens; shorten the fields.`);
    s.charter = charter;
    return { touched: ["charter"], subject: "set the charter", trailers: { "Approved-By": `owner ${a.approvalRef}` }, journal: `pm: charter set, approved ${a.approvalRef}`, result: {} };
  });
}

// ------------------------------------------------------------------------------------------- the runtime

export interface MemberInput {
  agentId: string;
  role: string;
  archetype: string;
  thread?: string;
}

/** Staffing (provisioning, S3): puts an agent on the roster, or updates its role. Runtime-only, never a lead tool. */
export function addMember(pid: string, m: MemberInput, deps: StateDeps = {}) {
  return mutate(pid, RUNTIME, "add_member", "tool", deps, (s) => {
    const found = s.roster.members.find((x) => x.agentId === m.agentId);
    if (found) Object.assign(found, { role: clean(m.role), archetype: clean(m.archetype), ...(m.thread ? { thread: m.thread } : {}) });
    else
      s.roster.members.push({
        agentId: m.agentId,
        role: clean(m.role),
        archetype: clean(m.archetype),
        ...(m.thread ? { thread: m.thread } : {}),
        state: "idle",
        lastCheckIn: null,
        lastReport: null,
        blockers: [],
        pmNote: null,
      });
    return { touched: ["roster"], subject: `staff ${m.agentId}`, journal: `runtime: ${m.agentId} on the team as ${clip(m.role, 60)}`, result: {} };
  });
}

// -------------------------------------------------------------------------------------------- the worker

/** A `<state_delta>` line for the lead's tail (F §4.1 layout item 7). */
export interface StateDelta {
  projectId: string;
  rev: number;
  taskId: string;
  line: string;
}

export interface ReportArgs {
  taskId: string;
  status: ReportStatus;
  summary: string;
  evidence: string[];
  blocker?: { text: string; on?: string };
}

const REPORT_TO: Record<ReportStatus, Status> = { progress: "in_progress", blocked: "blocked", review: "review", done: "done" };
const MEMBER_STATE = { progress: "working", blocked: "blocked", review: "idle", done: "idle" } as const;

/**
 * A worker's report (F §3.1, §4.6): the task's status, blocker, evidence and lastReport, the worker's roster entry,
 * the full report file and the journal line, in one commit. Returns the `<state_delta>` line for the lead.
 */
export function report(pid: string, worker: string, a: ReportArgs, deps: StateDeps = {}) {
  return mutate(pid, agentAuthor(worker), "report", "report", deps, async (s, ctx) => {
    const t = findTask(s.dag, a.taskId);
    if (t.owner !== worker)
      throw new StateError("not_owner", `${t.id} is ${t.owner ? `owned by ${t.owner}` : "unassigned"}, not you. Report only on tasks assigned to you; ask the lead if this one should be.`);
    const m = s.roster.members.find((x) => x.agentId === worker);
    if (!m) throw new StateError("unknown_owner", `You (${worker}) aren't on this project's roster.`);
    const from = t.status;
    const to = REPORT_TO[a.status];
    // A report on a task that is ready or blocked starts (or resumes) it on the way.
    if (to !== from) {
      if (to !== "in_progress" && (from === "ready" || from === "blocked")) {
        checkMove(t.id, from, "in_progress");
        checkMove(t.id, "in_progress", to);
      } else checkMove(t.id, from, to);
    }
    if (a.status === "blocked" && !a.blocker)
      throw new StateError("blocker_required", "A blocked report needs a blocker: what you wait on, and the question or task id if there is one.");
    if (a.blocker) checkBlockerOn(s, a.blocker.on);
    const evidence = uniq(a.evidence);
    t.evidence = uniq([...t.evidence, ...evidence]);
    const since = from === "blocked" && t.blocker ? t.blocker.since : ctx.at;
    t.blocker = a.status === "blocked" && a.blocker ? { text: clean(a.blocker.text), ...(a.blocker.on ? { on: a.blocker.on } : {}), since } : null;
    if (from === "review" && to === "in_progress") t.reopened += 1;
    t.status = to;
    if (to === "done") checkDone(t);
    checkBlocked(t);

    const n = Math.max(0, ...(await reportNumbers(await writerVault(), pid, t.id))) + 1;
    const ref = reportPath(pid, t.id, n);
    t.lastReport = { at: ctx.at, by: worker, status: a.status, summary: clip(a.summary, 300), ref };
    t.rev = ctx.rev;
    t.updated = ctx.at;

    m.state = MEMBER_STATE[a.status];
    m.lastCheckIn = ctx.at;
    m.lastReport = clip(`${t.id} ${a.summary}`, 300);
    m.blockers = m.blockers.filter((b) => b.task !== t.id);
    if (t.blocker) m.blockers.push({ text: t.blocker.text, ...(t.blocker.on ? { on: t.blocker.on } : {}), task: t.id });

    const body = [
      `# ${t.id} report ${String(n).padStart(2, "0")} · ${a.status}`,
      "",
      `- Task: ${t.id} ${t.title}`,
      `- By: ${worker}`,
      `- At: ${ctx.at}`,
      `- Rev: ${ctx.rev}`,
      ...(evidence.length ? [`- Evidence: ${evidence.join(", ")}`] : []),
      ...(t.blocker ? [`- Blocker: ${t.blocker.text}${t.blocker.on ? ` (on ${t.blocker.on})` : ""}`] : []),
      "",
      a.summary.trim(),
      "",
    ].join("\n");

    const line = `${t.id} ${a.status} (${worker}): "${clip(a.summary, 120)}"${t.blocker?.on ? ` · on ${t.blocker.on}` : ""} · report ${ref}`;
    const delta: StateDelta = { projectId: pid, rev: ctx.rev, taskId: t.id, line: `<state_delta rev="${ctx.rev}">${line}</state_delta>` };
    return {
      touched: ["dag", "roster"],
      subject: from === to ? `${t.id} report by ${worker}` : `${t.id} ${from} -> ${to} (report by ${worker})`,
      task: t.id,
      trailers: { Evidence: evidence.length ? evidence.join(", ") : undefined },
      extra: [{ path: ref, content: body }],
      journal: line,
      result: { ref, delta },
    };
  });
}
