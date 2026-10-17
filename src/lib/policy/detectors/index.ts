/*
 * The detector pack's interface (design §6): labelled spans of secrets and PII in text.
 * Local pack: vendored gitleaks rules, three secretlint rules and six Presidio recognizer ports; TypeSafe Jev when
 * `hosted` is set and its key is configured. The rules engine and routes import these signatures.
 */
import type { DetectorSummary, Label } from "../types";
import { GITLEAKS_COMMIT, GITLEAKS_RULES } from "./gitleaks.gen";
import { scanDetailed } from "./pipeline";
import { PRESIDIO_COMMIT, PRESIDIO_RECOGNIZERS } from "./presidio";
import { SECRETLINT_COMMIT, SECRETLINT_RULES } from "./secretlint";
import { TYPESAFE_LABELS, typesafeConfigured } from "./typesafe";

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
  try {
    return (await scanDetailed(text, opts)).spans;
  } catch {
    return [];
  }
}

/** The detector sets in the pack, plus hosted providers. */
export function listDetectors(): DetectorSummary[] {
  return [
    {
      id: "gitleaks",
      name: "gitleaks secret rules",
      kind: "secret",
      rules: GITLEAKS_RULES.length,
      source: `https://github.com/gitleaks/gitleaks/blob/${GITLEAKS_COMMIT}/config/gitleaks.toml`,
      license: "MIT",
    },
    {
      id: "secretlint",
      name: "secretlint rules (connection strings, basic auth, private keys)",
      kind: "secret",
      rules: SECRETLINT_RULES.length,
      source: `https://github.com/secretlint/secretlint/tree/${SECRETLINT_COMMIT}/packages/@secretlint`,
      license: "MIT",
    },
    {
      id: "presidio-ports",
      name: "Presidio PII recognizers (TypeScript ports)",
      kind: "pii",
      rules: PRESIDIO_RECOGNIZERS.length,
      source: `https://github.com/microsoft/presidio/tree/${PRESIDIO_COMMIT}/presidio-analyzer/presidio_analyzer/predefined_recognizers`,
      license: "MIT",
    },
    {
      id: "typesafe",
      name: "TypeSafe Jev (hosted)",
      kind: "pii",
      rules: TYPESAFE_LABELS.length,
      source: "https://docs.typesafe.ai/api",
      license: "Proprietary hosted API (TypeSafe terms)",
      configured: typesafeConfigured(),
    },
  ];
}
