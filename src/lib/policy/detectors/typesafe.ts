/*
 * TypeSafe Jev as a hosted second opinion (design §6, Q11), used only when `scan(text, { hosted: true })` and
 * TYPESAFE_API_KEY is set.
 *
 * API (verified with one live call, 2026-10-17): POST https://api.typesafe.ai/v1/systemone,
 * `Authorization: Bearer <key>`, body { model: "jev-latest", state, questions: { <id>: { type: "choice",
 * instructions, criteria: { <option>: <description> } } } } → { model, answers: { <id>: { type: "choice", choice,
 * confidence, probabilities } }, usage: { input_tokens, output_tokens } }. Docs: https://docs.typesafe.ai/api.
 * Jev answers questions; it does not return spans ("TypeSafe picks one of the options you hand it, so the candidates
 * have to be found first", docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook). So we find candidates
 * locally and ask one choice question per candidate, as jev-pii-checker does.
 *
 * Layering rule: the local pack runs first and every local hit is replaced by a placeholder BEFORE the text is sent,
 * so a secret the pack already found never reaches a third party. Retention: TypeSafe's privacy policy says it will
 * not train on Input; its terms state no retention period (zero data retention is enterprise-only), so treat what is
 * sent as retained (https://typesafe.ai/legal/privacy-policy, https://docs.typesafe.ai/legal).
 */
import type { Label } from "../types";
import { createEngine } from "./engine";
import type { Span } from "./index";

export const TYPESAFE_DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const TYPESAFE_DEFAULT_MODEL = "jev-latest";
/** The TypeSafe SDKs default to 10 s. */
export const TYPESAFE_TIMEOUT_MS = 8000;
/** Jev's context is 64k tokens per request; stay well under it. */
const MAX_STATE_CHARS = 100_000;
const MAX_CANDIDATES = 24;
const MIN_CONFIDENCE = 0.5;

/** A subset of process.env (the TypeSafe SDKs' variable names). */
export interface TypesafeEnv {
  [name: string]: string | undefined;
  TYPESAFE_API_KEY?: string;
  TYPESAFE_BASE_URL?: string;
  TYPESAFE_DEFAULT_MODEL?: string;
}

/** The options Jev chooses from, each mapped to our label (null: not sensitive). */
const CRITERIA: Record<string, { description: string; label: Label | null }> = {
  secret: { description: "a password, API key, access token, private key or other credential", label: "secret.generic" },
  person_name: { description: "the name of a specific real person", label: "pii.person" },
  address: { description: "a postal or street address", label: "pii.address" },
  gov_id: { description: "a government-issued identifier such as a passport, driver's license, national ID or tax number", label: "pii.gov_id" },
  account_number: { description: "a bank, card or other financial account number", label: "pii.bank" },
  none: { description: "not sensitive", label: null },
};

/** Labels the provider can return (the rule count shown in listDetectors). */
export const TYPESAFE_LABELS = Object.values(CRITERIA)
  .map((c) => c.label)
  .filter((l): l is Label => l !== null);

export function typesafeConfigured(env: TypesafeEnv = process.env): boolean {
  return Boolean(env.TYPESAFE_API_KEY?.trim());
}

interface Scrubbed {
  text: string;
  /** Copied stretches: [start in scrubbed, end in scrubbed, start in original]. */
  segments: [number, number, number][];
}

/** Replaces each local hit (overlaps merged) with `[[REDACTED_n]]`. */
export function scrub(text: string, spans: Span[]): Scrubbed {
  const merged: [number, number][] = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last[1]) last[1] = Math.max(last[1], s.end);
    else merged.push([s.start, s.end]);
  }
  let out = "";
  let pos = 0;
  const segments: Scrubbed["segments"] = [];
  merged.forEach(([start, end], i) => {
    segments.push([out.length, out.length + (start - pos), pos]);
    out += text.slice(pos, start) + `[[REDACTED_${i + 1}]]`;
    pos = end;
  });
  segments.push([out.length, out.length + (text.length - pos), pos]);
  out += text.slice(pos);
  return { text: out, segments };
}

