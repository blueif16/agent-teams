/*
 * Checks on written docs: copy cites the brief's facts and invents no numbers, a memo's prices come from the
 * analyst's table (or a band it cites), required phrases are there and banned ones aren't, sections run in order,
 * and the text stays under a word cap. Text is read as a reader sees it (Markdown stripped, a page's visible text).
 */
import { collapse, mdBlocks, mdHeadings, numerals, parseNumber, sentences } from "./parse";
import { clip, columnOf, fail, fmt, isResult, pass, plural, readTable, versionOf, visibleText, type Params } from "./shared";
import type { CheckFn } from "./types";

export const cites_facts: CheckFn<Params<"cites_facts">> = (ctx, p) => {
  const v = versionOf(ctx);
  if (isResult(v)) return v;
  let tagRe: RegExp;
  try {
    tagRe = new RegExp(`\\[(${p.tag})\\]`, "g");
  } catch {
    return fail([`tag pattern "${p.tag}" is not a valid regex`]);
  }
  const known = Object.values(ctx.facts).flatMap(numerals);
  const problems: string[] = [];
  let claims = 0;
  let tags = 0;
  let stated = 0;
  for (const b of mdBlocks(v.text)) {
    for (const s of sentences(b.text)) {
      const cited = [...s.matchAll(tagRe)].map((m) => m[1]);
      tags += cited.length;
      for (const tag of cited) if (!Object.hasOwn(ctx.facts, tag)) problems.push(`line ${b.line}: [${tag}] is not a fact in the brief`);
      const said = numerals(s.replace(tagRe, " "));
      if (!said.length) continue;
      claims++;
      stated += said.length;
      if (!cited.length) problems.push(`line ${b.line}: no fact tag on "${clip(s)}"`);
      for (const n of said) if (!known.some((k) => Math.abs(k - n) < 1e-9)) problems.push(`line ${b.line}: ${n} is in no fact ("${clip(s, 60)}")`);
    }
  }
  if (problems.length) return fail(problems);
  return pass(`${plural(claims, "sentence")} with numerals, all tagged; ${plural(tags, "tag")}, all facts in the brief; ${plural(stated, "numeral")}, all in the facts`);
};

const AMOUNT = /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)([kKmM](?![A-Za-z]))?/g;
const BAND_JOIN = /^\s*(?:–|—|-|to)\s*$/;
const PERCENTILE_BAND = /\b[pP](\d{1,2})\s*(?:–|—|-|to)\s*[pP](\d{1,2})\b/g;

interface Amount {
  raw: string;
  value: number;
  start: number;
  end: number;
}

function amountsIn(s: string): Amount[] {
  return [...s.matchAll(AMOUNT)].map((m) => {
    const scale = !m[2] ? 1 : m[2].toLowerCase() === "k" ? 1e3 : 1e6;
    return { raw: m[0].replace(/\s/g, ""), value: Number(m[1].replace(/,/g, "")) * scale, start: m.index, end: m.index + m[0].length };
  });
}

