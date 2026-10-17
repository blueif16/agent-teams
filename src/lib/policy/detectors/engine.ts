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
  /** Shannon entropy in bits per char, as gitleaks computes it. */
  entropy(s: string): number;
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

  // ---- Presidio validators (presidio @ 2523c7b, MIT) ----
  const digitsOf = (s: string) => s.replace(/\D/g, "");

  /** credit_card_recognizer.py `__luhn_checksum`. */
  function luhn(s: string): boolean {
    const digits = digitsOf(s);
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = digits.charCodeAt(digits.length - 1 - i) - 48;
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    return digits.length > 0 && sum % 10 === 0;
  }

  /** iban_patterns.py regex_per_country, in its own shorthand: A letter · C alphanumeric · N digit, with a count. */
  const IBAN_FORMATS: Record<string, string> = {
    AL: "N4 N4 C4 C4 C4 C4", AD: "N4 N4 C4 C4 C4", AT: "N4 N4 N4 N4", AZ: "C4 N4 N4 N4 N4 N4", BH: "A4 C4 C4 C4 C2", BY: "C4 N4 C4 C4 C4 C4", BE: "N4 N4 N4", BA: "N4 N4 N4 N4", BR: "N4 N4 N4 N4 N4 N3 A C", BG: "A4 N4 N N C2 C4 C2", CR: "0 N3 N4 N4 N4 N2", HR: "N4 N4 N4 N4 N", CY: "N4 N4 C4 C4 C4 C4", CZ: "N4 N4 N4 N4 N4", DK: "N4 N4 N4 N2", DO: "A4 N4 N4 N4 N4 N4", TL: "N4 N4 N4 N4 N3", EE: "N4 N4 N4 N4", FO: "N4 N4 N4 N2", FI: "N4 N4 N4 N2", FR: "N4 N4 N2 C2 C4 C4 C N2", GE: "C2 N2 N4 N4 N4 N2", DE: "N4 N4 N4 N4 N2", GI: "A4 C4 C4 C4 C3", GR: "N4 N3 C C4 C4 C4 C3", GL: "N4 N4 N4 N2", GT: "C4 C4 C4 C4 C4 C4", HU: "N4 N4 N4 N4 N4 N4", IS: "N4 N4 N4 N4 N4 N2", IE: "C4 N4 N4 N4 N2", IL: "N4 N4 N4 N4 N3", IT: "A N3 N4 N3 C C3 C C4 C3", JO: "A4 N4 N4 N4 N4 N4 N2", KZ: "N3 C C4 C4 C4", XK: "N4 N4 N4 N4", KW: "A4 C4 C4 C4 C4 C4 C2", LV: "A4 C4 C4 C4 C", LB: "N4 C4 C4 C4 C4 C4", LI: "N4 N C3 C4 C4 C", LT: "N4 N4 N4 N4", LU: "N3 C C4 C4 C4", MT: "A4 N4 N C3 C4 C4 C4 C3", MR: "N4 N4 N4 N4 N4 N3", MU: "A4 N4 N4 N4 N4 N3 A", MD: "C4 C4 C4 C4 C4", MC: "N4 N4 N2 C2 C4 C4 C N2", ME: "N4 N4 N4 N4 N2", NL: "A4 N4 N4 N2", MK: "N3 C C4 C4 C N2", NO: "N4 N4 N3", PK: "C4 N4 N4 N4 N4", PS: "C4 N4 N4 N4 N4 N", PL: "N4 N4 N4 N4 N4 N4", PT: "N4 N4 N4 N4 N", QA: "A4 C4 C4 C4 C4 C", RO: "A4 C4 C4 C4 C4", SM: "A N3 N4 N3 C C4 C4 C3", SA: "N2 C2 C4 C4 C4 C4", RS: "N4 N4 N4 N4 N2", SK: "N4 N4 N4 N4 N4", SI: "N4 N4 N4 N3", ES: "N4 N4 N4 N4 N4", SE: "N4 N4 N4 N4 N4", CH: "N4 N C3 C4 C4 C", TN: "N4 N4 N4 N4 N4", TR: "N4 N C3 C4 C4 C4 C2", AE: "N4 N4 N4 N4 N3", GB: "A4 N4 N4 N4 N2", VA: "N4 N4 N4 N4 N2", VG: "C4 N4 N4 N4 N4", EG: "N4 N4 N4 N4 N4 N4 N", IQ: "A4 N4 N4 N4 N3", LY: "N4 N4 N4 N4 N4 N", LC: "A4 C4 C4 C4 C4 C4 C4", SC: "A4 N4 N4 N4 N4 N4 A3", UA: "N4 N2 C4 C4 C4 C4 C3",
  };
  const IBAN_CLASS: Record<string, string> = { A: "[A-Z]", C: "[a-zA-Z0-9]", N: "[0-9]" };
  const ibanFormat = new Map<string, RegExp>();
  /** iban_recognizer.py `__is_valid_format`: start-anchored only (exact_match is off by default). */
  function ibanFormatOk(iban: string): boolean {
    const cc = iban.slice(0, 2);
    const fmt = IBAN_FORMATS[cc];
    if (!fmt) return false;
    let re = ibanFormat.get(cc);
    if (!re) {
      const body = fmt
        .split(" ")
        .map((t) => (t === "0" ? "[0]" : `(?:${IBAN_CLASS[t[0]]}[ ]?){${t.slice(1) || "1"}}`))
        .join("");
      re = new RegExp(`^(${cc})[0-9]{2}[ ]?${body}`);
      ibanFormat.set(cc, re);
    }
    return re.test(iban);
  }
  /** iban_recognizer.py `validate_result`: mod-97 check digits, then the country format. */
  function iban(s: string): boolean | null {
    const v = s.replace(/[- ]/g, "");
    if (!/^[A-Za-z0-9]{5,}$/.test(v)) return false;
    const moved = (v.slice(4) + v.slice(0, 2) + "00").toUpperCase();
    let rem = 0;
    for (const ch of moved) {
      const n = parseInt(ch, 36);
      rem = n > 9 ? (rem * 100 + n) % 97 : (rem * 10 + n) % 97;
    }
    const check = String(98 - rem).padStart(2, "0");
    if (check !== v.slice(2, 4)) return false;
    if (ibanFormatOk(v)) return true;
    return ibanFormatOk(v.toUpperCase()) ? null : false;
  }

  /** us_ssn_recognizer.py `invalidate_result`, plus areas 900-999 (never issued as SSNs). */
  function usSsn(s: string): boolean | null {
    const delimiters = new Set(s.replace(/[0-9]/g, ""));
    if (delimiters.size > 1) return false;
    const d = digitsOf(s);
    if (/^(\d)\1*$/.test(d)) return false;
    if (d.slice(3, 5) === "00" || d.slice(5) === "0000") return false;
    if (["000", "666"].includes(d.slice(0, 3)) || d[0] === "9") return false;
    if (["123456789", "987654320", "078051120"].includes(d)) return false;
    return null;
  }

  /** ip_recognizer.py `invalidate_result` (Python's ipaddress.ip_interface must parse it). */
  function ip(s: string): boolean | null {
    const [addr, prefix, extra] = s.split("/");
    if (extra !== undefined) return false;
    if (addr.includes(".") && !addr.includes(":")) {
      const parts = addr.split(".");
      if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false;
      return prefix === undefined || (/^\d{1,2}$/.test(prefix) && Number(prefix) <= 32) ? null : false;
    }
    const host = addr.split("%")[0];
    const halves = host.split("::");
    if (halves.length > 2) return false;
    const groups = (h: string) => (h ? h.split(":") : []);
    const all = [...groups(halves[0]), ...(halves.length === 2 ? groups(halves[1]) : [])];
    let count = 0;
    for (let i = 0; i < all.length; i++) {
      const g = all[i];
      if (i === all.length - 1 && g.includes(".")) {
        if (ip(g) === false) return false;
        count += 2;
      } else if (/^[0-9A-Fa-f]{1,4}$/.test(g)) count += 1;
      else return false;
    }
    if (halves.length === 2 ? count > 7 : count !== 8) return false;
    return prefix === undefined || (/^\d{1,3}$/.test(prefix) && Number(prefix) <= 128) ? null : false;
  }

  /**
   * File extensions that follow an `@` in asset names and paths (logo@2x.png, heartbeat@30m.md). None is a TLD except
   * `md` (Moldova), kept here on purpose: in agent text it is a Markdown file far more often than a mail domain.
   */
  const NOT_TLDS = new Set(["md", "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "scss", "less", "json", "yaml", "yml", "toml", "lock", "map", "txt", "html", "htm", "xml", "csv", "pdf", "gz", "tar", "exe", "dll", "wasm"]);
  /** email_recognizer.py `validate_result` asks tldextract for a registrable domain; we ask for a plausible TLD. */
  function email(s: string): boolean {
    const tld = s.slice(s.lastIndexOf(".") + 1).toLowerCase();
    return /^[a-z]{2,63}$/.test(tld) && !NOT_TLDS.has(tld);
  }

  type Groups = Record<string, string | undefined>;
  /** true: validated · false: reject · null: no opinion. */
  const VALIDATORS: Record<string, (secret: string, groups: Groups) => boolean | null> = {
    luhn: (s) => luhn(s),
    iban: (s) => iban(s),
    us_ssn: (s) => usSsn(s),
    ip: (s) => ip(s),
    email: (s) => email(s),
    phone(s) {
      const n = digitsOf(s).length;
      return n >= 7 && n <= 15 ? null : false;
    },
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
      let score = spec.score ?? 1;
      if (spec.validator === "iban") {
        // iban_recognizer.py __analyze_patterns: try the match ending at group 3, then 2, then 1; keep the first that
        // validates, so trailing text the pattern swallowed ("… 013000 2 days") is cut off.
        let found = false;
        for (const gi of [3, 2, 1]) {
          const end = m.indices[gi]?.[1] ?? mEnd;
          if (end <= mStart) continue;
          const verdict = iban(text.slice(mStart, end));
          if (verdict === false) continue;
          if (verdict === true) score = 1;
          sEnd = end;
          found = true;
          break;
        }
        if (!found) continue;
      } else if (spec.secretGroup !== undefined) {
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
      if (spec.validator && spec.validator !== "iban") {
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

  return { prepare, runRule, finalize, entropy: shannon };
}
