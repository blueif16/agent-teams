/*
 * Converts the vendored gitleaks rules into a TypeScript data file the detector pack loads.
 *
 *   node scripts/policy/import-gitleaks.mts      (or: npm run policy:import-gitleaks)
 *
 * Input:  scripts/policy/vendor/gitleaks.toml, verbatim from gitleaks `config/gitleaks.toml` @ GITLEAKS_COMMIT
 *         (MIT, Copyright (c) 2019 Zachary Rice; see LICENSES/gitleaks.txt).
 * Output: src/lib/policy/detectors/gitleaks.gen.ts
 *
 * Go RE2 → JS RegExp fixes (docs/research/E-privacy.md §3): a leading `(?i)` becomes the `i` flag; a mid-pattern
 * `(?i)` becomes a scoped `(?i:…)` over the rest of its group; `\z` → `$`; `\A` → `^`; `(?P<` → `(?<`; POSIX
 * bracket classes are expanded. A rule that still fails to compile is dropped and listed in GITLEAKS_DROPPED, and
 * so is a rule that only fires on a file path (scans see free text, never a path).
 *
 * The TOML parser covers the subset gitleaks.toml uses (tables, arrays of tables, strings, numbers, arrays), so the
 * import needs no dependency.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AllowSpec, RuleSpec } from "../../src/lib/policy/detectors/engine.ts";

export const GITLEAKS_COMMIT = "b58d3f102cf3a2c84cb7f923d05c25c9b1aed84b";
const VENDOR = new URL("./vendor/gitleaks.toml", import.meta.url);
const OUTPUT = new URL("../../src/lib/policy/detectors/gitleaks.gen.ts", import.meta.url);

// ---------- Go regex → JS ----------

const POSIX: Record<string, string> = {
  alnum: "a-zA-Z0-9",
  alpha: "a-zA-Z",
  digit: "0-9",
  xdigit: "0-9A-Fa-f",
  upper: "A-Z",
  lower: "a-z",
  space: "\\t\\n\\v\\f\\r ",
  word: "\\w",
  punct: "!-\\/:-@\\[-`{-~",
};

interface Frame {
  /** A mid-pattern flag group is open in this group and must close before `|` or `)`. */
  scoped: string | null;
}

/** Rewrites a Go RE2 pattern into a JS RegExp source + flags. Throws on a construct it can't port. */
export function convertGoRegex(src: string): { source: string; flags: string } {
  let flags = "";
  let s = src;
  const lead = /^\(\?([ims]+)\)/.exec(s);
  if (lead) {
    flags = [...new Set(lead[1])].sort().join("");
    s = s.slice(lead[0].length);
  }
  let out = "";
  const stack: Frame[] = [{ scoped: null }];
  let inClass = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      const n = s[i + 1];
      if (!inClass && n === "z") out += "$";
      else if (!inClass && n === "A") out += "^";
      else out += c + (n ?? "");
      i++;
      continue;
    }
    if (inClass) {
      const posix = /^\[:(\^?)([a-z]+):\]/.exec(s.slice(i));
      if (posix) {
        if (posix[1] || !POSIX[posix[2]]) throw new Error(`unsupported POSIX class ${posix[0]}`);
        out += POSIX[posix[2]];
        i += posix[0].length - 1;
        continue;
      }
      if (c === "]") inClass = false;
      out += c;
      continue;
    }
    if (c === "[") {
      inClass = true;
      out += c;
      if (s[i + 1] === "^") out += s[++i];
      // RE2 reads a ] right after [ or [^ as a literal; JS reads [] as empty and [^] as any char.
      if (s[i + 1] === "]") {
        out += "\\]";
        i++;
      }
      continue;
    }
    if (c === "(") {
      const rest = s.slice(i);
      const inline = /^\(\?([ims]+)\)/.exec(rest);
      if (inline) {
        // Flags already on here (globally, or from an earlier (?i) in this or an enclosing group) are redundant.
        const active = flags + stack.map((f) => f.scoped ?? "").join("");
        const add = [...new Set(inline[1])].filter((f) => !active.includes(f)).sort().join("");
        if (add) {
          const frame = stack[stack.length - 1];
          if (frame.scoped) throw new Error("nested mid-pattern flags");
          frame.scoped = add;
          out += `(?${add}:`;
        }
        i += inline[0].length - 1;
        continue;
      }
      if (/^\(\?[a-zA-Z-]*\)/.test(rest)) throw new Error(`unsupported inline flags ${rest.slice(0, 6)}`);
      if (rest.startsWith("(?P<")) {
        out += "(?<";
        i += 3;
      } else out += c;
      stack.push({ scoped: null });
      continue;
    }
    if (c === "|") {
      const frame = stack[stack.length - 1];
      out += frame.scoped ? `)|(?${frame.scoped}:` : "|";
      continue;
    }
    if (c === ")") {
      const frame = stack.pop();
      if (!frame || stack.length === 0) throw new Error("unbalanced )");
      if (frame.scoped) out += ")";
      out += c;
      continue;
    }
    out += c;
  }
  if (inClass || stack.length !== 1) throw new Error("unterminated class or group");
  if (stack[0].scoped) out += ")";
  return { source: out, flags };
}

