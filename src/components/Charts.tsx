"use client";

import { memo, useId, useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, ChartColumn, Check, Clock, Table2, TriangleAlert } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { parseChart, type ChartSpec, type ChartStatus, type Series } from "@/lib/charts";
import { POP, SPRING } from "./ui";
import { Markdown } from "./Markdown";

/*
 * The chart templates agents fill with a ```chart block (see src/lib/charts.ts). Built to the dataviz
 * method: series 1 is the app accent, then the validated categorical order (checked on white with
 * validate_palette.js, 2026-10-16); thin marks with 4px rounded data ends; hairline grid; a legend
 * for 2+ series; values in ink, never in the series colour; a table view on every plotted chart.
 */

const SERIES = ["#4166eb", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const OTHER = "#c4c4c4";
const MUTED_MARK = "#d4d4d4";
const GRID = "#efefef";
const BASELINE = "#e2e2e2";
const AXIS_TEXT = { fontSize: 12, fill: "#8a8a8a" };

const PREFIX_UNITS = new Set(["$", "€", "£", "¥"]);

function fmtNumber(v: number, compact: boolean): string {
  const a = Math.abs(v);
  if (compact && a >= 1000) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  return v.toLocaleString("en-US", { maximumFractionDigits: a < 10 ? 2 : a < 100 ? 1 : 0 });
}

/** 1,284 · $4.2K · 82% · 12h · 40 calls */
export function fmt(v: number | string, unit?: string, compact = true): string {
  if (typeof v === "string") return v;
  const n = fmtNumber(v, compact);
  if (!unit) return n;
  if (PREFIX_UNITS.has(unit)) return v < 0 ? `-${unit}${n.slice(1)}` : `${unit}${n}`;
  return unit === "%" || unit.length <= 2 ? `${n}${unit}` : `${n} ${unit}`;
}

/** Draws a chart block, or a skeleton while its JSON is still streaming. */
export const ChartBlock = memo(function ChartBlock({ code, open }: { code: string; open: boolean }) {
  const spec = useMemo(() => (open ? null : parseChart(code)), [code, open]);
  if (open) return <ChartSkeleton />;
  if (!spec) {
    return (
      <div className="w-fit max-w-[min(620px,100%)] rounded-[20px] bg-bubble px-4 py-[11px] text-[15px] leading-[22px]">
        <p className="mb-2 text-[13px] text-muted">This chart&apos;s data didn&apos;t come through, so here it is as sent.</p>
        <Markdown text={"```json\n" + code.trim() + "\n```"} />
      </div>
    );
  }
  return (
    <motion.div className="max-w-full" initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={POP} style={{ transformOrigin: "0% 0%" }}>
      <Chart spec={spec} />
    </motion.div>
  );
});

function ChartSkeleton() {
  const heights = [46, 70, 38, 88, 60, 76, 52];
  return (
    <div className="w-[560px] max-w-full rounded-[20px] bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]" aria-label="Drawing a chart">
      <div className="flex items-center gap-1.5 text-[13px] text-muted">
        <ChartColumn className="size-4" strokeWidth={1.8} />
        Drawing a chart…
      </div>
      <div className="mt-4 flex h-[150px] items-end gap-3 border-b border-[#ececec] px-2">
        {heights.map((h, i) => (
          <span key={i} className="flex-1 animate-pulse rounded-t-[4px] bg-[#f0f0f0]" style={{ height: `${h}%`, animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    </div>
  );
}

function Chart({ spec }: { spec: ChartSpec }) {
  switch (spec.type) {
    case "stats":
      return <StatTiles spec={spec} />;
    case "bar":
    case "line":
    case "area":
      return <Plotted spec={spec} />;
    case "breakdown":
      return <Breakdown spec={spec} />;
    case "progress":
      return <ProgressRows spec={spec} />;
    case "timeline":
      return <Timeline spec={spec} />;
  }
}

/* ---------- card chrome ---------- */

function Card({ title, subtitle, right, children, className = "w-[560px]" }: { title?: string; subtitle?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <figure
      // Charts are for reading and hovering; a click here shouldn't open the message's quick actions.
      onClick={(e) => e.stopPropagation()}
      className={`${className} max-w-full cursor-default rounded-[20px] bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06)] transition-shadow hover:shadow-[0_6px_22px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.07)]`}
    >
      {(title || subtitle || right) && (
        <figcaption className="mb-3 flex items-start justify-between gap-3">
          <span className="min-w-0">
            {title && <span className="block text-[15px] font-semibold leading-[21px] text-ink">{title}</span>}
            {subtitle && <span className="mt-0.5 block text-[13px] leading-[18px] text-muted">{subtitle}</span>}
          </span>
          {right}
        </figcaption>
      )}
      {children}
    </figure>
  );
}

function ViewToggle({ view, onChange }: { view: "chart" | "table"; onChange: (v: "chart" | "table") => void }) {
  const id = useId();
  const views = [
    { v: "chart", label: "Chart", Icon: ChartColumn },
    { v: "table", label: "Table", Icon: Table2 },
  ] as const;
  return (
    <span className="flex shrink-0 rounded-full bg-[#f2f2f2] p-0.5" role="tablist" aria-label="Chart or table">
      {views.map(({ v, label, Icon }) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          aria-label={label}
          title={label}
          onClick={() => onChange(v)}
          className={`tap relative grid h-6 w-7 place-items-center rounded-full ${view === v ? "text-ink" : "text-[#9a9a9a] hover:text-ink-2"}`}
        >
          {view === v && (
            <motion.span layoutId={`view-${id}`} transition={SPRING} className="absolute inset-0 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)]" />
          )}
          <Icon className="relative size-3.5" strokeWidth={2} />
        </button>
      ))}
    </span>
  );
}

function Legend({ items, shape }: { items: { name: string; color: string }[]; shape: "rect" | "line" }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((s) => (
        <span key={s.name} className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <span className={shape === "line" ? "h-[2px] w-3 rounded-full" : "size-2.5 rounded-[3px]"} style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="scroll-quiet max-h-[260px] overflow-auto rounded-[12px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
      <table className="w-full border-collapse text-[13.5px] leading-[19px]">
        <thead className="sticky top-0 bg-white">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={`border-b border-line px-3 py-2 text-[12.5px] font-medium text-ink-2 ${i ? "text-right" : "text-left"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line first:border-t-0 hover:bg-[#fafafa]">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-1.5 tabular-nums ${j ? "text-right text-ink-2" : "text-ink"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- stats ---------- */

function StatTiles({ spec }: { spec: Extract<ChartSpec, { type: "stats" }> }) {
  const n = spec.items.length;
  return (
    <figure onClick={(e) => e.stopPropagation()} className={`${n <= 2 ? "w-[380px]" : "w-[560px]"} max-w-full cursor-default`}>
      {spec.title && <figcaption className="mb-1.5 px-1 text-[13px] font-medium text-ink-2">{spec.title}</figcaption>}
      <div
        className="grid gap-px overflow-hidden rounded-[20px] bg-[#ececec] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]"
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${n > 3 ? 120 : 140}px, 1fr))` }}
      >
        {spec.items.map((t, i) => (
          <motion.div
            key={t.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...POP, delay: 0.05 * i }}
            className="flex min-w-0 flex-col bg-white px-4 py-3.5"
          >
            <span className="truncate text-[12.5px] text-ink-2" title={t.label}>
              {t.label}
            </span>
            <span className="mt-1 whitespace-nowrap text-[26px] font-semibold leading-[30px] tracking-[-0.01em] text-ink">{fmt(t.value, t.unit)}</span>
            {(t.delta !== undefined || t.trend) && (
              <span className="mt-2 flex items-center gap-2">
                {t.delta !== undefined && <Delta delta={t.delta} unit={t.unit} good={t.good} />}
                {t.trend && <Sparkline values={t.trend} />}
              </span>
            )}
            {t.note && <span className="mt-1 truncate text-[12px] text-muted">{t.note}</span>}
          </motion.div>
        ))}
      </div>
    </figure>
  );
}

function Delta({ delta, unit, good = "up" }: { delta: number; unit?: string; good?: "up" | "down" }) {
  const flat = delta === 0;
  const better = flat ? null : (delta > 0) === (good === "up");
  const tone = better === null ? "bg-[#f2f2f2] text-ink-2" : better ? "bg-[#e6f6ee] text-[#16794c]" : "bg-[#fdecec] text-[#b42318]";
  const Icon = delta >= 0 ? ArrowUpRight : ArrowDownRight;
  const amount = `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${fmtNumber(Math.abs(delta), true)}${unit === "%" ? " pts" : "%"}`;
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full py-px pl-1 pr-1.5 text-[12px] font-medium ${tone}`}>
      {!flat && <Icon className="size-3.5" strokeWidth={2.2} />}
      {amount}
    </span>
  );
}

/** Fills the room the tile has left; the line keeps its 1.5px stroke at any width. */
function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 3 + (1 - (v - min) / span) * 18]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("");
  const lastY = pts[pts.length - 1][1];
  return (
    <span className="relative h-6 min-w-[28px] max-w-[96px] flex-1" aria-hidden>
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <motion.path
          d={d}
          fill="none"
          stroke="#c8c8c8"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </svg>
      <motion.span
        className="absolute right-0 size-[7px] translate-x-1/2 -translate-y-1/2 rounded-full ring-[1.5px] ring-white"
        style={{ top: `${(lastY / 24) * 100}%`, background: SERIES[0] }}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ ...POP, delay: 0.5 }}
      />
    </span>
  );
}

/* ---------- bar / line / area ---------- */

type Plot = Extract<ChartSpec, { type: "bar" | "line" | "area" }>;

function Plotted({ spec }: { spec: Plot }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const many = spec.series.length > 1;
  const colors = spec.series.map((_, i) => SERIES[i % SERIES.length]);
  // One series with many or long categories reads best as a ranked list of horizontal bars.
  const asList = spec.type === "bar" && !many && (spec.x.length > 7 || Math.max(...spec.x.map((x) => x.length)) > 12);
  const table = {
    head: ["", ...spec.series.map((s) => s.name)],
    rows: spec.x.map((x, i) => [x, ...spec.series.map((s) => fmt(s.values[i], spec.unit, false))]),
  };
  return (
    <Card title={spec.title} subtitle={spec.subtitle} right={<ViewToggle view={view} onChange={setView} />}>
      {view === "table" ? (
        <DataTable {...table} />
      ) : (
        <>
          {many && <Legend items={spec.series.map((s, i) => ({ name: s.name, color: colors[i] }))} shape={spec.type === "line" ? "line" : "rect"} />}
          {asList ? (
            <BarList x={spec.x} values={spec.series[0].values} unit={spec.unit} highlight={spec.type === "bar" ? spec.highlight : undefined} />
          ) : spec.type === "bar" ? (
            <Columns spec={spec as Extract<ChartSpec, { type: "bar" }>} colors={colors} />
          ) : (
            <Lines spec={spec} colors={colors} />
          )}
        </>
      )}
    </Card>
  );
}

function rowsOf(x: string[], series: Series[]) {
  return x.map((label, i) => Object.fromEntries([["x", label], ...series.map((s, j) => [`s${j}`, s.values[i]])]));
}

type TipProps = Pick<TooltipContentProps, "active" | "payload" | "label">;

function ChartTooltip({ active, payload, label, unit }: Partial<TipProps> & { unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[120px] rounded-xl bg-white px-3 py-2 shadow-[0_8px_28px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.06)]">
      <div className="mb-1 text-[12px] text-muted">{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 py-px">
          <span className="h-[2px] w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
          <span className="text-[13.5px] font-semibold tabular-nums text-ink">{fmt(Number(p.value), unit, false)}</span>
          <span className="truncate text-[12.5px] text-ink-2">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

const yAxis = (unit?: string) => (
  <YAxis tick={AXIS_TEXT} tickFormatter={(v: number) => fmt(v, unit)} axisLine={false} tickLine={false} width={44} tickCount={5} />
);
const xAxis = <XAxis dataKey="x" tick={AXIS_TEXT} tickLine={false} axisLine={{ stroke: BASELINE }} interval="preserveStartEnd" minTickGap={14} tickMargin={6} />;
const grid = <CartesianGrid vertical={false} stroke={GRID} />;

function Columns({ spec, colors }: { spec: Extract<ChartSpec, { type: "bar" }>; colors: string[] }) {
  const reduce = useReducedMotion();
  const data = useMemo(() => rowsOf(spec.x, spec.series), [spec]);
  const single = spec.series.length === 1;
  const labelled = single && spec.x.length <= 8;
  return (
    <BarChart responsive data={data} style={{ width: "100%", height: 210 }} margin={{ top: labelled ? 18 : 6, right: 4, bottom: 0, left: -6 }} barGap={2} barCategoryGap="24%">
      {grid}
      {xAxis}
      {yAxis(spec.unit)}
      <Tooltip cursor={{ fill: "rgba(0,0,0,0.035)" }} content={(p: TipProps) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} unit={spec.unit} />} />
      {spec.series.map((s, j) => {
        const top = !spec.stacked || j === spec.series.length - 1;
        return (
          <Bar
            key={j}
            dataKey={`s${j}`}
            name={s.name}
            fill={colors[j]}
            stackId={spec.stacked ? "a" : undefined}
            maxBarSize={spec.stacked || single ? 28 : 18}
            radius={top ? [4, 4, 0, 0] : 0}
            // The 2px surface gap between stacked segments.
            stroke={spec.stacked ? "#fff" : undefined}
            strokeWidth={spec.stacked ? 2 : 0}
            isAnimationActive={!reduce}
            animationDuration={650}
            animationEasing="ease-out"
            activeBar={{ fillOpacity: 0.85 }}
            shape={
              single && spec.highlight
                ? (props: { x?: number; y?: number; width?: number; height?: number; payload?: { x: string } }) => (
                    <RoundedBar {...props} fill={props.payload?.x === spec.highlight ? colors[0] : MUTED_MARK} />
                  )
                : undefined
            }
          >
            {labelled && <LabelList dataKey={`s${j}`} position="top" offset={6} formatter={(v) => fmt(Number(v), spec.unit)} style={{ fontSize: 12, fill: "#5d5d5d" }} />}
          </Bar>
        );
      })}
    </BarChart>
  );
}

/** A column with a 4px rounded data end and a square base. */
function RoundedBar({ x = 0, y = 0, width = 0, height = 0, fill }: { x?: number; y?: number; width?: number; height?: number; fill: string }) {
  if (height <= 0 || width <= 0) return null;
  const r = Math.min(4, width / 2, height);
  return <path d={`M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`} fill={fill} />;
}

function Lines({ spec, colors }: { spec: Plot; colors: string[] }) {
  const reduce = useReducedMotion();
  const gid = useId().replace(/:/g, "");
  const data = useMemo(() => rowsOf(spec.x, spec.series), [spec]);
  const last = spec.x.length - 1;
  const single = spec.series.length === 1;
  const area = spec.type === "area";
  const common = {
    data,
    responsive: true,
    style: { width: "100%", height: 200 },
    margin: { top: 10, right: single ? 50 : 10, bottom: 0, left: -6 },
  };
  // Only the latest point gets a marker, ringed in the surface colour.
  const endDot = (color: string) =>
    function EndDot({ cx, cy, index }: { cx?: number; cy?: number; index?: number }) {
      return index === last && cx != null && cy != null ? <circle key="end" cx={cx} cy={cy} r={4} fill={color} stroke="#fff" strokeWidth={2} /> : <g key={index} />;
    };
  const endLabel = (
    <LabelList
      dataKey="s0"
      content={(p) => {
        const { x, y, value, index } = p as { x?: number; y?: number; value?: number; index?: number };
        if (index !== last || x == null || y == null) return null;
        return (
          <text x={Number(x) + 8} y={Number(y) + 4} fontSize={12} fontWeight={600} fill="#0d0d0d">
            {fmt(Number(value), spec.unit)}
          </text>
        );
      }}
    />
  );
  const tooltip = <Tooltip cursor={{ stroke: "#d4d4d4", strokeWidth: 1 }} content={(p: TipProps) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} unit={spec.unit} />} />;
  const anim = { isAnimationActive: !reduce, animationDuration: 800, animationEasing: "ease-out" as const };

  if (area) {
    return (
      <AreaChart {...common}>
        <defs>
          {colors.map((c, j) => (
            <linearGradient key={j} id={`${gid}-${j}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity={0.16} />
              <stop offset="100%" stopColor={c} stopOpacity={0.01} />
            </linearGradient>
          ))}
        </defs>
        {grid}
        {xAxis}
        {yAxis(spec.unit)}
        {tooltip}
        {spec.series.map((s, j) => (
          <Area
            key={j}
            type="monotone"
            dataKey={`s${j}`}
            name={s.name}
            stroke={colors[j]}
            strokeWidth={2}
            fill={`url(#${gid}-${j})`}
            dot={endDot(colors[j])}
            activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }}
            {...anim}
          >
            {single && endLabel}
          </Area>
        ))}
      </AreaChart>
    );
  }
  return (
    <LineChart {...common}>
      {grid}
      {xAxis}
      {yAxis(spec.unit)}
      {tooltip}
      {spec.series.map((s, j) => (
        <Line
          key={j}
          type="monotone"
          dataKey={`s${j}`}
          name={s.name}
          stroke={colors[j]}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={endDot(colors[j])}
          activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }}
          {...anim}
        >
          {single && endLabel}
        </Line>
      ))}
    </LineChart>
  );
}

