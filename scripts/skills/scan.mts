/*
 * The skill scan (docs/design/team-setup.md §3b step 3): high-signal patterns only, so a hit means a person
 * should look before the skill is listed. Any finding keeps a skill out of the index.
 *
 *   secret.*        AWS keys, private key blocks, GitHub / Slack / OpenAI-style / Google / Stripe tokens
 *   injection.*     instruction overrides, concealment from the user, agent-addressed HTML comments,
 *                   zero-width / bidi / tag characters
 *   remote-code.*   download piped into a shell, eval of fetched content, download + chmod +x,
 *                   eval in a shipped script, a shipped native binary
 *
 * `executable` is separate from findings: it says the skill ships scripts that run code (tier T7, shell), which
 * keeps it listed but off by default until shell tools are sandboxed.
 */

export interface ScanFile {
  /** Relative to the skill folder, "/"-separated. */
  path: string;
  data: Uint8Array;
  /** POSIX mode bits; the exec bit marks a file executable. */
  mode?: number;
}

export interface Finding {
  file: string;
  line: number;
  rule: string;
  excerpt: string;
}

export interface ScanResult {
  findings: Finding[];
  executable: boolean;
  /** Files that run code (scripts, shebang, exec bit, native binaries), sorted. */
  executables: string[];
}

const SCRIPT_EXT = /\.(sh|bash|zsh|fish|py|pyw|js|mjs|cjs|ts|mts|cts|jsx|tsx|rb|pl|php|ps1|psm1|bat|cmd|lua|r|jar|exe|dll|so|dylib|bin|wasm)$/i;
const NATIVE_EXT = /\.(exe|dll|so|dylib|bin)$/i;

interface Rule {
  rule: string;
  re: RegExp;
  /** Drop matches that are documented placeholders. */
  placeholder?: boolean;
  /** Only in files that run code. */
  codeOnly?: boolean;
}

