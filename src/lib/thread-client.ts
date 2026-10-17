/*
 * The browser side of the runtime's thread API (src/app/api/threads/[id]/…): send an owner message to an
 * agent's thread and follow the run that answers it over SSE. Opens the event stream first, so no token is
 * missed, then posts. Client only.
 */

export interface ThreadReplyHandlers {
  /** The answer so far, each time a token arrives. */
  text(acc: string): void;
  /** The agent's "now" line (Reading brief.md, Planning, …). */
  now(line: string): void;
}

type Ev = { type: string; run: string; text?: string; message?: string };

/** Resolves with the run's final answer; rejects when the post or the run fails. `uploads`: ids from POST /api/uploads. */
export function sendToThread(threadId: string, text: string, on: ThreadReplyHandlers, uploads?: string[]): Promise<string> {
  const base = `/api/threads/${encodeURIComponent(threadId)}`;
  return new Promise((resolve, reject) => {
    const source = new EventSource(`${base}/events`);
    let run: string | undefined;
    let acc = "";
    let settled = false;
    let posted = false;
    const finish = (err: Error | null, answer = "") => {
      if (settled) return;
      settled = true;
      source.close();
      if (err) reject(err);
      else resolve(answer);
    };
    // Before the post answers, events from any run count (a DM delivered into a run already going).
    const mine = (e: Ev) => !run || e.run === run;
    const on_ = (type: string, fn: (e: Ev) => void) =>
      source.addEventListener(type, (m) => {
        const e = JSON.parse((m as MessageEvent<string>).data) as Ev;
        if (mine(e)) fn(e);
      });
    on_("token", (e) => {
      acc += e.text ?? "";
      on.text(acc);
    });
    on_("now", (e) => on.now(e.text ?? ""));
    on_("done", (e) => finish(null, e.text || acc));
    on_("error", (e) => finish(new Error(e.message || "The run failed.")));
    source.onerror = () => {
      // EventSource retries on its own; give up only if it closed for good.
      if (source.readyState === EventSource.CLOSED) finish(new Error("Lost the connection to the agent."));
    };
    source.onopen = async () => {
      // Once only: EventSource reopens after a drop, and the message must not be sent twice.
      if (posted || settled) return;
      posted = true;
      try {
        const res = await fetch(`${base}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, uploads }),
        });
        const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
        if (!res.ok) return finish(new Error(body.error ?? `Request failed (${res.status})`));
        run = body.runId;
      } catch (e) {
        finish(e as Error);
      }
    };
  });
}
