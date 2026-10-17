import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCassette } from "./cassette";
import { modelFetch } from "./model-fetch";

const CRUSOE = "https://api.inference.crusoecloud.com/v1/chat/completions";
const BODY = JSON.stringify({ model: "deepseek-ai/DeepSeek-V3-0324", stream: true, messages: [{ role: "user", content: "Draft the launch plan" }] });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const call = (f: typeof fetch, body = BODY) => f(CRUSOE, { method: "POST", headers: { "Content-Type": "application/json" }, body });

/** A model API answering `words`, the first after ttfbMs and the rest gapMs apart. */
function answering(words: string[], { ttfbMs = 0, gapMs = 0 } = {}) {
  const enc = new TextEncoder();
  return vi.fn(async () => {
    if (ttfbMs) await sleep(ttfbMs);
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (i >= words.length) return c.close();
        if (i > 0 && gapMs) await sleep(gapMs);
        c.enqueue(enc.encode(words[i++]));
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  });
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "model-fetch-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

/** A cassette file holding one recorded answer to BODY; returns its path and the recorded total ms. */
async function recorded(name: string, words = ["recorded ", "answer"], timing = {}) {
  const file = path.join(dir, name);
  const rec = createCassette({ file, mode: "record", upstream: answering(words, timing) as unknown as typeof fetch });
  await (await call(rec.fetch)).arrayBuffer();
  return { file, total: rec.entries()[0].response.chunks.reduce((s, c) => s + c.dt, 0) };
}

describe("modelFetch", () => {
  it("returns the global fetch when CASSETTE is unset", () => {
    vi.stubEnv("CASSETTE", undefined);
    expect(modelFetch()).toBe(globalThis.fetch);
  });

  it("returns the global fetch when CASSETTE is off", () => {
    vi.stubEnv("CASSETTE", "off");
    expect(modelFetch()).toBe(globalThis.fetch);
  });

  it("with replay:<file>, serves the recording and never the network", async () => {
    const { file } = await recorded("replay.jsonl");
    const network = vi.fn(async () => new Response("live"));
    vi.stubGlobal("fetch", network);
    vi.stubEnv("CASSETTE", `replay:${file}`);

    const hit = await call(modelFetch());
    const miss = await call(modelFetch(), BODY.replace("launch plan", "pricing page"));

    expect(await hit.text()).toBe("recorded answer");
    expect(miss.status).toBe(598);
    expect(network).not.toHaveBeenCalled();
  });

  it("with record:<file>, passes calls to the global fetch and records them", async () => {
    const file = path.join(dir, "record.jsonl");
    vi.stubGlobal("fetch", answering(["live ", "answer"]));
    vi.stubEnv("CASSETTE", `record:${file}`);

    expect(await (await call(modelFetch())).text()).toBe("live answer");
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).n).toBe(1);
  });

  it("keeps one cassette per process for a CASSETTE value", async () => {
    const { file } = await recorded("memo.jsonl");
    vi.stubEnv("CASSETTE", `replay:${file}`);

    expect(modelFetch()).toBe(modelFetch());
    // One cassette means one occurrence counter: the second identical call is occurrence 2, which wasn't recorded.
    expect((await call(modelFetch())).status).toBe(200);
    expect((await call(modelFetch())).status).toBe(598);
  });

  it("replays at the recorded pace with CASSETTE_SPEED=1", async () => {
    const { file, total } = await recorded("pace.jsonl", ["a", "b", "c"], { ttfbMs: 50, gapMs: 75 });
    vi.stubEnv("CASSETTE", `replay:${file}`);
    vi.stubEnv("CASSETTE_SPEED", "1");

    const t0 = performance.now();
    await (await call(modelFetch())).arrayBuffer();

    expect(performance.now() - t0).toBeGreaterThanOrEqual(total - 20);
  });

  it("replays without waiting when CASSETTE_SPEED is unset", async () => {
    const { file, total } = await recorded("fast.jsonl", ["a", "b", "c"], { ttfbMs: 50, gapMs: 75 });
    vi.stubEnv("CASSETTE", `replay:${file}`);
    vi.stubEnv("CASSETTE_SPEED", undefined);

    const t0 = performance.now();
    await (await call(modelFetch())).arrayBuffer();

    expect(performance.now() - t0).toBeLessThan(total / 4);
  });

  it.each(["replay", "replay:", "play:run.jsonl", "on"])("refuses CASSETTE=%s rather than going live", (value) => {
    vi.stubEnv("CASSETTE", value);
    expect(() => modelFetch()).toThrow(/CASSETTE/);
  });

  it("refuses a CASSETTE_SPEED it can't read", async () => {
    const { file } = await recorded("speed.jsonl");
    vi.stubEnv("CASSETTE", `replay:${file}`);
    vi.stubEnv("CASSETTE_SPEED", "fast");
    expect(() => modelFetch()).toThrow(/CASSETTE_SPEED/);
  });
});
