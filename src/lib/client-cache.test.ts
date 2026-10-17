import { describe, expect, it, vi } from "vitest";
import { createClientCache, type Listen } from "./client-cache";

const MIRA = "/api/stats?agent=mira";
const REX = "/api/stats?agent=rex";

/** A fetcher that answers each key with how many times that key was asked for. */
function counting() {
  const calls: string[] = [];
  const count = (key: string) => calls.filter((k) => k === key).length;
  const fetcher = vi.fn(async (key: string) => {
    calls.push(key);
    return { key, n: count(key) };
  });
  return { fetcher, count };
}

/** Stands in for the shared EventSource. */
function stream() {
  let handlers: Parameters<Listen>[0] | undefined;
  const listen: Listen = (h) => {
    handlers = h;
  };
  return { listen, change: (topic: string) => handlers!.change(topic) };
}

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("client cache", () => {
  it("a second subscriber gets the cached value synchronously", async () => {
    const { fetcher, count } = counting();
    const cache = createClientCache({ fetcher });
    const unmount = cache.subscribe(MIRA, () => {});
    await cache.revalidate(MIRA);
    unmount();

    cache.subscribe(MIRA, () => {});

    expect(cache.snapshot(MIRA).data).toEqual({ key: MIRA, n: 1 });
    expect(count(MIRA)).toBe(1);
  });

  it("a topic event revalidates its key exactly once and leaves other keys alone", async () => {
    const { fetcher, count } = counting();
    const events = stream();
    const cache = createClientCache({ fetcher, listen: events.listen });
    cache.subscribe(MIRA, () => {}, "stats:agent:mira");
    cache.subscribe(REX, () => {}, "stats:agent:rex");
    await Promise.all([cache.revalidate(MIRA), cache.revalidate(REX)]);

    events.change("stats:agent:mira");
    await settle();

    expect(count(MIRA)).toBe(2);
    expect(count(REX)).toBe(1);
    expect(cache.snapshot(MIRA).data).toEqual({ key: MIRA, n: 2 });
  });

  it("concurrent requests for one key share one fetch", async () => {
    const { fetcher, count } = counting();
    const cache = createClientCache({ fetcher });

    await Promise.all([cache.revalidate(MIRA), cache.revalidate(MIRA), cache.prefetch(MIRA)]);

    expect(count(MIRA)).toBe(1);
  });

  it("a reload paints the last snapshot from sessionStorage before any fetch", async () => {
    const storage = memoryStorage();
    await createClientCache({ fetcher: counting().fetcher, storage }).revalidate(MIRA);
    const { fetcher, count } = counting();

    const reloaded = createClientCache({ fetcher, storage });

    expect(reloaded.snapshot(MIRA).data).toEqual({ key: MIRA, n: 1 });
    expect(count(MIRA)).toBe(0);
  });

  it("a change that lands mid-fetch gets one more fetch, so the newer data wins", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const answers = ["old", "new"];
    const fetcher = vi.fn(async () => {
      const answer = answers.shift();
      if (answer === "old") await gate;
      return answer;
    });
    const events = stream();
    const cache = createClientCache({ fetcher, listen: events.listen });
    cache.subscribe(MIRA, () => {}, "stats:agent:mira");

    const first = cache.revalidate(MIRA);
    events.change("stats:agent:mira");
    release();
    await first;
    await settle();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cache.snapshot(MIRA).data).toBe("new");
  });
});
