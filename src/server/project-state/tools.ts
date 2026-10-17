/*
 * The lead's state tools and the worker's `report` as LangChain tools (F §9.2). Exported, not registered: the runtime
 * builder adds them to the agents and wires `dispatch` and `notifyLead`.
 *
 * Every result is one JSON line. Success: `{id?, rev, recite}`, where recite restates the plan at the tail (F §3.1).
 * A refusal: `{error, message, rev, recite}` with nothing written, so the model can fix the call and retry.
 * Schemas are strict: a field the runtime owns (lastReport, member state, ...) is rejected, not ignored.
 */
import { tool } from "langchain";
import { z } from "zod";
import { recite } from "./digest";
import { StateFileError } from "./format";
import {
  addTask,
  assignTask,
  logProgress,
  noteOwnerPref,
  raiseItem,
  recordDecision,
  report,
  resolveItem,
  setCharter,
  updateMember,
  updateTask,
  type Applied,
  type Dispatch,
  type StateDelta,
  type StateDeps,
} from "./ops";
import { StateError } from "./rules";
import { AgentId, DecisionId, IsoDate, ItemId, ProjectId, Ref, REPORT_STATUSES, STATUSES, TASK_KINDS, TaskId } from "./schema";
import { OutsideEditError } from "./store";

export interface LeadDeps extends StateDeps {
  /** Delivers assign_task's brief to the worker's thread. Without it, assign_task refuses with "not_wired". */
  dispatch?: Dispatch;
}

/** Runs one state change and shapes the model-facing result. */
async function respond(run: () => Promise<Applied<{ id?: string }>>): Promise<string> {
  try {
    const out = await run();
    return JSON.stringify({ ...(out.result.id ? { id: out.result.id } : {}), rev: out.rev, recite: recite(out.state) });
  } catch (e) {
    if (e instanceof StateError) return JSON.stringify({ error: e.code, message: e.message, ...(e.state ? { rev: e.state.rev, recite: recite(e.state) } : {}) });
    if (e instanceof OutsideEditError) return JSON.stringify({ error: "conflict", message: `${e.message}. Call again; your change wasn't applied.` });
    if (e instanceof StateFileError) return JSON.stringify({ error: "state_unreadable", message: `${e.message}. Tell the owner; the file needs restoring from its History.` });
    throw e;
  }
}

const text = (max: number, what: string) => z.string().min(1).max(max).describe(what);
const blocker = z.strictObject({
  text: text(200, "What it waits on, in a few words."),
  on: z.union([ItemId, TaskId]).optional().describe("The open question/risk id (Q-2, R-1) or task id it waits on, if any."),
});
const links = z
  .array(z.string().max(240).regex(/^[^\s,]+$/, "an id or path, no spaces"))
  .max(10)
  .optional()
  .describe("Related ids (t7, Q-2, D-003) or file paths.");
const source = Ref.optional().describe("What this came from, if not your own call: the owner's message (msg:<thread>:<n>), a report or a ledger ref.");

