import { connection } from "next/server";
import { getServerCache } from "@/server/cache";

/*
 * Server-Sent Events for cache changes:
 *   GET /api/events?topics=stats,files
 * Each change is `data: {"topic":"stats:agent:mira","version":3}`; a topic
 * also covers the topics under it. Only the topic and version travel: clients
 * re-fetch what they show. A comment every 25 s keeps idle proxies from closing
 * the stream, and the listener goes when the client does.
 * connection() keeps it at request time; under Cache Components a GET handler
 * that touches no request data may otherwise be prerendered.
 */
const HEARTBEAT_MS = 25_000;

export async function GET(req: Request) {
  await connection();
  const topics = (new URL(req.url).searchParams.get("topics") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!topics.length) return Response.json({ error: "Name the topics: /api/events?topics=stats,files" }, { status: 400 });

  const { bus } = getServerCache();
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
      const off = bus.subscribe(topics, (c) => send(`data: ${JSON.stringify(c)}\n\n`));
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
