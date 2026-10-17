import { connection } from "next/server";
import { getRuntime } from "@/server/runtime";

/*
 * Server-Sent Events for one agent thread's runs (research D §8):
 *   GET /api/threads/a:mira:p:dm/events
 * Each event is `event: <type>` + `data: {"type":…,"run":…,…}`, type one of token, now, plan, tool, done,
 * error (src/server/runtime/events.ts). Open it before POSTing a message. A comment every 25 s keeps idle
 * proxies from closing the stream, and the listener goes when the client does.
 * connection() keeps it at request time, as /api/events does.
 */
const HEARTBEAT_MS = 25_000;

export async function GET(req: Request, ctx: RouteContext<"/api/threads/[id]/events">) {
  await connection();
  const { id } = await ctx.params;
  const runtime = getRuntime();
  if (!runtime.db.threads.get(id)) return Response.json({ error: `There is no thread ${id}` }, { status: 404 });

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
      const off = runtime.events.subscribe(id, (e) => send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
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
      // Reconnect after 3 s if the stream drops; the comment flushes the headers now.
      send("retry: 3000\n: connected\n\n");
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: compression would buffer the stream.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
