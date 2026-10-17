import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callEvent } from "./testing";

// Outside a Next request, connection() throws; the route only calls it to stay dynamic.
vi.mock("next/server", () => ({ connection: async () => {} }));

type Global = { __agentTeamsCache?: { close(): void } };

/** Reads the stream until a `data:` line for `topic` arrives; rejects after `ms`. */
async function nextData(reader: ReadableStreamDefaultReader<Uint8Array>, topic: string, ms: number) {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`no ${topic} event within ${ms} ms; got ${JSON.stringify(text)}`);
    const chunk = await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), left)),
    ]);
    if (!chunk || chunk.done) continue;
    text += decoder.decode(chunk.value, { stream: true });
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = JSON.parse(line.slice(5)) as { topic: string; version: number };
      if (data.topic === topic) return data;
    }
  }
}

describe("GET /api/events", () => {
  let root: string;
  let cwd: { mockRestore(): void };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "events-"));
    cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.resetModules();
    delete (globalThis as Global).__agentTeamsCache;
  });

  afterEach(async () => {
    (globalThis as Global).__agentTeamsCache?.close();
    delete (globalThis as Global).__agentTeamsCache;
    cwd.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it("streams a change within 1 s of record()", async () => {
    const { GET } = await import("@/app/api/events/route");
    const { record } = await import("@/lib/ledger");
    const client = new AbortController();
    const res = await GET(new Request("http://localhost/api/events?topics=stats", { signal: client.signal }));
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const reader = res.body!.getReader();

    const started = Date.now();
    await record(callEvent());
    const data = await nextData(reader, "stats:agent:mira", 1000);

    expect(Date.now() - started).toBeLessThan(1000);
    expect(data.version).toBeGreaterThan(0);
    client.abort();
  });

  it("removes its bus listener when the client disconnects", async () => {
    const { GET } = await import("@/app/api/events/route");
    const { getServerCache } = await import("@/server/cache");
    const bus = getServerCache().bus;
    const baseline = bus.listenerCount();
    const client = new AbortController();

    await GET(new Request("http://localhost/api/events?topics=stats,files", { signal: client.signal }));
    expect(bus.listenerCount()).toBe(baseline + 1);
    client.abort();

    expect(bus.listenerCount()).toBe(baseline);
  });
});
