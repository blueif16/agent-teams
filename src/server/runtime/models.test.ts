import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODELS, reasoningFields } from "@/lib/models";
import { crusoe } from "./models";

type Request = { url: string; headers: Headers; body: Record<string, unknown> };

/** Stands in for Crusoe's OpenAI-compatible endpoint: records each request, answers with a full chat completion. */
function fakeCrusoe() {
  const requests: Request[] = [];
  const fetch = async (input: string | URL | globalThis.Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(input instanceof Request ? input.url : input), headers: new Headers(init?.headers), body });
    const completion = {
      id: "chatcmpl-test-1",
      object: "chat.completion",
      created: 1760659200,
      model: body.model,
      system_fingerprint: null,
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          logprobs: null,
          message: { role: "assistant", content: "pong", refusal: null, reasoning_content: "They said ping." },
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 6,
        total_tokens: 18,
        prompt_tokens_details: { cached_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 4 },
      },
    };
    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-limit-requests": "30",
        "x-ratelimit-remaining-requests": "29",
        "x-ratelimit-limit-tokens": "500000",
        "x-ratelimit-remaining-tokens": "499982",
      },
    });
  };
  return { requests, fetch };
}

beforeEach(() => {
  vi.stubEnv("CRUSOE_API_KEY", "test-crusoe-key");
  vi.stubEnv("CRUSOE_BASE_URL", "https://crusoe.test/v1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("crusoe", () => {
  it.each([
    [MODELS.main, true],
    [MODELS.main, false],
    [MODELS.advisor, true],
  ])("sends %s with its reasoning fields for think=%s and the max_tokens budget", async (model, think) => {
    const api = fakeCrusoe();
    await crusoe(model, { maxTokens: 1234, think, fetch: api.fetch }).invoke("ping");

    expect(api.requests).toHaveLength(1);
    const { body } = api.requests[0];
    expect(body.model).toBe(model);
    expect(body.max_tokens).toBe(1234);
    expect(body).toMatchObject(reasoningFields(model, think));
  });

  // A wrong base URL would send the Crusoe key to api.openai.com.
  it.each([
    ["https://crusoe.test/v1", "https://crusoe.test/v1/chat/completions"],
    [undefined, "https://api.inference.crusoecloud.com/v1/chat/completions"],
    ["", "https://api.inference.crusoecloud.com/v1/chat/completions"],
  ])("posts to CRUSOE_BASE_URL=%s → %s with the Crusoe key", async (baseUrl, endpoint) => {
    vi.stubEnv("CRUSOE_BASE_URL", baseUrl);
    const api = fakeCrusoe();
    await crusoe(MODELS.main, { maxTokens: 64, think: false, fetch: api.fetch }).invoke("ping");

    expect(api.requests).toHaveLength(1);
    expect(api.requests[0].url).toBe(endpoint);
    expect(api.requests[0].headers.get("authorization")).toBe("Bearer test-crusoe-key");
  });
});