const RULES: Rule[] = [
  { rule: "secret.aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, placeholder: true },
  { rule: "secret.private-key", re: /-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH|PGP|ENCRYPTED) )?PRIVATE KEY(?: BLOCK)?-----/g },
  { rule: "secret.github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g, placeholder: true },
  { rule: "secret.slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, placeholder: true },
  { rule: "secret.api-key", re: /\bsk-(?:proj-|ant-[a-z]+\d*-)?[A-Za-z0-9_-]{32,}/g, placeholder: true },
  { rule: "secret.api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, placeholder: true },
  { rule: "secret.api-key", re: /\b[sr]k_live_[0-9A-Za-z]{24,}\b/g, placeholder: true },

  {
    rule: "injection.override",
    re: /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+|your\s+|my\s+)?(?:previous|prior|above|earlier|preceding|original|system)\s+(?:instructions?|prompts?|messages?|directions?|rules|guidelines|context)\b/gi,
  },
  { rule: "injection.override", re: /\byou\s+are\s+now\s+(?:in\s+)?(?:DAN|developer\s+mode|jailbroken|unrestricted|unfiltered)\b/gi },
  {
    rule: "injection.conceal",
    re: /\b(?:do\s+not|don['’]t|never)\s+(?:tell|inform|alert|notify)\s+the\s+user\b|\bhide\s+(?:this|it)\s+from\s+the\s+user\b|\bwithout\s+the\s+user['’]?s?\s+(?:knowledge|knowing|noticing)\b/gi,
  },

  {
    rule: "remote-code.pipe-to-shell",
    re: /\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da|k|fi)?sh\b|\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:python3?|node|perl|ruby)\b|\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]*\|\s*(?:iex|Invoke-Expression)\b/gi,
  },
  {
    rule: "remote-code.eval-remote",
    re: /\b(?:eval|exec|source)\s*\(?\s*["'`]?\s*(?:\$\(|<\(|`)\s*(?:curl|wget)\b|\b(?:eval|exec)\s*\(\s*(?:requests\.get|urllib\.request|urlopen|fetch\s*\(|await\s+fetch)/gi,
  },
  {
    rule: "remote-code.download-exec",
    re: /\b(?:curl|wget)\b[^\n]*(?:\s-o\s*|\s-O\s*|--output[=\s]|>\s*)\S+[^\n]*(?:&&|;)\s*chmod\s+(?:\+x|[0-7]*[1357][0-7]*)\b/gi,
  },
  { rule: "remote-code.decode-exec", re: /\bbase64\s+(?:-d|-D|--decode)\b[^\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/gi },
  { rule: "remote-code.eval", re: /(?<![\w.])eval\s*\(|^\s*eval\s+\S|\bnew\s+Function\s*\(/gm, codeOnly: true },
];

/** Zero-width, bidi controls, invisible operators, tag characters. ZWJ (U+200D) is handled separately. */
const INVISIBLE = /[\u200B\u200C\u200E\u200F\u2060-\u2064\u180E\u202A-\u202E\u2066-\u2069\u{E0000}-\u{E007F}]/gu;
const ZWJ = /\u200D/gu;
const PICTO = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\uFE0F]/u;
const BOM = /\uFEFF/gu;

const AGENT_WORDS = /\b(?:assistant|AI|agent|LLM|model|Claude|GPT|ChatGPT|Codex|Copilot|Gemini)s?\b/i;
const IMPERATIVE = /\b(?:must|always|never|ignore|instead|do\s+not|don['’]t|secretly|pretend|you\s+are)\b/i;

function looksPlaceholder(s: string): boolean {
  if (/example|x{4,}|0{6,}|your|dummy|fake|sample|placeholder|redacted/i.test(s)) return true;
  const body = s.replace(/^(?:AKIA|ASIA|gh[pousr]_|github_pat_|xox[abprs]-|sk-(?:proj-|ant-[a-z]+\d*-)?|AIza|[sr]k_live_)/, "");
  return new Set(body).size < 8;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const raw = text.slice(start, Math.min(text.length, index + length + 30));
  // Make invisible characters visible in the report.
  return raw.replace(/\s+/g, " ").replace(/[^\x20-\x7E]/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`).slice(0, 160);
}

function isNativeBinary(path: string, data: Uint8Array): boolean {
  if (NATIVE_EXT.test(path)) return true;
  if (data.length < 4) return false;
  const [a, b, c, d] = data;
  if (a === 0x7f && b === 0x45 && c === 0x4c && d === 0x46) return true; // ELF
  if (a === 0x4d && b === 0x5a) return true; // PE (MZ)
  const magic = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic); // Mach-O, fat
}

function isText(data: Uint8Array): boolean {
  const n = Math.min(data.length, 8192);
  for (let i = 0; i < n; i++) if (data[i] === 0) return false;
  return true;
}

function scanText(file: string, text: string, isCode: boolean): Finding[] {
  const out: Finding[] = [];
  const add = (rule: string, index: number, length: number) =>
    out.push({ file, line: lineOf(text, index), rule, excerpt: excerpt(text, index, length) });

  for (const r of RULES) {
    if (r.codeOnly && !isCode) continue;
    for (const m of text.matchAll(r.re)) {
      if (r.placeholder && looksPlaceholder(m[0])) continue;
      add(r.rule, m.index, m[0].length);
    }
  }

  for (const m of text.matchAll(/<!--([\s\S]*?)-->/g)) {
    const inner = m[1];
    const injected = RULES.some((r) => r.rule.startsWith("injection.") && new RegExp(r.re.source, r.re.flags).test(inner));
    const addressed = AGENT_WORDS.test(inner) && IMPERATIVE.test(inner);
    const command = /\b(?:curl|wget)\b|https?:\/\//i.test(inner) && IMPERATIVE.test(inner);
    if (injected || addressed || command) add("injection.html-comment", m.index, m[0].length);
  }

  for (const m of text.matchAll(INVISIBLE)) add("injection.invisible-char", m.index, 1);
  for (const m of text.matchAll(BOM)) if (m.index > 0) add("injection.invisible-char", m.index, 1);
  for (const m of text.matchAll(ZWJ)) {
    const before = String.fromCodePoint(text.codePointAt(m.index - 2) ?? 0, text.codePointAt(m.index - 1) ?? 0);
    const after = String.fromCodePoint(text.codePointAt(m.index + 1) ?? 0);
    if (!(PICTO.test(before) && PICTO.test(after))) add("injection.invisible-char", m.index, 1);
  }
  return out;
}

export function scanFiles(files: ScanFile[]): ScanResult {
  const findings: Finding[] = [];
  const executables: string[] = [];
  for (const f of files) {
    const execBit = ((f.mode ?? 0) & 0o111) !== 0;
    const native = isNativeBinary(f.path, f.data);
    if (native) findings.push({ file: f.path, line: 1, rule: "remote-code.native-binary", excerpt: "native executable" });
    let shebang = false;
    if (!native && isText(f.data)) {
      const text = new TextDecoder("utf-8").decode(f.data);
      shebang = text.startsWith("#!");
      findings.push(...scanText(f.path, text, shebang || SCRIPT_EXT.test(f.path)));
    }
    if (execBit || native || shebang || SCRIPT_EXT.test(f.path)) executables.push(f.path);
  }
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  findings.sort((a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.rule, b.rule));
  executables.sort();
  return { findings, executable: executables.length > 0, executables };
}
