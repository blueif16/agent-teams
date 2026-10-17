import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODELS } from "@/lib/models";
import { Limiter, limitFetch } from "./limiter";

const MAIN = MODELS.main;
const ADVISOR = MODELS.advisor;
const URL = "https://api.inference.crusoecloud.com/v1/chat/completions";

/** A chat-completions request as ChatOpenAI sends it, padded so the limiter estimates `estTokens` (chars / 4). */
function post(model: string, estTokens: number, stream = false): RequestInit {
  const shape = (content: string) =>
    JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: 1024, stream });
  return {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-key" },
    body: shape("x".repeat(Math.max(0, estTokens * 4 - shape("").length))),
  };
}

type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details: { cached_tokens: number } };
const SMALL_USAGE: Usage = { prompt_tokens: 90, completion_tokens: 10, total_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } };

/** The four rate-limit headers Crusoe puts on every response (skill file §6); pass `undefined` to leave one out. */
function crusoeHeaders(h: { limitRequests?: number; remainingRequests?: number; limitTokens?: number; remainingTokens?: number }) {
  const out: Record<string, string> = {};
  if (h.limitRequests !== undefined) out["x-ratelimit-limit-requests"] = String(h.limitRequests);
  if (h.remainingRequests !== undefined) out["x-ratelimit-remaining-requests"] = String(h.remainingRequests);
  if (h.limitTokens !== undefined) out["x-ratelimit-limit-tokens"] = String(h.limitTokens);
  if (h.remainingTokens !== undefined) out["x-ratelimit-remaining-tokens"] = String(h.remainingTokens);
  return out;
}
const ROOMY = crusoeHeaders({ limitRequests: 30, remainingRequests: 29, limitTokens: 500_000, remainingTokens: 499_900 });

