/*
 * Checks on visuals: the wireframe canvas has a frame at each width, with the copy's headlines in order inside each
 * (C2); a posted ```chart fence plots exactly the analyst's table, in the right unit (C3).
 */
import type { ChartSpec } from "../../charts";
import { collapse, excalidrawFrames, mdHeadings, parseNumber, type Frame } from "./parse";
import { dropFactTags, fail, fmt, isResult, pass, plural, readTable, requireColumns, rowName, versionOf, type Params } from "./shared";
import type { CheckFn } from "./types";

/** The longest headline the text begins with (ignoring case), as an index into `heads`; -1 if none. */
function headlineOf(text: string, heads: string[]): number {
  const t = text.toLowerCase();
  let best = -1;
  heads.forEach((h, i) => {
    if (t.startsWith(h.toLowerCase()) && (best < 0 || h.length > heads[best].length)) best = i;
  });
  return best;
}

export const frames: CheckFn<Params<"frames">> = (ctx, p) => {
  const v = versionOf(ctx);
  if (isResult(v)) return v;
  const all = excalidrawFrames(v.text);
  if (!all) return fail([`${v.path} is not Excalidraw JSON`]);
  const problems: string[] = [];
  const matched: Frame[] = [];
  for (const w of p.widths) {
    const near = all.filter((f) => Math.abs(f.width - w) <= 2);
    if (!near.length) problems.push(`no frame ${w} px wide (frames: ${all.map((f) => fmt(f.width)).join(", ") || "none"})`);
    for (const f of near) if (!matched.includes(f)) matched.push(f);
  }
  if (p.orderFrom) {
    const src = versionOf(ctx, p.orderFrom);
    if (isResult(src)) return fail([...problems, ...src.evidence]);
    const heads = mdHeadings(src.text).flatMap((h) => (h.level === 3 ? [collapse(dropFactTags(h.text))] : []));
    if (!heads.length) problems.push(`no ### headlines in ${p.orderFrom}`);
    for (const f of heads.length ? matched : []) {
      const name = `frame "${f.name || f.id}"`;
      const order = f.texts.map((t) => headlineOf(t, heads)).filter((i) => i >= 0);
      const k = order.findIndex((h, i) => i > 0 && h < order[i - 1]);
      if (!order.length) problems.push(`${name}: no text begins with a ### headline of ${p.orderFrom}`);
      else if (k > 0) problems.push(`${name}: "${heads[order[k]]}" is below "${heads[order[k - 1]]}"`);
    }
  }
  if (problems.length) return fail(problems);
  return pass(`frames at ${p.widths.join(", ")} px${p.orderFrom ? `; in each, the ### headlines of ${p.orderFrom} run top to bottom in order` : ""}`);
};

interface Plotted {
  unit?: string;
  pairs: [string, number][];
}

/** A chart's label → value pairs (the first series of a bar, line or area chart; a breakdown's items). */
function plotted(spec: unknown): Plotted | string {
  const s = (spec ?? {}) as ChartSpec;
  switch (s.type) {
    case "bar":
    case "line":
    case "area": {
      const values = Array.isArray(s.series) ? s.series[0]?.values : undefined;
      if (!Array.isArray(s.x) || !Array.isArray(values)) return `a ${s.type} chart without x and series`;
      return { unit: s.unit, pairs: s.x.map((l, i) => [collapse(String(l)), Number(values[i])]) };
    }
    case "breakdown":
      if (!Array.isArray(s.items)) return "a breakdown chart without items";
      return { unit: s.unit, pairs: s.items.map((it) => [collapse(String(it.label)), Number(it.value)]) };
    default:
      return `a ${String(s.type ?? "untyped")} chart has no label → value series with a unit`;
  }
}

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

export const chart_matches: CheckFn<Params<"chart_matches">> = (ctx, p) => {
  const read = readTable(ctx, p.table);
  if (isResult(read)) return read;
  const { t } = read;
  const cols = requireColumns(t, [p.label, p.value]);
  if (isResult(cols)) return cols;
  const [labelCol, valueCol] = cols;
  const bad = t.rows.findIndex((r) => parseNumber(r[valueCol]) === null);
  if (bad >= 0) return fail([`${rowName(t, bad)}: ${valueCol} "${t.rows[bad][valueCol]}" is not a number`]);
  const expected = t.rows.map((r) => [collapse(r[labelCol]), parseNumber(r[valueCol]) as number] as const);
  if (!ctx.charts.length) return fail(["no chart was posted"]);

  const compare = (chart: Plotted): string[] => {
    const problems: string[] = [];
    if (!(chart.unit ?? "").toLowerCase().includes(p.unit.toLowerCase())) problems.push(`unit "${chart.unit ?? ""}" lacks "${p.unit}"`);
    const onChart = new Map<string, number[]>();
    for (const [l, n] of chart.pairs) onChart.set(l, [...(onChart.get(l) ?? []), n]);
    for (const [l, n] of expected) {
      const vals = onChart.get(l) ?? [];
      const i = vals.findIndex((x) => same(x, n));
      if (i >= 0) vals.splice(i, 1);
      else if (vals.length) problems.push(`"${l}": chart ${fmt(vals.shift() as number)}, ${p.table} ${fmt(n)}`);
      else problems.push(`"${l}" (${p.table} ${fmt(n)}) is not on the chart`);
    }
    for (const [l, vals] of onChart) for (const x of vals) problems.push(`"${l}" (${fmt(x)}) is on the chart but not in ${p.table}`);
    return problems;
  };

  const results = ctx.charts.map((c) => {
    const pl = plotted(c.spec);
    return typeof pl === "string" ? { pl: null, problems: [pl] } : { pl, problems: compare(pl) };
  });
  const hit = results.findIndex((r) => !r.problems.length);
  if (hit >= 0) {
    const c = ctx.charts[hit];
    return pass(`chart ${hit + 1} of ${ctx.charts.length}, by ${c.agentId}: ${expected.length} ${labelCol} → ${valueCol} pairs equal ${p.table}; unit "${results[hit].pl?.unit}"`);
  }
  return fail([`${plural(ctx.charts.length, "chart")}, none matches ${p.table}; the latest:`, ...results[results.length - 1].problems]);
};
