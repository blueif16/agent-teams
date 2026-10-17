/*
 * Scan orchestration behind `scan()`: the local pack over the text.
 */
import { createEngine, type PreparedRule, type RawSpan } from "./engine";
import type { Span } from "./index";
import { PACK_ALLOW, PACK_RULES } from "./pack";

export interface ScanResult {
  spans: Span[];
}

const engine = createEngine();
let prepared: PreparedRule[] | null = null;

export function toSpans(raw: RawSpan[]): Span[] {
  return raw.map(({ start, end, label, detector }) => ({ start, end, label, detector }));
}

export async function scanDetailed(text: string): Promise<ScanResult> {
  prepared ??= engine.prepare(PACK_RULES, PACK_ALLOW);
  const lower = text.toLowerCase();
  const raw = prepared.flatMap((rule) => engine.runRule(rule, text, lower));
  return { spans: toSpans(engine.finalize(raw)) };
}
