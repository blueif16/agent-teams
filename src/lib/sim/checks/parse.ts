/*
 * Small parsers the deliverable checks read artifacts with: CSV (RFC 4180) and GitHub Markdown tables, Markdown
 * headings, blocks, lines, sentences and plain text, numbers and numerals, HTML tokens and visible text, and
 * Excalidraw frames. Hand-written, with no dependencies, and lenient only where agents' output varies harmlessly
 * (a stray quote mid-field, a missing trailing newline); never in a way that would change what a check sees.
 */

export interface Table {
  columns: string[];
  rows: Record<string, string>[];
}

/** "auto": the first Markdown table in the text if there is one, else CSV. */
export type TableFormat = "csv" | "markdown" | "auto";

export function parseTable(text: string, format: TableFormat = "auto"): Table {
  const body = text.replace(/^\uFEFF/, "");
  if (format === "csv") return parseCsv(body);
  const md = markdownTable(body);
  if (md) return md;
  return format === "markdown" ? { columns: [], rows: [] } : parseCsv(body);
}

/** Records of an RFC 4180 CSV. Blank lines are skipped; a quoted empty field ("") is a record, not a blank line. */
function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let sawQuote = false;
  const endRecord = () => {
    fields.push(field);
    if (fields.length > 1 || fields[0] !== "" || sawQuote) records.push(fields);
    fields = [];
    field = "";
    sawQuote = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && field === "") {
      quoted = true;
      sawQuote = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      endRecord();
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
  }
  if (field !== "" || fields.length || sawQuote) endRecord();
  return records;
}

function parseCsv(text: string): Table {
  const [columns = [], ...records] = csvRecords(text);
  return { columns, rows: records.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ""]))) };
}

/** A pipe-led Markdown table row's cells, trimmed; `\|` is a literal pipe. Null if the line isn't a row. */
function rowCells(line: string): string[] | null {
  let s = line.trim();
  if (!s.startsWith("|")) return null;
  s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += s[i];
  }
  cells.push(cell.trim());
  return cells;
}

const DELIMITER_CELL = /^:?-+:?$/;

/** The first Markdown table: a header row, then a delimiter row with as many cells, then rows until a non-row line. */
function markdownTable(text: string): Table | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i++) {
    const columns = rowCells(lines[i]);
    const delimiter = rowCells(lines[i + 1]);
    if (!columns || !delimiter || delimiter.length !== columns.length || !delimiter.every((c) => DELIMITER_CELL.test(c))) continue;
    const rows: Record<string, string>[] = [];
    for (let j = i + 2; j < lines.length; j++) {
      const cells = rowCells(lines[j]);
      if (!cells) break;
      rows.push(Object.fromEntries(columns.map((c, k) => [c, cells[k] ?? ""])));
    }
    return { columns, rows };
  }
  return null;
}

const NUMBER = /^([+-]?)\$?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)%?$/;

/** A cell or token as a number: "$1,299.00", "1299", "12.5%", "-3". Anything else (words, "1,29") is null. */
export function parseNumber(s: string): number | null {
  const m = NUMBER.exec(s.trim());
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ""));
  return m[1] === "-" ? -n : n;
}

const NUMERAL = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
const LETTER = /[\p{L}_]/u;

/** The numbers prose states. Digits glued to a letter before them are part of a name (S3, F12, B2B), not numerals. */
export function numerals(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUMERAL)) {
    if (m.index > 0 && LETTER.test(text[m.index - 1])) continue;
    out.push(Number(m[0].replace(/,/g, "")));
  }
  return out;
}

/** Inline Markdown to plain text: emphasis, code and strikethrough stripped; links and images keep their text. */
export function mdPlain(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, "$1")
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, "$1$2")
    .replace(/~~(.+?)~~/g, "$1");
}

export interface Heading {
  level: number;
  text: string;
}

type LineKind = "blank" | "fence" | "heading" | "item" | "row" | "text";

