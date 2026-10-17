/*
 * What every deliverable check shares: the result and evidence shape (one line on pass; up to five offending
 * things, then "+N more", on fail), reading a deliverable's current version, its format from the vault path, the
 * text a reader would see, its table, and the text normalizations verbatim comparisons use.
 */
import type { z } from "zod";
import type { CHECKS, CheckName } from "../scenario";
import { collapse, excalidrawTexts, htmlTextRuns, mdBlocks, parseTable, type Table } from "./parse";
import type { CheckContext, CheckResult, DeliverableVersion } from "./types";

/** A check's params after the scenario schema filled the defaults. */
export type Params<K extends CheckName> = z.output<(typeof CHECKS)[K]>;

const SHOWN = 5;

export const pass = (line: string): CheckResult => ({ pass: true, evidence: [line] });

export function fail(lines: string[]): CheckResult {
  const evidence = lines.slice(0, SHOWN);
  if (lines.length > SHOWN) evidence.push(`+${lines.length - SHOWN} more`);
  return { pass: false, evidence };
}

export const neverWritten = (id: string) => fail([`"${id}" was never written`]);

/** The version of `id` a check reads (the accepted one, else the latest), or a failing result if there is none. */
export function versionOf(ctx: CheckContext, id = ctx.deliverable.id): DeliverableVersion | CheckResult {
  return ctx.current(id) ?? neverWritten(id);
}

export const isResult = (v: DeliverableVersion | CheckResult): v is CheckResult => "pass" in v;

export type Format = "html" | "canvas" | "markdown" | "csv" | "text";

/** The artifact's format, from its vault path (tables are .csv, docs .md, mockups .html, canvases .excalidraw). */
export function formatOf(path: string): Format {
  const p = path.toLowerCase();
  if (/\.html?$/.test(p)) return "html";
  if (/\.excalidraw(\.json)?$/.test(p)) return "canvas";
  if (/\.(md|markdown|mdx)$/.test(p)) return "markdown";
  if (p.endsWith(".csv")) return "csv";
  return "text";
}

/** The text a reader sees: a page's text runs, a canvas's text elements, a doc's plain text; else the raw text. */
export function visibleText(v: DeliverableVersion): string {
  switch (formatOf(v.path)) {
    case "html":
      return htmlTextRuns(v.text).join(" ");
    case "canvas":
      return (excalidrawTexts(v.text) ?? []).join("\n");
    case "markdown":
      return mdBlocks(v.text)
        .map((b) => b.text)
        .join("\n");
    default:
      return v.text;
  }
}

/** A table deliverable is CSV; in a doc, the table is the first Markdown table. */
export function tableOf(v: DeliverableVersion): Table {
  const f = formatOf(v.path);
  return parseTable(v.text, f === "csv" ? "csv" : f === "markdown" ? "markdown" : "auto");
}

/** The table in deliverable `id`, or a failing result when it wasn't written or holds no table. */
export function readTable(ctx: CheckContext, id = ctx.deliverable.id): { v: DeliverableVersion; t: Table } | CheckResult {
  const v = versionOf(ctx, id);
  if (isResult(v)) return v;
  const t = tableOf(v);
  return t.columns.length ? { v, t } : fail([`no table in ${v.path}`]);
}

/** The table's own name for a column, matched ignoring case and surrounding spaces. */
export function columnOf(t: Table, name: string): string | undefined {
  const want = name.trim().toLowerCase();
  return t.columns.find((c) => c.trim().toLowerCase() === want);
}

/** "row 3 (CrewAI)": 1-based data row, labelled by its first cell. */
export function rowName(t: Table, i: number): string {
  const first = collapse(t.rows[i][t.columns[0]] ?? "");
  return first ? `row ${i + 1} (${clip(first, 40)})` : `row ${i + 1}`;
}

/** Columns that must exist, or a failing result naming the missing ones. */
export function requireColumns(t: Table, names: string[]): string[] | CheckResult {
  const found = names.map((n) => columnOf(t, n));
  const missing = names.filter((_, i) => !found[i]);
  return missing.length ? fail(missing.map((n) => `no column "${n}"`)) : (found as string[]);
}

export const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** For verbatim comparisons: whitespace (line wraps, tags splitting a sentence) doesn't count; every other character does. */
export const squash = (s: string) => s.replace(/\s+/g, "");

/** Copy's fact tags ("[F3]") are notes for the reviewer, not words the reader sees. */
export const dropFactTags = (s: string) => s.replace(/\s*\[F\d+\]/g, "");

/** A number as evidence shows it: at most two decimals, no trailing zeros. */
export const fmt = (n: number) => String(Math.round(n * 100) / 100);

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