export function leadTools(projectId: string, agentId: string, deps: LeadDeps = {}) {
  const pid = ProjectId.parse(projectId);
  const lead = AgentId.parse(agentId);

  const addTaskTool = tool((a) => respond(() => addTask(pid, lead, a, deps)), {
    name: "add_task",
    description:
      'Add one node to the project plan: a work task, a todo for yourself (kind "todo", owner "pm"), or a milestone. ' +
      "acceptance is the checkable definition of done. owner must be a roster member, \"pm\" or \"owner\"; deps must be existing task ids. " +
      "The task becomes ready by itself once every dep is done. Give it to a worker with assign_task. " +
      "Returns {id, rev, recite}. On {error} nothing was written: fix what the message says and call again.",
    schema: z.strictObject({
      title: text(120, "Short imperative title."),
      kind: z.enum(TASK_KINDS),
      acceptance: z.string().max(400).describe("How you will check it is done, e.g. \"3 tiers, <=120 words each\"."),
      owner: z.string().max(64).optional().describe('Roster agent id, "pm" or "owner"; leave out for unassigned.'),
      deps: z.array(TaskId).max(20).optional().describe("Task ids that must be done first."),
      milestone: TaskId.optional().describe("The milestone id (m1) this task belongs to."),
      due: IsoDate.optional(),
      detail: z.string().max(1000).optional(),
      source,
    }),
  });

  const updateTaskTool = tool((a) => respond(() => updateTask(pid, lead, a, deps)), {
    name: "update_task",
    description:
      "Change one task. expectedRev is the latest rev you have seen (in a recite line or the state digest); if the task changed after it you get " +
      '"conflict" with its current state: retry with the rev the message gives. ' +
      "Status moves: ready→in_progress; in_progress→review, blocked, done or failed; review→done or in_progress; blocked→in_progress; " +
      "any open status→dropped (note must give the reason). todo and ready are set by code from deps. " +
      "done needs evidence: a file path or ledger ref that proves it, passed here or already on the task. blocked needs a blocker. " +
      "Change owner here only before work starts; after that use assign_task. Returns {id, rev, recite}. On {error} nothing was written.",
    schema: z.strictObject({
      id: TaskId,
      expectedRev: z.number().int().min(0).describe("The latest project rev you have seen."),
      status: z.enum(STATUSES).optional(),
      owner: z.string().max(64).nullable().optional().describe('Roster agent id, "pm", "owner", or null to unassign (todo/ready tasks only).'),
      addDeps: z.array(TaskId).max(20).optional(),
      removeDeps: z.array(TaskId).max(20).optional(),
      blocker: blocker.nullable().optional().describe("With status blocked: what it waits on."),
      note: z.string().max(300).optional().describe("Why, in one line. Required when dropping."),
      evidence: z.array(Ref).max(10).optional().describe("Proof refs: file:<path>, a path, or led:<at>/<t>."),
    }),
  });

  const assignTaskTool = tool((a) => respond(() => assignTask(pid, lead, a, deps.dispatch, deps)), {
    name: "assign_task",
    description:
      "Give a task to a roster member and send them the brief: sets the owner and in_progress, and delivers the brief to their thread. " +
      "The task must be ready, blocked, in review, or in progress (to reassign). " +
      "Write the brief as what to do, the acceptance, and the input paths they need. " +
      "Returns {id, rev, recite}. On {error} nothing was written and nothing was sent.",
    schema: z.strictObject({ id: TaskId, agentId: AgentId.describe("A roster member's agent id."), brief: text(2000, "What to do, the acceptance, and input paths.") }),
  });

  const recordDecisionTool = tool((a) => respond(() => recordDecision(pid, lead, a, deps)), {
    name: "record_decision",
    description:
      "Record a decision that constrains more than one task, an owner approval or decline, or a reversal (decisions.md, append-only). " +
      'approvedBy "owner" needs approvalRef, the ledger ref of the owner\'s approval (led:<at>/approval); without one, record it as "pm" ' +
      "or ask the owner first with raise_item. To replace an earlier decision pass supersedes with its id. At most 25 are active. " +
      "Returns {id, rev, recite}. On {error} nothing was written.",
    schema: z.strictObject({
      title: text(120, "Short title."),
      decision: text(600, "What was decided, in one or two sentences."),
      why: text(600, "Why, in one or two sentences."),
      approvedBy: z.enum(["pm", "owner"]),
      approvalRef: Ref.optional().describe("led:<at>/approval of the owner's approval; required when approvedBy is owner."),
      supersedes: DecisionId.optional(),
      links,
      source,
    }),
  });

  const raiseItemTool = tool((a) => respond(() => raiseItem(pid, lead, a, deps)), {
    name: "raise_item",
    description:
      'Open a question or a risk. askOf "owner" puts it on the owner\'s card; "pm" or a roster member otherwise. ' +
      "Link the tasks it affects. At most 20 are open; close answered ones with resolve_item. Returns {id, rev, recite}. On {error} nothing was written.",
    schema: z.strictObject({
      kind: z.enum(["question", "risk"]),
      text: text(300, "The question, or the risk and what it threatens."),
      askOf: z.string().max(64).describe('"owner", "pm" or a roster agent id.'),
      links,
      due: IsoDate.optional(),
      severity: z.enum(["low", "medium", "high"]).optional().describe("For risks."),
      source,
    }),
  });

  const resolveItemTool = tool((a) => respond(() => resolveItem(pid, lead, a, deps)), {
    name: "resolve_item",
    description: "Close an open question or risk with its answer or outcome. Tasks blocked on it stay blocked until you move them. Returns {id, rev, recite}.",
    schema: z.strictObject({ id: ItemId, resolution: text(300, "The answer or outcome.") }),
  });

  const noteOwnerPrefTool = tool((a) => respond(() => noteOwnerPref(pid, lead, a, deps)), {
    name: "note_owner_pref",
    description:
      "Save a preference the owner stated for this project; the whole team sees it. sourceRef is the owner's message (msg:<thread>:<n>) " +
      "or the 📌 event (led:<at>/order) it came from. Never note a preference the owner didn't state. Returns {id, rev, recite}.",
    schema: z.strictObject({ text: text(300, "The preference, as the owner meant it."), sourceRef: Ref }),
  });

  const updateMemberTool = tool((a) => respond(() => updateMember(pid, lead, a, deps)), {
    name: "update_member",
    description:
      "Your note on a teammate (pmNote, e.g. \"fast; asks before guessing\") or a blocker you know they have. " +
      "Their state, check-ins and reports come from their own reports, not from here. Returns {rev, recite}.",
    schema: z.strictObject({
      agentId: AgentId,
      pmNote: z.string().max(200).nullable().optional().describe("null clears it."),
      blocker: blocker.nullable().optional().describe("null clears the one you noted."),
    }),
  });

  const logProgressTool = tool((a) => respond(() => logProgress(pid, lead, a, deps)), {
    name: "log_progress",
    description:
      "Add one line to the project journal for an event the state doesn't already show, such as a plan change and why. " +
      "State changes are journaled for you. Returns {rev, recite}.",
    schema: z.strictObject({ line: text(200, "One line.").regex(/^[^\r\n]*$/, "one line") }),
  });

  const setCharterTool = tool((a) => respond(() => setCharter(pid, lead, a, deps)), {
    name: "set_charter",
    description:
      "Write the project charter, only after the owner approved it: approvalRef is the ledger ref of that approval (led:<at>/approval). " +
      "Each field is a line or two. Returns {rev, recite}. On {error} nothing was written.",
    schema: z.strictObject({
      title: z.string().min(1).max(120).optional().describe("The project's name; kept from the last charter if left out."),
      goal: text(600, "What ships, and by when."),
      metric: text(600, "The one success metric."),
      deadline: IsoDate,
      scope: text(600, "In scope."),
      outOfScope: text(600, "Out of scope."),
      qualifications: text(600, "What each role must be good at."),
      budget: text(600, "Spend cap and owner gates."),
      approvalRef: Ref,
    }),
  });

  return [addTaskTool, updateTaskTool, assignTaskTool, recordDecisionTool, raiseItemTool, resolveItemTool, noteOwnerPrefTool, updateMemberTool, logProgressTool, setCharterTool];
}

