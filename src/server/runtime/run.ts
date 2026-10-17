/*
 * One run on a thread (research D §10 run.ts): the run row's lifecycle around one pass of the agent. The
 * queue guarantees nothing else runs on the thread meanwhile. Input is empty: the run's messages arrive
 * through InboxDrain, before its first model call and before each one after.
 */
import { withLane } from "./limiter";
import type { RuntimeDb } from "./db";
import type { Worker } from "./worker";

export interface RunContext {
  db: RuntimeDb;
  worker: Worker;
  /** Marks `runId` as the run in progress on the thread (InboxDrain delivers to it); returns the undo. */
  activate(runId: string): () => void;
}

export async function executeRun({ db, worker, activate }: RunContext, threadId: string, runId: string): Promise<void> {
  const run = db.runs.get(runId);
  if (!run) throw new Error(`No run ${runId}`);
  db.runs.start(runId);
  db.threads.setStatus(threadId, "running");
  const deactivate = activate(runId);
  try {
    await withLane(run.lane, () => worker.invoke({ messages: [] }, { runId }));
    db.runs.finish(runId, "done");
    db.threads.setStatus(threadId, "idle");
  } catch (e) {
    db.runs.finish(runId, "error", (e as Error).message);
    db.threads.setStatus(threadId, "error");
    throw e;
  } finally {
    deactivate();
  }
}
