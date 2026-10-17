/*
 * The chart tool. An agent writes a ```chart fence holding one small JSON object and the app
 * draws it from a fixed set of templates, so the model supplies data, never drawing code.
 * Shared by the server (the prompt note) and the client (parsing and splitting replies).
 */

export const CHART_FENCE = "```chart";

export type ChartStatus = "on-track" | "at-risk" | "behind" | "done";
export type StepState = "done" | "active" | "todo";

export interface Series {
  name: string;
  values: number[];
}

export type ChartSpec =
  | {
      type: "stats";
      title?: string;
      items: { label: string; value: number | string; unit?: string; delta?: number; good?: "up" | "down"; note?: string; trend?: number[] }[];
    }
  | { type: "bar"; title?: string; subtitle?: string; x: string[]; series: Series[]; unit?: string; stacked?: boolean; highlight?: string }
  | { type: "line" | "area"; title?: string; subtitle?: string; x: string[]; series: Series[]; unit?: string }
  | { type: "breakdown"; title?: string; subtitle?: string; items: { label: string; value: number }[]; unit?: string }
  | { type: "progress"; title?: string; subtitle?: string; items: { label: string; value: number; status?: ChartStatus; note?: string }[] }
  | { type: "timeline"; title?: string; subtitle?: string; items: { label: string; date?: string; state: StepState; note?: string }[] };

export type ChartType = ChartSpec["type"];

/** What the agents read in their prompt: when to chart, and the six templates with one example each. */
export const CHARTS_NOTE = `Charts: when numbers are easier to see than to read (a trend, a comparison, parts of a whole, progress toward goals, a schedule), put one chart after your sentence. Write a ${CHART_FENCE} fence holding one JSON object and the app draws it. Use only numbers you actually have (from the context above, your own work, or the owner's message); never make data up to fill a chart. At most one chart per reply, and keep your sentence saying what it shows. Pick the simplest type that fits:
- stats, 2 to 4 headline numbers, including different metrics this period vs. last: {"type":"stats","items":[{"label":"Accepted","value":82,"unit":"%","delta":6,"trend":[70,74,79,82]}]} (value is now; delta is the change vs. last period, in % or, for a % metric, in points; add "good":"down" when lower is better)
- bar, compare categories: {"type":"bar","title":"Replies by team","x":["#launch","#growth"],"series":[{"name":"Replies","values":[42,31]}],"highlight":"#launch"} (more series = grouped bars; "stacked":true stacks them)
- line or area, change over time: {"type":"line","title":"Cost per day","x":["Oct 12","Oct 13","Oct 14"],"series":[{"name":"Cost","values":[0.8,1.1,0.9]}],"unit":"$"} (area for one series)
- breakdown, parts of a whole (up to 6): {"type":"breakdown","title":"Where the hours went","items":[{"label":"Research","value":12},{"label":"Writing","value":8}],"unit":"h"}
- progress, goals or tasks toward done: {"type":"progress","title":"Launch readiness","items":[{"label":"Landing page","value":0.8,"status":"on-track","note":"Due Oct 24"}]} (value 0 to 1; status on-track, at-risk, behind or done)
- timeline, milestones: {"type":"timeline","title":"Plan","items":[{"date":"Oct 18","label":"Beta to 20 users","state":"done"},{"date":"Oct 24","label":"Public launch","state":"todo"}]} (state done, active or todo)
Everything plotted on one bar or line chart shares one unit and scale. Metrics in different units (users, %, $) never share a chart: show them as stats. "unit" is optional: "%", "$", or a word such as "h" or "calls".`;

export type Segment = { kind: "text"; text: string } | { kind: "chart"; code: string; open: boolean };