export interface WorkerDeps extends StateDeps {
  /** Appends a report's `<state_delta>` line to the lead's thread. Without it (or if it throws), the line waits in takeDeltas(). */
  notifyLead?: (delta: StateDelta) => void | Promise<void>;
}

const pending = new Map<string, StateDelta[]>();

/** Deltas no notifyLead took, oldest first; taking them clears them. */
export function takeDeltas(projectId: string): StateDelta[] {
  const out = pending.get(projectId) ?? [];
  pending.delete(projectId);
  return out;
}

async function deliver(delta: StateDelta, notify: WorkerDeps["notifyLead"]) {
  if (notify) {
    try {
      await notify(delta);
      return;
    } catch (e) {
      console.warn(`[project-state] couldn't hand ${delta.projectId} r${delta.rev} to the lead; queued:`, (e as Error).message);
    }
  }
  pending.set(delta.projectId, [...(pending.get(delta.projectId) ?? []), delta]);
}

export function workerTools(projectId: string, agentId: string, deps: WorkerDeps = {}) {
  const pid = ProjectId.parse(projectId);
  const worker = AgentId.parse(agentId);

  const reportTool = tool(
    (a) =>
      respond(async () => {
        const out = await report(pid, worker, a, deps);
        await deliver(out.result.delta, deps.notifyLead);
        return { ...out, result: {} };
      }),
    {
      name: "report",
      description:
        "Report on a task assigned to you; your lead sees every report. status: progress (still working), blocked (give blocker: what you wait on, " +
        "and on: the question or task id if there is one), review (ready for the lead to check), done (finished: evidence must name the files or " +
        "refs that prove it). summary: what you did and what is left, plainly; the first 300 characters show on the plan. " +
        "Returns {rev, recite}. On {error} nothing was recorded: fix what the message says and call again.",
      schema: z.strictObject({
        taskId: TaskId,
        status: z.enum(REPORT_STATUSES),
        summary: text(4000, "What you did and what is left."),
        evidence: z.array(Ref).max(20).describe("Files or refs that show the work (file:<path> or a path). Empty only for progress or blocked."),
        blocker: blocker.optional(),
      }),
    },
  );

  return [reportTool];
}
