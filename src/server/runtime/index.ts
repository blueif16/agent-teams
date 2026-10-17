/*
 * The agent runtime (research D §10): persistent workers on durable threads, one run per thread at a time.
 *
 *   getRuntime().send("a:mira:p:dm", { text })   an owner message: starts a run, or waits in the inbox for the
 *                                                one in progress (delivered before its next model call)
 *
 * One per process, on globalThis so dev-server reloads keep it. Server only.
 */
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { HQ } from "@/lib/data";
import { MODELS } from "@/lib/models";
import type { Rule } from "@/lib/policy/types";
import { Approvals, type Decision } from "./approvals";
import { openCheckpointer } from "./checkpointer";
import { getRuntimeDb, type AgentRow, type ApprovalRow, type ProjectRow, type RuntimeDb } from "./db";
import { ThreadEvents } from "./events";
import { inboxDrain, type DmPayload } from "./inbox";
import type { Limiter } from "./limiter";
import { executeRun } from "./run";
import { parseThreadId, ThreadQueue } from "./threads";
import type { ResearchToolDeps } from "./tools/research";
import { announceMessage } from "./transcript";
import { buildWorker, type Worker } from "./worker";

export interface RuntimeOptions {
  db?: RuntimeDb;
  checkpointer?: BaseCheckpointSaver & { db?: { close(): void } };
  /** Every model call goes through it (under the limiter); default the global fetch. */
  fetch?: typeof fetch;
  limiter?: Limiter;
  /** Extra tools per agent (tests: a tool that sleeps). */
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

export class Runtime {
  readonly db: RuntimeDb;
  readonly checkpointer: NonNullable<RuntimeOptions["checkpointer"]>;
  /** Every run's token, now, plan, tool, done, error and approval events, per thread (events.ts). */
  readonly events = new ThreadEvents();
  /** The tool gate and the owner's decisions (R6). */
  readonly approvals: Approvals;
  private readonly queue: ThreadQueue<Job>;
  private readonly workers = new Map<string, Worker>();
  /** The run in progress per thread. */
  private readonly active = new Map<string, string>();
  private readonly owns: { db: boolean; checkpointer: boolean };

  constructor(private readonly opts: RuntimeOptions = {}) {
    this.owns = { db: !opts.db, checkpointer: !opts.checkpointer };
    this.db = opts.db ?? getRuntimeDb();
    this.checkpointer = opts.checkpointer ?? openCheckpointer();
    this.approvals = new Approvals({ db: this.db, events: this.events, rules: opts.rules, research: opts.research });
    this.queue = new ThreadQueue<Job>(
      (threadId, job) => this.execute(threadId, job),
      (threadId) => this.followUp(threadId),
    );
  }

  /**
   * An owner message to a thread, saved to its transcript as it's accepted. `ref` is the sender's id for it.
   * Throws UnknownThreadError for a thread the runtime db doesn't have.
   */
  send(threadId: string, message: { text: string; from?: string; ref?: string }): SendResult {
    if (!this.db.threads.get(threadId)) throw new UnknownThreadError(threadId);
    const from = message.from ?? "owner";
    // A thread waiting on an approval stays paused: the resumed run reads the message before its next model call.
    const busy = this.queue.isBusy(threadId) || this.approvals.waiting(threadId);
    const { item, run, saved } = this.db.tx(() => {
      const item = this.db.inbox.add<DmPayload>(threadId, "dm", { text: message.text, from });
      const run = busy ? undefined : this.db.runs.create({ threadId, trigger: "dm", lane: "interactive" });
      const runId = run?.id ?? this.active.get(threadId) ?? null;
      const saved = this.db.messages.add({ threadId, runId, role: "owner", author: from, text: message.text, ref: message.ref });
      return { item, run, saved };
    });
    announceMessage(threadId);
    if (!run) return { delivered: "inbox", runId: this.active.get(threadId), inboxId: item.id, messageId: saved.id };
    // A failure is on the run row (and, with streaming, on the thread's events); nobody awaits it here.
    this.queue.enqueue(threadId, { runId: run.id }).catch(() => {});
    return { delivered: "run", runId: run.id, inboxId: item.id, messageId: saved.id };
  }

  /** The run in progress on the thread, if one is. */
  activeRun(threadId: string): string | undefined {
    return this.active.get(threadId);
  }

  /** Resolves once nothing runs or waits on the thread. */
  idle(threadId: string): Promise<void> {
    return this.queue.idle(threadId);
  }

  isBusy(threadId: string): boolean {
    return this.queue.isBusy(threadId);
  }

  /** The thread's compiled agent, built once and kept. */
  worker(threadId: string): Worker {
    const cached = this.workers.get(threadId);
    if (cached) return cached;
    const thread = this.db.threads.get(threadId);
    const ids = parseThreadId(threadId);
    const agent = ids && this.db.agents.get(ids.agentId);
    const project = ids && this.db.projects.get(ids.projectId);
    if (!thread || !agent || !project) throw new UnknownThreadError(threadId);
    const current = () => this.active.get(threadId);
    // R6 hook: the tool gate on every worker, and the gated tools its toolset grants (research).
    const gated = this.approvals.forWorker(agent, project, threadId, current);
    const worker = buildWorker(agent, project, {
      checkpointer: this.checkpointer,
      fetch: this.opts.fetch,
      limiter: this.opts.limiter,
      tools: [...gated.tools, ...(this.opts.tools?.(agent, project) ?? [])],
      middleware: [inboxDrain(this.db, threadId, current), gated.middleware],
    });
    this.workers.set(threadId, worker);
    return worker;
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

  /** Waits for every thread to go idle, then closes what the runtime opened itself. */
  async close(): Promise<void> {
    await Promise.all([...this.active.keys()].map((t) => this.idle(t)));
    if (this.owns.checkpointer) this.checkpointer.db?.close();
    if (this.owns.db) this.db.close();
  }

  private async execute(threadId: string, { runId, resume }: Job): Promise<void> {
    let input: unknown;
    if (resume) {
      input = await this.approvals.resumeCommand(this.worker(threadId), threadId);
      // An earlier resume run already picked these calls up: nothing is left waiting on this decision.
      if (!input) return this.db.runs.finish(runId, "cancelled");
    }
    const activate = (id: string) => {
      this.active.set(threadId, id);
      return () => this.active.delete(threadId);
    };
    const thread = this.db.threads.get(threadId)!;
    const agent = this.db.agents.get(thread.agentId)!;
    const project = this.db.projects.get(thread.projectId)!;
    // Stats teams are projects; a DM or company thread counts toward the company (Mira's HQ team).
    const team = project.kind === "team" ? project.id : HQ.id;
    return executeRun(
      {
        db: this.db,
        worker: this.worker(threadId),
        events: this.events,
        activate,
        announce: announceMessage,
        ledger: { team, agent: agent.id, asked: MODELS[agent.modelTier] },
      },
      threadId,
      runId,
      input,
    );
  }

  /** A DM parked after the last run's final model call gets a run of its own (not while the thread waits on an approval). */
  private followUp(threadId: string): Job | undefined {
    if (this.approvals.waiting(threadId)) return undefined;
    if (!this.db.inbox.pending(threadId, ["dm"]).length) return undefined;
    return { runId: this.db.runs.create({ threadId, trigger: "dm", lane: "interactive" }).id };
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