const engine = createEngine();
const CANDIDATE_PATTERNS: { re: RegExp; group: number; keep?: (s: string) => boolean }[] = [
  // A value assigned to a secret-sounding name the local rules did not recognise.
  { re: /(?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|auth|credential)s?["']?\s*[:=]\s*["']?([^\s"'`,;]{4,128})/gi, group: 1 },
  // A long, high-entropy token with no known prefix.
  { re: /(?<![\w+/=.~-])([A-Za-z0-9+/_=.~-]{20,256})(?![\w+/=.~-])/g, group: 1, keep: (s) => /\d/.test(s) && /[A-Za-z]/.test(s) && engine.entropy(s) >= 3.5 },
  // Two or three capitalised words: a possible name or street.
  { re: /\b([A-Z][a-z]+(?: [A-Z][a-z]+){1,2})\b/g, group: 1 },
  // A run of 8 or more digits: a possible account or ID number.
  { re: /\b(\d(?:[ -]?\d){7,})\b/g, group: 1 },
];

interface Candidate {
  start: number;
  end: number;
  value: string;
}

/** Local candidates in the scrubbed text for Jev to judge; never inside a placeholder. */
export function findCandidates(scrubbed: string): Candidate[] {
  const placeholders = [...scrubbed.matchAll(/\[\[REDACTED_\d+\]\]/g)].map((m) => [m.index, m.index + m[0].length]);
  const found = new Map<string, Candidate>();
  for (const { re, group, keep } of CANDIDATE_PATTERNS) {
    for (const m of scrubbed.matchAll(new RegExp(re.source, `${re.flags.replace("d", "")}d`))) {
      const idx = m.indices?.[group];
      const value = m[group];
      if (!idx || !value || (keep && !keep(value))) continue;
      const [start, end] = idx;
      if (placeholders.some(([a, b]) => start < b && end > a)) continue;
      found.set(`${start}:${end}`, { start, end, value });
    }
  }
  return [...found.values()].sort((a, b) => a.start - b.start).slice(0, MAX_CANDIDATES);
}

function toOriginal(segments: Scrubbed["segments"], start: number, end: number): [number, number] | null {
  const seg = segments.find(([a, b]) => start >= a && end <= b);
  return seg ? [seg[2] + (start - seg[0]), seg[2] + (end - seg[0])] : null;
}

export interface HostedOptions {
  env?: TypesafeEnv;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface HostedResult {
  spans: Span[];
  /** Why the hosted check did not complete; the caller keeps its local spans. */
  degraded?: string;
}

interface ChoiceAnswer {
  type?: unknown;
  choice?: unknown;
  confidence?: unknown;
}

/** Asks Jev about what the local pack left unlabelled. Never throws. */
export async function scanHosted(text: string, localSpans: Span[], opts: HostedOptions = {}): Promise<HostedResult> {
  const env = opts.env ?? process.env;
  const key = env.TYPESAFE_API_KEY?.trim();
  if (!key) return { spans: [], degraded: "TYPESAFE_API_KEY is not set" };
  const scrubbed = scrub(text, localSpans);
  const candidates = findCandidates(scrubbed.text);
  if (candidates.length === 0) return { spans: [] };
  if (scrubbed.text.length > MAX_STATE_CHARS) return { spans: [], degraded: `text over ${MAX_STATE_CHARS} chars, not sent` };

  const criteria = Object.fromEntries(Object.entries(CRITERIA).map(([k, v]) => [k, v.description]));
  const questions = Object.fromEntries(
    candidates.map((c, i) => [`c${i}`, { type: "choice", instructions: `In the text, what kind of data is ${JSON.stringify(c.value)}?`, criteria }]),
  );
  const body = { model: env.TYPESAFE_DEFAULT_MODEL || TYPESAFE_DEFAULT_MODEL, state: { text: scrubbed.text }, questions };
  const base = (env.TYPESAFE_BASE_URL || TYPESAFE_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? TYPESAFE_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let json: unknown;
  try {
    const res = await (opts.fetch ?? fetch)(`${base}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return { spans: [], degraded: `TypeSafe answered HTTP ${res.status}` };
    json = await res.json();
  } catch (e) {
    const aborted = controller.signal.aborted || (e as Error)?.name === "AbortError";
    return { spans: [], degraded: aborted ? `TypeSafe timed out after ${timeoutMs} ms` : `TypeSafe request failed: ${(e as Error)?.message ?? e}` };
  } finally {
    clearTimeout(timer);
  }
  const answers = (json as { answers?: unknown })?.answers;
  if (!answers || typeof answers !== "object") return { spans: [], degraded: "TypeSafe response has no answers" };

  const spans: Span[] = [];
  candidates.forEach((c, i) => {
    const a = (answers as Record<string, ChoiceAnswer>)[`c${i}`];
    if (!a || a.type !== "choice" || typeof a.choice !== "string" || typeof a.confidence !== "number") return;
    const label = CRITERIA[a.choice]?.label;
    if (!label || a.confidence < MIN_CONFIDENCE) return;
    const range = toOriginal(scrubbed.segments, c.start, c.end);
    if (range) spans.push({ start: range[0], end: range[1], label, detector: "typesafe" });
  });
  return { spans };
}
