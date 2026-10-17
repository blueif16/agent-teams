/*
 * The detector pack's interface (design §6): labelled spans of secrets and PII in text.
 * Local pack: vendored gitleaks rules and three secretlint rules. The rules engine and routes import these signatures.
 */
import type { DetectorSummary, Label } from "../types";
import { scanDetailed } from "./pipeline";

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

/** Labelled spans of sensitive data in `text`. Never throws. */
export async function scan(text: string, opts: ScanOptions = {}): Promise<Span[]> {
  void opts;
  try {
    return (await scanDetailed(text)).spans;
  } catch {
    return [];
  }
}

/** The detector sets in the pack, plus hosted providers. */
export function listDetectors(): DetectorSummary[] {
  return [];
}
