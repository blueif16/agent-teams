/*
 * Checks on tables (a .csv, or the first Markdown table of a doc): the deliverable exists, has enough filled rows,
 * cites its sources, quotes pages the team actually fetched, recomputes, and tiers that climb. The research half of
 * the pricing benchmark (C3) and the teardown of the landing-page case (C2) are graded with these.
 */
import { collapse, parseNumber } from "./parse";
import { clip, columnOf, fail, fmt, isResult, neverWritten, pass, plural, readTable, requireColumns, rowName, squash, type Params } from "./shared";
import type { CheckFn } from "./types";

export const exists: CheckFn<Params<"exists">> = (ctx) => {
  const { id, type } = ctx.deliverable;
  const versions = ctx.versions(id);
  if (versions.length) {
    const v = versions[versions.length - 1];
    return pass(`${plural(versions.length, "version")}; v${v.version} at ${v.path}`);
  }
  // A chart deliverable is a ```chart fence in a message; it may never get a vault version.
  if (type === "chart" && ctx.charts.length) return pass(`${plural(ctx.charts.length, "chart")} posted`);
  return neverWritten(id);
};

export const table_rows: CheckFn<Params<"table_rows">> = (ctx, p) => {
  const read = readTable(ctx);
  if (isResult(read)) return read;
  const { t } = read;
  const problems: string[] = [];
  if (t.rows.length < p.min) problems.push(`${plural(t.rows.length, "row")}; at least ${p.min} required`);
  const named = (p.columns ?? []).map((name) => ({ name, col: columnOf(t, name) }));
  for (const { name, col } of named) if (!col) problems.push(`no column "${name}"`);
  if (p.nonEmpty) {
    t.rows.forEach((r, i) => {
      for (const { col } of named) if (col && !r[col].trim()) problems.push(`${rowName(t, i)}: "${col}" is blank`);
    });
  }
  let distinct = "";
  if (p.distinct) {
    const col = columnOf(t, p.distinct.column);
    if (!col) problems.push(`no column "${p.distinct.column}"`);
    else {
      const n = new Set(t.rows.map((r) => collapse(r[col]).toLowerCase()).filter(Boolean)).size;
      if (n < p.distinct.min) problems.push(`"${col}" has ${n} different values; at least ${p.distinct.min} required`);
      distinct = `; ${n} different ${col}`;
    }
  }
  if (problems.length) return fail(problems);
  const filled = named.length ? `; ${named.map((x) => x.col).join(", ")} ${p.nonEmpty ? "all filled" : "present"}` : "";
  return pass(`${plural(t.rows.length, "row")}${filled}${distinct}`);
};