/** Linear interpolation between closest ranks (numpy's and pandas' default), q in 0..1. */
function percentile(sorted: number[], q: number): number {
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

const cents = (n: number) => Math.round(n * 100);

export const prices_supported: CheckFn<Params<"prices_supported">> = (ctx, p) => {
  const v = versionOf(ctx);
  if (isResult(v)) return v;
  const read = readTable(ctx, p.table);
  if (isResult(read)) return read;
  const col = columnOf(read.t, p.column);
  if (!col) return fail([`no column "${p.column}" in ${p.table}`]);
  const values = read.t.rows.map((r) => parseNumber(r[col])).filter((n): n is number => n !== null);
  if (!values.length) return fail([`no numbers in ${p.table} ${col}`]);
  const sorted = [...values].sort((a, b) => a - b);
  const inColumn = (n: number) => values.some((x) => cents(x) === cents(n));

  const problems: string[] = [];
  let total = 0;
  let direct = 0;
  let banded = 0;
  for (const b of mdBlocks(v.text)) {
    for (const s of sentences(b.text)) {
      const amounts = amountsIn(s);
      if (!amounts.length) continue;
      // Bands the sentence cites: "$a–$b" with both ends in the column, or "p25–p75" of the column.
      const bands: [number, number][] = [];
      for (let i = 0; i + 1 < amounts.length; i++) {
        const [a, z] = [amounts[i], amounts[i + 1]];
        if (BAND_JOIN.test(s.slice(a.end, z.start)) && inColumn(a.value) && inColumn(z.value)) bands.push([Math.min(a.value, z.value), Math.max(a.value, z.value)]);
      }
      for (const m of s.matchAll(PERCENTILE_BAND)) {
        const [lo, hi] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y);
        bands.push([percentile(sorted, lo / 100), percentile(sorted, hi / 100)]);
      }
      for (const a of amounts) {
        total++;
        if (inColumn(a.value)) direct++;
        else if (bands.some(([lo, hi]) => cents(lo) <= cents(a.value) && cents(a.value) <= cents(hi))) banded++;
        else problems.push(`line ${b.line}: ${a.raw} is not in ${col}, and no band its sentence cites holds it`);
      }
    }
  }
  if (problems.length) return fail(problems);
  if (!total) return pass(`no $ amounts in ${v.path}`);
  return pass(`${total} $ amounts: ${direct} in ${p.table} ${col}, ${banded} inside a cited band`);
};

export const mentions: CheckFn<Params<"mentions">> = (ctx, p) => {
  const v = versionOf(ctx);
  if (isResult(v)) return v;
  const hay = collapse(visibleText(v)).toLowerCase();
  const missing = p.all.filter((phrase) => !hay.includes(collapse(phrase).toLowerCase()));
  if (missing.length) return fail(missing.map((m) => `missing "${m}"`));
  return pass(`${plural(p.all.length, "phrase")} found: ${p.all.map((x) => `"${x}"`).join(", ")}`);
};

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Where `phrase` first occurs as whole words (no letter or digit touching either end), ignoring case; -1 if never. */
function wholeWordAt(lower: string, phrase: string): number {
  const want = collapse(phrase).toLowerCase();
  for (let i = lower.indexOf(want); i >= 0; i = lower.indexOf(want, i + 1)) {
    const before = lower[i - 1];
    const after = lower[i + want.length];
    if (!(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after))) return i;
  }
  return -1;
}

export const excludes: CheckFn<Params<"excludes">> = (ctx, p) => {
  const v = versionOf(ctx);
  if (isResult(v)) return v;
  const text = collapse(visibleText(v));
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const phrase of p.none) {
    const at = wholeWordAt(lower, phrase);
    if (at < 0) continue;
    const [from, to] = [Math.max(0, at - 30), Math.min(text.length, at + phrase.length + 30)];
    found.push(`"${phrase}" in "${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}"`);
  }
  if (found.length) return fail(found);
  return pass(`none of ${p.none.map((x) => `"${x}"`).join(", ")} appears`);
};

export const sections: CheckFn<Params<"sections">> = (ctx, p) => {
  const v = versionOf(ctx);
  if (isResult(v)) return v;
  const heads = mdHeadings(v.text)
    .filter((h) => h.level === 2)
    .map((h) => h.text);
  const starts = (h: string, want: string) => h.toLowerCase().startsWith(want.toLowerCase());
  const problems: string[] = [];
  let next = 0;
  for (const want of p.headings) {
    const at = heads.findIndex((h, i) => i >= next && starts(h, want));
    if (at >= 0) next = at + 1;
    else problems.push(heads.some((h) => starts(h, want)) ? `"${want}" is out of order` : `no ## heading starting with "${want}"`);
  }
  if (problems.length) return fail([...problems, `## headings: ${heads.join(" · ") || "none"}`]);
  return pass(`${plural(p.headings.length, "## section")} in order: ${heads.join(" · ")}`);
};

export const max_words: CheckFn<Params<"max_words">> = (ctx, p) => {
  const v = versionOf(ctx);
  if (isResult(v)) return v;
  const n = visibleText(v)
    .split(/\s+/)
    .filter((w) => WORD_CHAR.test(w)).length;
  const line = `${plural(n, "word")}; the limit is ${fmt(p.max)}`;
  return n <= p.max ? pass(line) : fail([line]);
};
