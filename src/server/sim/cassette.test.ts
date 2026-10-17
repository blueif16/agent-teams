import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  const serve = (async (input: string | URL | Request, init?: RequestInit) => {
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
  return { fetch: serve, calls, state };
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

/** Resolves to "timed out" if `p` hasn't settled within ms. */
const within = <T,>(p: Promise<T>, ms = 1000) => Promise.race([p, sleep(ms).then(() => "timed out" as const)]);

describe("recording while the caller streams", () => {
  it("hands the caller the first chunk before the upstream has finished", async () => {
    let release = () => {};
    const hold = new Promise<void>((r) => (release = r));
    const chunks = sseChunks();
    const up = fakeUpstream([{ chunks: chunks.slice(0, 1), hold }]);
    const rec = createCassette({ file, mode: "record", upstream: up.fetch });

    const first = await within(
      (async () => {
        const reader = (await post(rec.fetch, chat("Draft the launch plan"))).body!.getReader();
        return { reader, chunk: await reader.read() };
      })(),
    );

    expect(first).not.toBe("timed out");
    const { reader, chunk } = first as Exclude<typeof first, "timed out">;
    expect(Buffer.from(chunk.value!).equals(Buffer.from(chunks[0]))).toBe(true);
    expect(up.state.finished).toBe(0);
    release();
    expect((await reader.read()).done).toBe(true);
  });

  it("saves a cancelled recording as partial, with the chunks read so far", async () => {
    const chunks = sseChunks();
    const up = fakeUpstream([{ chunks: chunks.slice(0, 1), hold: new Promise(() => {}) }]);
    const rec = createCassette({ file, mode: "record", upstream: up.fetch });

    const res = await within(post(rec.fetch, chat("Draft the launch plan")));
    expect(res).not.toBe("timed out");
    const reader = (res as Response).body!.getReader();
    await reader.read();
    await reader.cancel();

    const saved = (await readFile(file, "utf8")).trim().split("\n").slice(1).map((l) => JSON.parse(l));
    expect(saved).toHaveLength(1);
    expect(saved[0].response.partial).toBe(true);
    expect(saved[0].response.chunks.map((c: { b64: string }) => c.b64)).toEqual([Buffer.from(chunks[0]).toString("base64")]);
  });

  it("cancels the upstream body when the caller cancels, so the model stops", async () => {
    const up = fakeUpstream([{ chunks: sseChunks().slice(0, 1), hold: new Promise(() => {}) }]);
    const rec = createCassette({ file, mode: "record", upstream: up.fetch });

    const res = await within(post(rec.fetch, chat("Draft the launch plan")));
    expect(res).not.toBe("timed out");
    const reader = (res as Response).body!.getReader();
    await reader.read();
    await reader.cancel();

    expect(up.state.cancelled).toBe(1);
  });
});

const text = (s: string): Reply => ({ chunks: [enc.encode(s)] });

describe("occurrences", () => {
  it("numbers identical requests 1 and 2, and each replays its own answer", async () => {
    const rec = await recordAll([chat("Draft the launch plan"), chat("Draft the launch plan")], [text("one"), text("two")]);
    expect(rec.entries().map((e) => e.n)).toEqual([1, 2]);

    const play = createCassette({ file, mode: "replay", upstream: offline });
    const first = await (await post(play.fetch, chat("Draft the launch plan"))).text();
    const second = await (await post(play.fetch, chat("Draft the launch plan"))).text();

    expect([first, second]).toEqual(["one", "two"]);
  });

  it("assigns the occurrence when a request starts, so parallel calls match in any order", async () => {
    await recordAll(
      [chat("Draft the launch plan"), chat("Size the market"), chat("Draft the launch plan")],
      [text("plan one"), text("market"), text("plan two")],
    );

    const play = createCassette({ file, mode: "replay", upstream: offline });
    // Started together, the market call first; the bodies are read last-started first.
    const [market, plan1, plan2] = await Promise.all([
      post(play.fetch, chat("Size the market")),
      post(play.fetch, chat("Draft the launch plan")),
      post(play.fetch, chat("Draft the launch plan")),
    ]);

    expect(await plan2.text()).toBe("plan two");
    expect(await plan1.text()).toBe("plan one");
    expect(await market.text()).toBe("market");
  });

  it("records an error the caller never reads, so a retry replays the 429 and then the answer", async () => {
    const up = fakeUpstream([{ status: 429, ...text('{"error":"rate limited"}') }, { chunks: sseChunks() }]);
    const rec = createCassette({ file, mode: "record", upstream: up.fetch });
    await post(rec.fetch, chat("Draft the launch plan")); // like callCrusoe: a 429 body is left unread
    await bytesOf(await post(rec.fetch, chat("Draft the launch plan")));
    await vi.waitFor(() => expect(rec.entries()).toHaveLength(2));

    const play = createCassette({ file, mode: "replay", upstream: offline });
    const limited = await post(play.fetch, chat("Draft the launch plan"));
    const answer = await post(play.fetch, chat("Draft the launch plan"));

    expect(limited.status).toBe(429);
    expect(await limited.text()).toBe('{"error":"rate limited"}');
    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain("Café");
  });
});

// The volatile text a real prompt carries: the date line chat/route.ts builds, ISO dates and times, a uuid7 trace id.
const SYSTEM = [
  "You are Mira, the chief of staff.",
  "Today is Fri, Oct 17, 2026.",
  "The sprint ends 2026-10-31.",
  "Last check-in 2026-10-17T22:04:05.123Z.",
  "Trace 0199f3c2-7d1e-7a3b-9c4d-5e6f7a8b9c0d.",
].join("\n");

interface MissBody {
  error: string;
  key: string;
  n: number;
  closest: { key: string; n: number } | null;
  diff: string[];
}

describe("the key", () => {
  it.each([
    ["a weekday date", "Today is Fri, Oct 17, 2026.", "Today is Sat, Oct 18, 2026."],
    ["an ISO date", "2026-10-31", "2026-11-07"],
    ["an ISO timestamp", "2026-10-17T22:04:05.123Z", "2026-10-18T09:15:00Z"],
    ["a UUID", "0199f3c2-7d1e-7a3b-9c4d-5e6f7a8b9c0d", "0199F3C3-0000-7FFF-8ABC-123456789ABC"],
  ])("is the same when the prompt has another %s", async (_, recorded, now) => {
    await recordAll([chat("Draft the launch plan", SYSTEM)], [text("answer")]);

    const play = createCassette({ file, mode: "replay", upstream: offline });
    const res = await post(play.fetch, chat("Draft the launch plan", SYSTEM.replace(recorded, now)));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("answer");
  });

  it("differs when the user's message differs", async () => {
    await recordAll([chat("Draft the launch plan", SYSTEM)], [text("answer")]);

    const play = createCassette({ file, mode: "replay", upstream: offline });
    const res = await post(play.fetch, chat("Draft the pricing page", SYSTEM));

    expect(res.status).toBe(598);
  });

  it("goes through the canonicalize hook, for volatile text only this project knows", async () => {
    // Like the chief prompt's ledger block: numbers that move between runs.
    const maskCalls = (c: { method: string; path: string; body: unknown }) =>
      JSON.parse(JSON.stringify(c).replace(/Calls this week: \d+/g, "Calls this week: <N>"));
    const up = fakeUpstream([text("answer")]);
    const rec = createCassette({ file, mode: "record", upstream: up.fetch, canonicalize: maskCalls });
    await bytesOf(await post(rec.fetch, chat("Draft the launch plan", "Calls this week: 41")));

    const play = createCassette({ file, mode: "replay", upstream: offline, canonicalize: maskCalls });
    const res = await post(play.fetch, chat("Draft the launch plan", "Calls this week: 57"));

    expect(res.status).toBe(200);
  });
});

describe("a miss in replay", () => {
  it("returns 598 with the key, the occurrence and a diff naming the changed line", async () => {
    const rec = await recordAll([chat("Draft the launch plan")], [text("answer")]);
    const recorded = rec.entries()[0];

    const play = createCassette({ file, mode: "replay", upstream: offline });
    const res = await post(play.fetch, chat("Draft the pricing page"));
    const body = (await res.json()) as MissBody;

    expect(res.status).toBe(598);
    expect(body.error).toBe("cassette miss");
    expect(body.key).toMatch(/^[0-9a-f]{64}$/);
    expect(body.key).not.toBe(recorded.key);
    expect(body.n).toBe(1);
    expect(body.closest).toEqual({ key: recorded.key, n: 1 });
    // Only the lines that differ: the recorded one, then this request's.
    expect(body.diff).toEqual([
      expect.stringMatching(/^- "content": "Draft the launch plan"/),
      expect.stringMatching(/^\+ "content": "Draft the pricing page"/),
    ]);
  });

  it("lists the miss in misses() and never calls the upstream", async () => {
    await recordAll([chat("Draft the launch plan")], [text("answer")]);
    const up = fakeUpstream([text("live answer")]);

    const play = createCassette({ file, mode: "replay", upstream: up.fetch });
    const body = (await (await post(play.fetch, chat("Draft the pricing page"))).json()) as MissBody;

    expect(up.calls).toHaveLength(0);
    expect(play.misses()).toHaveLength(1);
    expect(play.misses()[0]).toMatchObject({ key: body.key, n: 1, request: { path: "/v1/chat/completions", model: MODEL } });
  });

  it("diffs against an entry for the same model, even when another model's is closer", async () => {
    const rec = await recordAll(
      [chat("Draft the launch plan", undefined, "model-a"), chat("Draft the pricing page", undefined, "model-b")],
      [text("a"), text("b")],
    );
    const [a] = rec.entries();

    const play = createCassette({ file, mode: "replay", upstream: offline });
    const body = (await (await post(play.fetch, chat("Draft the pricing page", undefined, "model-a"))).json()) as MissBody;

    expect(body.closest).toEqual({ key: a.key, n: 1 });
  });

  it("diffs against the most similar entry when several share the model", async () => {
    const rec = await recordAll(
      [chat("Size the market", "You are Kai, the analyst."), chat("Draft the launch plan", "You are Mira.")],
      [text("kai"), text("mira")],
    );
    const mira = rec.entries()[1];

    const play = createCassette({ file, mode: "replay", upstream: offline });
    const body = (await (await post(play.fetch, chat("Draft the pricing page", "You are Mira."))).json()) as MissBody;

    expect(body.closest).toEqual({ key: mira.key, n: 1 });
    expect(body.diff).toHaveLength(2);
  });

  it("caps the diff at 20 lines", async () => {
    const many = (word: string) => ({ ...chat(""), messages: Array.from({ length: 30 }, (_, i) => ({ role: "user", content: `${word} ${i}` })) });
    await recordAll([many("before")], [text("answer")]);

    const play = createCassette({ file, mode: "replay", upstream: offline });
    const body = (await (await post(play.fetch, many("after"))).json()) as MissBody;

    expect(body.diff).toHaveLength(20);
  });
});

/** Records one answer that arrives 60 ms after the request, then a chunk every 80 ms: about 300 ms in all. */
async function recordTimed(): Promise<number> {
  const words = ["One ", "two ", "three ", "four"];
  const rec = await recordAll([chat("Draft the launch plan")], [{ ttfbMs: 60, gapMs: 80, chunks: words.map((w) => enc.encode(w)) }]);
  return rec.entries()[0].response.chunks.reduce((sum, c) => sum + c.dt, 0);
}

/** ms from the request to the end of the body. */
async function timeReplay(speed?: number): Promise<number> {
  const play = createCassette({ file, mode: "replay", upstream: offline, speed });
  const t0 = performance.now();
  await bytesOf(await post(play.fetch, chat("Draft the launch plan")));
  return performance.now() - t0;
}

describe("replay pace", () => {
  it("takes about the recorded time at speed 1", async () => {
    const total = await recordTimed();
    expect(total).toBeGreaterThanOrEqual(280); // the fake's own delays, as recorded

    const elapsed = await timeReplay(1);

    expect(elapsed).toBeGreaterThanOrEqual(total - 20);
    expect(elapsed).toBeLessThan(total + 150);
  });

  it("takes about a quarter of the recorded time at speed 4", async () => {
    const total = await recordTimed();

    const elapsed = await timeReplay(4);

    expect(elapsed).toBeGreaterThanOrEqual(total / 4 - 20);
    expect(elapsed).toBeLessThan(total / 2);
  });

  it("doesn't wait at all by default", async () => {
    const total = await recordTimed();

    const elapsed = await timeReplay();

    expect(elapsed).toBeLessThan(total / 6);
  });

  it("refuses a speed that isn't positive", () => {
    expect(() => createCassette({ file, mode: "replay", speed: 0 })).toThrow(/speed/);
  });
});

describe("aborting a replay", () => {
  it("errors the stream with an AbortError at once, without waiting out the gaps", async () => {
    await recordTimed();
    const play = createCassette({ file, mode: "replay", upstream: offline, speed: 1 });
    const ctl = new AbortController();
    const reader = (await post(play.fetch, chat("Draft the launch plan"), { signal: ctl.signal })).body!.getReader();
    await reader.read();

    const t0 = performance.now();
    ctl.abort();
    const next = await reader.read().then(
      () => "a chunk",
      (e: Error) => e.name,
    );

    expect(next).toBe("AbortError");
    expect(performance.now() - t0).toBeLessThan(100); // the rest of the recording is ~240 ms away
  });

  it("stops a replay at the default speed too", async () => {
    await recordAll([chat("Draft the launch plan")], [{ chunks: sseChunks() }]);
    const play = createCassette({ file, mode: "replay", upstream: offline });
    const ctl = new AbortController();
    const reader = (await post(play.fetch, chat("Draft the launch plan"), { signal: ctl.signal })).body!.getReader();
    await reader.read();

    ctl.abort();

    await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects at once when the signal is already aborted, as fetch does", async () => {
    await recordAll([chat("Draft the launch plan")], [{ chunks: sseChunks() }]);
    const play = createCassette({ file, mode: "replay", upstream: offline });

    await expect(post(play.fetch, chat("Draft the launch plan"), { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
  });
});
