/*
 * The agent runtime (research D §10): persistent workers on durable threads, one run per thread at a time.
 *
 *   getRuntime().send("a:mira:p:dm", { text })   a message to a thread: it lands in the thread's inbox, and
 *                                                starts a run or waits for the one in progress (delivered before
 *                                                its next model call)
 *
 * Any inbox row wakes its thread, whoever added it (db.onInbox): a launch's kickoff on the PM's thread, a brief the PM
 * sends an expert (assign_task → send), a report's delta for the PM (report → callback row). A thread that is busy
 * gets the row through InboxDrain or a follow-up run; rows that waited while no runtime ran start when one does.
 * Each worker gets its agent's tools (toolkit.ts) when it is first built.
 *
 * One per process, on globalThis so dev-server reloads keep it. Server only.
 */
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { HQ } from "@/lib/data";
import { MODELS } from "@/lib/models";
import type { Rule } from "@/lib/policy/types";
import { readState, renderDigest } from "@/server/project-state";
import { Approvals, type Decision } from "./approvals";
import { openCheckpointer } from "./checkpointer";
import { getRuntimeDb, type AgentRow, type ApprovalRow, type InboxRow, type ProjectRow, type RunTrigger, type RuntimeDb } from "./db";
import { ThreadEvents } from "./events";
import { inboxDrain, type DmPayload } from "./inbox";
import type { Lane, Limiter } from "./limiter";
import { executeRun } from "./run";
import { parseThreadId, ThreadQueue } from "./threads";
import type { ResearchToolDeps } from "./tools/research";
import { announceMessage } from "./transcript";
import { agentTools } from "./toolkit";
import { Workbenches } from "./tools/bash";
import { buildWorker, type Worker } from "./worker";

export interface RuntimeOptions {
  db?: RuntimeDb;
  checkpointer?: BaseCheckpointSaver & { db?: { close(): void } };
  /** Every model call goes through it (under the limiter); default the global fetch. */
  fetch?: typeof fetch;
  limiter?: Limiter;
  /** Extra tools per agent, after its own (tests: a tool that sleeps). */
  tools?: (agent: AgentRow, project: ProjectRow) => StructuredToolInterface[];
  /** The rules the tool gate decides with; default the policy store (approvals.ts). */
  rules?: () => Promise<Rule[]>;
  /** The research tool's You.com key, fetch and ledger; default YDC_API_KEY, the global fetch, the ledger. */
  research?: ResearchToolDeps;
}

export interface SendResult {
  /** "run": this message started a run. "inbox": a run is in progress; it gets the message before its next model call. */
  delivered: "run" | "inbox";
  /** The run that will answer, when one is known. */
  runId?: string;
  inboxId: number;
  /** Its row in the thread's transcript. */
  messageId: number;
}

export class UnknownThreadError extends Error {
  constructor(readonly threadId: string) {
    super(`There is no thread ${threadId}`);
    this.name = "UnknownThreadError";
  }
}

/** `resume`: pick up the thread's paused tool calls whose approvals are decided (approvals.ts). */
type Job = { runId: string; resume?: boolean };

/** What starts a run, from the oldest item waiting for it: the owner's messages are interactive, the team's work. */
function runFor(item: InboxRow): { trigger: RunTrigger; lane: Lane } {
  if (item.kind === "assignment") return { trigger: "kickoff", lane: "work" };
  if (item.kind === "callback") return { trigger: "callback", lane: "work" };
  const from = (item.payload as Partial<DmPayload> | null)?.from;
  return !from || from === "owner" ? { trigger: "dm", lane: "interactive" } : { trigger: "message", lane: "work" };
}

/** The PM's view of its project: the code-rendered `<project_state>` digest (project-state/digest.ts). */
const projectDigest = async (projectId: string) => renderDigest(await readState(projectId));

export class Runtime {
  readonly db: RuntimeDb;
  readonly checkpointer: NonNullable<RuntimeOptions["checkpointer"]>;
  /** Every run's token, now, plan, tool, done, error and approval events, per thread (events.ts). */
  readonly events = new ThreadEvents();
  /** The tool gate and the owner's decisions (R6). */
  readonly approvals: Approvals;
  private readonly queue: ThreadQueue<Job>;
  private readonly workers = new Map<string, Promise<Worker>>();
  /** The run in progress per thread. */
  private readonly active = new Map<string, string>();
  /** Threads whose last run failed: no follow-up run until something new arrives (a failure must not loop). */
  private readonly failed = new Set<string>();
  private readonly benches = new Workbenches();
  private readonly owns: { db: boolean; checkpointer: boolean };
  private readonly unlisten: () => void;
  private closed = false;

