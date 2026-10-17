/*
 * Any model in the fixed set (src/lib/models.ts) as a LangChain chat model on
 * Crusoe's OpenAI-compatible API. Reasoning is pinned per call (DECISIONS.md:
 * V4.1 Flash thinks by default, and thinking tokens count against maxTokens).
 *
 * `fetch` sees every HTTP call the model makes, including fallbacks and
 * summarization, so it is where a rate limiter or a privacy scrubber plugs in
 * (research D §7).
 */
import { ChatOpenAI } from "@langchain/openai";
import { reasoningFields } from "@/lib/models";

const DEFAULT_BASE_URL = "https://api.inference.crusoecloud.com/v1";

export type CrusoeOptions = { maxTokens: number; think: boolean; fetch?: typeof fetch };

export function crusoe(model: string, { maxTokens, think, fetch }: CrusoeOptions): ChatOpenAI {
  return new ChatOpenAI({
    model,
    apiKey: process.env.CRUSOE_API_KEY,
    // `||`, not `??`: an empty CRUSOE_BASE_URL= would fall through to api.openai.com.
    configuration: { baseURL: process.env.CRUSOE_BASE_URL || DEFAULT_BASE_URL, fetch },
    maxTokens,
    modelKwargs: reasoningFields(model, think),
  });
}