function BarList({ x, values, unit, highlight }: { x: string[]; values: number[]; unit?: string; highlight?: string }) {
  const max = Math.max(...values, 0) || 1;
  return (
    <ul className="space-y-1">
      {x.map((label, i) => {
        const pct = Math.max(0, values[i]) / max;
        const color = highlight && label !== highlight ? MUTED_MARK : SERIES[0];
        return (
          <li key={i} className="group/row grid grid-cols-[minmax(0,34%)_1fr_auto] items-center gap-3 rounded-lg px-1.5 py-1 transition-colors hover:bg-[#f7f7f7]">
            <span className="truncate text-[13.5px] text-ink" title={label}>
              {label}
            </span>
            <span className="h-3.5">
              <motion.span
                className="block h-full rounded-r-[4px]"
                style={{ background: color }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(pct * 100, 1.5)}%` }}
                transition={{ ...SPRING, delay: 0.03 * i }}
              />
            </span>
            <span className="min-w-[44px] text-right text-[13px] tabular-nums text-ink-2">{fmt(values[i], unit)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- breakdown ---------- */

function Breakdown({ spec }: { spec: Extract<ChartSpec, { type: "breakdown" }> }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [hot, setHot] = useState<number | null>(null);
  // Six parts at most; the rest fold into "Other" rather than earning a new hue.
  const parts = useMemo(() => {
    const p = spec.items.map((it, i) => ({ ...it, color: SERIES[i % SERIES.length] }));
    if (p.length <= 6) return p;
    const rest = p.slice(5).reduce((s, it) => s + it.value, 0);
    return [...p.slice(0, 5), { label: "Other", value: rest, color: OTHER }];
  }, [spec]);
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
  return (
    <Card title={spec.title} subtitle={spec.subtitle} right={<ViewToggle view={view} onChange={setView} />}>
      {view === "table" ? (
        <DataTable head={["", "Value", "Share"]} rows={parts.map((p) => [p.label, fmt(p.value, spec.unit, false), pct(p.value)])} />
      ) : (
        <>
          <div className="mb-1 flex items-baseline gap-1.5">
            <span className="text-[24px] font-semibold leading-[30px] tracking-[-0.01em]">{fmt(total, spec.unit)}</span>
            <span className="text-[13px] text-muted">total</span>
          </div>
          <div className="flex h-3 gap-[2px] overflow-hidden rounded-[4px]" onMouseLeave={() => setHot(null)}>
            {parts.map((p, i) => (
              <motion.span
                key={p.label}
                onMouseEnter={() => setHot(i)}
                title={`${p.label}: ${fmt(p.value, spec.unit, false)} (${pct(p.value)})`}
                className="h-full transition-opacity duration-150"
                style={{ background: p.color, opacity: hot === null || hot === i ? 1 : 0.3 }}
                initial={{ flexGrow: 0.0001 }}
                animate={{ flexGrow: p.value / total }}
                transition={{ ...SPRING, delay: 0.04 * i }}
              />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {parts.map((p, i) => (
              <li
                key={p.label}
                onMouseEnter={() => setHot(i)}
                onMouseLeave={() => setHot(null)}
                className={`flex items-center gap-2 rounded-lg px-1.5 py-1 transition-[background-color,opacity] ${hot === i ? "bg-[#f5f5f5]" : ""} ${hot !== null && hot !== i ? "opacity-60" : ""}`}
              >
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{p.label}</span>
                <span className="text-[13px] tabular-nums text-ink-2">{fmt(p.value, spec.unit)}</span>
                <span className="w-9 text-right text-[12.5px] tabular-nums text-muted">{pct(p.value)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/* ---------- progress ---------- */

const STATUS: Record<ChartStatus, { label: string; fill: string; track: string; chip: string; Icon: typeof Check }> = {
  "on-track": { label: "On track", fill: SERIES[0], track: "#eef2fe", chip: "bg-accent-wash text-accent", Icon: Check },
  "at-risk": { label: "At risk", fill: "#f5a524", track: "#fff4de", chip: "bg-[#fff4de] text-[#9a5b00]", Icon: TriangleAlert },
  behind: { label: "Behind", fill: "#d03b3b", track: "#fdecec", chip: "bg-[#fdecec] text-[#b42318]", Icon: Clock },
  done: { label: "Done", fill: "#22a06b", track: "#e6f6ee", chip: "bg-[#e6f6ee] text-[#16794c]", Icon: Check },
};

function ProgressRows({ spec }: { spec: Extract<ChartSpec, { type: "progress" }> }) {
  return (
    <Card title={spec.title} subtitle={spec.subtitle}>
      <ul className="space-y-3">
        {spec.items.map((it, i) => {
          const s = it.status ? STATUS[it.status] : null;
          return (
            <li key={i}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{it.label}</span>
                {s && (
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-[11.5px] font-medium ${s.chip}`}>
                    <s.Icon className="size-3" strokeWidth={2.4} />
                    {s.label}
                  </span>
                )}
                <span className="w-10 shrink-0 text-right text-[13px] font-medium tabular-nums text-ink-2">{Math.round(it.value * 100)}%</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: s?.track ?? "#eef2fe" }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: s?.fill ?? SERIES[0] }}
                  initial={{ width: 0 }}
                  animate={{ width: `${it.value * 100}%` }}
                  transition={{ ...SPRING, delay: 0.05 * i }}
                />
              </div>
              {it.note && <p className="mt-1 text-[12.5px] text-muted">{it.note}</p>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ---------- timeline ---------- */

function Timeline({ spec }: { spec: Extract<ChartSpec, { type: "timeline" }> }) {
  return (
    <Card title={spec.title} subtitle={spec.subtitle}>
      <ol>
        {spec.items.map((it, i) => {
          const lastRow = i === spec.items.length - 1;
          const done = it.state === "done";
          return (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...POP, delay: 0.05 * i }}
              className="relative flex gap-3 pb-3 last:pb-0"
            >
              {!lastRow && <span className={`absolute left-[8.5px] top-[22px] bottom-0 w-[1.5px] rounded-full ${done ? "bg-accent" : "bg-[#e4e4e4]"}`} />}
              <span className="relative mt-0.5 grid size-[18px] shrink-0 place-items-center">
                {done ? (
                  <span className="grid size-[18px] place-items-center rounded-full bg-accent text-white">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                ) : it.state === "active" ? (
                  <span className="grid size-[18px] place-items-center rounded-full border-[1.5px] border-accent bg-white">
                    <span className="pulse-dot size-2 rounded-full bg-accent" />
                  </span>
                ) : (
                  <span className="size-[18px] rounded-full border-[1.5px] border-[#cfcfcf] bg-white" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={`text-[14.5px] leading-[22px] ${it.state === "active" ? "font-medium text-ink" : done ? "text-ink-2" : "text-ink"}`}>{it.label}</span>
                  {it.date && <span className="shrink-0 text-[12.5px] tabular-nums text-muted">{it.date}</span>}
                </span>
                {it.note && <span className="block text-[13px] leading-[19px] text-muted">{it.note}</span>}
              </span>
            </motion.li>
          );
        })}
      </ol>
    </Card>
  );
}
