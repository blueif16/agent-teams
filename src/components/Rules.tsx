import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Info, Loader, Lock, Quote, Trash2, TriangleAlert } from "lucide-react";
import { AGENTS } from "@/lib/data";
import type { CompileResult, DetectorSummary, Outcome, Rule, RuleConflict, RuleKind, RulesResponse, Scope } from "@/lib/policy/types";
import { useOrg } from "./org";
import { POP, SPRING } from "./ui";

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

/** The confirm step before a DELETE: anchored to the trash button, closes on Escape or a click outside. */
function RemoveConfirm({
  sentence,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  sentence: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onCancel} />
      <motion.div
        role="dialog"
        aria-label="Remove this rule?"
        initial={{ opacity: 0, scale: 0.94, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.1 } }}
        transition={SPRING}
        style={{ transformOrigin: "top right" }}
        className="absolute right-0 top-full z-40 mt-1.5 w-64 rounded-2xl bg-white p-3 text-left text-ink shadow-[0_8px_30px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.05)]"
      >
        <p className="text-[13.5px] font-medium">Remove this rule?</p>
        <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[17px] text-ink-2">{sentence}</p>
        {error && <p className="mt-1.5 text-[12px] leading-[16px] text-danger">{error}</p>}
        <div className="mt-2.5 flex justify-end gap-1.5">
          <button type="button" onClick={onCancel} className="tap rounded-full px-3 py-1 text-[13px] font-medium text-ink-2 hover:bg-bubble">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="tap rounded-full bg-danger px-3 py-1 text-[13px] font-medium text-white hover:shadow-lg hover:shadow-danger/30 disabled:opacity-60"
          >
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      </motion.div>
    </>
  );
}

