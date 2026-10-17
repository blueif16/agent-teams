/*
 * Test fixture: Crusoe's OpenAI-compatible chat completions API, in-process. Hand it to
 * `crusoe(model, { fetch })` and the real ChatOpenAI client talks to a script: every request body is
 * recorded, and each reply is the next scripted turn, as JSON or as an SSE stream when the request asks
 * for `stream: true` (agent.stream with "messages" does). Not imported by app code.
 */

export interface ToolCallSpec {
  name: string;
  args: Record<string, unknown>;
}

/** One model reply: text, tool calls, or both. */
export interface Turn {
  text?: string;
  toolCalls?: ToolCallSpec[];
  /** Usage to report; default: input ≈ body length / 4 with half of it cached, output ≈ text length / 4. */
  usage?: { input: number; cached: number; output: number };
}

export interface ChatRequest {
  model: string;
  stream?: boolean;
  messages: { role: string; content: unknown; tool_calls?: unknown[]; tool_call_id?: string }[];
  tools?: { type: string; function: { name: string } }[];
  [key: string]: unknown;
}

/** A turn, or a function of the request (to answer a summarization call differently, say). */
export type Step = Turn | ((req: ChatRequest) => Turn | Promise<Turn>);

export interface FakeCrusoe {
  fetch: typeof fetch;
  /** Every request body, in order. */
  requests: ChatRequest[];
  /** Append more steps. */
  push(...steps: Step[]): void;
}

/** The text of a message's content (a string or OpenAI content parts). */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p && typeof p === "object" && "text" in p ? String(p.text) : "")).join("");
  return "";
}

let ids = 0;

/** Past the end of the script every call answers "Done." */
export function fakeCrusoe(steps: Step[] = []): FakeCrusoe {
  const script = [...steps];
  const requests: ChatRequest[] = [];

  const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body ?? "{}")) as ChatRequest;
    requests.push(req);
    const step = script.shift() ?? { text: "Done." };
    const turn = typeof step === "function" ? await step(req) : step;
    const id = `chatcmpl-${++ids}`;
    const text = turn.text ?? "";
    const calls = (turn.toolCalls ?? []).map((c, i) => ({
      index: i,
      id: `call_${ids}_${i}`,
      type: "function" as const,
      function: { name: c.name, arguments: JSON.stringify(c.args) },
    }));
    const promptTokens = turn.usage?.input ?? Math.max(1, Math.ceil(String(init?.body ?? "").length / 4));
    const usage = {
      prompt_tokens: promptTokens,
      completion_tokens: turn.usage?.output ?? Math.max(1, Math.ceil((text.length + JSON.stringify(calls).length) / 4)),
      total_tokens: 0,
      prompt_tokens_details: { cached_tokens: turn.usage?.cached ?? Math.floor(promptTokens / 2) },
    };
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    const finish = calls.length ? "tool_calls" : "stop";
    const base = { id, created: 0, model: req.model };
    const headers = { "x-ratelimit-remaining-requests": "29", "x-ratelimit-remaining-tokens": "499000" };

    if (!req.stream) {
      const message = { role: "assistant", content: text, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: c.type, function: c.function })) } : {}) };
      return Response.json({ ...base, object: "chat.completion", choices: [{ index: 0, message, finish_reason: finish }], usage }, { headers });
    }

    // Stream: the text in a few pieces, then each tool call whole, then the finish and the usage chunk.
    const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
      `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    const parts: string[] = [chunk({ role: "assistant", content: "" })];
    for (let i = 0; i < text.length; i += 8) parts.push(chunk({ content: text.slice(i, i + 8) }));
    for (const c of calls) parts.push(chunk({ tool_calls: [c] }));
    parts.push(chunk({}, finish));
    parts.push(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [], usage })}\n\n`);
    parts.push("data: [DONE]\n\n");
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const p of parts) controller.enqueue(encoder.encode(p));
        controller.close();
      },
    });
    return new Response(body, { headers: { ...headers, "content-type": "text/event-stream" } });
  }) as typeof globalThis.fetch;

  return { fetch, requests, push: (...more) => script.push(...more) };
}

/** The system prompt a request carried. */
export function systemOf(req: ChatRequest): string {
  return req.messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
}
