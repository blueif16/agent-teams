/*
 * The detector pack's interface (design §6). PLACEHOLDER: finds nothing until the detector pack lands; the rules
 * engine and routes are built against these signatures.
 */
import type { DetectorSummary, Label } from "../types";

export interface Span {
  start: number;
  end: number;
  label: Label;
  /** DetectorSummary.id that found it. */
  detector: string;
}

export interface ScanOptions {
  /** Give up after this many ms (regexes can blow up on hostile input). */
  timeoutMs?: number;
  /** Also ask the hosted TypeSafe Jev provider when its key is configured. */
  hosted?: boolean;
}

/** Labelled spans of sensitive data in `text`. */
export async function scan(text: string, opts: ScanOptions = {}): Promise<Span[]> {
  void text;
  void opts;
  return [];
}

/** The detector sets in the pack, plus hosted providers. */
export function listDetectors(): DetectorSummary[] {
  return [];
}
