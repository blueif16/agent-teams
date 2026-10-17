import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useCached, type Resource } from "@/lib/client-cache";
import { AGENTS } from "@/lib/data";
import { useOrg } from "./org";
import { tierOf } from "@/lib/models";
import { ORDERS } from "@/lib/orders";
import type { AgentReport, CallPoint, TeamReport, Totals } from "@/lib/stats";
import { Mascot } from "./Mascot";
import { POP, SPRING } from "./ui";

/*
 * Performance tabs: concise records of how efficiently agents work, from
 * GET /api/stats (the same numbers the HR agent will judge by), through the
 * client cache: they paint what they showed last and refresh when the ledger
 * announces a change.
 * Token series colors were run through the dataviz palette validator
 * (light surface): all checks pass; aqua sits under 3:1 contrast, so every
 * chart has a legend, tooltips and a table view.
 */
const SERIES = [
  { key: "cached", label: "Cached input", color: "#1baf7a" },
  { key: "fresh", label: "New input", color: "#4166eb" },
  { key: "output", label: "Output", color: "#eb6834" },
] as const;

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const tokens = (n: number) => compact.format(n);
const usd = (v: number) => (v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : v < 100 ? `$${v.toFixed(2)}` : `$${compact.format(v)}`);
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const secs = (ms: number | null) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const shortModel = (m: string) => m.split("/").pop() ?? m;

/** Round up to 1, 2 or 5 × 10^k so axis ticks are clean. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

function split(p: { input: number; cached: number; output: number }) {
  return { cached: p.cached, fresh: Math.max(0, p.input - p.cached), output: p.output };
}

export const agentStats = (agentId: string): Resource => ({ key: `/api/stats?agent=${agentId}`, topic: `stats:agent:${agentId}` });

/** Changes arrive as events; this slow refresh only covers a stream that is down. */
const SAFETY_REFRESH_MS = 120_000;