const HEADING = /^\s{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const FENCE = /^\s{0,3}(```|~~~)/;
const DELIMITER_ROW = /^\|?[\s:|-]*-[\s:|-]*$/;

/** Each line of a Markdown doc, classified, with fenced code and table delimiter rows left out. */
function* mdScan(text: string): Generator<{ kind: LineKind; text: string; line: number; level?: number }> {
  let fenced = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (FENCE.test(raw)) {
      fenced = !fenced;
      yield { kind: "fence", text: "", line: i + 1 };
      continue;
    }
    if (fenced) continue;
    const line = raw.trim();
    const h = HEADING.exec(raw);
    if (!line) yield { kind: "blank", text: "", line: i + 1 };
    else if (h) yield { kind: "heading", text: mdPlain(h[2]), line: i + 1, level: h[1].length };
    else if (line.startsWith("|")) {
      if (!DELIMITER_ROW.test(line)) yield { kind: "row", text: mdPlain(line), line: i + 1 };
    } else if (ITEM.test(line)) yield { kind: "item", text: mdPlain(line.replace(ITEM, "")), line: i + 1 };
    else yield { kind: "text", text: mdPlain(line.replace(/^>\s?/, "")), line: i + 1 };
  }
}

/** ATX headings ("## Market map"), as plain text with their level; headings inside code fences don't count. */
export function mdHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  for (const l of mdScan(text)) if (l.kind === "heading") out.push({ level: l.level ?? 0, text: l.text });
  return out;
}

export interface Block {
  kind: "heading" | "para" | "item" | "row";
  text: string;
  /** 1-based line where the block starts. */
  line: number;
}

/** A doc as blocks of plain text: headings, list items and table rows one each; wrapped paragraph lines joined. */
export function mdBlocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let start = 0;
  const flush = () => {
    if (para.length) out.push({ kind: "para", text: para.join(" "), line: start });
    para = [];
  };
  for (const l of mdScan(text)) {
    if (l.kind === "text") {
      if (!para.length) start = l.line;
      para.push(l.text);
      continue;
    }
    flush();
    if (l.kind === "heading" || l.kind === "item" || l.kind === "row") out.push({ kind: l.kind, text: l.text, line: l.line });
  }
  flush();
  return out;
}

/** The doc's non-empty body lines (everything but headings), as plain text. */
export function mdLines(text: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  for (const l of mdScan(text)) if ((l.kind === "text" || l.kind === "item" || l.kind === "row") && l.text) out.push({ text: l.text, line: l.line });
  return out;
}

/**
 * Sentences of one block: split after ".", "!" or "?" followed by a space. Bracketed tags written after the full
 * stop ("… in 2 minutes. [F2]") stay with the sentence before them.
 */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const part of text.trim().split(/(?<=[.!?])\s+/)) {
    const lead = /^(?:\[[^\]]+\]\s*)+/.exec(part);
    if (lead && out.length) {
      out[out.length - 1] += ` ${lead[0].trim()}`;
      const rest = part.slice(lead[0].length).trim();
      if (rest) out.push(rest);
    } else if (part) out.push(part);
  }
  return out;
}

export type HtmlToken =
  | { kind: "open"; name: string; attrs: Record<string, string>; void: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string }
  /** The body of a script, style or title element, unparsed. */
  | { kind: "raw"; name: string; text: string };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "title"]);
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", copy: "©", reg: "®", trade: "™", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", middot: "·", times: "×", euro: "€", pound: "£",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

const TAG_NAME = /[A-Za-z][\w:-]*/y;
const ATTR_NAME = /[^\s"'>/=]+/y;
const SPACE = /\s*/y;

/** HTML as a flat token list: tags with lowercased names and decoded attributes, decoded text, raw script/style. */
export function htmlTokens(html: string): HtmlToken[] {
  const out: HtmlToken[] = [];
  const at = (re: RegExp, i: number) => {
    re.lastIndex = i;
    const m = re.exec(html);
    return m ? m[0] : null;
  };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out.push({ kind: "text", text: decodeEntities(html.slice(i)) });
      break;
    }
    if (lt > i) out.push({ kind: "text", text: decodeEntities(html.slice(i, lt)) });
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    const closing = html[lt + 1] === "/";
    const name = at(TAG_NAME, lt + (closing ? 2 : 1));
    if (!name) {
      out.push({ kind: "text", text: "<" });
      i = lt + 1;
      continue;
    }
    let j = lt + (closing ? 2 : 1) + name.length;
    const attrs: Record<string, string> = {};
    while (j < html.length && html[j] !== ">") {
      j += at(SPACE, j)?.length ?? 0;
      if (html[j] === ">" || j >= html.length) break;
      if (html[j] === "/") {
        j++;
        continue;
      }
      const key = at(ATTR_NAME, j);
      if (!key) {
        j++;
        continue;
      }
      j += key.length;
      j += at(SPACE, j)?.length ?? 0;
      let value = "";
      if (html[j] === "=") {
        j++;
        j += at(SPACE, j)?.length ?? 0;
        const q = html[j];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, j + 1);
          value = html.slice(j + 1, end < 0 ? html.length : end);
          j = end < 0 ? html.length : end + 1;
        } else {
          const v = at(/[^\s>]*/y, j) ?? "";
          value = v;
          j += v.length;
        }
      }
      attrs[key.toLowerCase()] = decodeEntities(value);
    }
    i = j + 1;
    const tag = name.toLowerCase();
    if (closing) {
      out.push({ kind: "close", name: tag });
      continue;
    }
    out.push({ kind: "open", name: tag, attrs, void: VOID.has(tag) });
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, i);
      out.push({ kind: "raw", name: tag, text: html.slice(i, end < 0 ? html.length : end) });
      i = end < 0 ? html.length : end;
    }
  }
  return out;
}

export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** The page's visible text runs: text nodes outside script, style and title, whitespace collapsed, empty ones dropped. */
export function htmlTextRuns(html: string): string[] {
  return htmlTokens(html).flatMap((t) => (t.kind === "text" && collapse(t.text) ? [collapse(t.text)] : []));
}

export interface Frame {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Text elements whose centre lies inside the frame, top to bottom. */
  texts: string[];
}

interface Element {
  id?: string;
  type?: string;
  name?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  originalText?: string;
  isDeleted?: boolean;
}

/** The live elements of an Excalidraw scene (a file with `elements`, or a bare array); null if it isn't one. */
function sceneElements(json: string): Element[] | null {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return null;
  }
  const els = Array.isArray(doc) ? doc : (doc as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(els)) return null;
  return els.filter((e): e is Element => !!e && typeof e === "object" && !(e as Element).isDeleted);
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Excalidraw stores soft-wrapped text with newlines in `text`; `originalText` is what was typed. */
const textOf = (e: Element) => collapse(e.originalText ?? e.text ?? "");

export function excalidrawTexts(json: string): string[] | null {
  const els = sceneElements(json);
  return els && els.filter((e) => e.type === "text").map(textOf);
}

export function excalidrawFrames(json: string): Frame[] | null {
  const els = sceneElements(json);
  if (!els) return null;
  const texts = els.filter((e) => e.type === "text");
  return els
    .filter((e) => e.type === "frame" && typeof e.width === "number")
    .map((f) => {
      const [x, y, width, height] = [num(f.x), num(f.y), num(f.width), num(f.height)];
      const inside = texts
        .filter((t) => {
          const cx = num(t.x) + num(t.width) / 2;
          const cy = num(t.y) + num(t.height) / 2;
          return cx >= x && cx <= x + width && cy >= y && cy <= y + height;
        })
        .sort((a, b) => num(a.y) - num(b.y) || num(a.x) - num(b.x));
      return { id: f.id ?? "", name: f.name ?? "", x, y, width, height, texts: inside.map(textOf) };
    });
}