  constructor(private readonly opts: RuntimeOptions = {}) {
    this.owns = { db: !opts.db, checkpointer: !opts.checkpointer };
    this.db = opts.db ?? getRuntimeDb();
    this.checkpointer = opts.checkpointer ?? openCheckpointer();
    this.approvals = new Approvals({ db: this.db, events: this.events, rules: opts.rules, research: opts.research });
    this.queue = new ThreadQueue<Job>(
      (threadId, job) => this.execute(threadId, job),
      (threadId) => this.followUp(threadId),
    );
    this.unlisten = this.db.onInbox((threadId) => this.wake(threadId));
    // What waited while no runtime ran (a launch before the first request, a restart) starts now.
    queueMicrotask(() => {
      if (!this.closed) for (const threadId of this.db.inbox.pendingThreads()) this.wake(threadId);
    });
  }

  /**
   * A message to a thread, from the owner unless `from` names an agent, saved to its transcript as it's accepted.
   * `ref` is the sender's id for it. Throws UnknownThreadError for a thread the runtime db doesn't have.
   */
  send(threadId: string, message: { text: string; from?: string; ref?: string }): SendResult {
    if (!this.db.threads.get(threadId)) throw new UnknownThreadError(threadId);
    const from = message.from ?? "owner";
    const item = this.db.inbox.add<DmPayload>(threadId, "dm", { text: message.text, from });
    // A thread waiting on an approval stays paused: the resumed run reads the message before its next model call.
    const busy = this.queue.isBusy(threadId) || this.approvals.waiting(threadId);
    const runId = busy ? this.active.get(threadId) : this.wake(threadId);
    const saved = this.db.messages.add({ threadId, runId: runId ?? null, role: from === "owner" ? "owner" : "agent", author: from, text: message.text, ref: message.ref });
    announceMessage(threadId);
    if (busy) return { delivered: "inbox", runId, inboxId: item.id, messageId: saved.id };
    return { delivered: "run", runId, inboxId: item.id, messageId: saved.id };
  }

  /** The run in progress on the thread, if one is. */
  activeRun(threadId: string): string | undefined {
    return this.active.get(threadId);
  }

  /**
   * Starts a run for what waits in the thread's inbox. A busy thread gets it from its run in progress (InboxDrain,
   * or a follow-up run), so nothing starts. Returns the new run's id.
   */
  wake(threadId: string): string | undefined {
    // A thread waiting on an approval wakes only through decide().
    if (this.closed || this.queue.isBusy(threadId) || !this.db.threads.get(threadId) || this.approvals.waiting(threadId)) return undefined;
    this.failed.delete(threadId);
    const job = this.nextJob(threadId);
    // A failure is on the run row (and, with streaming, on the thread's events); nobody awaits it here.
    if (job) this.queue.enqueue(threadId, job).catch(() => {});
    return job?.runId;
  }

  /** Resolves once nothing runs or waits on the thread. */
  idle(threadId: string): Promise<void> {
    return this.queue.idle(threadId);
  }

  isBusy(threadId: string): boolean {
    return this.queue.isBusy(threadId);
  }

  /** Waits for every thread to go idle, then closes what the runtime opened itself. Nothing wakes once it starts. */
  async close(): Promise<void> {
    this.closed = true;
    this.unlisten();
    for (let busy = this.queue.busyThreads(); busy.length; busy = this.queue.busyThreads()) await Promise.all(busy.map((t) => this.idle(t)));
    await this.benches.close();
    if (this.owns.checkpointer) this.checkpointer.db?.close();
    if (this.owns.db) this.db.close();
  }

  /** The thread's compiled agent with its tools, built once and kept. */
  worker(threadId: string): Promise<Worker> {
    let worker = this.workers.get(threadId);
    if (!worker) {
      worker = this.build(threadId);
      this.workers.set(threadId, worker);
      worker.catch(() => this.workers.delete(threadId));
    }
    return worker;
  }

