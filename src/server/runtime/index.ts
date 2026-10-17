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
import { openCheckpointer } from "./checkpointer";
import { getRuntimeDb, type AgentRow, type ProjectRow, type RuntimeDb } from "./db";
import { inboxDrain, type DmPayload } from "./inbox";
import type { Limiter } from "./limiter";
import { executeRun } from "./run";
import { parseThreadId, ThreadQueue } from "./threads";
import { buildWorker, type Worker } from "./worker";

export interface RuntimeOptions {
  db?: RuntimeDb;
  checkpointer?: BaseCheckpointSaver & { db?: { close(): void } };
  /** Every model call goes through it (under the limiter); default the global fetch. */
  fetch?: typeof fetch;
  limiter?: Limiter;
  /** Extra tools per agent (tests: a tool that sleeps). */
  tools?: (agent: AgentRow, project: ProjectRow) => StructuredToolInterface[];
}

export interface SendResult {
  /** "run": this message started a run. "inbox": a run is in progress; it gets the message before its next model call. */
  delivered: "run" | "inbox";
  /** The run that will answer, when one is known. */
  runId?: string;
  inboxId: number;
}

export class UnknownThreadError extends Error {
  constructor(readonly threadId: string) {
    super(`There is no thread ${threadId}`);
    this.name = "UnknownThreadError";
  }
}

type Job = { runId: string };

export class Runtime {
  readonly db: RuntimeDb;
  readonly checkpointer: NonNullable<RuntimeOptions["checkpointer"]>;
  private readonly queue: ThreadQueue<Job>;
  private readonly workers = new Map<string, Worker>();
  /** The run in progress per thread. */
  private readonly active = new Map<string, string>();
  private readonly owns: { db: boolean; checkpointer: boolean };

  constructor(private readonly opts: RuntimeOptions = {}) {
    this.owns = { db: !opts.db, checkpointer: !opts.checkpointer };
    this.db = opts.db ?? getRuntimeDb();
    this.checkpointer = opts.checkpointer ?? openCheckpointer();
    this.queue = new ThreadQueue<Job>(
      (threadId, job) => this.execute(threadId, job),
      (threadId) => this.followUp(threadId),
    );
  }

  /** An owner message to a thread. Throws UnknownThreadError for a thread the runtime db doesn't have. */
  send(threadId: string, message: { text: string; from?: string }): SendResult {
    if (!this.db.threads.get(threadId)) throw new UnknownThreadError(threadId);
    const item = this.db.inbox.add<DmPayload>(threadId, "dm", { text: message.text, from: message.from ?? "owner" });
    if (this.queue.isBusy(threadId)) return { delivered: "inbox", runId: this.active.get(threadId), inboxId: item.id };
    const run = this.db.runs.create({ threadId, trigger: "dm", lane: "interactive" });
    // A failure is on the run row (and, with streaming, on the thread's events); nobody awaits it here.
    this.queue.enqueue(threadId, { runId: run.id }).catch(() => {});
    return { delivered: "run", runId: run.id, inboxId: item.id };
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
    const worker = buildWorker(agent, project, {
      checkpointer: this.checkpointer,
      fetch: this.opts.fetch,
      limiter: this.opts.limiter,
      tools: this.opts.tools?.(agent, project),
      middleware: [inboxDrain(this.db, threadId, () => this.active.get(threadId))],
    });
    this.workers.set(threadId, worker);
    return worker;
  }

  /** Waits for every thread to go idle, then closes what the runtime opened itself. */
  async close(): Promise<void> {
    await Promise.all([...this.active.keys()].map((t) => this.idle(t)));
    if (this.owns.checkpointer) this.checkpointer.db?.close();
    if (this.owns.db) this.db.close();
  }

  private execute(threadId: string, { runId }: Job): Promise<void> {
    const activate = (id: string) => {
      this.active.set(threadId, id);
      return () => this.active.delete(threadId);
    };
    return executeRun({ db: this.db, worker: this.worker(threadId), activate }, threadId, runId);
  }

  /** A DM parked after the last run's final model call gets a run of its own. */
  private followUp(threadId: string): Job | undefined {
    if (!this.db.inbox.pending(threadId, ["dm"]).length) return undefined;
    return { runId: this.db.runs.create({ threadId, trigger: "dm", lane: "interactive" }).id };
  }
}

const G = globalThis as { __agentTeamsRuntime?: Runtime };

/** The app's runtime, on <DATA_DIR>/runtime.db and checkpoints.db. */
export function getRuntime(): Runtime {
  return (G.__agentTeamsRuntime ??= new Runtime());
}