interface Removal {
  confirming: boolean;
  busy: boolean;
  error: string | null;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function RuleRow({ rule, sentence, fresh, reveal, removal }: { rule: Rule; sentence: string; fresh: boolean; reveal: boolean; removal: Removal }) {
  const org = useOrg();
  // Defaults and locked rules stay; anything you or an approval added can go.
  const removable = !rule.locked && rule.createdBy !== "default";
  const ref = useRef<HTMLLIElement>(null);
  // A rule you just saved scrolls into view, so you see it pop in.
  useEffect(() => {
    if (!reveal) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" });
  }, [reveal]);
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
      ref={ref}
      initial={fresh ? { opacity: 0, y: 12, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      // Fade first, then close the gap, so the leaving text never overlaps the row below.
      exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, transition: { opacity: { duration: 0.08 }, default: SPRING } }}
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
        <span className="relative grid size-7 shrink-0 place-items-center text-muted">
          {rule.locked ? (
            <span role="img" aria-label="Locked" title="Locked: no grant can relax it, and it can't be removed here">
              <Lock className="size-3.5" />
            </span>
          ) : (
            removable && (
              <button
                type="button"
                aria-label={`Remove rule: ${sentence}`}
                aria-expanded={removal.confirming}
                title="Remove"
                onClick={removal.onAsk}
                className={`tap grid size-7 place-items-center rounded-full hover:bg-danger-wash hover:text-danger ${removal.confirming ? "bg-danger-wash text-danger" : ""}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            )
          )}
          <AnimatePresence>
            {removal.confirming && (
              <RemoveConfirm sentence={sentence} busy={removal.busy} error={removal.error} onCancel={removal.onCancel} onConfirm={removal.onConfirm} />
            )}
          </AnimatePresence>
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

function RulesList({
  data,
  fresh,
  saved,
  onRemoved,
}: {
  data: RulesResponse;
  fresh: ReadonlySet<string>;
  saved: ReadonlySet<string>;
  onRemoved: () => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Removed rows leave at once, before the refetch lands.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const cancel = useCallback(() => {
    setConfirm(null);
    setError(null);
  }, []);
  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rules/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw await failure(res, "Couldn't remove it");
      setGone((g) => new Set(g).add(id));
      setConfirm(null);
      onRemoved();
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(false);
    }
  };
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
        const rules = data.rules.filter((r) => r.kind === kind && !gone.has(r.id));
        if (rules.length === 0) return null;
        return (
          <Section key={kind} title={title} aside={<span className="text-[12px] tabular-nums text-muted">{rules.length}</span>}>
            <ul>
              <AnimatePresence initial={false}>
                {rules.map((r) => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    sentence={data.readBack[r.id] ?? r.reason ?? `A ${r.kind} rule`}
                    fresh={fresh.has(r.id)}
                    reveal={fresh.has(r.id) && saved.has(r.id)}
                    removal={{
                      confirming: confirm === r.id,
                      busy: busy && confirm === r.id,
                      error: confirm === r.id ? error : null,
                      onAsk: () => {
                        setError(null);
                        setConfirm((c) => (c === r.id ? null : r.id));
                      },
                      onCancel: cancel,
                      onConfirm: () => void remove(r.id),
                    }}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </Section>
        );
      })}
    </>
  );
}

const CONFLICT_LABEL: Record<RuleConflict["kind"], string> = {
  shadowed: "Already covered",
  tightens: "Tightens",
  revokes_grant: "Revokes a grant",
  duplicate: "Duplicate",
};

/** POST /api/rules { rules, mode }: the same two modes a rule carries. */
type SaveMode = NonNullable<Rule["mode"]>;

/** The server's own `{ error }` message when it sent one, else a plain fallback. */
async function failure(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return new Error(typeof body?.error === "string" ? body.error : `${fallback} (${res.status})`);
}
const reason = (e: unknown) => (e instanceof TypeError ? "The app server didn't answer" : (e as Error).message);
const asSentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

const btn = "tap rounded-full px-3.5 py-1.5 text-[13.5px] font-medium";

function Proposal({
  result,
  round,
  busy,
  picked,
  error,
  existing,
  onAnswer,
  onSave,
  onCancel,
}: {
  result: CompileResult;
  round: number;
  busy: "compile" | SaveMode | null;
  picked: string | null;
  error: string | null;
  /** Read-backs of the rules already in force, for the conflict lines. */
  existing: Record<string, string>;
  onAnswer: (q: string, option: string) => void;
  onSave: (mode: SaveMode) => void;
  onCancel: () => void;
}) {
  const n = result.rules.length;
  // readBack is a list, not keyed by id; when it lines up with the rules, each line gets its rule's chip.
  const aligned = n === result.readBack.length;
  const d = result.dryRun;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.14 } }}
      transition={POP}
      style={{ transformOrigin: "top center" }}
      className="mt-2 rounded-[20px] bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_8px_24px_rgba(0,0,0,0.06)]"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-medium text-muted">{n === 0 ? "Nothing new to add" : n === 1 ? "Proposed rule" : `Proposed rules (${n})`}</h3>
        {busy === "compile" && (
          <span className="inline-flex items-center gap-1 text-[12px] text-muted">
            <Loader className="size-3 animate-spin motion-reduce:animate-none" />
            Updating…
          </span>
        )}
      </div>
      {/* Keyed per compile so a recompiled proposal pops in. */}
      <motion.div
        key={round}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: busy === "compile" ? 0.55 : 1, y: 0 }}
        transition={POP}
      >
        <ul className="mt-2 space-y-1.5">
          {result.readBack.map((line, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="min-w-0 flex-1 text-[14.5px] leading-[21px]">{line}</span>
              {aligned && (
                <span className="mt-0.5 flex">
                  <OutcomeChip {...outcomeOf(result.rules[i])} />
                </span>
              )}
            </li>
          ))}
        </ul>

        {result.questions.map((q) => (
          <div key={q.q} className="mt-3">
            <p className="text-[13.5px] font-medium leading-[19px]">{q.q}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {q.options.map((o) => {
                const on = picked === `${q.q}\n${o}`;
                return (
                  <button
                    key={o}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => onAnswer(q.q, o)}
                    className={`tap rounded-full px-3 py-1 text-[13px] ${on ? "bg-accent text-white" : "bg-bubble hover:bg-black/[0.08] disabled:opacity-60"}`}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {result.assumptions.length > 0 && (
          <ul className="mt-3 space-y-0.5">
            {result.assumptions.map((a) => (
              <li key={a} className="flex gap-1.5 text-[12.5px] leading-[18px] text-ink-2">
                <Info className="mt-[3px] size-3 shrink-0 text-muted" />
                <span>Assumed: {a}</span>
              </li>
            ))}
          </ul>
        )}

        {result.conflicts.map((c) => (
          <div key={`${c.kind}-${c.ruleId}-${c.otherRuleId}`} className="mt-3 flex gap-2 rounded-xl bg-caution-wash px-3 py-2 text-[13px] leading-[18px]">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-caution" />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-caution">{CONFLICT_LABEL[c.kind]}</span> · {c.note}
              {existing[c.otherRuleId] && (
                <span className="mt-0.5 block truncate text-[12px] text-ink-2" title={existing[c.otherRuleId]}>
                  Existing rule: {existing[c.otherRuleId]}
                </span>
              )}
            </span>
          </div>
        ))}

        <div className="mt-3 border-t border-line pt-3 text-[13px] leading-[19px] text-ink-2">
          {d ? (
            <>
              <p>If it had been on for the last {plural(d.total, "recorded call")}:</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <OutcomeChip label={`${d.block} blocked`} tone="danger" />
                <OutcomeChip label={`${d.ask} asked`} tone="ask" />
                <OutcomeChip label={`${d.redact} redacted`} tone="caution" />
                <OutcomeChip label={`${d.allow} allowed`} tone="neutral" />
              </div>
            </>
          ) : (
            <p>No recorded tool calls yet, so there&apos;s nothing to test it on.</p>
          )}
        </div>
      </motion.div>

      {error && <p className="mt-3 text-[12.5px] text-danger">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={n === 0 || busy !== null}
          onClick={() => onSave("enforce")}
          className={`${btn} bg-accent text-white hover:shadow-lg hover:shadow-accent/30 disabled:bg-accent-soft disabled:shadow-none`}
        >
          {busy === "enforce" ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={n === 0 || busy !== null}
          onClick={() => onSave("shadow")}
          title="Log what it would do, without enforcing it"
          className={`${btn} bg-white ring-1 ring-black/10 hover:bg-bubble disabled:opacity-50`}
        >
          {busy === "shadow" ? "Saving…" : "Save as shadow"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy === "enforce" || busy === "shadow"} className={`${btn} text-ink-2 hover:bg-bubble`}>
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

/** "Describe a rule…": compiles the sentence, shows the proposal, saves it. */
function RuleComposer({
  agentId,
  projectId,
  existing,
  onSaved,
}: {
  agentId?: string;
  projectId?: string;
  existing: Record<string, string>;
  onSaved: (ids: string[], mode: SaveMode) => void;
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<CompileResult | null>(null);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState<"compile" | SaveMode | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Cancel, so a compile that lands afterwards doesn't reopen the card.
  const attempt = useRef(0);

  const compile = async (sentence: string) => {
    if (!sentence.trim() || busy) return;
    const mine = ++attempt.current;
    setBusy("compile");
    setError(null);
    try {
      const res = await fetch("/api/rules/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sentence.trim(), agent: agentId, project: projectId }),
      });
      if (!res.ok) throw await failure(res, "Couldn't turn that into a rule");
      const r = (await res.json()) as CompileResult;
      if (mine !== attempt.current) return;
      setResult(r);
      setRound((x) => x + 1);
    } catch (e) {
      if (mine === attempt.current) setError(reason(e));
    } finally {
      if (mine === attempt.current) {
        setBusy(null);
        setPicked(null);
      }
    }
  };

  // An answer joins the sentence, so the box shows exactly what was compiled.
  const answer = (q: string, option: string) => {
    const next = `${asSentence(text)} ${q.trim()} ${asSentence(option)}`;
    setText(next);
    setPicked(`${q}\n${option}`);
    void compile(next);
  };

  const save = async (mode: SaveMode) => {
    if (!result?.rules.length || busy) return;
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: result.rules, mode }),
      });
      if (!res.ok) throw await failure(res, "Couldn't save the rule");
      onSaved(result.rules.map((r) => r.id), mode);
      setResult(null);
      setText("");
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    attempt.current++;
    setResult(null);
    setBusy(null);
    setPicked(null);
    setError(null);
  };

  const canSend = text.trim().length > 0 && busy === null;
  return (
    <div className="mt-5">
      <div className="flex items-end gap-1 rounded-[22px] border border-line bg-white py-1.5 pl-4 pr-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] focus-within:border-accent-soft focus-within:ring-3 focus-within:ring-accent/12">
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void compile(text);
            }
          }}
          placeholder="Describe a rule…"
          aria-label="Describe a rule"
          className="own-focus scroll-quiet field-sizing-content max-h-40 min-h-[34px] min-w-0 flex-1 resize-none bg-transparent py-[7px] text-[14.5px] leading-[20px] outline-none placeholder:text-muted"
        />
        <button
          type="button"
          aria-label="Turn into a rule"
          title="Turn into a rule"
          onClick={() => void compile(text)}
          disabled={!canSend}
          className={`tap grid size-[34px] shrink-0 place-items-center rounded-full text-white ${canSend ? "bg-accent hover:shadow-lg hover:shadow-accent/30" : "bg-accent-soft"}`}
        >
          {busy === "compile" ? (
            <Loader className="size-[17px] animate-spin motion-reduce:animate-none" />
          ) : (
            <ArrowUp className="size-[18px]" strokeWidth={2.2} />
          )}
        </button>
      </div>
      {!result && (
        <p className={`mt-1.5 px-4 text-[12.5px] leading-[18px] ${error ? "text-danger" : "text-muted"}`}>
          {error ?? "Like “Never email Acme files to anyone outside acme.com.”"}
        </p>
      )}
      <AnimatePresence initial={false}>
        {result && (
          <Proposal
            key="proposal"
            result={result}
            round={round}
            busy={busy}
            picked={picked}
            error={error}
            existing={existing}
            onAnswer={answer}
            onSave={(m) => void save(m)}
            onCancel={cancel}
          />
        )}
      </AnimatePresence>
    </div>
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
export function RulesTab({ agentId, projectId, onNotify }: { agentId?: string; projectId?: string; onNotify: (text: string) => void }) {
  const query = agentId ? `agent=${encodeURIComponent(agentId)}` : `project=${encodeURIComponent(projectId ?? "")}`;
  const { data, fresh, error, reload } = useRules(`/api/rules?${query}`);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  if (!data) return <LoadState error={error} onRetry={reload} />;
  const locked = data.rules.filter((r) => r.locked).length;
  return (
    <div className="@container">
      <RuleComposer
        agentId={agentId}
        projectId={projectId}
        existing={data.readBack}
        onSaved={(ids, mode) => {
          setSaved(new Set(ids));
          reload();
          onNotify(`Saved ${plural(ids.length, "rule")}${mode === "shadow" ? " in shadow mode" : ""}`);
        }}
      />
      <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1">
        <span className="mr-1 text-[13px] text-ink-2">
          {plural(data.rules.length, "rule")} · {locked} locked
        </span>
        {data.detectors.map((d) => (
          <DetectorChip key={d.id} d={d} />
        ))}
      </div>
      <RulesList
        data={data}
        fresh={fresh}
        saved={saved}
        onRemoved={() => {
          reload();
          onNotify("Rule removed");
        }}
      />
    </div>
  );
}
