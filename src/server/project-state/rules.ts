/*
 * The rules that keep project state trustworthy after compaction (F §3, §8). Each check throws a StateError whose
 * message tells the model exactly what to do instead; a refused call writes nothing.
 */
import type { LedgerEvent } from "@/lib/ledger";
import { isOpen, OWNER_ID, PM, type Dag, type ProjectState, type Roster, type Status, type Task } from "./schema";

export type StateErrorCode =
  | "conflict"
  | "illegal_transition"
  | "evidence_required"
  | "reason_required"
  | "blocker_required"
  | "cycle"
  | "unknown_id"
  | "unknown_owner"
  | "cap_reached"
  | "approval_required"
  | "unknown_source"
  | "not_owner"
  | "use_assign_task"
  | "dispatch_failed"
  | "not_wired"
  | "no_change"
  | "too_long"
  | "invalid";

export class StateError extends Error {
  /** The state the refused call saw, for the recite line in the refusal. */
  state?: ProjectState;
  constructor(
    readonly code: StateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StateError";
  }
}

/**
 * Optimistic concurrency per task: expectedRev is the latest project rev the caller has seen. The task must not have
 * changed after it, and it can't be a rev the project hasn't reached.
 */
export function checkRev(t: Task, expectedRev: number, projectRev: number): void {
  const now = `${t.id} is ${t.status}${t.owner ? ` (owner ${t.owner})` : ""}${t.blocker ? `, blocked: ${t.blocker.text}` : ""}, last changed at rev ${t.rev}`;
  if (expectedRev > projectRev)
    throw new StateError("conflict", `expectedRev ${expectedRev} is newer than the project (rev ${projectRev}). ${now}. Call again with expectedRev ${projectRev}.`);
  if (t.rev > expectedRev)
    throw new StateError("conflict", `${t.id} changed after rev ${expectedRev}: ${now}. Check this still makes sense, then call again with expectedRev ${projectRev}.`);
}

/** F §3.1. todo → ready is computed from deps, never set; any open status may be dropped (with a reason). */
const MOVES: Record<Status, readonly Status[]> = {
  todo: ["dropped"],
  ready: ["in_progress", "dropped"],
  in_progress: ["review", "blocked", "done", "failed", "dropped"],
  review: ["done", "in_progress", "dropped"],
  blocked: ["in_progress", "dropped"],
  done: [],
  failed: [],
  dropped: [],
};

export function checkMove(id: string, from: Status, to: Status): void {
  if (MOVES[from].includes(to)) return;
  if (to === "ready" || to === "todo")
    throw new StateError("illegal_transition", `${to} is set by code: a task is ready once every dep is done. ${id} is ${from}.`);
  const legal = MOVES[from];
  throw new StateError(
    "illegal_transition",
    `${id} can't go from ${from} to ${to}. ${legal.length ? `From ${from} it can go to: ${legal.join(", ")}.` : `${from} is final; add a new task instead.`}`,
  );
}

/** `done` needs at least one evidence ref: a file path or a ledger id (F §3.1, §8 "premature done"). */
export function checkDone(t: Task): void {
  if (!t.evidence.length)
    throw new StateError("evidence_required", `${t.id} can't be done without evidence. Pass evidence: the file path or ledger ref that shows the acceptance ("${t.acceptance.slice(0, 80)}") is met.`);
}

export function checkDropReason(id: string, note: string | undefined): void {
  if (!note?.trim()) throw new StateError("reason_required", `Dropping ${id} needs a reason: pass note with why.`);
}

export function checkBlocked(t: Task): void {
  if (t.status === "blocked" && !t.blocker) throw new StateError("blocker_required", `${t.id} is blocked, so it needs a blocker: pass blocker {text, on?}.`);
}

