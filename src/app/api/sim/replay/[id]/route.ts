import { connection } from "next/server";
import { isTapeId, play, readTape } from "@/server/sim/tape";

/*
 * Plays a recorded tape back as Server-Sent Events (docs/design/test-mode.md §5), so the live UI shows a run without
 * calling a model:
 *   GET /api/sim/replay/[id]?speed=1|2|4|8|16|inf&from=<ms>&idleCap=<ms>
 * Frames: `event: header` with the tape's header; each event as `id: <seq>`, `event: tape`, `data: <json>`; then
 * `event: end`. A reconnect's Last-Event-ID resumes after that seq. Each gap plays as min(gap, idleCap) / speed, with
 * idleCap defaulting to the header's idleCapMs. 404 unless APP_MODE=test.
 * The stream mechanics are /api/events': a comment every 25 s keeps idle proxies from closing it, and playback stops
 * when the client goes. connection() keeps it at request time.
 */
const HEARTBEAT_MS = 25_000;
const SPEEDS = new Map([
  ["1", 1],
  ["2", 2],
  ["4", 4],
  ["8", 8],
  ["16", 16],
  ["inf", Infinity],
]);

/** A number param: `fallback` when absent, NaN when it isn't a finite number of at least `min`. */
function num(raw: string | null, fallback: number, min: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) && n >= min ? n : NaN;
}

export async function GET(req: Request, ctx: RouteContext<"/api/sim/replay/[id]">) {
  await connection();
  if (process.env.APP_MODE !== "test") return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  if (!isTapeId(id)) return Response.json({ error: "Not a tape id." }, { status: 400 });

  const q = new URL(req.url).searchParams;
  const speed = SPEEDS.get(q.get("speed") ?? "1");
  const from = num(q.get("from"), 0, 0);
  const idleCap = num(q.get("idleCap"), 0, Number.MIN_VALUE); // 0: not given, use the header's
  const last = num(req.headers.get("last-event-id"), 0, 0);
  if (speed === undefined || Number.isNaN(from) || Number.isNaN(idleCap) || !Number.isInteger(last)) {
    return Response.json({ error: "Use ?speed=1|2|4|8|16|inf&from=<ms ≥ 0>&idleCap=<ms > 0>; Last-Event-ID is a seq." }, { status: 400 });
  }
  const tape = await readTape(id);
  if (!tape) return Response.json({ error: `No tape ${id}.` }, { status: 404 });

  // Resuming: skip what the client has, and play on from the last event it got (or `from`, if that is later).
  let start = from;
  for (const e of tape.events) if (e.seq <= last) start = Math.max(start, e.t);
  const events = tape.events.filter((e) => e.seq > last);
  const idleCapMs = idleCap || tape.header.idleCapMs;

  const encoder = new TextEncoder();
  let stop = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const playing = new AbortController();
      const send = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop(); // the stream is gone
        }
      };
      const beat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      stop = () => {
        if (!open) return;
        open = false;
        playing.abort();
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
      // Reconnect after 3 s if the stream drops.
      send(`retry: 3000\nevent: header\ndata: ${JSON.stringify(tape.header)}\n\n`);
      void (async () => {
        try {
          for await (const e of play(events, { speed, from: start, idleCapMs, signal: playing.signal })) {
            send(`id: ${e.seq}\nevent: tape\ndata: ${JSON.stringify(e)}\n\n`);
          }
          send("event: end\ndata: {}\n\n");
        } catch (e) {
          console.warn(`The replay of tape ${id} failed:`, (e as Error).message);
        } finally {
          stop();
        }
      })();
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
