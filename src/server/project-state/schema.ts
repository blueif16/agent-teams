/*
 * The lead's durable project state (docs/research/F-orchestrator-memory.md §3): the shape of every state file,
 * validated with zod on every read and before every write. The files live in the vault at
 * `projects/<pid>/state/*` (design §8b), and only the tools in this folder write them.
 *
 * Every file shares one monotonic project `rev`. A JSON file records the rev of its own last write, every task
 * records the rev at which it last changed, and every journal line carries the rev of the write that made it.
 */
import { z } from "zod";

/** Caps the tools enforce (F §3, §8 "Over-long state files"). */
export const LIMITS = {
  openTasks: 60,
  activeDecisions: 25,
  openItems: 20,
  prefs: 40,
  /** Notes kept per task, newest last. */
  taskNotes: 5,
} as const;

/** Open = still needs work. Closed tasks never come back (F §3.1 has no move out of done, failed or dropped). */
export const OPEN_STATUSES = ["todo", "ready", "in_progress", "review", "blocked"] as const;
export const CLOSED_STATUSES = ["done", "failed", "dropped"] as const;
export const STATUSES = [...OPEN_STATUSES, ...CLOSED_STATUSES] as const;
export type Status = (typeof STATUSES)[number];
export const isOpen = (s: Status) => (OPEN_STATUSES as readonly string[]).includes(s);

export const TASK_KINDS = ["work", "todo", "milestone"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** Who may own a task besides roster members: the lead itself and the human owner. */
export const PM = "pm";
export const OWNER_ID = "owner";

export const ProjectId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "a project id like p_42");
export const AgentId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "an agent id like ana");
/** Work and todos are t<n>; milestones are m<n>. */
export const TaskId = z.string().regex(/^[tm][1-9][0-9]{0,5}$/, "a task id like t7 or a milestone id like m1");
export const ItemId = z.string().regex(/^[QR]-[1-9][0-9]{0,4}$/, "an item id like Q-2 or R-1");
export const DecisionId = z.string().regex(/^D-[0-9]{3,5}$/, "a decision id like D-007");
export const PrefId = z.string().regex(/^P-[1-9][0-9]{0,4}$/);
export const IsoTime = z.iso.datetime();
export const IsoDate = z.iso.date();

/**
 * A pointer at where something came from or what proves it (F §3, G §3 Evidence grammar): a ledger event
 * (`led:<at>/<t>`), a message (`msg:<thread>:<idx>`), an assignment, a note, a report, a `file:` path, or a
 * plain path with at least one slash. One token: no spaces or commas, so it fits a trailer list.
 */
export const Ref = z
  .string()
  .max(240)
  .regex(/^(?:(?:led|msg|asg|note|rep|file|run):[^\s,]+|\/?[^\s,:/]+(?:\/[^\s,]+)+)$/, "a ref like led:<at>/<t>, msg:<thread>:<n>, file:<path> or a path");

const line = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => !/[\r\n]/.test(s), "one line")
    .refine((s) => s.trim().length > 0, "not empty");
export const Line = line;

export const Blocker = z.strictObject({
  text: line(200),
  /** The open item or task it waits on. */
  on: z.union([ItemId, TaskId]).optional(),
  since: IsoTime,
});
export type Blocker = z.infer<typeof Blocker>;