/** The DAG must stay acyclic: walks every dep chain and names the cycle it finds. */
export function checkAcyclic(dag: Dag): void {
  const deps = new Map(dag.tasks.map((t) => [t.id, t.deps]));
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "visiting");
    path.push(id);
    for (const d of deps.get(id) ?? []) {
      const cycle = visit(d);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(id, "done");
    return null;
  };
  for (const t of dag.tasks) {
    const cycle = visit(t.id);
    if (cycle) throw new StateError("cycle", `That would make a dependency cycle: ${cycle.join(" → ")}. Remove one of these deps instead.`);
  }
}

/** Deps must name tasks that exist, aren't the task itself, and can still be done. */
export function checkDepsKnown(dag: Dag, deps: readonly string[], self?: string): void {
  for (const d of deps) {
    if (d === self) throw new StateError("cycle", `${d} can't depend on itself.`);
    const t = dag.tasks.find((x) => x.id === d);
    if (!t) throw new StateError("unknown_id", `There is no task ${d} to depend on.`);
    if (t.status === "dropped" || t.status === "failed") throw new StateError("invalid", `${d} is ${t.status}, so it will never be done; depend on its replacement.`);
  }
}

/** Refuses to add one more when `count` is already at `max`. */
export function checkCap(what: string, count: number, max: number, hint: string): void {
  if (count >= max) throw new StateError("cap_reached", `There are already ${count} ${what} (the limit is ${max}); ${hint}.`);
}

/** An owner of work or a question: a roster member, or (when allowed) the lead itself or the human owner. */
export function checkOwner(roster: Roster, owner: string, opts: { allowPm: boolean }): void {
  if (opts.allowPm && (owner === PM || owner === OWNER_ID)) return;
  if (roster.members.some((m) => m.agentId === owner)) return;
  const names = roster.members.map((m) => m.agentId).join(", ") || "nobody yet";
  throw new StateError("unknown_owner", `${owner} isn't on this project's roster (${names})${opts.allowPm ? ', and isn\'t "pm" or "owner"' : ""}.`);
}

function ledgerEvent(events: readonly LedgerEvent[], ref: string): LedgerEvent | undefined {
  const m = /^led:(.+)\/([a-z]+)$/.exec(ref);
  return m ? events.find((e) => e.at === m[1] && e.t === m[2]) : undefined;
}

/** Owner approval must resolve to a real `approved` event in the ledger (F §3.2: the model can't fake one). */
export function checkApproval(events: readonly LedgerEvent[], ref: string | undefined): void {
  const why = "Ask the owner first (raise_item with askOf owner) and record their answer when the approval arrives.";
  if (!ref) throw new StateError("approval_required", `An owner approval needs approvalRef, the ledger ref of the owner's approval (led:<at>/approval). ${why}`);
  const e = ledgerEvent(events, ref);
  if (!e || e.t !== "approval") throw new StateError("approval_required", `${ref} isn't an owner approval in the ledger. ${why}`);
  if (e.decision !== "approved") throw new StateError("approval_required", `${ref} is the owner declining, not approving. Record that as declined (approvedBy pm), or ask again.`);
}

/** A 📌 source must be a real pin order in the ledger. */
export function checkPin(events: readonly LedgerEvent[], ref: string): void {
  const e = ledgerEvent(events, ref);
  if (!e || e.t !== "order" || e.order !== "pin") throw new StateError("unknown_source", `${ref} isn't a 📌 in the ledger. Cite the 📌 (led:<at>/order) or the owner's message (msg:<thread>:<n>).`);
}

/**
 * todo ↔ ready, computed: a todo whose deps are all done becomes ready, and a ready task that gained an unfinished
 * dep goes back to todo. Returns the ids that became ready.
 */
export function refreshReady(dag: Dag, rev: number, at: string): string[] {
  const status = new Map(dag.tasks.map((t) => [t.id, t.status]));
  const readied: string[] = [];
  for (const t of dag.tasks) {
    if (!isOpen(t.status) || (t.status !== "todo" && t.status !== "ready")) continue;
    const ready = t.deps.every((d) => status.get(d) === "done");
    const next = ready ? "ready" : "todo";
    if (next === t.status) continue;
    t.status = next;
    t.rev = rev;
    t.updated = at;
    if (ready) readied.push(t.id);
  }
  return readied;
}
