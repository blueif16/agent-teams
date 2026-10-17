/*
 * The fixed set of Crusoe models we run. Nothing outside this set is called.
 *
 * - main: every agent, leads and workers.
 * - cheap: labeling and status lines.
 * - advisor: an occasional second opinion on hard calls.
 * - vision: where image work goes when the current model can't see, or when a
 *   model that can see fails on it.
 *
 * Text fallbacks run back and forth inside the set: main ↔ advisor. The cheap
 * tier never falls back, because every other model costs more. Vision is
 * routing, not a fallback. See DECISIONS.md.
 */

export const MODELS = {
  main: "deepseek-ai/DeepSeek-V4.1-Flash",
  cheap: "nvidia/Nemotron-3.5-Lightning-30B-A3B",
  advisor: "zai-org/GLM-5.3",
  vision: "nvidia/NVIDIA-Nemotron-3.5-Super-VL",
} as const;

export type Tier = keyof typeof MODELS;

/** Models whose Crusoe deployment accepts `image_url` (each checked with a screenshot, 2026-10-16). */
const SEES_IMAGES = new Set<string>([MODELS.main, MODELS.vision]);

export function canSee(model: string): boolean {
  return SEES_IMAGES.has(model);
}

/** Text-only fallback on a failed call. The cheap tier has none. */
const TEXT_FALLBACK: Record<string, string> = {
  [MODELS.main]: MODELS.advisor,
  [MODELS.advisor]: MODELS.main,
};

/**
 * The models to try for one request, in order.
 * Text: the model, then its fallback if it has one.
 * Images: the model if it can see, then the vision model; a model that can't
 * see goes straight to the vision model.
 */
export function modelChain(model: string, opts: { hasImage?: boolean } = {}): string[] {
  if (opts.hasImage) return canSee(model) && model !== MODELS.vision ? [model, MODELS.vision] : [MODELS.vision];
  const fallback = TEXT_FALLBACK[model];
  return fallback ? [model, fallback] : [model];
}

export function tierOf(model: string): Tier | undefined {
  return (Object.keys(MODELS) as Tier[]).find((t) => MODELS[t] === model);
}

/** Crusoe list prices, USD per 1M tokens (from `GET /v1/models`, 2026-10-16). */
export const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  [MODELS.main]: { input: 0.29, cached: 0.007, output: 1.2 },
  [MODELS.cheap]: { input: 0.05, cached: 0.03, output: 0.2 },
  [MODELS.advisor]: { input: 1.4, cached: 0.26, output: 4.4 },
  [MODELS.vision]: { input: 0.1, cached: 0.08, output: 0.4 },
};

/** Cost of one call; cached input is billed at the cached rate. */
export function costOf(model: string, input: number, cached: number, output: number): number {
  const p = PRICES[model];
  if (!p) return 0;
  return ((input - cached) * p.input + cached * p.cached + output * p.output) / 1e6;
}

/**
 * Per-model request fields that pin reasoning on or off. Pin it explicitly:
 * V4.1 Flash thinks by default, and a reply with a small max_tokens comes back
 * empty after the budget is spent on reasoning.
 */
export function reasoningFields(model: string, think: boolean): Record<string, unknown> {
  if (model.startsWith("nvidia/")) return { chat_template_kwargs: { enable_thinking: think } };
  if (model.startsWith("deepseek-ai/")) return { chat_template_kwargs: { thinking: think } };
  if (model.startsWith("zai-org/")) return { reasoning_effort: think ? "high" : "low" };
  return {};
}