// ---------- TOML subset ----------

type TomlValue = string | number | boolean | TomlValue[] | { [k: string]: TomlValue };
type TomlTable = { [k: string]: TomlValue };

/** Parses the TOML subset gitleaks.toml uses. Throws with a line number on anything else. */
export function parseToml(text: string): TomlTable {
  const root: TomlTable = {};
  let current: TomlTable = root;
  let i = 0;
  const line = () => text.slice(0, i).split("\n").length;
  const fail = (msg: string): never => {
    throw new Error(`TOML line ${line()}: ${msg}`);
  };
  const skip = (newlines: boolean) => {
    for (;;) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\r" || (newlines && c === "\n")) i++;
      else if (c === "#") while (i < text.length && text[i] !== "\n") i++;
      else return;
    }
  };
  const basic = (): string => {
    let v = "";
    for (i++; ; i++) {
      const c = text[i];
      if (c === undefined || c === "\n") fail("unterminated string");
      if (c === '"') {
        i++;
        return v;
      }
      if (c === "\\") {
        const n = text[++i];
        const esc: Record<string, string> = { '"': '"', "\\": "\\", n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
        if (n in esc) v += esc[n];
        else if (n === "u" || n === "U") {
          const len = n === "u" ? 4 : 8;
          v += String.fromCodePoint(parseInt(text.slice(i + 1, i + 1 + len), 16));
          i += len;
        } else fail(`bad escape \\${n}`);
      } else v += c;
    }
  };
  const value = (): TomlValue => {
    if (text.startsWith("'''", i)) {
      const end = text.indexOf("'''", i + 3);
      if (end < 0) fail("unterminated '''");
      let v = text.slice(i + 3, end);
      if (v.startsWith("\n")) v = v.slice(1);
      i = end + 3;
      return v;
    }
    const c = text[i];
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      const v = text.slice(i + 1, end);
      if (end < 0 || v.includes("\n")) fail("unterminated '");
      i = end + 1;
      return v;
    }
    if (c === '"') {
      if (text.startsWith('"""', i)) fail('""" strings are not supported');
      return basic();
    }
    if (c === "[") {
      i++;
      const arr: TomlValue[] = [];
      for (;;) {
        skip(true);
        if (text[i] === "]") {
          i++;
          return arr;
        }
        arr.push(value());
        skip(true);
        if (text[i] === ",") i++;
        else if (text[i] !== "]") fail("expected , or ]");
      }
    }
    const lit = /^(?:true|false|[+-]?\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i, i + 64));
    if (!lit) return fail("unsupported value");
    i += lit[0].length;
    if (lit[0] === "true" || lit[0] === "false") return lit[0] === "true";
    return Number(lit[0].replace(/_/g, ""));
  };
  const walk = (path: string[]): TomlTable => {
    let t: TomlTable = root;
    for (const seg of path) {
      let next = t[seg];
      if (next === undefined) next = t[seg] = {};
      if (Array.isArray(next)) next = next[next.length - 1];
      if (typeof next !== "object" || next === null || Array.isArray(next)) fail(`not a table: ${seg}`);
      t = next as TomlTable;
    }
    return t;
  };
  for (;;) {
    skip(true);
    if (i >= text.length) return root;
    if (text.startsWith("[[", i)) {
      const end = text.indexOf("]]", i);
      const path = text.slice(i + 2, end).trim().split(".");
      i = end + 2;
      const parent = walk(path.slice(0, -1));
      const key = path[path.length - 1];
      const arr = (parent[key] ??= []);
      if (!Array.isArray(arr)) fail(`not an array of tables: ${key}`);
      current = {};
      (arr as TomlValue[]).push(current);
    } else if (text[i] === "[") {
      const end = text.indexOf("]", i);
      const path = text.slice(i + 1, end).trim().split(".");
      i = end + 1;
      current = walk(path);
    } else {
      const key = /^[A-Za-z0-9_-]+/.exec(text.slice(i, i + 128))?.[0] ?? fail("expected a key");
      i += key.length;
      skip(false);
      if (text[i] !== "=") fail("expected =");
      i++;
      skip(false);
      current[key] = value();
    }
    skip(false);
    if (i < text.length && text[i] !== "\n") fail("expected end of line");
  }
}

