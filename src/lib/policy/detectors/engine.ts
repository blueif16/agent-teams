/*
 * The detector pack's scan engine (design §6, E §3): keyword pre-filter → regex → entropy → validator → allowlist.
 *
 * `createEngine` is self-contained (it references nothing outside its own body), because the worker that runs scans
 * is started from its source text (`createEngine.toString()`), so no bundler has to resolve a worker file.
 * The match semantics follow gitleaks detect/detect.go @ b58d3f1 (MIT): the secret is `secretGroup`, else the first
 * non-empty capture group, else the match; entropy must exceed the rule's; global then rule allowlists; a generic
 * finding yields to a provider finding that contains it.
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
  /** Capture group holding the secret (number or name; 0 = the whole match). Default: the first non-empty group, else the match. */
  secretGroup?: number | string;
  allow?: AllowSpec[];
  validator?: Validator;
  /** Presidio-style base score; a span is reported when the final score reaches MIN_SCORE. */
  score?: number;
  /** Presidio-style context words: one inside the 5 words before the match raises the score. */
  context?: string[];
}

/** Allowlists that apply to every rule of a detector set (gitleaks' global allowlist, the pack's own heuristics). */
export type SetAllowlists = Record<string, AllowSpec[]>;

/** A span plus the rule that found it (the public Span drops `rule`). */
export interface RawSpan {
  start: number;
  end: number;
  label: Label;
  detector: string;
  rule: string;
}

export interface Engine {
  prepare(rules: RuleSpec[], setAllow: SetAllowlists): PreparedRule[];
  /** Runs one rule over `text` (`lower` = text.toLowerCase()). */
  runRule(rule: PreparedRule, text: string, lower: string): RawSpan[];
  /** Dedupes and applies precedence; returns spans sorted by position. */
  finalize(spans: RawSpan[]): RawSpan[];
}

export interface PreparedRule {
  spec: RuleSpec;
  re: RegExp;
  allow: { condition?: "AND"; target?: "match" | "line"; regexes: RegExp[]; stopwords: string[] }[];
}

