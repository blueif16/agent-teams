/*
 * Retry and fallback for every agent's model calls (D §7, finding 3).
 *
 * LangChain composes middleware so the first in the list is the outermost layer
 * (langchain dist/agents/utils.js:268). Fallback must therefore come first: the
 * retry inside it gives the primary 4 tries with backoff, and only then does the
 * fallback model get its own 4. The other way round, every first failure went
 * straight to the fallback, doubling 429 traffic.
 *
 * A 429 from Crusoe has no retry-after, so ChatOpenAI throws without retrying
 * (D §9); this retry is what backs off. Each try also waits on the limiter.
 */
import { modelFallbackMiddleware, modelRetryMiddleware } from "langchain";
import { modelChain } from "@/lib/models";

/** What modelFallbackMiddleware accepts: a chat model (or a "provider:model" string). */
export type FallbackModel = Parameters<typeof modelFallbackMiddleware>[number];

/** Crusoe's backoff recipe: about 1 s, doubling, jitter, capped at 30 s (skill file §6). */
const RETRY = { maxRetries: 3, initialDelayMs: 1000, backoffFactor: 2, maxDelayMs: 30_000, jitter: true, onFailure: "error" } as const;

/**
 * The middleware for an agent on `model`: its fixed fallback (models.ts `modelChain`)
 * outside, retry inside. `makeModel` builds the fallback's chat model. The cheap tier
 * has no fallback; with none, the fallback layer just rethrows the retry's error.
 */
export function resilient(model: string, makeModel: (modelId: string) => FallbackModel) {
  const fallbacks = modelChain(model).slice(1).map(makeModel);
  return [modelFallbackMiddleware(...fallbacks), modelRetryMiddleware(RETRY)];
}