/** A complete non-streamed chat.completion response, as Crusoe returns it (shape from research/sandbox/verify3.mjs). */
function completion(model: string, { usage = SMALL_USAGE, headers = ROOMY }: { usage?: Usage; headers?: Record<string, string> } = {}) {
  const body = {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1_760_000_000,
    model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hi", reasoning_content: "thought" } }],
    usage,
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

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

describe("limitFetch", () => {
  it("waits on the limiter for the model named in the request body before calling the inner fetch", async () => {
    const sent: string[] = [];
    const inner: typeof fetch = async (_input, init) => {
      const { model } = JSON.parse(String(init?.body));
      sent.push(model);
      return completion(model);
    };
    const f = limitFetch(inner, new Limiter({ rpm: 1 }));
    await f(URL, post(MAIN, 100));

    const second = track(f(URL, post(MAIN, 100)));
    await f(URL, post(ADVISOR, 100)); // another model's bucket is free
    expect(sent).toEqual([MAIN, ADVISOR]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(second.done).toBe(true);
    expect(sent).toEqual([MAIN, ADVISOR, MAIN]);
  });

  it("hands the inner fetch the exact request and returns its response with the body unread, so it can sit anywhere in a fetch chain", async () => {
    const res = completion(MAIN);
    const calls: [unknown, unknown][] = [];
    const inner: typeof fetch = async (input, init) => {
      calls.push([input, init]);
      return res;
    };
    const init = post(MAIN, 100);

    const out = await limitFetch(inner, new Limiter())(URL, init);

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(URL);
    expect(calls[0][1]).toBe(init);
    expect(out).toBe(res);
    expect((await out.json()).choices[0].message.content).toBe("hi");
  });

  it("still sends a request that has no JSON body, such as GET /v1/models", async () => {
    const res = new Response(JSON.stringify({ object: "list", data: [] }), {
      status: 200,
      headers: { "content-type": "application/json", ...ROOMY },
    });
    const inner: typeof fetch = async () => res;

    const out = await limitFetch(inner, new Limiter())("https://api.inference.crusoecloud.com/v1/models", { method: "GET" });

    expect(out).toBe(res);
  });

  it("returns a streamed response as soon as it starts, without waiting for the stream to end", async () => {
    const enc = new TextEncoder();
    const chunk = (extra: object) =>
      enc.encode(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1_760_000_000, model: MAIN, ...extra })}\n\n`);
    let finish = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(chunk({ choices: [{ index: 0, delta: { role: "assistant", content: "hi" }, finish_reason: null }] }));
        finish = () => {
          c.enqueue(chunk({ choices: [], usage: SMALL_USAGE }));
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        };
      },
    });
    const res = new Response(body, { status: 200, headers: { "content-type": "text/event-stream", ...ROOMY } });

    const out = track(limitFetch(async () => res, new Limiter())(URL, post(MAIN, 100, true)));
    await vi.advanceTimersByTimeAsync(0);
    expect(out.done).toBe(true);
    finish();
  });
});

describe("calibration from responses", () => {
  /** limitFetch over a fake Crusoe whose responses come from `respond`, counting what reached it. */
  function crusoe(limiter: Limiter, respond: (n: number) => Response) {
    const reached = { n: 0 };
    const f = limitFetch(async () => respond(++reached.n), limiter);
    return { f, reached };
  }

  it("blocks the next request to a model after a response says x-ratelimit-remaining-requests: 0", async () => {
    // Another process (or a key shared elsewhere) spent the minute: locally only 1 of 30 is used.
    const headers = crusoeHeaders({ limitRequests: 30, remainingRequests: 0, limitTokens: 500_000, remainingTokens: 499_900 });
    const { f, reached } = crusoe(new Limiter(), () => completion(MAIN, { headers }));
    await f(URL, post(MAIN, 100));

    const next = track(f(URL, post(MAIN, 100)));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(next.done).toBe(false);
    expect(reached.n).toBe(1);
    await vi.advanceTimersByTimeAsync(1); // the window that request opened has passed
    expect(next.done).toBe(true);
  });

  it("does not read a missing x-ratelimit-remaining-requests header as 0", async () => {
    const headers = crusoeHeaders({ limitTokens: 500_000, remainingTokens: 499_900 }); // no *-requests headers
    const { f, reached } = crusoe(new Limiter(), () => completion(MAIN, { headers }));
    await f(URL, post(MAIN, 100));

    const next = track(f(URL, post(MAIN, 100)));
    await vi.advanceTimersByTimeAsync(0);
    expect(next.done).toBe(true);
    expect(reached.n).toBe(2);
  });

  it("holds a request that won't fit in the x-ratelimit-remaining-tokens a response reported", async () => {
    // Crusoe says 2K tokens are left this minute; locally only ~100 have been counted.
    const headers = crusoeHeaders({ limitRequests: 30, remainingRequests: 29, limitTokens: 500_000, remainingTokens: 2_000 });
    const { f, reached } = crusoe(new Limiter(), () => completion(MAIN, { headers }));
    await f(URL, post(MAIN, 100));

    const next = track(f(URL, post(MAIN, 3_000)));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(next.done).toBe(false);
    expect(reached.n).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(next.done).toBe(true);
  });

  it("after a 429, holds the model until the minute that began with the window's first request has passed", async () => {
    // A 429 with no x-ratelimit headers or retry-after, like the one in research/sandbox/verify3.mjs
    // (and GLM-5.3 at capacity answering 429 to a single request, DECISIONS.md).
    const rateLimited = () =>
      new Response(JSON.stringify({ error: { message: "rate limited", type: "rate_limit_error", code: 429 } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    const { f, reached } = crusoe(new Limiter(), (n) => (n === 1 ? completion(MAIN) : rateLimited()));
    await f(URL, post(MAIN, 100)); // t = 0, ok: the window starts here
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await f(URL, post(MAIN, 100))).status).toBe(429); // t = 10 s

    const next = track(f(URL, post(MAIN, 100)));
    await vi.advanceTimersByTimeAsync(49_999);
    expect(next.done).toBe(false);
    expect(reached.n).toBe(2);
    await vi.advanceTimersByTimeAsync(1); // t = 60 s
    expect(next.done).toBe(true);
  });

  it("still returns and observes a response labelled JSON whose body doesn't parse, such as an empty 429", async () => {
    const empty429 = () => new Response("", { status: 429, headers: { "content-type": "application/json" } });
    const { f, reached } = crusoe(new Limiter(), empty429);

    await expect(f(URL, post(MAIN, 100))).resolves.toMatchObject({ status: 429 });
    const next = track(f(URL, post(MAIN, 100)));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(next.done).toBe(false);
    expect(reached.n).toBe(1);
  });

  // The next two responses carry no x-ratelimit headers, so only the body's usage can correct the count.
  const BIG_USAGE: Usage = { prompt_tokens: 6_000, completion_tokens: 1_500, total_tokens: 7_500, prompt_tokens_details: { cached_tokens: 5_000 } };

  it("counts a JSON response's real usage, output included, in place of the request's estimate", async () => {
    const limiter = new Limiter({ tpm: 10_000 });
    const { f } = crusoe(limiter, () => completion(MAIN, { usage: BIG_USAGE, headers: {} }));
    await f(URL, post(MAIN, 100)); // estimated 100, really 7.5K

    const next = track(limiter.acquire(MAIN, 3_000)); // fits beside 100, not beside 7.5K
    await vi.advanceTimersByTimeAsync(59_999);
    expect(next.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(next.done).toBe(true);
  });

  it("counts cached prompt tokens toward TPM unless countCachedTokens is false", async () => {
    // Whether Crusoe counts cached tokens is UNVERIFIED (F §4), so they count by default.
    const nextGoesAtOnce = async (opts: { countCachedTokens?: boolean }) => {
      const limiter = new Limiter({ tpm: 10_000, ...opts });
      const { f } = crusoe(limiter, () => completion(MAIN, { usage: BIG_USAGE, headers: {} }));
      await f(URL, post(MAIN, 100));
      const next = track(limiter.acquire(MAIN, 5_000)); // 7.5K + 5K > 10K; (7.5K - 5K cached) + 5K fits
      await vi.advanceTimersByTimeAsync(0);
      return next.done;
    };
    expect(await nextGoesAtOnce({})).toBe(false);
    expect(await nextGoesAtOnce({ countCachedTokens: false })).toBe(true);
  });
});
