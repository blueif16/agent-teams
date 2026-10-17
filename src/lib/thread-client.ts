/*
 * The browser side of the runtime's thread API (src/app/api/threads/[id]/…): send an owner message to an
 * agent's thread and follow the run that answers it. The run's events come on the app's one GET /api/runs stream
 * (src/lib/live-runs.ts), connected before the post so nothing is missed. Client only.
 */
import { connectRuns, followRun } from "./live-runs";

export interface ThreadReplyHandlers {
  /** The thread took the message: `runId` is the run that answers it (known before any text). */
  accepted?(runId: string): void;
  /** The answer so far, each time it grows. */
  text(acc: string): void;
}

export interface ThreadReply {
  /** "inbox": a run already going gets it before its next model call, and answers for both. */
  delivered: "run" | "inbox";
  runId?: string;
  /** The final answer ("" for an inbox delivery). */
  text: string;
  /** The answer's transcript row. */
  message?: number;
  /** The run ended while the stream was down; `text` may be partial and the transcript has the answer. */
  lost?: boolean;
}

/** Resolves when the run that answers is done; rejects when the post or the run fails. `ref` is saved with the message. */
export async function sendToThread(threadId: string, text: string, on: ThreadReplyHandlers, { ref }: { ref?: string } = {}): Promise<ThreadReply> {
  await connectRuns();
  const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ref }),
  });
  const body = (await res.json().catch(() => ({}))) as { delivered?: "run" | "inbox"; runId?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  if (body.delivered !== "run" || !body.runId) return { delivered: "inbox", runId: body.runId, text: "" };
  on.accepted?.(body.runId);
  let shown = "";
  const run = await followRun(body.runId, (r) => {
    if (r.text === shown) return;
    shown = r.text;
    on.text(r.text);
  });
  return { delivered: "run", runId: body.runId, text: run.text, message: run.message, lost: run.lost };
}
