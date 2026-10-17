import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Lock, Quote } from "lucide-react";
import { AGENTS } from "@/lib/data";
import type { DetectorSummary, Outcome, Rule, RuleKind, RulesResponse, Scope } from "@/lib/policy/types";
import { useOrg } from "./org";
import { POP } from "./ui";

/*
 * Rules tab (design §6, E-privacy §7 V4): the privacy and tool rules an agent or project runs under, from
 * GET /api/rules. One line per rule, read back in plain English from the JSON, with an outcome chip.
 */

const TONE = {
  danger: "bg-danger-wash text-danger",
  ask: "bg-accent-wash text-accent",
  caution: "bg-caution-wash text-caution",
  neutral: "bg-bubble text-ink-2",
} as const;
type Tone = keyof typeof TONE;

/** Red stops, blue asks, amber rewrites, gray lets through. */
const OUTCOME_TONE: Record<Outcome, Tone> = {
  block: "danger",
  deny: "danger",
  ask: "ask",
  tokenize: "caution",
  redact: "caution",
  hash: "caution",
  mask: "caution",
  allow: "neutral",
};

const GROUPS: { kind: RuleKind; title: string }[] = [
  { kind: "flow", title: "Data flows" },
  { kind: "tool", title: "Tools" },
  { kind: "grant", title: "Grants" },
  { kind: "budget", title: "Budgets" },
  { kind: "classifier", title: "Classifiers" },
];

const DETECTOR_KIND: Record<DetectorSummary["kind"], string> = { secret: "Secrets", pii: "PII", custom: "Custom" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What a rule does when it fires, as a chip. */
function outcomeOf(rule: Rule): { label: string; tone: Tone } {
  switch (rule.kind) {
    case "tool":
      return { label: rule.effect, tone: OUTCOME_TONE[rule.effect] };
    case "flow":
      return { label: rule.action, tone: OUTCOME_TONE[rule.action] };
    case "grant":
      // A grant only ever turns an ask into an allow.
      return { label: "allow", tone: "neutral" };
    case "budget":
      return rule.onExceed === "ask"
        ? { label: "ask", tone: "ask" }
        : rule.onExceed === "deny"
          ? { label: "deny", tone: "danger" }
          : rule.onExceed === "end"
            ? { label: "end run", tone: "danger" }
            : { label: "pause", tone: "caution" };
    case "classifier":
      return { label: "label", tone: "neutral" };
  }
}

function OutcomeChip({ label, tone, pop = false }: { label: string; tone: Tone; pop?: boolean }) {
  const cls = `inline-flex min-w-[48px] shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-[12px] font-medium leading-[16px] ${TONE[tone]}`;
  // Keyed on the outcome so a change pops instead of swapping silently.
  return pop ? (
    <motion.span key={label} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={POP} className={cls}>
      {label}
    </motion.span>
  ) : (
    <span className={cls}>{label}</span>
  );
}

/** Fetches the rules now, every 15s, and when the window regains focus; `reload` refetches at once. */
function useRules(url: string) {
  // `fresh` holds the ids that arrived since the previous load, so new rows can pop in.
  const [state, setState] = useState<{ data: RulesResponse | null; fresh: ReadonlySet<string> }>({ data: null, fresh: new Set() });
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`The server answered ${r.status}`))))
        .then((d: RulesResponse) => {
          if (!alive) return;
          setState((s) => {
            const before = s.data ? new Set(s.data.rules.map((r) => r.id)) : null;
            return { data: d, fresh: new Set(before ? d.rules.filter((r) => !before.has(r.id)).map((r) => r.id) : []) };
          });
          setError(null);
        })
        .catch((e: Error) => alive && setError(e instanceof TypeError ? "The app server didn't answer" : e.message));
    load();
    const timer = setInterval(load, 15_000);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [url, tick]);
  const reload = useCallback(() => {
    setError(null);
    setTick((t) => t + 1);
  }, []);
  return { ...state, error, reload };
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-end justify-between gap-3 px-1">
        <h3 className="text-[13px] font-medium text-muted">{title}</h3>
        {aside}
      </div>
      <div className="rounded-2xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">{children}</div>
    </section>
  );
}

function DetectorChip({ d }: { d: DetectorSummary }) {
  const hosted = d.configured !== undefined;
  return (
    <span
      title={`${d.source} · ${d.license}${hosted && !d.configured ? " · not configured" : ""}`}
      className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[12px] leading-[16px] text-ink-2 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]"
    >
      {hosted ? (
        <>
          <span className={`size-1.5 rounded-full ${d.configured ? "bg-mint" : "bg-muted"}`} />
          {d.name} · {d.configured ? "on" : "off"}
        </>
      ) : (
        <>
          {DETECTOR_KIND[d.kind]} · {d.name}
          <span className="font-medium tabular-nums text-ink">{d.rules}</span>
        </>
      )}
    </span>
  );
}

/** Who a rule applies to, when it isn't everyone. */
function scopeChips(scope: Scope, channel: (projectId: string) => string): { label: string; title: string }[] {
  const real = (xs?: string[]) => (xs ?? []).filter((x) => x !== "*");
  const chip = (xs: string[], name: (x: string) => string) => {
    const names = xs.map(name);
    return { label: names.length > 2 ? `${names[0]} +${names.length - 1}` : names.join(", "), title: names.join(", ") };
  };
  const out: { label: string; title: string }[] = [];
  const agents = real(scope.agents);
  const archetypes = real(scope.archetypes);
  const projects = real(scope.projects);
  if (agents.length) out.push(chip(agents, (id) => AGENTS[id]?.name ?? id));
  if (archetypes.length) out.push(chip(archetypes, (a) => `${a}s`));
  if (projects.length) out.push(chip(projects, (p) => (p === "dm:*" ? "DMs" : `#${channel(p)}`)));
  return out;
}

