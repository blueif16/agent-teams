import { connection } from "next/server";
import { getRuntime } from "@/server/runtime";

/*
 * Server-Sent Events for every agent thread's runs, on one connection:
 *   GET /api/runs
 * Each event is `event: <type>` + `data: {"type":…,"thread":…,"run":…,…}`, the types of
 * src/server/runtime/events.ts (start, token, now, plan, tool, done, error) plus `live`, sent first for each run
 * already in progress: `{ type: "live", thread, run, text }` with the answer typed so far, so a page opened (or
 * reconnected) mid-run picks the run up where it is. One stream for the app instead of one per thread keeps under
 * the browser's six connections per host. A comment every 25 s keeps idle proxies from closing it.
 */
const HEARTBEAT_MS = 25_000;

export async function GET(req: Request) {
  await connection();
  const runtime = getRuntime();
  const encoder = new TextEncoder();
  let stop = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop(); // the stream is gone
        }
      };
      const frame = (type: string, data: object) => send(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      // The snapshot and the subscription in one tick: no token falls between them.
      for (const r of runtime.events.live()) frame("live", { type: "live", ...r });
      const off = runtime.events.subscribeAll((thread, e) => frame(e.type, { ...e, thread }));
      const beat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      stop = () => {
        if (!open) return;
        open = false;
        off();
        clearInterval(beat);
        req.signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {
          // already closed or cancelled
        }
      };
      req.signal.addEventListener("abort", stop);
      if (req.signal.aborted) return stop();
      send("retry: 3000\n: connected\n\n");
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