const URL_IN = /https?:\/\/[^\s<>()[\]"']+/i;
const DATE_IN = /\b(\d{4})-(\d{2})-(\d{2})\b/;

function hasHttpUrl(cell: string): boolean {
  const m = URL_IN.exec(cell);
  if (!m) return false;
  try {
    return new URL(m[0]).hostname.includes(".");
  } catch {
    return false;
  }
}

/** A real calendar date written YYYY-MM-DD (so 2026-02-30 doesn't count). */
function hasDate(cell: string): boolean {
  const m = DATE_IN.exec(cell);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}

export const sources_cited: CheckFn<Params<"sources_cited">> = (ctx, p) => {
  const read = readTable(ctx);
  if (isResult(read)) return read;
  const { v, t } = read;
  const cols = requireColumns(t, [p.urlColumn, p.dateColumn]);
  if (isResult(cols)) return cols;
  if (!t.rows.length) return fail([`no rows in ${v.path}`]);
  const [urlCol, dateCol] = cols;
  const problems: string[] = [];
  t.rows.forEach((r, i) => {
    if (!hasHttpUrl(r[urlCol])) problems.push(`${rowName(t, i)}: no http(s) URL in "${urlCol}" ("${clip(r[urlCol], 50)}")`);
    if (!hasDate(r[dateCol])) problems.push(`${rowName(t, i)}: no YYYY-MM-DD date in "${dateCol}" ("${clip(r[dateCol], 30)}")`);
  });
  if (problems.length) return fail(problems);
  return pass(`${plural(t.rows.length, "row")}, all with an http(s) URL in "${urlCol}" and a YYYY-MM-DD date in "${dateCol}"`);
};

export const verbatim_quote: CheckFn<Params<"verbatim_quote">> = (ctx, p) => {
  const read = readTable(ctx);
  if (isResult(read)) return read;
  const { v, t } = read;
  const cols = requireColumns(t, [p.quoteColumn]);
  if (isResult(cols)) return cols;
  if (!t.rows.length) return fail([`no rows in ${v.path}`]);
  const [col] = cols;
  const pages = ctx.fetched.map(squash);
  const problems: string[] = [];
  t.rows.forEach((r, i) => {
    const quote = r[col];
    if (!quote.trim()) problems.push(`${rowName(t, i)}: blank quote`);
    else if (!pages.some((page) => page.includes(squash(quote)))) problems.push(`${rowName(t, i)}: not in any fetched page: "${clip(collapse(quote))}"`);
  });
  if (problems.length) return fail(problems);
  return pass(`${plural(t.rows.length, "quote")}, all found verbatim in ${plural(ctx.fetched.length, "fetched page")}`);
};

export const recompute: CheckFn<Params<"recompute">> = (ctx, p) => {
  const read = readTable(ctx);
  if (isResult(read)) return read;
  const { v, t } = read;
  const cols = requireColumns(t, [p.price, p.quantity, p.total]);
  if (isResult(cols)) return cols;
  if (!t.rows.length) return fail([`no rows in ${v.path}`]);
  const [priceCol, qtyCol, totalCol] = cols;
  const problems: string[] = [];
  t.rows.forEach((r, i) => {
    const bad = cols.find((c) => parseNumber(r[c]) === null);
    if (bad) return problems.push(`${rowName(t, i)}: ${bad} "${clip(r[bad], 30)}" is not a number`);
    const [price, qty, total] = cols.map((c) => parseNumber(r[c]) as number);
    const want = price * qty;
    if (Math.abs(total - want) > p.tolerance * Math.abs(total)) problems.push(`${rowName(t, i)}: ${totalCol} ${fmt(total)} ≠ ${fmt(price)} × ${fmt(qty)} = ${fmt(want)}`);
  });
  if (problems.length) return fail(problems);
  return pass(`${plural(t.rows.length, "row")}: ${totalCol} = ${priceCol} × ${qtyCol} within ${fmt(p.tolerance * 100)}%`);
};

const features = (cell: string) =>
  cell
    .split(";")
    .map(collapse)
    .filter(Boolean);

export const monotonic_tiers: CheckFn<Params<"monotonic_tiers">> = (ctx, p) => {
  const read = readTable(ctx);
  if (isResult(read)) return read;
  const { v, t } = read;
  const cols = requireColumns(t, [p.tier, p.price, p.features]);
  if (isResult(cols)) return cols;
  if (!t.rows.length) return fail([`no rows in ${v.path}`]);
  const [tierCol, priceCol, featCol] = cols;
  const name = (i: number) => collapse(t.rows[i][tierCol]) || `row ${i + 1}`;
  const prices = t.rows.map((r) => parseNumber(r[priceCol]));
  const problems: string[] = [];
  t.rows.forEach((r, i) => {
    const price = prices[i];
    if (price === null) return problems.push(`${name(i)}: ${priceCol} "${clip(r[priceCol], 30)}" is not a number`);
    if (i === 0) return;
    const above = prices[i - 1];
    if (above !== null && !(price > above)) problems.push(`${name(i)} (${fmt(price)}) is not above ${name(i - 1)} (${fmt(above)})`);
    const have = new Set(features(r[featCol]).map((f) => f.toLowerCase()));
    for (const f of features(t.rows[i - 1][featCol])) if (!have.has(f.toLowerCase())) problems.push(`${name(i)} lacks "${f}" from ${name(i - 1)}`);
  });
  if (problems.length) return fail(problems);
  return pass(`${plural(t.rows.length, "tier")} (${t.rows.map((_, i) => name(i)).join(", ")}): each costs more and keeps every feature of the one above`);
};
