import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODELS } from "@/lib/models";
import { resilient } from "./resilience";

const MAIN = MODELS.main;
const ADVISOR = MODELS.advisor; // main's fallback in modelChain

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * A fake Crusoe behind ChatOpenAI's `configuration.fetch`: main is always rate
 * limited, with no retry-after (so LangChain itself won't retry, D §9); anything
 * else answers with a complete chat.completion.
 */
function fakeCrusoe() {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const { model } = JSON.parse(String(init?.body)) as { model: string };
    calls.push(model);
    if (model === MAIN) {
      return new Response(JSON.stringify({ error: { message: "rate limited", type: "rate_limit_error", code: 429 } }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-limit-requests": "30",
          "x-ratelimit-remaining-requests": "0",
          "x-ratelimit-limit-tokens": "500000",
          "x-ratelimit-remaining-tokens": "480000",
        },
      });
    }
    const body = {
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1_760_000_000,
      model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "from the fallback" } }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16, prompt_tokens_details: { cached_tokens: 0 } },
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-limit-requests": "30",
        "x-ratelimit-remaining-requests": "29",
        "x-ratelimit-limit-tokens": "500000",
        "x-ratelimit-remaining-tokens": "499984",
      },
    });
  };
  return { fetch, calls };
}

describe("resilient", () => {
  it("retries a primary that always 429s 3 times, with backoff, before calling its fallback once", async () => {
    const crusoe = fakeCrusoe();
    const chat = (model: string) =>
      new ChatOpenAI({ model, apiKey: "test-key", configuration: { baseURL: "https://api.inference.crusoecloud.com/v1", fetch: crusoe.fetch } });
    const agent = createAgent({ model: chat(MAIN), tools: [], middleware: resilient(MAIN, chat) });

    const run = agent.invoke({ messages: [{ role: "user", content: "hi" }] });
    await vi.advanceTimersByTimeAsync(700); // first backoff is 1 s ± 25%
    expect(crusoe.calls).toEqual([MAIN]);
    await vi.advanceTimersByTimeAsync(60_000);
    const out = await run;

    expect(crusoe.calls).toEqual([MAIN, MAIN, MAIN, MAIN, ADVISOR]);
    expect(out.messages.at(-1)?.content).toBe("from the fallback");
  });
});