/** Split a reply into prose and chart blocks. A chart fence still streaming is returned with open: true. */
export function splitCharts(text: string): Segment[] {
  const out: Segment[] = [];
  const open = /(^|\n)[ \t]*```chart[^\n]*(\n|$)/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text))) {
    const start = m.index + m[1].length;
    const bodyStart = m.index + m[0].length;
    const close = /\n[ \t]*```[ \t]*(\n|$)/g;
    close.lastIndex = bodyStart - 1;
    const c = close.exec(text);
    if (start > at) out.push({ kind: "text", text: text.slice(at, start) });
    if (!c) {
      out.push({ kind: "chart", code: text.slice(bodyStart), open: true });
      at = text.length;
      break;
    }
    out.push({ kind: "chart", code: text.slice(bodyStart, c.index), open: false });
    at = c.index + c[0].length;
    open.lastIndex = at;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out.filter((s) => s.kind === "chart" || s.text.trim());
}

/** While streaming, hold back a fence that is still arriving ("`", "``", "```ch"), so it never flashes as code. */
export const trimPartialFence = (text: string) => text.replace(/(^|\n)[ \t]*`{1,3}(c(h(a(r(t)?)?)?)?)?$/, "$1");

const str = (v: unknown, n = 80) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, n) : "");
const opt = (v: unknown, n = 80) => str(v, n) || undefined;

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = Number(v.replace(/[,$%\s]/g, ""));
  return v.trim() && Number.isFinite(n) ? n : null;
}

const nums = (v: unknown, n = 60): number[] => (Array.isArray(v) ? v.slice(0, n).map((x) => num(x) ?? 0) : []);
const LABEL_KEYS = ["label", "name", "x", "date", "day", "category", "team", "period"];

/**
 * Series from either the taught columnar form ({x, series}) or the row form models also reach for:
 * data: [{label: "Mon", value: 3}] or [{label: "Mon", Calls: 3, Errors: 1}].
 */
function readSeries(raw: Record<string, unknown>): { x: string[]; series: Series[] } | null {
  if (Array.isArray(raw.x) && Array.isArray(raw.series)) {
    const x = raw.x.slice(0, 60).map((v) => str(v, 40));
    const series = raw.series
      .slice(0, 6)
      .map((s, i) => {
        const o = (s ?? {}) as Record<string, unknown>;
        const values = nums(o.values ?? o.data, x.length);
        while (values.length < x.length) values.push(0);
        return { name: str(o.name, 40) || `Series ${i + 1}`, values };
      })
      .filter((s) => s.values.length);
    return x.length && series.length ? { x, series } : null;
  }
  if (Array.isArray(raw.values) && Array.isArray(raw.x)) {
    return readSeries({ x: raw.x, series: [{ name: str(raw.title, 40) || "Value", values: raw.values }] });
  }
  const rows = (Array.isArray(raw.data) ? raw.data : Array.isArray(raw.items) ? raw.items : []).slice(0, 60) as Record<string, unknown>[];
  if (!rows.length || typeof rows[0] !== "object") return null;
  const labelKey = LABEL_KEYS.find((k) => k in rows[0]) ?? Object.keys(rows[0]).find((k) => typeof rows[0][k] === "string");
  const keys = Object.keys(rows[0]).filter((k) => k !== labelKey && num(rows[0][k]) !== null).slice(0, 6);
  if (!labelKey || !keys.length) return null;
  const x = rows.map((r) => str(r[labelKey], 40));
  const series = keys.map((k) => ({ name: k === "value" ? str(raw.title, 40) || "Value" : k, values: rows.map((r) => num(r[k]) ?? 0) }));
  return { x, series };
}

const STATUSES = new Set<ChartStatus>(["on-track", "at-risk", "behind", "done"]);
const STATES = new Set<StepState>(["done", "active", "todo"]);

function looseJSON(code: string): unknown {
  const body = code.slice(code.indexOf("{"), code.lastIndexOf("}") + 1);
  try {
    return JSON.parse(body);
  } catch {
    // Common model slips: smart quotes and trailing commas.
    return JSON.parse(body.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, "$1"));
  }
}

/** Read and clean a chart block. Null when it can't be drawn. */
export function parseChart(code: string): ChartSpec | null {
  let raw: Record<string, unknown>;
  try {
    raw = looseJSON(code) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const type = str(raw.type, 20).toLowerCase();
  const title = opt(raw.title);
  const subtitle = opt(raw.subtitle, 120);
  const unit = opt(raw.unit, 12);
  const items = (Array.isArray(raw.items) ? raw.items : Array.isArray(raw.data) ? raw.data : []) as Record<string, unknown>[];

  switch (type) {
    case "stats":
    case "kpi": {
      const tiles = items.slice(0, 4).flatMap((o) => {
        const label = str(o?.label ?? o?.name, 40);
        if (!label || o.value == null) return [];
        const value = num(o.value) ?? str(o.value, 24);
        const delta = num(o.delta) ?? undefined;
        const trend = nums(o.trend, 24);
        return [{ label, value, unit: opt(o.unit, 12), delta, good: o.good === "down" ? ("down" as const) : undefined, note: opt(o.note), trend: trend.length > 1 ? trend : undefined }];
      });
      return tiles.length ? { type: "stats", title, items: tiles } : null;
    }
    case "bar":
    case "column":
    case "line":
    case "area": {
      const s = readSeries(raw);
      if (!s) return null;
      if (type === "bar" || type === "column") return { type: "bar", title, subtitle, unit, ...s, stacked: raw.stacked === true, highlight: opt(raw.highlight, 40) };
      return { type: type as "line" | "area", title, subtitle, unit, ...s };
    }
    case "breakdown":
    case "donut":
    case "pie": {
      const parts = items
        .map((o) => ({ label: str(o?.label ?? o?.name, 40), value: Math.max(0, num(o?.value) ?? 0) }))
        .filter((p) => p.label && p.value > 0);
      return parts.length ? { type: "breakdown", title, subtitle, unit, items: parts } : null;
    }
    case "progress":
    case "goals": {
      const rows = items.slice(0, 10).flatMap((o) => {
        const label = str(o?.label ?? o?.name, 60);
        let value = num(o?.value);
        if (!label || value === null) return [];
        // Models send 0.62 or 62; anything above 1 reads as a percent.
        if (value > 1) value /= 100;
        const status = str(o.status, 12).toLowerCase() as ChartStatus;
        return [{ label, value: Math.min(1, Math.max(0, value)), status: STATUSES.has(status) ? status : undefined, note: opt(o.note) }];
      });
      return rows.length ? { type: "progress", title, subtitle, items: rows } : null;
    }
    case "timeline":
    case "milestones": {
      const steps = items.slice(0, 10).flatMap((o) => {
        const label = str(o?.label ?? o?.name, 80);
        if (!label) return [];
        const state = str(o.state ?? o.status, 10).toLowerCase() as StepState;
        return [{ label, date: opt(o.date, 24), state: STATES.has(state) ? state : ("todo" as const), note: opt(o.note, 120) }];
      });
      return steps.length ? { type: "timeline", title, subtitle, items: steps } : null;
    }
  }
  return null;
}

/** One line standing in for a chart where only text fits: previews, copy, the toast. */
export function chartSummary(spec: ChartSpec | null): string {
  if (!spec) return "📊 Chart";
  const head = `📊 ${spec.title ?? "Chart"}`;
  switch (spec.type) {
    case "stats":
      return `${spec.title ? `${head}: ` : "📊 "}${spec.items.map((i) => `${i.label} ${i.value}${i.unit ?? ""}`).join(", ")}`;
    case "bar":
    case "line":
    case "area":
      return `${head}: ${spec.x.slice(0, 6).map((x, i) => `${x} ${spec.series[0].values[i]}`).join(", ")}${spec.x.length > 6 ? ", …" : ""}`;
    case "breakdown":
      return `${head}: ${spec.items.map((i) => `${i.label} ${i.value}`).join(", ")}`;
    case "progress":
      return `${head}: ${spec.items.map((i) => `${i.label} ${Math.round(i.value * 100)}%`).join(", ")}`;
    case "timeline":
      return `${head}: ${spec.items.map((i) => (i.date ? `${i.date} ${i.label}` : i.label)).join(", ")}`;
  }
}

/** A reply with each chart block swapped for its one-line summary. */
export function withChartSummaries(text: string): string {
  return splitCharts(text)
    .map((s) => (s.kind === "text" ? s.text.trim() : chartSummary(parseChart(s.code))))
    .join("\n\n");
}