function RuleRow({ rule, sentence, fresh }: { rule: Rule; sentence: string; fresh: boolean }) {
  const org = useOrg();
  const outcome = outcomeOf(rule);
  const shadow = rule.mode === "shadow";
  const scopes = scopeChips(rule.scope, (p) => org.teamsById[p]?.channel ?? p);
  const meta = (shadow || scopes.length > 0) && (
    <>
      {shadow && (
        <span
          title="Shadow mode: logged, never enforced"
          className="shrink-0 rounded-full border border-dashed border-ink-2/40 px-1.5 text-[11px] leading-[16px] text-ink-2"
        >
          shadow
        </span>
      )}
      {scopes.map((s) => (
        <span key={s.title} title={s.title} className="max-w-[140px] shrink-0 truncate rounded-full bg-bubble px-1.5 text-[11.5px] leading-[18px] text-ink-2">
          {s.label}
        </span>
      ))}
    </>
  );
  return (
    <motion.li
      initial={fresh ? { opacity: 0, y: 12, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
      transition={POP}
      className="border-t border-line px-4 py-2.5 first:border-t-0"
    >
      <div className="flex items-center gap-2">
        {/* One line in a wide pane; two in a narrow one, where one line would cut most of the sentence. */}
        <span
          className="min-w-0 flex-1 text-[14px] leading-[20px] @max-md:line-clamp-2 @md:truncate"
          title={rule.reason ? `${sentence}\n${rule.reason}` : sentence}
        >
          {sentence}
        </span>
        {meta && <span className="hidden shrink-0 items-center gap-1 @md:flex">{meta}</span>}
        <OutcomeChip {...outcome} />
        <span className="grid size-7 shrink-0 place-items-center text-muted">
          {rule.locked && (
            <span role="img" aria-label="Locked" title="Locked: no grant can relax it, and it can't be removed here">
              <Lock className="size-3.5" />
            </span>
          )}
        </span>
      </div>
      {meta && <div className="mt-1 flex flex-wrap gap-1 @md:hidden">{meta}</div>}
      {rule.source?.nl && (
        <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] leading-[18px] text-muted">
          <Quote className="size-3 shrink-0" />
          <span className="min-w-0 truncate" title={rule.source.nl}>
            {rule.source.nl}
          </span>
        </p>
      )}
    </motion.li>
  );
}

function RulesList({ data, fresh }: { data: RulesResponse; fresh: ReadonlySet<string> }) {
  if (data.rules.length === 0)
    return (
      <div className="mt-6 rounded-2xl bg-white px-4 py-6 text-center shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
        <p className="text-[14.5px] font-medium">No rules yet</p>
        <p className="mx-auto mt-1 max-w-[360px] text-[13px] leading-[19px] text-ink-2">
          Each tool falls back to its tier&apos;s default. Describe a rule in plain words and it shows here once you save it.
        </p>
      </div>
    );
  return (
    <>
      {GROUPS.map(({ kind, title }) => {
        const rules = data.rules.filter((r) => r.kind === kind);
        if (rules.length === 0) return null;
        return (
          <Section key={kind} title={title} aside={<span className="text-[12px] tabular-nums text-muted">{rules.length}</span>}>
            <ul>
              <AnimatePresence initial={false}>
                {rules.map((r) => (
                  <RuleRow key={r.id} rule={r} sentence={data.readBack[r.id] ?? r.reason ?? `A ${r.kind} rule`} fresh={fresh.has(r.id)} />
                ))}
              </AnimatePresence>
            </ul>
          </Section>
        );
      })}
    </>
  );
}

function LoadState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return <p className="mt-6 text-center text-[13px] text-muted">Loading rules…</p>;
  return (
    <div className="mt-6 rounded-2xl bg-white px-4 py-6 text-center shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
      <p className="text-[14.5px] font-medium">Couldn&apos;t load the rules</p>
      <p className="mx-auto mt-1 max-w-[360px] text-[13px] leading-[19px] text-ink-2">{error}. Try again in a moment.</p>
      <button
        type="button"
        onClick={onRetry}
        className="tap mt-3 rounded-full bg-white px-3.5 py-1.5 text-[13.5px] font-medium ring-1 ring-black/10 hover:bg-bubble"
      >
        Try again
      </button>
    </div>
  );
}

/** The Rules tab: `agentId` for an agent's panel, `projectId` for a team's. */
export function RulesTab({ agentId, projectId }: { agentId?: string; projectId?: string }) {
  const query = agentId ? `agent=${encodeURIComponent(agentId)}` : `project=${encodeURIComponent(projectId ?? "")}`;
  const { data, fresh, error, reload } = useRules(`/api/rules?${query}`);
  if (!data) return <LoadState error={error} onRetry={reload} />;
  const locked = data.rules.filter((r) => r.locked).length;
  return (
    <div className="@container">
      <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1">
        <span className="mr-1 text-[13px] text-ink-2">
          {plural(data.rules.length, "rule")} · {locked} locked
        </span>
        {data.detectors.map((d) => (
          <DetectorChip key={d.id} d={d} />
        ))}
      </div>
      <RulesList data={data} fresh={fresh} />
    </div>
  );
}
