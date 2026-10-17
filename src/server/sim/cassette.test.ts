import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCassette, type Cassette } from "./cassette";

const CRUSOE = "https://api.inference.crusoecloud.com/v1/chat/completions";
const enc = new TextEncoder();
const dec = new TextDecoder();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** An OpenAI-style SSE answer, cut where a network might cut it: through "é" (two UTF-8 bytes) and mid-event. */
function sseChunks(words = ["Café ", "plan"]): Uint8Array[] {
  const events = words.map(
    (w) => `data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":${JSON.stringify(w)}}}]}\n\n`,
  );
  events.push('data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":2}}\n\n');
  events.push("data: [DONE]\n\n");
  const all = enc.encode(events.join(""));
  const inChar = all.indexOf(0xc3) + 1;
  return inChar > 0 ? [all.slice(0, inChar), all.slice(inChar, 150), all.slice(150)] : [all.slice(0, 120), all.slice(120)];
}

interface Reply {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  chunks: Uint8Array[];
  /** Delay before the response (headers) arrives. */
  ttfbMs?: number;
  /** Delay before each chunk after the first. */
  gapMs?: number;
  /** The body stays open after its chunks until this settles. */
  hold?: Promise<void>;
}

/** A model API that answers the i-th call with replies[i], streaming its chunks. */
function fakeUpstream(replies: Reply[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const state = { finished: 0, cancelled: 0 };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const r = replies[calls.length - 1];
    if (!r) throw new Error(`fake upstream: no reply for call ${calls.length}`);
    if (r.ttfbMs) await sleep(r.ttfbMs);
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (i > 0 && i < r.chunks.length && r.gapMs) await sleep(r.gapMs);
        if (i < r.chunks.length) return c.enqueue(r.chunks[i++]);
        await r.hold;
        state.finished++;
        c.close();
      },
      cancel() {
        state.cancelled++;
      },
    });
    return new Response(body, {
      status: r.status ?? 200,
      statusText: r.statusText,
      headers: { "content-type": "text/event-stream", ...r.headers },
    });
  }) as typeof fetch;
  return { fetch, calls, state };
}

/** Fails the test if replay ever reaches for the network. */
const offline = (async () => {
  throw new Error("replay called the network");
}) as typeof fetch;

const MODEL = "deepseek-ai/DeepSeek-V3-0324";
function chat(user: string, system = "You are Mira, the chief of staff.", model = MODEL) {
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 1500,
    temperature: 0.8,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
}

function post(f: typeof fetch, body: unknown, init: RequestInit = {}, url = CRUSOE) {
  return f(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    ...init,
  });
}

const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer());
const join = (parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));

async function chunksOf(res: Response): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  const reader = res.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(value);
  }
}

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "cassette-"));
  file = path.join(dir, "run.cassette.jsonl");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Records each body in turn against the replies, reading every response to the end. */
async function recordAll(bodies: unknown[], replies: Reply[], init?: RequestInit): Promise<Cassette> {
  const up = fakeUpstream(replies);
  const rec = createCassette({ file, mode: "record", upstream: up.fetch });
  for (const b of bodies) await bytesOf(await post(rec.fetch, b, init));
  return rec;
}

