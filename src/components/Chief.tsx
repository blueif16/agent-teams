"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarClock, ChartColumnIncreasing, Check, ChevronRight, Clock, Loader2, MessageCircle, Plus, Shuffle, Trophy, Wallet, X } from "lucide-react";
import { CAST, CHIEF } from "@/lib/data";
import { CHIEF_SHORTCUTS, type OptionPlan, type RosterEntry } from "@/lib/project";
import type { AgentStatus, Message } from "@/lib/types";
import { Mascot } from "./Mascot";
import { useOrg } from "./org";
import { POP, SPRING, StatusDot } from "./ui";

const SHORTCUT_ICONS = [ChartColumnIncreasing, Trophy, CalendarClock, Shuffle];

/** The chief at the bottom of the rail. A dot means she has something to tell you. */
export function ChiefButton({ open, unread, onClick }: { open: boolean; unread: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${CHIEF.name}, your CEO`}
      title={`${CHIEF.name}, your CEO`}
      aria-expanded={open}
      className="group relative mb-3 grid size-11 place-items-center rounded-full"
    >
      <span
        className={`absolute inset-0 rounded-full transition-colors ${open ? "bg-white shadow-[0_1px_4px_rgba(0,0,0,0.1)]" : "group-hover:bg-black/[0.06]"}`}
      />
      <span className="squish relative block">
        <Mascot look={CHIEF.look} size={34} />
      </span>
      <AnimatePresence>
        {unread && (
          <motion.span
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.3, opacity: 0 }}
            transition={POP}
            className="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-accent ring-2 ring-frame"
          />
        )}
      </AnimatePresence>
    </button>
  );
}

function MenuRow({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap-soft flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-[7px] text-left text-[14px] text-ink hover:bg-black/[0.05]"
    >
      <span className="grid size-4 shrink-0 place-items-center text-muted">{icon}</span>
      {children}
    </button>
  );
}

/** Shortcuts to the chief: the questions you'd ask a CEO in a hallway, and the way into her DM. */
export function ChiefMenu({
  open,
  status,
  note,
  onClose,
  onAsk,
  onStartProject,
  onOpenChat,
}: {
  open: boolean;
  status: AgentStatus;
  note: string | null;
  onClose: () => void;
  onAsk: (text: string) => void;
  onStartProject: () => void;
  onOpenChat: () => void;
}) {
  const { teams } = useOrg();
  const agents = new Set(teams.flatMap((t) => t.agents.map((a) => a.id))).size;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="chief-scrim" className="fixed inset-0 z-40" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            key="chief-menu"
            role="menu"
            aria-label={`Ask ${CHIEF.name}`}
            initial={{ opacity: 0, scale: 0.94, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4, transition: { duration: 0.12 } }}
            transition={SPRING}
            style={{ transformOrigin: "0% 100%" }}
            className="fixed bottom-3 left-[60px] z-50 w-[min(300px,calc(100vw-72px))] rounded-[20px] bg-white p-1.5 shadow-[0_14px_44px_rgba(0,0,0,0.16),0_0_0_1px_rgba(0,0,0,0.06)]"
          >
            <div className="flex items-center gap-3 px-2.5 pb-2 pt-2">
              <Mascot look={CHIEF.look} size={40} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[15px] font-semibold">
                  {CHIEF.name}
                  <StatusDot status={status} className="size-[7px]" />
                </div>
                <div className="truncate text-[12.5px] text-muted">
                  CEO · {teams.length} teams, {agents} agents
                </div>
              </div>
            </div>
            {note && (
              <button
                type="button"
                onClick={onOpenChat}
                className="tap-soft mx-1 mb-1.5 block w-[calc(100%-8px)] rounded-[14px] bg-bubble px-3 py-2 text-left text-[13.5px] leading-[19px] text-ink hover:bg-[#ececec]"
              >
                <span className="line-clamp-3">{note}</span>
              </button>
            )}
            {CHIEF_SHORTCUTS.map((s, i) => {
              const Icon = SHORTCUT_ICONS[i] ?? MessageCircle;
              return (
                <MenuRow key={s.label} icon={<Icon className="size-4" strokeWidth={1.8} />} onClick={() => onAsk(s.ask)}>
                  {s.label}
                </MenuRow>
              );
            })}
            <MenuRow icon={<Plus className="size-4" strokeWidth={2} />} onClick={onStartProject}>
              Start a new project…
            </MenuRow>
            <div className="mx-2.5 my-1 h-px bg-line" />
            <MenuRow icon={<MessageCircle className="size-4" strokeWidth={1.8} />} onClick={onOpenChat}>
              Open chat
            </MenuRow>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

type ProposalMsg = Extract<Message, { kind: "proposal" }>;

/** While Mira's fence streams and the plan comes back: her sentence stays above, and only this quiet line shows. */
export function ShimmerLine() {
  return (
    <p className="mt-1 px-1 text-[13px]" role="status" aria-live="polite">
      <span className="shimmer-text">Staffing the options…</span>
    </p>
  );
}

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const chipCls = "inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11.5px] leading-[16px]";

function MemberRow({ entry }: { entry: RosterEntry }) {
  const rehire = entry.rehire && entry.candidate?.id === entry.rehire ? entry.candidate : undefined;
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className="squish-group mt-0.5 shrink-0">
        <Mascot look={CAST[entry.archetype]} size={28} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="shrink-0 text-[13.5px] font-semibold">{rehire?.name ?? entry.name}</span>
          <span className="min-w-0 truncate text-[12px] text-muted">{entry.role}</span>
          {rehire && <span className={`${chipCls} shrink-0 bg-accent-wash font-medium text-accent`}>Rehire</span>}
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          {entry.skills.slice(0, 3).map((s) => (
            <span key={s.id} title={s.why} className={`${chipCls} bg-bubble text-ink-2`}>
              {s.name}
            </span>
          ))}
          {entry.skills.length === 0 && (
            <span title={entry.uncovered.length ? `No library skill for: ${entry.uncovered.join(", ")}` : undefined} className={`${chipCls} text-muted shadow-[0_0_0_1px_#e6e6e6]`}>
              No skill yet
            </span>
          )}
        </span>
      </span>
    </li>
  );
}

