/*
 * Threads: one per agent × project (research D §1); a DM task is a one-member project.
 *
 * No imports and no TS-only syntax, so a plain `node` can load it (agents.ts re-exports threadId for the
 * restart test).
 */

/** `a:{agentId}:p:{projectId}`. */
export function threadId(agentId: string, projectId: string): string {
  return `a:${agentId}:p:${projectId}`;
}

/** The agent and project of a thread id, or null when it isn't one. */
export function parseThreadId(id: string): { agentId: string; projectId: string } | null {
  const m = /^a:([^:]+):p:([^:]+)$/.exec(id);
  return m ? { agentId: m[1], projectId: m[2] } : null;
}

/**
 * One run per thread at a time, FIFO (D §1, finding 6: two concurrent runs on a thread fork its checkpoint
 * chain and lose messages). Each thread drains its own line; different threads run side by side.
 *
 * `next` is asked, synchronously, whenever a thread's line empties: a job it returns runs before the thread
 * goes idle. Nothing can slip in between, so a message parked for the run that just ended is never stranded.
 */
export class ThreadQueue<J> {
  private readonly lines = new Map<string, { job: J; done: (e?: unknown) => void }[]>();
  private readonly drained = new Map<string, (() => void)[]>();
  // Plain fields, not parameter properties: a plain `node` strips types but can't compile those.
  private readonly run: (threadId: string, job: J) => Promise<void>;
  private readonly next?: (threadId: string) => J | undefined;

  constructor(run: (threadId: string, job: J) => Promise<void>, next?: (threadId: string) => J | undefined) {
    this.run = run;
    this.next = next;
  }

  /** Resolves when this job has run (rejects with its error). */
  enqueue(threadId: string, job: J): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = (e?: unknown) => (e === undefined ? resolve() : reject(e));
      const line = this.lines.get(threadId);
      if (line) return void line.push({ job, done });
      this.lines.set(threadId, [{ job, done }]);
      void this.drain(threadId);
    });
  }

  /** A job is running or waiting on this thread. */
  isBusy(threadId: string): boolean {
    return this.lines.has(threadId);
  }

  /** Every thread with a job running or waiting. */
  busyThreads(): string[] {
    return [...this.lines.keys()];
  }

  /** Resolves once the thread has nothing running or waiting. */
  idle(threadId: string): Promise<void> {
    if (!this.isBusy(threadId)) return Promise.resolve();
    return new Promise((resolve) => this.drained.set(threadId, [...(this.drained.get(threadId) ?? []), resolve]));
  }

  private async drain(threadId: string): Promise<void> {
    const line = this.lines.get(threadId)!;
    for (;;) {
      if (!line.length) {
        const follow = this.next?.(threadId);
        if (follow === undefined) break;
        line.push({ job: follow, done: () => {} });
      }
      const { job, done } = line[0];
      try {
        await this.run(threadId, job);
        done();
      } catch (e) {
        done(e ?? new Error("job failed"));
      }
      line.shift();
    }
    this.lines.delete(threadId);
    for (const resolve of this.drained.get(threadId) ?? []) resolve();
    this.drained.delete(threadId);
  }
}