function useStats<T>(resource: Resource) {
  return useCached<T>(resource, { refreshMs: SAFETY_REFRESH_MS });
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-end justify-between gap-3 px-1">
        <h3 className="text-[13px] font-medium text-muted">{title}</h3>
        {aside}
      </div>
      <div className="rounded-2xl bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">{children}</div>
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white px-3.5 py-3 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
      <div className="text-[12.5px] text-muted">{label}</div>
      <motion.div
        key={value}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={POP}
        className="mt-0.5 text-[22px] font-semibold tracking-[-0.01em]"
      >
        {value}
      </motion.div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

function Kpis({ t }: { t: Totals }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Tile label="Spend" value={usd(t.cost)} sub={t.costPerAccepted != null ? `${usd(t.costPerAccepted)}/accepted` : `${t.calls} calls`} />
      <Tile label="Tokens" value={tokens(t.input + t.output)} sub={`${tokens(t.output)} output`} />
      <Tile label="Cache hit" value={pct(t.cacheHit)} sub={`${tokens(t.cached)} cached input`} />
      <Tile label="Accepted" value={pct(t.acceptRate)} sub={`👍 ${t.accepted} · 🔁 ${t.rejected}`} />
      <Tile label="Avg reply" value={secs(t.avgMs)} sub={`p95 ${secs(t.p95Ms)}`} />
      <Tile label="Failures" value={String(t.errors)} sub={`${t.rerouted} rerouted`} />
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-2">
      {SERIES.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function Tip({ show, children, align = "center" }: { show: boolean; children: ReactNode; align?: "center" | "left" | "right" }) {
  const pos = align === "left" ? "left-0" : align === "right" ? "right-0" : "left-1/2 -translate-x-1/2";
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 4, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={POP}
          className={`pointer-events-none absolute bottom-full z-20 mb-2 w-max max-w-[220px] rounded-xl bg-ink px-2.5 py-2 text-[12px] leading-[17px] text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] ${pos}`}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TipRows({ p }: { p: { input: number; cached: number; output: number } }) {
  const s = split(p);
  return (
    <>
      {SERIES.map((x) => (
        <div key={x.key} className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px]" style={{ background: x.color }} />
          <span className="text-white/70">{x.label}</span>
          <span className="ml-auto pl-3 tabular-nums">{tokens(s[x.key])}</span>
        </div>
      ))}
    </>
  );
}

/** Stacked column per call: how much of each prompt the cache covered, and what it produced. */
function TokensPerCall({ points }: { points: CallPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...points.map((p) => p.input + p.output)));
  const H = 140;
  return (
    <div className="flex gap-2">
      <div className="relative w-8 shrink-0 text-right text-[11px] tabular-nums text-muted" style={{ height: H }}>
        {[1, 0.5, 0].map((f) => (
          <span key={f} className="absolute right-0 -translate-y-1/2" style={{ top: H * (1 - f) }}>
            {tokens(max * f)}
          </span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1" style={{ height: H }}>
        {[0, 0.5, 1].map((f) => (
          <div key={f} className="absolute inset-x-0 h-px bg-line" style={{ top: H * f }} />
        ))}
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {points.map((p, i) => {
            const s = split(p);
            const segs = [s.cached, s.fresh, s.output];
            const topIdx = segs.findLastIndex((v) => v > 0);
            return (
              <div
                key={`${p.at}-${i}`}
                className="relative flex h-full min-w-0 max-w-6 flex-1 cursor-default flex-col-reverse items-stretch"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              >
                <div className={`flex flex-col-reverse gap-[2px] transition-opacity ${hover != null && hover !== i ? "opacity-45" : ""}`}>
                  {segs.map((v, j) =>
                    v > 0 ? (
                      <motion.div
                        key={j}
                        initial={{ height: 0 }}
                        animate={{ height: Math.max(1, (v / max) * H - (j > 0 ? 2 : 0)) }}
                        transition={SPRING}
                        className={j === topIdx ? "rounded-t-[4px]" : ""}
                        style={{ background: SERIES[j].color }}
                      />
                    ) : null,
                  )}
                </div>
                <Tip show={hover === i} align={i < points.length / 4 ? "left" : i > (points.length * 3) / 4 ? "right" : "center"}>
                  <div className="mb-1 font-medium">
                    {clock(p.at)} · {shortModel(p.model)}
                  </div>
                  <TipRows p={p} />
                  <div className="mt-1 text-white/70">
                    {p.ok ? secs(p.ms) : "Failed"}
                  </div>
                </Tip>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One horizontal stacked bar per agent, longest first. */
function TokensByAgent({ report, onOpenAgent }: { report: TeamReport; onOpenAgent: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const rows = [...report.agents].sort((a, b) => b.input + b.output - (a.input + a.output));
  const max = Math.max(1, ...rows.map((a) => a.input + a.output));
  return (
    <div className="space-y-1">
      {rows.map((a) => {
        const agent = AGENTS[a.agent];
        const s = split(a);
        const total = a.input + a.output;
        const segs = [s.cached, s.fresh, s.output];
        const topIdx = segs.findLastIndex((v) => v > 0);
        return (
          <button
            key={a.agent}
            type="button"
            onClick={() => onOpenAgent(a.agent)}
            onMouseEnter={() => setHover(a.agent)}
            onMouseLeave={() => setHover(null)}
            className="tap-soft group relative flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1 text-left hover:bg-bubble"
          >
            <span className="squish-group shrink-0">
              <Mascot look={agent.look} size={20} />
            </span>
            <span className="w-16 shrink-0 truncate text-[13px] font-medium">{agent.name}</span>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="flex h-3.5 min-w-0 gap-[2px]" style={{ width: `${(total / max) * 100}%` }}>
                {segs.map((v, j) =>
                  v > 0 ? (
                    <motion.span
                      key={j}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={SPRING}
                      className={`h-full origin-left ${j === topIdx ? "rounded-r-[4px]" : ""}`}
                      style={{ background: SERIES[j].color, flexGrow: v, flexBasis: 0 }}
                    />
                  ) : null,
                )}
              </span>
              <span className="shrink-0 text-[12px] tabular-nums text-muted">{total ? tokens(total) : "—"}</span>
            </span>
            <Tip show={hover === a.agent && total > 0}>
              <div className="mb-1 font-medium">
                {agent.name} · {usd(a.cost)}
              </div>
              <TipRows p={a} />
            </Tip>
          </button>
        );
      })}
    </div>
  );
}

/** Spend per hour for the last 24 hours. */
function SpendByHour({ report }: { report: TeamReport }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...report.hourly.map((h) => h.cost));
  const top = max > 0 ? max : 1;
  const H = 96;
  return (
    <div>
      <div className="relative" style={{ height: H }}>
        <div className="absolute inset-x-0 bottom-0 h-px bg-line" />
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {report.hourly.map((h, i) => (
            <div
              key={h.hour}
              className="relative flex h-full min-w-0 flex-1 cursor-default items-end justify-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((x) => (x === i ? null : x))}
            >
              {h.cost > 0 && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: Math.max(2, (h.cost / top) * H) }}
                  transition={SPRING}
                  className={`w-full max-w-6 rounded-t-[4px] bg-accent transition-opacity ${hover != null && hover !== i ? "opacity-45" : ""}`}
                />
              )}
              <Tip show={hover === i} align={i < 6 ? "left" : i > 17 ? "right" : "center"}>
                <div className="font-medium">{clock(h.hour)}</div>
                <div className="text-white/70">
                  {usd(h.cost)} · {h.calls} calls · {tokens(h.tokens)} tokens
                </div>
              </Tip>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted">
        <span>{clock(report.hourly[0].hour)}</span>
        <span>{max > 0 ? `peak ${usd(max)}/h` : "no spend in 24h"}</span>
        <span>now</span>
      </div>
    </div>
  );
}

function TableToggle({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="tap inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12.5px] text-ink-2 hover:bg-bubble"
      >
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING} className="grid place-items-center">
          <ChevronDown className="size-3.5" />
        </motion.span>
        {open ? "Hide table" : "Show as table"}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
            className="overflow-hidden"
          >
            <div className="mt-2 overflow-x-auto">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const th = "px-2 py-1.5 text-left font-medium text-muted";
const td = "px-2 py-1.5 tabular-nums";

function Empty({ who }: { who: string }) {
  return (
    <div className="mt-5 rounded-2xl bg-white px-4 py-6 text-center shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
      <p className="text-[14.5px] font-medium">No activity recorded yet</p>
      <p className="mx-auto mt-1 max-w-[360px] text-[13px] leading-[19px] text-ink-2">
        Every reply from {who} is recorded here: tokens, cache hits, latency and spend. Reactions count as accepted (👍) or
        redone (🔁).
      </p>
    </div>
  );
}

function Status({ error }: { error: string }) {
  return <p className="mt-6 text-center text-[13px] text-muted">Couldn&apos;t load stats ({error})</p>;
}

const KPI_LABELS = ["Spend", "Tokens", "Cache hit", "Accepted", "Avg reply", "Failures"];

/** Only the first-ever load shows this; after that the cache always has numbers to paint. */
function StatsSkeleton() {
  const bar = "animate-pulse bg-[#f0f0f0]";
  return (
    <div aria-busy="true" aria-label="Loading stats">
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {KPI_LABELS.map((label, i) => (
          <div key={label} className="rounded-2xl bg-white px-3.5 py-3 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
            <div className="text-[12.5px] text-muted">{label}</div>
            <div className={`mt-1.5 h-[22px] w-16 rounded-md ${bar}`} style={{ animationDelay: `${i * 90}ms` }} />
            <div className={`mt-1.5 h-3 w-24 rounded-full ${bar}`} style={{ animationDelay: `${i * 90}ms` }} />
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-2xl bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
        <div className="flex h-[120px] items-end gap-3 border-b border-[#ececec] px-2">
          {[46, 70, 38, 88, 60, 76, 52].map((h, i) => (
            <span key={i} className={`flex-1 rounded-t-[4px] ${bar}`} style={{ height: `${h}%`, animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function TeamPerformance({ teamId, onOpenAgent }: { teamId: string; onOpenAgent: (id: string) => void }) {
  const team = useOrg().teamsById[teamId];
  // Launched teams exist only in the browser, so they name their members.
  const { data, error } = useStats<TeamReport>({
    key: `/api/stats?team=${teamId}${team.launched ? `&agents=${team.agents.map((a) => a.id).join(",")}` : ""}`,
    topic: `stats:team:${teamId}`,
  });
  if (!data) return error ? <Status error={error} /> : <StatsSkeleton />;
  const active = data.agents.some((a) => a.calls > 0);
  return (
    <div>
      <Kpis t={data.totals} />
      {!active ? (
        <Empty who={`#${team.channel}'s agents`} />
      ) : (
        <>
          <Section title="Tokens by agent" aside={<Legend />}>
            <TokensByAgent report={data} onOpenAgent={onOpenAgent} />
            <TableToggle>
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Agent</th>
                    <th className={th}>Calls</th>
                    <th className={th}>Tokens</th>
                    <th className={th}>Cache</th>
                    <th className={th}>Avg reply</th>
                    <th className={th}>👍 / 🔁</th>
                    <th className={th}>Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((a) => (
                    <tr key={a.agent} className="border-b border-line last:border-0">
                      <td className="px-2 py-1.5">{AGENTS[a.agent].name}</td>
                      <td className={td}>{a.calls}</td>
                      <td className={td}>{tokens(a.input + a.output)}</td>
                      <td className={td}>{pct(a.cacheHit)}</td>
                      <td className={td}>{secs(a.avgMs)}</td>
                      <td className={td}>
                        {a.accepted} / {a.rejected}
                      </td>
                      <td className={td}>{usd(a.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableToggle>
          </Section>
          <Section title="Spend by hour, last 24 hours">
            <SpendByHour report={data} />
          </Section>
        </>
      )}
    </div>
  );
}

export function AgentPerformance({ agentId }: { agentId: string }) {
  const { data, error } = useStats<AgentReport>(agentStats(agentId));
  if (!data) return error ? <Status error={error} /> : <StatsSkeleton />;
  const agent = AGENTS[agentId];
  const signals = data.calls > 0 || ORDERS.some((o) => data.orders[o.key] > 0);
  return (
    <div>
      <Kpis t={data} />
      {!signals ? (
        <Empty who={agent.name} />
      ) : (
        <>
          {data.recent.length > 0 && (
            <Section title={`Tokens per call, last ${data.recent.length}`} aside={<Legend />}>
              <TokensPerCall points={data.recent} />
              <TableToggle>
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line">
                      <th className={th}>Time</th>
                      <th className={th}>Model</th>
                      <th className={th}>Cached</th>
                      <th className={th}>New</th>
                      <th className={th}>Output</th>
                      <th className={th}>Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.recent].reverse().map((p, i) => {
                      const s = split(p);
                      return (
                        <tr key={`${p.at}-${i}`} className="border-b border-line last:border-0">
                          <td className={td}>{clock(p.at)}</td>
                          <td className="px-2 py-1.5">{shortModel(p.model)}</td>
                          <td className={td}>{tokens(s.cached)}</td>
                          <td className={td}>{tokens(s.fresh)}</td>
                          <td className={td}>{tokens(s.output)}</td>
                          <td className={td}>{p.ok ? secs(p.ms) : "failed"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableToggle>
            </Section>
          )}
          <Section title="Your orders">
            <div className="flex flex-wrap gap-1.5">
              {ORDERS.map((o) => (
                <span
                  key={o.key}
                  title={o.meaning}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] ${data.orders[o.key] ? "bg-bubble text-ink" : "bg-bubble/60 text-muted"}`}
                >
                  <span>{o.emoji}</span>
                  {o.label}
                  <span className="tabular-nums font-medium">{data.orders[o.key]}</span>
                </span>
              ))}
            </div>
          </Section>
          {Object.keys(data.models).length > 0 && (
            <Section title="Models">
              {Object.entries(data.models)
                .sort((a, b) => b[1] - a[1])
                .map(([m, n]) => (
                  <div key={m} className="flex items-center gap-2 py-1 text-[13px]">
                    <span className="font-mono text-[12px] text-ink-2">{m}</span>
                    {tierOf(m) && <span className="rounded-full bg-bubble px-1.5 py-px text-[11px] text-muted">{tierOf(m)}</span>}
                    <span className="ml-auto tabular-nums text-muted">{n} calls</span>
                  </div>
                ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}