// ---------- rules ----------

/** Rule ids whose first word is not the provider. */
const LABEL_OVERRIDES: [prefix: string, kind: string][] = [
  ["private-key", "private_key"],
  ["new-relic-", "new_relic"],
  ["defined-networking-", "defined_networking"],
  ["octopus-deploy-", "octopus_deploy"],
  ["curl-", "credential"],
];

/** `secret.<kind>` (E §4.1): the provider for vendor rules, `generic`, `jwt`, `private_key`, `credential`. */
export function labelFor(id: string): string {
  const override = LABEL_OVERRIDES.find(([prefix]) => id.startsWith(prefix));
  return `secret.${override ? override[1] : id.split("-")[0]}`;
}

export interface Imported {
  rules: RuleSpec[];
  dropped: { id: string; reason: string }[];
  globalAllow: AllowSpec[];
  upstreamRules: number;
}

const str = (v: TomlValue | undefined): string | undefined => (typeof v === "string" ? v : undefined);
const strs = (v: TomlValue | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function compileCheck(source: string, flags: string): void {
  new RegExp(source, `${flags}dg`);
}

function convertAllow(t: TomlTable): AllowSpec | null {
  const regexes = strs(t.regexes);
  const stopwords = strs(t.stopwords).map((w) => w.toLowerCase());
  const pathOrCommit = strs(t.paths).length > 0 || strs(t.commits).length > 0;
  // AND with a path or commit check can never hold for free text; path/commit-only allowlists never apply.
  if (pathOrCommit && str(t.condition)?.toUpperCase() === "AND") return null;
  if (regexes.length === 0 && stopwords.length === 0) return null;
  const spec: AllowSpec = {};
  if (str(t.condition)?.toUpperCase() === "AND") spec.condition = "AND";
  const target = str(t.regexTarget);
  if (target === "match" || target === "line") spec.target = target;
  if (regexes.length) {
    spec.regexes = regexes.map((r) => {
      const c = convertGoRegex(r);
      compileCheck(c.source, c.flags);
      return c;
    });
  }
  if (stopwords.length) spec.stopwords = stopwords;
  return spec;
}

export function importGitleaks(tomlText: string): Imported {
  const doc = parseToml(tomlText);
  const rawRules = (Array.isArray(doc.rules) ? doc.rules : []) as TomlTable[];
  const rules: RuleSpec[] = [];
  const dropped: Imported["dropped"] = [];
  for (const r of rawRules) {
    const id = str(r.id) ?? "?";
    const regex = str(r.regex);
    if (str(r.path)) {
      dropped.push({ id, reason: regex ? "path-scoped: fires only on files matching a path" : "path-only: no content regex" });
      continue;
    }
    if (!regex) {
      dropped.push({ id, reason: "no regex" });
      continue;
    }
    try {
      const { source, flags } = convertGoRegex(regex);
      compileCheck(source, flags);
      const rule: RuleSpec = { id, label: labelFor(id), detector: "gitleaks", source, flags };
      const keywords = strs(r.keywords).map((k) => k.toLowerCase());
      if (keywords.length) rule.keywords = keywords;
      if (typeof r.entropy === "number") rule.entropy = r.entropy;
      if (typeof r.secretGroup === "number" && r.secretGroup > 0) rule.secretGroup = r.secretGroup;
      const allow = ((Array.isArray(r.allowlists) ? r.allowlists : []) as TomlTable[]).map(convertAllow).filter((a): a is AllowSpec => a !== null);
      if (allow.length) rule.allow = allow;
      rules.push(rule);
    } catch (e) {
      dropped.push({ id, reason: `uncompilable: ${(e as Error).message}` });
    }
  }
  const globalTables = [doc.allowlist, ...(Array.isArray(doc.allowlists) ? doc.allowlists : [])].filter(
    (t): t is TomlTable => typeof t === "object" && t !== null && !Array.isArray(t),
  );
  const globalAllow = globalTables.map(convertAllow).filter((a): a is AllowSpec => a !== null);
  return { rules, dropped, globalAllow, upstreamRules: rawRules.length };
}

export function renderModule(result: Imported): string {
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  return `/*
 * GENERATED by scripts/policy/import-gitleaks.mts from scripts/policy/vendor/gitleaks.toml. Do not edit by hand.
 *
 * Source: gitleaks config/gitleaks.toml @ ${GITLEAKS_COMMIT} (https://github.com/gitleaks/gitleaks).
 * MIT License, Copyright (c) 2019 Zachary Rice. The full notice is in LICENSES/gitleaks.txt.
 * Changes: Go RE2 patterns ported to JS (leading (?i) → i flag, mid-pattern (?i) → (?i:…), \\z → $, \\A → ^,
 * (?P< → (?<, POSIX classes expanded); path and commit allowlists removed (scans see text, not files); rules that
 * fire only on a file path removed. Labels are secret.<provider>.
 */
import type { AllowSpec, RuleSpec } from "./engine";

export const GITLEAKS_COMMIT = ${json(GITLEAKS_COMMIT)};

/** \`[[rules]]\` in the upstream file. */
export const GITLEAKS_UPSTREAM_RULES = ${result.upstreamRules};

/** Upstream rules not vendored, with the reason. */
export const GITLEAKS_DROPPED: { id: string; reason: string }[] = ${json(result.dropped)};

/** The upstream global allowlist (regexes and stopwords; its paths don't apply to text). */
export const GITLEAKS_GLOBAL_ALLOW: AllowSpec[] = ${json(result.globalAllow)};

export const GITLEAKS_RULES: RuleSpec[] = ${json(result.rules)};
`;
}

function main() {
  const result = importGitleaks(readFileSync(VENDOR, "utf8"));
  writeFileSync(OUTPUT, renderModule(result));
  const byReason = new Map<string, string[]>();
  for (const d of result.dropped) byReason.set(d.reason, [...(byReason.get(d.reason) ?? []), d.id]);
  console.log(`gitleaks @ ${GITLEAKS_COMMIT.slice(0, 7)}: ${result.upstreamRules} upstream rules, ${result.rules.length} vendored, ${result.dropped.length} dropped`);
  for (const [reason, ids] of byReason) console.log(`  dropped (${ids.length}) ${reason}: ${ids.join(", ")}`);
  console.log(`wrote ${fileURLToPath(OUTPUT)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
