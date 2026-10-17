/*
 * The simulated owner's model calls (docs/design/test-mode.md §3, §6). Code decides everything else; the only
 * model call here is the judge: one yes/no rubric question about one deliverable, at temperature 0, seeing only
 * the deliverable text and the question. A "yes" counts only with a quote found verbatim in the text, so a judge
 * that invents support gives no verdict instead of a pass. On a 429/503 it retries twice with backoff, then gives
 * no verdict (pass: null), which the driver and the claims treat as "not judged".
 *
 * The owner's reply wording (makePhrase) is out of scope for now: without it the driver answers every question
 * with the scenario's unknownReply, which never invents a requirement.
 */
import { reasoningFields } from "@/lib/models";
import type { Judge } from "@/lib/sim/driver";
import * as z from "zod";

export interface LlmDeps {
  fetch: typeof fetch;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
}

// `||`, not `??`: an empty CRUSOE_BASE_URL= must not become the base URL.
const baseUrl = (deps: LlmDeps) => deps.baseUrl || process.env.CRUSOE_BASE_URL || "https://api.inference.crusoecloud.com/v1";
const RETRIES = 2;

// ---------- the prompt (agent-facing; a contract for a literal executor) ----------

export const JUDGE_SYSTEM = `<role>
You are a strict reviewer checking one deliverable against one yes/no question. You answer only from the text you
are given: never from what the text might mean to say, what a reader could infer, or what a good deliverable
would contain.
</role>

<output_spec>
Return ONE JSON object and nothing else: no prose, no markdown fence.
{"answer": "yes" | "no", "quote": "..."}
- answer: "yes" only if the text itself plainly satisfies the question; otherwise "no".
- quote: for "yes", the shortest passage copied character for character from the text that shows it (one sentence
  or line, at most 200 characters). For "no", the passage that comes closest, or "" if nothing does.
</output_spec>

<the_bar>
- A "yes" needs a quote that appears verbatim in the text. If you can't copy such a passage, the answer is "no".
- Partial, implied or promised content is "no" (e.g. the question asks for a price and the text says "pricing
  coming soon").
- Judge only the question asked; ignore every other quality of the text.
</the_bar>

<self_check>
Before returning: find your quote in the text, character for character. If it isn't there, change the answer to
"no" with quote "". Then return the JSON object only.
</self_check>`;

const judgeMessage = (text: string, question: string) => `<question>
${question}
</question>

<deliverable>
${text}
</deliverable>

<output_only>One JSON object {"answer": "yes" | "no", "quote": "..."}, the quote copied verbatim from <deliverable>.</output_only>`;

const JudgeOutput = z.object({ answer: z.enum(["yes", "no"]), quote: z.string() });

// ---------- the call ----------

/** One chat completion's content, retrying 429/503 twice with backoff; null on any failure. */
async function complete(deps: LlmDeps, system: string, user: string, maxTokens: number): Promise<string | null> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await deps.fetch(`${baseUrl(deps)}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${deps.apiKey ?? process.env.CRUSOE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: deps.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0,
          stream: false,
          max_tokens: maxTokens,
          ...reasoningFields(deps.model, false),
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      return null;
    }
    if ((res.status === 429 || res.status === 503) && attempt < RETRIES) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string | null } }[] } | null;
    return body?.choices?.[0]?.message?.content ?? null;
  }
}

/** The JSON object in a reply, tolerating a ```json fence around it. */
function parseJson(content: string): unknown {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(content);
  try {
    return JSON.parse(m ? m[1] : content.trim());
  } catch {
    return null;
  }
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export function makeJudge(deps: LlmDeps): Judge {
  return async (text, question) => {
    const content = await complete(deps, JUDGE_SYSTEM, judgeMessage(text, question), 400);
    const out = JudgeOutput.safeParse(content === null ? null : parseJson(content));
    if (!out.success) return { pass: null, quote: "" };
    const { answer, quote } = out.data;
    if (answer === "no") return { pass: false, quote };
    // A yes must point at the text; an invented quote is no verdict at all.
    return quote.trim() && squash(text).includes(squash(quote)) ? { pass: true, quote } : { pass: null, quote };
  };
}
