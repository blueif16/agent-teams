/*
 * The detector pack's scan engine (design §6, E §3): keyword pre-filter → regex → entropy → validator → allowlist.
 * Types only for now; the engine lands with the pipeline.
 */
import type { Label } from "../types";

/** A checksum or plausibility check a match must pass (Presidio-style validators and secretlint checks). */
export type Validator = "luhn" | "iban" | "us_ssn" | "ip" | "email" | "phone" | "basic_auth" | "db_credential" | "pem_base64";

/** One allowlist (gitleaks semantics): a match it covers is not reported. */
export interface AllowSpec {
  /** "AND": every check present must hold. Default: any one check (OR). */
  condition?: "AND";
  /** What the regexes test: the secret (default), the whole match, or the line around it. */
  target?: "match" | "line";
  regexes?: { source: string; flags: string }[];
  /** Lowercase substrings; tested against the lowercased secret. */
  stopwords?: string[];
}

export interface RuleSpec {
  /** Unique within its detector set, e.g. "aws-access-token". */
  id: string;
  label: Label;
  /** DetectorSummary.id of the set it belongs to. */
  detector: string;
  /** JS RegExp source and flags (without g/d; the engine adds them). */
  source: string;
  flags: string;
  /** Lowercase; the regex only runs when one appears in the lowercased text. Empty: always run. */
  keywords?: string[];
  /** Shannon entropy (bits per char) the secret must exceed. */
  entropy?: number;
  /** Capture group holding the secret (number or name). Default: the first non-empty group, else the match. */
  secretGroup?: number | string;
  allow?: AllowSpec[];
  validator?: Validator;
  /** Presidio-style base score; a span is reported when the final score reaches the pack's threshold. */
  score?: number;
  /** Presidio-style context words: one within the 5 words before the match raises the score. */
  context?: string[];
}