describe("recording and replaying a stream", () => {
  it("replays a recorded SSE response byte for byte", async () => {
    const chunks = sseChunks();
    await recordAll([chat("Draft the launch plan")], [{ chunks }]);

    const play = createCassette({ file, mode: "replay", upstream: offline });
    const res = await post(play.fetch, chat("Draft the launch plan"));

    expect(res.status).toBe(200);
    expect(Buffer.from(await bytesOf(res)).equals(Buffer.from(join(chunks)))).toBe(true);
  });

  it("replays the recorded chunk boundaries, so a split character stays split", async () => {
    const chunks = sseChunks();
    await recordAll([chat("Draft the launch plan")], [{ chunks }]);

    const play = createCassette({ file, mode: "replay", upstream: offline });
    const got = await chunksOf(await post(play.fetch, chat("Draft the launch plan")));

    expect(got.map((c) => Buffer.from(c).toString("hex"))).toEqual(chunks.map((c) => Buffer.from(c).toString("hex")));
  });

  it("replays the status and content-type, and no other response header", async () => {
    await recordAll(
      [chat("Draft the launch plan")],
      [{ status: 503, chunks: [enc.encode('{"error":"overloaded"}')], headers: { "content-type": "application/json", "set-cookie": "s=1", "x-request-id": "req_9" } }],
    );

    const play = createCassette({ file, mode: "replay", upstream: offline });
    const res = await post(play.fetch, chat("Draft the launch plan"));

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-request-id")).toBeNull();
    expect(await res.text()).toBe('{"error":"overloaded"}');
  });

  it("leaves the status and headers the caller sees unchanged while recording", async () => {
    const up = fakeUpstream([{ status: 201, statusText: "Created", headers: { "x-request-id": "req_9" }, chunks: sseChunks() }]);
    const rec = createCassette({ file, mode: "record", upstream: up.fetch });

    const res = await post(rec.fetch, chat("Draft the launch plan"));

    expect(res.status).toBe(201);
    expect(res.statusText).toBe("Created");
    expect(res.headers.get("x-request-id")).toBe("req_9");
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });

  it("never writes the Authorization header to the file", async () => {
    await recordAll([chat("Draft the launch plan")], [{ chunks: sseChunks() }], {
      headers: { Authorization: "Bearer sk-test-123", "Content-Type": "application/json" },
    });

    const text = await readFile(file, "utf8");
    expect(text.trim().split("\n")).toHaveLength(2); // the header and the one exchange were written
    expect(text).not.toContain("sk-test-123");
    expect(text.toLowerCase()).not.toContain("authorization");
  });

  it("writes JSONL: a cassette header line, then one entry per exchange", async () => {
    const chunks = sseChunks();
    await recordAll([chat("Draft the launch plan")], [{ chunks }]);

    const [header, entry, ...rest] = (await readFile(file, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(rest).toEqual([]);
    expect(header).toMatchObject({ v: 1, kind: "cassette" });
    expect(Number.isNaN(Date.parse(header.createdAt))).toBe(false);
    expect(entry).toMatchObject({
      v: 1,
      n: 1,
      request: { method: "POST", path: "/v1/chat/completions", model: MODEL },
      response: { status: 200, headers: { "content-type": "text/event-stream" } },
    });
    expect(entry.key).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.canonical.body.messages[1].content).toBe("Draft the launch plan");
    expect(Number.isNaN(Date.parse(entry.recordedAt))).toBe(false);
    expect(typeof entry.response.ttfbMs).toBe("number");
    expect(entry.response.chunks.map((c: { b64: string }) => Buffer.from(c.b64, "base64").toString("hex"))).toEqual(
      chunks.map((c) => Buffer.from(c).toString("hex")),
    );
    expect(entry.response.chunks.every((c: { dt: number }) => typeof c.dt === "number" && c.dt >= 0)).toBe(true);
  });

  it("keys on the path alone: another host and other headers still match", async () => {
    await recordAll([chat("Draft the launch plan")], [{ chunks: sseChunks() }], {
      headers: { "X-Stainless-Retry-Count": "0", "User-Agent": "OpenAI/JS 7.34.0" },
    });

    const play = createCassette({ file, mode: "replay", upstream: offline });
    const res = await post(
      play.fetch,
      chat("Draft the launch plan"),
      { headers: { "X-Stainless-Retry-Count": "2", Authorization: "Bearer other" } },
      "http://127.0.0.1:4010/v1/chat/completions",
    );

    expect(res.status).toBe(200);
    expect(dec.decode(await bytesOf(res))).toContain("Café");
  });
});