export function createEngine(): Engine {
  /** Presidio: a pattern result is reported from this score up (after validation and context). */
  const MIN_SCORE = 0.5;
  /** Presidio LemmaContextAwareEnhancer defaults: +0.35, floor 0.4, 5 words before, substring match. */
  const CONTEXT_BOOST = 0.35;
  const CONTEXT_FLOOR = 0.4;
  const CONTEXT_WORDS_BEFORE = 5;

  function shannon(s: string): number {
    if (!s) return 0;
    const counts = new Map<string, number>();
    const chars = [...s];
    for (const c of chars) counts.set(c, (counts.get(c) ?? 0) + 1);
    let h = 0;
    for (const n of counts.values()) {
      const p = n / chars.length;
      h -= p * Math.log2(p);
    }
    return h;
  }

  // ---- secretlint checks (secretlint @ 92f0b0c, MIT) ----
  const TEMPLATE_VARS = [/\$\{[^}]{1,50}\}/, /\{\{[^}]{1,50}\}\}/, /\{[^}]{1,50}\}/, /%[A-Z_]{1,30}%/, /\$[A-Z_]{1,30}/, /\$\([^)]{1,50}\)/];
  const isTemplate = (s: string) => TEMPLATE_VARS.some((p) => p.test(s));
  const BASIC_AUTH_IGNORED = ["localhost", "127.0.0.1", "password", "mypassword", "myusername", "{password}", "${password}", "{{password}}", "{username}", "${username}", "{{username}}", "your_password", "your_username", "replace_with_password", "replace_with_username"];
  const DB_IGNORED = ["localhost", "127.0.0.1", "example.com", "example.org", "test.com", "password", "username", "secret", "mypassword", "myusername", "root", "admin", "user", "pass", "{password}", "${password}", "{{password}}", "{username}", "${username}", "{{username}}", "your_password", "your_username", "replace_with_password"];

  type Groups = Record<string, string | undefined>;
  /** true: validated · false: reject · null: no opinion. */
  const VALIDATORS: Record<string, (secret: string, groups: Groups) => boolean | null> = {
    basic_auth(_secret, g) {
      const user = g.user ?? "";
      const pass = g.password ?? "";
      const lowerIgnored = (s: string) => BASIC_AUTH_IGNORED.some((p) => s.toLowerCase().includes(p));
      if (user.length < 2 || isTemplate(user) || lowerIgnored(user)) return false;
      if (pass.length < 4 || isTemplate(pass) || lowerIgnored(pass) || /^(.)\1{3,}$/.test(pass)) return false;
      return null;
    },
    db_credential(_secret, g) {
      const user = g.username ?? "";
      const pass = g.password ?? "";
      if (!user || !pass || user === pass || pass.length < 4 || isTemplate(pass)) return false;
      if (DB_IGNORED.includes(pass.toLowerCase()) || /^(.)\1{3,}$/.test(pass)) return false;
      return null;
    },
    pem_base64(_secret, g) {
      const body = (g.body ?? "").replace(/\s|\\n/g, "");
      return /^[A-Za-z0-9+/]+=*$/.test(body) && body.length >= 100 && /^(MI|b3BlbnNzaC1rZXktdjE)/.test(body) ? null : false;
    },
  };

  function compile(source: string, flags: string): RegExp {
    return new RegExp(source, flags);
  }

  function prepare(rules: RuleSpec[], setAllow: SetAllowlists): PreparedRule[] {
    const prepAllow = (list: AllowSpec[] | undefined) =>
      (list ?? []).map((a) => ({
        condition: a.condition,
        target: a.target,
        regexes: (a.regexes ?? []).map((r) => compile(r.source, r.flags)),
        stopwords: a.stopwords ?? [],
      }));
    const bySet = new Map<string, PreparedRule["allow"]>();
    for (const [set, list] of Object.entries(setAllow)) bySet.set(set, prepAllow(list));
    return rules.map((spec) => ({
      spec,
      re: compile(spec.source, `${spec.flags.replace(/[gdy]/g, "")}dg`),
      allow: [...(bySet.get(spec.detector) ?? []), ...prepAllow(spec.allow)],
    }));
  }

  function allowed(rule: PreparedRule, secret: string, match: string, line: string): boolean {
    const lowerSecret = secret.toLowerCase();
    for (const a of rule.allow) {
      const target = a.target === "match" ? match : a.target === "line" ? line : secret;
      const regexHit = a.regexes.some((r) => r.test(target));
      const stopHit = a.stopwords.some((w) => lowerSecret.includes(w));
      if (a.condition === "AND") {
        const checks: boolean[] = [];
        if (a.regexes.length) checks.push(regexHit);
        if (a.stopwords.length) checks.push(stopHit);
        if (checks.length && checks.every(Boolean)) return true;
      } else if (regexHit || stopHit) return true;
    }
    return false;
  }

  function contextHit(words: string[], text: string, start: number): boolean {
    const before = text.slice(Math.max(0, start - 200), start).toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const window = before.slice(-CONTEXT_WORDS_BEFORE);
    return window.some((w) => words.some((c) => w.includes(c)));
  }

  function runRule(rule: PreparedRule, text: string, lower: string): RawSpan[] {
    const { spec, re } = rule;
    if (spec.keywords?.length && !spec.keywords.some((k) => lower.includes(k))) return [];
    const out: RawSpan[] = [];
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (!m[0] || !m.indices) continue;
      let mStart = m.index;
      let mEnd = m.index + m[0].length;
      while (mStart < mEnd && text[mStart] === "\n") mStart++;
      while (mEnd > mStart && text[mEnd - 1] === "\n") mEnd--;
      let sStart = mStart;
      let sEnd = mEnd;
      if (spec.secretGroup !== undefined) {
        const idx = typeof spec.secretGroup === "number" ? m.indices[spec.secretGroup] : m.indices.groups?.[spec.secretGroup];
        if (!idx) continue;
        if (spec.secretGroup !== 0) [sStart, sEnd] = idx;
      } else {
        for (let gi = 1; gi < m.length; gi++) {
          const idx = m.indices[gi];
          if (m[gi] && idx) {
            [sStart, sEnd] = idx;
            break;
          }
        }
      }
      const secret = text.slice(sStart, sEnd);
      if (spec.entropy !== undefined && shannon(secret) <= spec.entropy) continue;
      let score = spec.score ?? 1;
      if (spec.validator) {
        const verdict = VALIDATORS[spec.validator](secret, (m.groups ?? {}) as Groups);
        if (verdict === false) continue;
        if (verdict === true) score = 1;
      }
      if (score < 1 && spec.context?.length && contextHit(spec.context, text, sStart)) {
        score = Math.min(1, Math.max(score + CONTEXT_BOOST, CONTEXT_FLOOR));
      }
      if (score < MIN_SCORE) continue;
      const lineStart = text.lastIndexOf("\n", mStart - 1) + 1;
      const nl = text.indexOf("\n", mEnd);
      const line = text.slice(lineStart, nl < 0 ? text.length : nl);
      if (allowed(rule, secret, text.slice(mStart, mEnd), line)) continue;
      out.push({ start: sStart, end: sEnd, label: spec.label, detector: spec.detector, rule: spec.id });
    }
    return out;
  }

  function finalize(spans: RawSpan[]): RawSpan[] {
    const seen = new Set<string>();
    const unique = spans.filter((s) => {
      const key = `${s.start}:${s.end}:${s.label}:${s.detector}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const covers = (a: RawSpan, b: RawSpan) => a !== b && a.start <= b.start && a.end >= b.end;
    const kept = unique.filter((s) => {
      // gitleaks filter(): a generic finding yields to a provider finding whose secret contains it.
      if (s.rule.includes("generic") && unique.some((t) => !t.rule.includes("generic") && t.label.startsWith("secret.") && covers(t, s))) return false;
      // Presidio remove_duplicates: a span inside another of the same label and set is the same finding.
      return !unique.some((t) => t.label === s.label && t.detector === s.detector && covers(t, s) && (t.start !== s.start || t.end !== s.end));
    });
    return kept.sort((a, b) => a.start - b.start || a.end - b.end || a.label.localeCompare(b.label) || a.detector.localeCompare(b.detector));
  }

  return { prepare, runRule, finalize };
}
