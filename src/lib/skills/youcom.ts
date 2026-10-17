/*
 * A minimal You.com Research API client (docs/design/team-setup.md §3b), checked against
 * https://you.com/docs/api-reference/research/v1-research and https://you.com/docs/administration/billing
 * on 2026-10-17:
 *   POST https://api.you.com/v1/research, header X-API-Key, body { input, research_effort, output_schema?,
 *   source_control?, background? } → { output: { content, content_type: "text" | "object", sources[] }, warnings[] }.
 * Synchronous only: `deep` takes up to 120 s, so the timeout sits above that. Background mode (needed for
 * `frontier`) isn't wired yet. Server only; the key never leaves this module.
 */

export const RESEARCH_URL = "https://api.you.com/v1/research";

export type ResearchEffort = "lite" | "standard" | "deep" | "exhaustive" | "frontier";

/** List price per call in USD ($12 · $50 · $100 · $450 · $1,200 per 1k calls), for cost reporting. */
export const RESEARCH_PRICE_USD: Record<ResearchEffort, number> = {
  lite: 0.012,
  standard: 0.05,
  deep: 0.1,
  exhaustive: 0.45,
  frontier: 1.2,
};

/** Sent as is (You.com's field names). include_domains can't be combined with exclude_ or boost_domains. */
export interface SourceControl {
  include_domains?: string[];
  exclude_domains?: string[];
  boost_domains?: string[];
  /** "day" | "week" | "month" | "year" | "YYYY-MM-DDtoYYYY-MM-DD" */
  freshness?: string;
  /** Two-letter country code, e.g. "US". */
  country?: string;
}

export interface ResearchRequest {
  /** ≤ 40,000 characters. */
  input: string;
  /** Default "standard", like the API. */
  effort?: ResearchEffort;
  /** JSON Schema subset: root object, every object `additionalProperties: false`, every property required. */
  outputSchema?: Record<string, unknown>;
  sourceControl?: SourceControl;
}

export interface ResearchSource {
  url: string;
  title?: string;
  snippets?: string[];
}

/** The 200 body of a synchronous call. */
export interface ResearchResponse {
  output: { content: string | Record<string, unknown>; content_type: "text" | "object"; sources: ResearchSource[] };
  warnings: string[];
}

export interface ResearchResult {
  /** Markdown with [[n]] citations, or the object matching `outputSchema`. */
  content: string | Record<string, unknown>;
  contentType: "text" | "object";
  sources: ResearchSource[];
  warnings: string[];
  effort: ResearchEffort;
  /** List price of the call. */
  costUsd: number;
  latencyMs: number;
}

export type Research = (req: ResearchRequest) => Promise<ResearchResult>;

export interface ResearchOptions {
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export function createResearch({ apiKey = process.env.YDC_API_KEY, fetch = globalThis.fetch, timeoutMs = 150_000 }: ResearchOptions = {}): Research {
  return async ({ input, effort = "standard", outputSchema, sourceControl }) => {
    if (!apiKey) throw new Error("You.com research: set YDC_API_KEY");
    // Both return 422 from You.com; refuse before spending a round trip.
    if (outputSchema && effort === "lite") throw new Error("You.com research: output_schema doesn't work with lite");
    if (effort === "frontier") throw new Error("You.com research: frontier needs background mode, which isn't supported here");

    const body: Record<string, unknown> = { input, research_effort: effort };
    if (outputSchema) body.output_schema = outputSchema;
    if (sourceControl) body.source_control = sourceControl;

    const started = performance.now();
    const res = await fetch(RESEARCH_URL, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { detail?: unknown };
        if (parsed.detail !== undefined) detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail).slice(0, 300);
      } catch {
        // not JSON: keep the raw text
      }
      throw new Error(`You.com research ${res.status}: ${detail}`);
    }
    const data = JSON.parse(text) as ResearchResponse;
    return {
      content: data.output.content,
      contentType: data.output.content_type,
      sources: data.output.sources ?? [],
      warnings: data.warnings ?? [],
      effort,
      costUsd: RESEARCH_PRICE_USD[effort],
      latencyMs: Math.round(performance.now() - started),
    };
  };
}