function OptionCard({ o, picked, dim, layoutId, onPick }: { o: OptionPlan; picked: boolean; dim: boolean; layoutId: string; onPick: () => void }) {
  const experts = o.roster.filter((r) => r.archetype !== "lead").length;
  return (
    <motion.div animate={{ opacity: dim ? 0.45 : 1 }} transition={{ duration: 0.2 }} className="w-[82%] max-w-[296px] shrink-0 snap-start">
      <div
        onClick={onPick}
        className="lift relative flex h-full cursor-pointer flex-col rounded-[20px] bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.07)] hover:shadow-[0_6px_22px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.08)]"
      >
        {picked && <motion.span layoutId={layoutId} transition={SPRING} className="pointer-events-none absolute -inset-px rounded-[20px] shadow-[0_0_0_2px_#4166eb]" />}
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold tracking-[-0.01em]">{o.label}</span>
          <span className={`${chipCls} shrink-0 bg-bubble text-ink-2`}>{o.kind === "solo" ? "One expert" : `PM + ${experts} expert${experts === 1 ? "" : "s"}`}</span>
        </div>
        {o.summary && <p className="mt-1 line-clamp-2 text-[13px] leading-[18px] text-ink-2">{o.summary}</p>}
        <ul className="mt-2.5 flex-1 border-t border-line pt-1">
          {o.roster.map((r, i) => (
            <MemberRow key={`${r.archetype}-${i}`} entry={r} />
          ))}
        </ul>
        <div className="mt-2 flex items-center gap-2 border-t border-line pt-3">
          <span className="flex min-w-0 flex-1 items-center gap-2.5 whitespace-nowrap text-[12.5px] tabular-nums text-ink-2">
            <span className="flex items-center gap-1" title="Budget">
              <Wallet className="size-3.5 text-muted" strokeWidth={1.9} />
              {money(o.budgetUsd)}
            </span>
            {o.etaDays && (
              <span className="flex items-center gap-1" title="Estimated time">
                <Clock className="size-3.5 text-muted" strokeWidth={1.9} />
                {o.etaDays} day{o.etaDays === 1 ? "" : "s"}
              </span>
            )}
          </span>
          <button
            type="button"
            aria-pressed={picked}
            onClick={(e) => {
              e.stopPropagation();
              onPick();
            }}
            className={`tap flex items-center gap-1 rounded-full px-3 py-1 text-[13px] font-medium ${picked ? "bg-accent-wash text-accent" : "bg-white shadow-[0_0_0_1px_#e2e2e2] hover:bg-[#fafafa]"}`}
          >
            {picked && <Check className="size-3.5" strokeWidth={2.6} />}
            {picked ? "Picked" : "Pick"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/** The folded editor: the shared goal and due date, the picked option's budget, and its roster. */
function Details({ m, onEdit }: { m: ProposalMsg; onEdit: (update: (m: ProposalMsg) => ProposalMsg) => void }) {
  const plan = m.plan!;
  const o = plan.options[m.picked];
  const edits = m.edits ?? {};
  const setEdit = (patch: NonNullable<ProposalMsg["edits"]>) => onEdit((x) => ({ ...x, edits: { ...x.edits, ...patch } }));
  const setRoster = (roster: RosterEntry[]) =>
    onEdit((x) => ({ ...x, plan: { ...x.plan!, options: x.plan!.options.map((p, i) => (i === x.picked ? { ...p, roster } : p)) } }));
  const experts = o.roster.filter((r) => r.archetype !== "lead").length;
  const field = "own-focus w-full rounded-[12px] bg-white px-3 py-2 text-[14px] shadow-[0_0_0_1px_#e2e2e2] outline-none focus:shadow-[0_0_0_2px_#4166eb]";
  return (
    <motion.div
      key="details"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      className="overflow-hidden"
    >
      <div className="mt-2 max-w-[540px] rounded-[20px] bg-bubble p-3.5">
        <label className="block text-[12.5px] font-medium text-muted">
          Goal
          <textarea rows={2} value={edits.goal ?? plan.charter.goal} onChange={(e) => setEdit({ goal: e.target.value })} className={`${field} mt-1 resize-none leading-[20px] text-ink`} />
        </label>
        <div className="mt-2.5 flex gap-2.5">
          <label className="block flex-1 text-[12.5px] font-medium text-muted">
            Due
            <input type="date" value={(edits.due === null ? "" : edits.due) ?? plan.charter.due ?? ""} onChange={(e) => setEdit({ due: e.target.value || null })} className={`${field} mt-1 text-ink`} />
          </label>
          <label className="block w-[120px] text-[12.5px] font-medium text-muted">
            Budget (USD)
            <input
              type="number"
              min={1}
              step={1}
              value={edits.budgetUsd ?? o.budgetUsd}
              onChange={(e) => setEdit({ budgetUsd: Math.max(1, Number(e.target.value) || 1) })}
              className={`${field} mt-1 tabular-nums text-ink`}
            />
          </label>
        </div>
        <p className="mt-3 text-[12.5px] font-medium text-muted">{o.label} roster</p>
        <ul className="mt-1 overflow-hidden rounded-[14px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
          {o.roster.map((r, i) => (
            <li key={`${r.archetype}-${i}`} className="flex items-center gap-2 border-t border-line px-3 py-2 first:border-t-0">
              <Mascot look={CAST[r.archetype]} size={22} />
              <span className="min-w-0 flex-1 truncate text-[13.5px]">
                {r.rehire && r.candidate ? r.candidate.name : r.name} <span className="text-muted">· {r.role}</span>
              </span>
              {r.candidate && (
                <button
                  type="button"
                  title={r.candidate.record ?? "No record yet"}
                  onClick={() => setRoster(o.roster.map((x, j) => (j === i ? { ...x, rehire: x.rehire ? undefined : x.candidate!.id } : x)))}
                  className="tap rounded-full bg-white px-2.5 py-0.5 text-[12.5px] font-medium shadow-[0_0_0_1px_#e2e2e2] hover:bg-[#fafafa]"
                >
                  {r.rehire ? "Hire new instead" : `Rehire ${r.candidate.name}`}
                </button>
              )}
              {r.archetype !== "lead" && o.kind === "project" && experts > 1 && (
                <button
                  type="button"
                  aria-label={`Remove ${r.role}`}
                  onClick={() => setRoster(o.roster.filter((_, j) => j !== i))}
                  className="tap grid size-6 place-items-center rounded-full text-muted hover:bg-bubble hover:text-ink"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

/**
 * Mira's staffing options: a row of equal cards that scrolls sideways (snap, a peek of the next card, a fade at the
 * edge), Pick on one, then one Launch. Nothing card-like renders until every option has come back staffed.
 */
export function LaunchCard({
  m,
  onEdit,
  onLaunch,
  onRequestChanges,
  onOpen,
}: {
  m: ProposalMsg;
  onEdit: (update: (m: ProposalMsg) => ProposalMsg) => void;
  onLaunch: () => void;
  onRequestChanges: (text: string) => void;
  onOpen: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const [panel, setPanel] = useState<"details" | "changes" | null>(null);
  const [ask, setAsk] = useState("");
  const ready = m.plan && m.state !== "drafting" && m.state !== "planning";

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const update = () => setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [ready]);

  if (!ready) return <ShimmerLine />;
  const plan = m.plan!;
  const o = plan.options[m.picked];
  const launching = m.state === "launching";
  const launched = m.state === "launched";
  const pick = (i: number) => !launched && !launching && onEdit((x) => ({ ...x, picked: i }));

  return (
    <div>
      <div className="relative -mx-5 sm:-mx-6">
        <div ref={row} className="scroll-quiet flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-2 pt-1 sm:scroll-px-6 sm:px-6" role="list" aria-label="Staffing options">
          {plan.options.map((opt, i) => (
            <OptionCard key={`${opt.label}-${i}`} o={opt} picked={i === m.picked} dim={launched && i !== m.picked} layoutId={`pick-${m.id}`} onPick={() => pick(i)} />
          ))}
        </div>
        <div className={`pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-white to-transparent transition-opacity duration-200 ${atEnd ? "opacity-0" : "opacity-100"}`} />
      </div>

      <div className="mt-2 min-h-[34px]">
        <AnimatePresence mode="wait" initial={false}>
          {launched ? (
            <motion.div key="launched" initial={{ opacity: 0, scale: 0.85, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={POP} style={{ transformOrigin: "0% 50%" }} className="flex h-[34px] items-center gap-3">
              <span className="flex items-center gap-1.5 text-[14px] font-medium text-[#16794c]">
                <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                  <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.08, ease: "easeOut" }} />
                </svg>
                Launched {o.label}
              </span>
              <button type="button" onClick={onOpen} className="tap rounded-full bg-white px-3 py-1 text-[13.5px] font-medium shadow-[0_0_0_1px_#e2e2e2] hover:bg-[#fafafa]">
                {m.launched?.channel ? `Open #${m.launched.channel}` : "Open the DM"}
              </button>
            </motion.div>
          ) : (
            <motion.div key="actions" exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }} className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onLaunch}
                disabled={launching}
                className="tap flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-[14px] font-medium text-white hover:bg-[#3557d6] hover:shadow-[0_4px_14px_rgba(65,102,235,0.35)] disabled:bg-accent-soft"
              >
                {launching && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2.4} />}
                {launching ? "Launching…" : `Launch ${o.label}`}
              </button>
              <button
                type="button"
                onClick={() => setPanel((p) => (p === "changes" ? null : "changes"))}
                aria-expanded={panel === "changes"}
                className="tap rounded-full bg-white px-4 py-1.5 text-[14px] font-medium shadow-[0_0_0_1px_#e2e2e2] hover:bg-[#fafafa] hover:shadow-[0_0_0_1px_#d0d0d0]"
              >
                Request changes
              </button>
              <button
                type="button"
                onClick={() => setPanel((p) => (p === "details" ? null : "details"))}
                aria-expanded={panel === "details"}
                className="tap flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[13.5px] font-medium text-ink-2 hover:bg-black/[0.05]"
              >
                <motion.span animate={{ rotate: panel === "details" ? 90 : 0 }} transition={SPRING} className="grid">
                  <ChevronRight className="size-3.5" />
                </motion.span>
                Edit details
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {m.error && !launched && <p className="mt-1.5 px-1 text-[13px] text-danger">{m.error} Launching again won&apos;t create a second team.</p>}

      <AnimatePresence initial={false}>
        {!launched && panel === "details" && <Details m={m} onEdit={onEdit} />}
        {!launched && panel === "changes" && (
          <motion.form
            key="changes"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ask.trim()) return;
              onRequestChanges(ask.trim());
              setAsk("");
              setPanel(null);
            }}
          >
            <div className="mt-2 flex max-w-[540px] items-end gap-2 rounded-[20px] bg-bubble p-2">
              <textarea
                rows={2}
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                placeholder={`What should ${CHIEF.name} change?`}
                aria-label={`What should ${CHIEF.name} change?`}
                className="own-focus min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-[14px] leading-[20px] outline-none placeholder:text-muted"
              />
              <button type="submit" disabled={!ask.trim()} className="tap rounded-full bg-accent px-3.5 py-1.5 text-[13.5px] font-medium text-white hover:bg-[#3557d6] disabled:bg-accent-soft">
                Send
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
