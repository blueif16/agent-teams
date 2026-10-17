import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODELS } from "@/lib/models";
import { Limiter } from "./limiter";

const MAIN = MODELS.main;
const ADVISOR = MODELS.advisor;

/** Watch a promise without awaiting it, so a test can ask "has it resolved yet?". */
function track<T>(p: Promise<T>) {
  const s = { done: false, error: undefined as unknown };
  p.then(
    () => (s.done = true),
    (e) => ((s.done = true), (s.error = e)),
  );
  return s;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Limiter buckets", () => {
  it("makes the 31st request to a model inside a minute wait for the window, without blocking another model", async () => {
    const limiter = new Limiter(); // defaults: 30 RPM, 500K TPM per model
    for (let i = 0; i < 30; i++) await limiter.acquire(MAIN, 10);

    const thirtyFirst = track(limiter.acquire(MAIN, 10));
    const otherModel = track(limiter.acquire(ADVISOR, 10));
    await vi.advanceTimersByTimeAsync(0);
    expect(otherModel.done).toBe(true);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(thirtyFirst.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1); // the first 30 leave the 60 s window
    expect(thirtyFirst.done).toBe(true);
  });

  it("holds a request whose estimated tokens exceed what is left of the model's TPM until the window frees", async () => {
    const limiter = new Limiter({ tpm: 10_000 });
    await limiter.acquire(MAIN, 7_000);

    const big = track(limiter.acquire(MAIN, 4_000)); // 7K + 4K > 10K, though RPM has 29 left
    await vi.advanceTimersByTimeAsync(59_999);
    expect(big.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(big.done).toBe(true);
  });

  it("lets a request estimated above the whole TPM limit through once the bucket is empty, instead of waiting forever", async () => {
    const limiter = new Limiter({ tpm: 10_000 });
    await limiter.acquire(MAIN, 2_000);

    const huge = track(limiter.acquire(MAIN, 25_000));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(huge.done).toBe(false); // it still waits for the bucket to empty
    await vi.advanceTimersByTimeAsync(1);
    expect(huge.done).toBe(true);
  });
});