export const REPORT_STATUSES = ["progress", "blocked", "review", "done"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const LastReport = z.strictObject({
  at: IsoTime,
  by: AgentId,
  status: z.enum(REPORT_STATUSES),
  summary: line(300),
  /** Vault path of the full report. */
  ref: z.string().max(240),
});
export type LastReport = z.infer<typeof LastReport>;

export const TaskNote = z.strictObject({ at: IsoTime, rev: z.number().int().min(1), text: line(300) });

export const Task = z.strictObject({
  id: TaskId,
  kind: z.enum(TASK_KINDS),
  title: line(120),
  status: z.enum(STATUSES),
  /** A roster agent, "pm", "owner", or null for unassigned. */
  owner: z.string().max(64).nullable(),
  deps: z.array(TaskId),
  milestone: TaskId.optional(),
  due: IsoDate.optional(),
  acceptance: z.string().max(400),
  detail: z.string().max(1000).optional(),
  /** What the worker was told when the task was assigned (F §4.6: the worker's opener shows it). */
  brief: z.string().max(2000).optional(),
  blocker: Blocker.nullable(),
  evidence: z.array(Ref),
  lastReport: LastReport.optional(),
  notes: z.array(TaskNote).max(LIMITS.taskNotes),
  created: IsoTime,
  updated: IsoTime,
  /** Times the task went back from review to in_progress. */
  reopened: z.number().int().min(0),
  /** Project rev at which this task last changed; update_task's expectedRev is checked against it. */
  rev: z.number().int().min(1),
  source: z.string().max(240),
});
export type Task = z.infer<typeof Task>;

export const Dag = z.strictObject({
  pid: ProjectId,
  rev: z.number().int().min(0),
  updatedAt: IsoTime.nullable(),
  tasks: z.array(Task),
});
export type Dag = z.infer<typeof Dag>;

export const MEMBER_STATES = ["working", "idle", "blocked", "waiting_owner"] as const;

export const MemberBlocker = z.strictObject({
  text: line(200),
  on: z.union([ItemId, TaskId]).optional(),
  /** Set when a report raised it; absent when the PM noted it with update_member. */
  task: TaskId.optional(),
});

export const Member = z.strictObject({
  agentId: AgentId,
  role: line(80),
  archetype: line(40),
  thread: z.string().max(120).optional(),
  // Runtime-owned (reports, run start/end, heartbeat). Load and current task are derived from dag.json.
  state: z.enum(MEMBER_STATES),
  lastCheckIn: IsoTime.nullable(),
  lastReport: z.string().max(300).nullable(),
  blockers: z.array(MemberBlocker),
  // The PM's only field (update_member).
  pmNote: z.string().max(200).nullable(),
});
export type Member = z.infer<typeof Member>;

export const Roster = z.strictObject({
  rev: z.number().int().min(0),
  updatedAt: IsoTime.nullable(),
  members: z.array(Member),
});
export type Roster = z.infer<typeof Roster>;

export const Item = z.strictObject({
  id: ItemId,
  kind: z.enum(["question", "risk"]),
  /** "owner" makes it an owner card; "pm" or a roster agent otherwise. */
  askOf: z.string().max(64),
  text: line(300),
  raised: IsoTime,
  due: IsoDate.optional(),
  severity: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(["open", "resolved"]),
  links: z.array(z.string().max(240)),
  source: z.string().max(240),
  resolution: z.string().max(300).optional(),
  resolvedAt: IsoTime.optional(),
});
export type Item = z.infer<typeof Item>;

export const OpenItems = z.strictObject({
  rev: z.number().int().min(0),
  updatedAt: IsoTime.nullable(),
  items: z.array(Item),
});
export type OpenItems = z.infer<typeof OpenItems>;

export const Decision = z.strictObject({
  id: DecisionId,
  date: IsoDate,
  title: line(120),
  status: z.union([z.literal("active"), z.literal("revoked"), z.string().regex(/^superseded by D-[0-9]{3,5}$/)]),
  decision: line(600),
  why: line(600),
  approvedBy: z.enum([PM, OWNER_ID]),
  approvalRef: Ref.optional(),
  proposedBy: AgentId,
  supersedes: DecisionId.optional(),
  links: z.array(z.string().max(240)),
  source: z.string().max(240),
});
export type Decision = z.infer<typeof Decision>;

export const Pref = z.strictObject({ id: PrefId, text: line(300), source: Ref });
export type Pref = z.infer<typeof Pref>;

export const Charter = z.strictObject({
  title: line(120),
  goal: line(600),
  metric: line(600),
  deadline: IsoDate,
  scope: line(600),
  outOfScope: line(600),
  qualifications: line(600),
  budget: line(600),
  approvalRef: Ref,
});
export type Charter = z.infer<typeof Charter>;

/** One journal line: `<minute>Z r<rev> <text>`. */
export const JournalLine = z.strictObject({ at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/), rev: z.number().int().min(1), text: line(400) });
export type JournalLine = z.infer<typeof JournalLine>;

/** Everything under `projects/<pid>/state/`, as one typed snapshot. */
export interface ProjectState {
  pid: string;
  /** The project rev: the rev of the latest state write (0 before the first). */
  rev: number;
  dag: Dag;
  roster: Roster;
  open: OpenItems;
  decisions: Decision[];
  prefs: Pref[];
  charter: Charter | null;
  /** Current journal window (`journal/<n>.md`). */
  journal: { window: number; lines: JournalLine[] };
}
