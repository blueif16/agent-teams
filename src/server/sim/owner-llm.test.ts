/*
 * The judge against a FAKE Crusoe: every reply is a complete chat-completion body, so a parser that reads a field
 * the real API doesn't send breaks here too. No network.
 */
import { describe, expect, it } from "vitest";
import { MODELS } from "@/lib/models";
import { makeJudge } from "./owner-llm";

const COPY = "Tern turns every field sales meeting into notes.\nBuilt for reps who sell in person.";
const QUESTION = "Does the copy say who Tern is for?";

function completion(model: string, content: string) {
  return {
    id: "chatcmpl-judge",
    object: "chat.completion",
    created: 1760702400,
    model,
    choices: [{ index: 0, message: { role: "assistant", content, reasoning_content: null, tool_calls: [] }, logprobs: null, finish_reason: "stop" }],
    usage: { prompt_tokens: 420, completion_tokens: 30, total_tokens: 450, prompt_tokens_details: { cached_tokens: 0 } },
  };
}

/** Answers each call with the next scripted reply: a content string (200) or a status number. */
function fakeCrusoe(replies: (string | number)[]) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(url), init: init ?? {}, body });
    const next = replies.shift();
    if (next === undefined) throw new Error("fake Crusoe: no reply scripted");
    if (typeof next === "number") return new Response(JSON.stringify({ error: { message: "at capacity", code: next } }), { status: next });
    return Response.json(completion(String(body.model), next));
  }) as typeof fetch;
  return { fetchFn, calls };
}

const deps = (fetchFn: typeof fetch, slept: number[] = []) => ({
  fetch: fetchFn,
  model: MODELS.advisor,
  apiKey: "test-key",
  baseUrl: "https://crusoe.test/v1",
  sleep: async (ms: number) => void slept.push(ms),
});

describe("makeJudge", () => {
  it("asks one non-streaming, temperature-0 completion with only the text and the question, and passes on a yes with a verbatim quote", async () => {
    const { fetchFn, calls } = fakeCrusoe([JSON.stringify({ answer: "yes", quote: "Built for reps who sell in person." })]);
    const r = await makeJudge(deps(fetchFn))(COPY, QUESTION);
    expect(r).toEqual({ pass: true, quote: "Built for reps who sell in person." });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://crusoe.test/v1/chat/completions");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].body).toMatchObject({ model: MODELS.advisor, temperature: 0 });
    expect(calls[0].body.stream ?? false).toBe(false);
    const prompt = JSON.stringify(calls[0].body.messages);
    expect(prompt).toContain(QUESTION);
    expect(prompt).toContain("Built for reps who sell in person.");
  });

  it("fails on a no, and gives no verdict on a yes whose quote isn't in the text", async () => {
    const no = fakeCrusoe([JSON.stringify({ answer: "no", quote: "" })]);
    expect(await makeJudge(deps(no.fetchFn))(COPY, QUESTION)).toEqual({ pass: false, quote: "" });
    const invented = fakeCrusoe(["```json\n" + JSON.stringify({ answer: "yes", quote: "Made for enterprise CFOs." }) + "\n```"]);
    expect((await makeJudge(deps(invented.fetchFn))(COPY, QUESTION)).pass).toBeNull();
  });

  it("retries a 429/503 twice with backoff, then gives no verdict", async () => {
    const slept: number[] = [];
    const busy = fakeCrusoe([429, 503, 429]);
    expect((await makeJudge(deps(busy.fetchFn, slept))(COPY, QUESTION)).pass).toBeNull();
    expect(busy.calls).toHaveLength(3);
    expect(slept).toEqual([1000, 2000]);

    const recovers = fakeCrusoe([503, JSON.stringify({ answer: "yes", quote: "field sales meeting" })]);
    expect((await makeJudge(deps(recovers.fetchFn))(COPY, QUESTION)).pass).toBe(true);
  });
});