  private async build(threadId: string): Promise<Worker> {
    const thread = this.db.threads.get(threadId);
    const ids = parseThreadId(threadId);
    const agent = ids && this.db.agents.get(ids.agentId);
    const project = ids && this.db.projects.get(ids.projectId);
    if (!thread || !agent || !project) throw new UnknownThreadError(threadId);
    const kit = await agentTools(agent, project, {
      send: (t, m) => this.send(t, m),
      inbox: this.db.inbox,
      bash: (projectId) => this.benches.tools(projectId),
    });
    // The PM sees its project's state with everything it is handed: the kickoff, each report, each message.
    const context = agent.archetype === "lead" && project.kind === "team" ? () => projectDigest(project.id) : undefined;
    const current = () => this.active.get(threadId);
    // R6 hook: the tool gate on every worker, and the gated tools its toolset grants (research).
    const gated = this.approvals.forWorker(agent, project, threadId, current, { sandbox: kit.sandbox });
    return buildWorker(agent, project, {
      checkpointer: this.checkpointer,
      fetch: this.opts.fetch,
      limiter: this.opts.limiter,
      tools: [...kit.tools, ...gated.tools, ...(this.opts.tools?.(agent, project) ?? [])],
      sandbox: kit.sandbox,
      middleware: [inboxDrain(this.db, threadId, current, { context }), gated.middleware],
    });
  }

  /**
   * The owner's answer to an approval: recorded (row, ledger, events), then a resume run on its thread. Approve runs
   * the tool; decline tells the model, with the note. Throws UnknownApprovalError, or ApprovalDecidedError when it
   * was already decided.
   */
  async decide(approvalId: string, decision: Decision, note?: string): Promise<{ approval: ApprovalRow; runId: string }> {
    const approval = await this.approvals.decide(approvalId, decision, note);
    const run = this.db.runs.create({ threadId: approval.threadId, trigger: "resume", lane: "interactive" });
    this.queue.enqueue(approval.threadId, { runId: run.id, resume: true }).catch(() => {});
    return { approval, runId: run.id };
  }

  private async execute(threadId: string, { runId, resume }: Job): Promise<void> {
    const activate = (id: string) => {
      this.active.set(threadId, id);
      return () => this.active.delete(threadId);
    };
    const thread = this.db.threads.get(threadId)!;
    const agent = this.db.agents.get(thread.agentId)!;
    const project = this.db.projects.get(thread.projectId)!;
    // Stats teams are projects; a DM or company thread counts toward the company (Mira's HQ team).
    const team = project.kind === "team" ? project.id : HQ.id;
    try {
      let worker: Worker;
      try {
        worker = await this.worker(threadId);
      } catch (e) {
        // No agent to hand them to: what waited goes to this failed run instead of starting run after run.
        const message = `Couldn't build ${agent.id}'s agent: ${(e as Error).message || String(e)}`;
        this.db.inbox.take(threadId, runId);
        this.db.runs.finish(runId, "error", message);
        this.db.threads.setStatus(threadId, "error");
        this.events.emit(threadId, { type: "error", run: runId, message });
        throw e;
      }
      let input: unknown;
      if (resume) {
        input = await this.approvals.resumeCommand(worker, threadId);
        // An earlier resume run already picked these calls up: nothing is left waiting on this decision.
        if (!input) return this.db.runs.finish(runId, "cancelled");
      }
      await executeRun(
        { db: this.db, worker, events: this.events, activate, announce: announceMessage, ledger: { team, agent: agent.id, asked: MODELS[agent.modelTier] } },
        threadId,
        runId,
        input,
      );
      this.failed.delete(threadId);
    } catch (e) {
      this.failed.add(threadId);
      throw e;
    }
  }

  /** What arrived after the last run's final model call gets a run of its own (not after a failed run, nor while it waits on an approval). */
  private followUp(threadId: string): Job | undefined {
    return this.closed || this.failed.has(threadId) || this.approvals.waiting(threadId) ? undefined : this.nextJob(threadId);
  }

  private nextJob(threadId: string): Job | undefined {
    const [first] = this.db.inbox.pending(threadId);
    return first && { runId: this.db.runs.create({ threadId, ...runFor(first) }).id };
  }
}

const G = globalThis as { __agentTeamsRuntime?: Runtime };

/** The app's runtime, on <DATA_DIR>/runtime.db and checkpoints.db. */
export function getRuntime(): Runtime {
  return (G.__agentTeamsRuntime ??= new Runtime());
}

/** Replace the app's runtime (a test's, on its own db and fake model); null resets to the default. */
export function setRuntime(rt: Runtime | null): void {
  G.__agentTeamsRuntime = rt ?? undefined;
}
