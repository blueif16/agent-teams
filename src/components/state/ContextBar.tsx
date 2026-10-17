"use client";

/*
 * The context bar (owner, 2026-10-17): how full an agent's context is, as a thin bar with a tick where it compacts
 * on its own, and never a number. Its history shows each compaction's steps in the order they ran: the files it
 * saved first (each opens that file's History at that change), then Summarized, Rebuilt, Checked.
 * Motion is one-shot and calm: the fill eases to its level; when a new compaction lands, the fill slides from
 * before to after once while the step chips pop in left to right. Reduced motion: no movement, same end state.
 */
import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import type { CompactionEvent, ContextStatus } from "@/lib/compaction";
import { POP, SPRING } from "../ui";
import { compactionSteps, fillWords, type StepChip } from "./context";
import { ago, useNow } from "./shared";

const pct = (x: number) => `${+(Math.min(1, Math.max(0, x)) * 100).toFixed(2)}%`;

/** The newest compaction, while it is new to this view (it arrived after the view mounted). */
function useFresh(status: ContextStatus) {
  const reduce = useReducedMotion();
  const newest = status.compactions[0] ?? null;
  const [seen, setSeen] = useState(newest?.at ?? null);
  const fresh = !reduce && newest && newest.at !== seen ? newest : null;
  return { fresh, settle: () => fresh && setSeen(fresh.at) };
}

export function ContextBar({ status, slim = false, className = "" }: { status: ContextStatus; slim?: boolean; className?: string }) {
  const reduce = useReducedMotion();
  const { fresh, settle } = useFresh(status);
  const used = status.used ?? 0;
  const past = status.used !== null && used >= status.compactsAt;
  const target = pct(used);
  return (
    <span
      role="img"
      aria-label={`Context: ${fillWords(status.used, status.compactsAt)}`}
      className={`relative block rounded-full bg-black/[0.07] ${slim ? "h-1" : "h-1.5"} ${className}`}
    >
      <motion.span
        data-part="fill"
        initial={false}
        animate={fresh ? { width: [pct(fresh.before), pct(fresh.after), target] } : { width: target }}
        transition={fresh ? { duration: 1.1, times: [0, 0.55, 1], ease: [0.2, 0.8, 0.2, 1] } : reduce ? { duration: 0 } : SPRING}
        onAnimationComplete={settle}
        className={`absolute inset-y-0 left-0 block rounded-full ${past ? "bg-amber" : "bg-accent"}`}
      />
      <span
        data-part="tick"
        aria-hidden
        className={`absolute top-1/2 block w-[2px] -translate-y-1/2 rounded-full bg-ink/30 ${slim ? "-ml-px h-2" : "-ml-px h-3"}`}
        style={{ left: pct(status.compactsAt) }}
      />
    </span>
  );
}

function Step({ step, index, enter, small, onOpenFile }: { step: StepChip; index: number; enter: boolean; small: boolean; onOpenFile?: (path: string, change: string) => void }) {
  const caution = step.tone === "caution";
  return (
    <motion.span
      initial={enter ? { opacity: 0, scale: 0.8 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...POP, delay: enter ? 0.06 * index : 0 }}
      className={`inline-flex flex-wrap items-center ${small ? "gap-0.5" : "gap-1"}`}
    >
      {index > 0 && <ChevronRight aria-hidden className={`shrink-0 text-black/20 ${small ? "size-2.5" : "size-3"}`} />}
      <span
        className={`inline-flex items-center gap-1 rounded-full font-medium ${small ? "px-1.5 py-px text-[11.5px]" : "px-2 py-[2px] text-[12px]"} ${caution ? "bg-caution-wash text-caution" : "bg-bubble text-ink-2"}`}
      >
        {caution ? <TriangleAlert className={small ? "size-2.5" : "size-3"} strokeWidth={2.4} /> : <Check className={`text-mint ${small ? "size-2.5" : "size-3"}`} strokeWidth={3} />}
        {step.label}
      </span>
      {onOpenFile &&
        step.files.map((f) => (
          <button
            key={f.path}
            type="button"
            data-change={f.change}
            onClick={(e) => {
              e.stopPropagation();
              onOpenFile(f.path, f.change);
            }}
            title={`History of ${f.name} at this save`}
            className="tap rounded-md bg-white px-1.5 py-px font-mono text-[11px] text-ink-2 shadow-[0_0_0_1px_rgba(0,0,0,0.09)] hover:bg-bubble hover:text-ink"
          >
            {f.name}
          </button>
        ))}
    </motion.span>
  );
}

/** One compaction's steps on one line (wrapping on a phone). */
export function StepRow({ event, enter = false, small = false, onOpenFile }: { event: CompactionEvent; enter?: boolean; small?: boolean; onOpenFile?: (path: string, change: string) => void }) {
  return (
    <span className={`flex flex-wrap items-center gap-y-1.5 ${small ? "gap-x-0.5" : "gap-x-1"}`}>
      {compactionSteps(event).map((s, i) => (
        <Step key={`${s.kind}-${i}`} step={s} index={i} enter={enter} small={small} onOpenFile={onOpenFile} />
      ))}
    </span>
  );
}

/** The last three compactions, newest first. */
export function CompactionHistory({ compactions, onOpenFile }: { compactions: CompactionEvent[]; onOpenFile: (path: string, change: string) => void }) {
  const now = useNow();
  if (!compactions.length) return <p className="py-1 text-[13px] text-muted">No compactions yet</p>;
  return (
    <ol className="space-y-2.5">
      {compactions.map((c) => (
        <li key={c.at} className="flex flex-col gap-1.5">
          <span className="text-[11.5px] text-muted">{ago(c.at, now) || "Compacted"}</span>
          <StepRow event={c} onOpenFile={onOpenFile} />
        </li>
      ))}
    </ol>
  );
}

/**
 * The strip's context line: label, bar, the latest compaction's steps, and its history on hover or tap.
 * `who` names the agent in the history's one-line explainer.
 */
export function ContextRow({ status, who, onOpenFile }: { status: ContextStatus; who: string; onOpenFile: (path: string, change: string) => void }) {
  const [open, setOpen] = useState(false);
  const { fresh } = useFresh(status);
  const now = useNow();
  const hover = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = status.compactions[0];
  const show = (v: boolean) => {
    clearTimeout(hover.current);
    hover.current = setTimeout(() => setOpen(v), v ? 120 : 180);
  };
  return (
    <div className="relative" onMouseEnter={() => show(true)} onMouseLeave={() => show(false)}>
      <button
        type="button"
        aria-expanded={open}
        aria-label="Context and compaction history"
        onClick={() => {
          clearTimeout(hover.current);
          setOpen((o) => !o);
        }}
        className="tap-soft flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-black/[0.03]"
      >
        <span className="w-[54px] shrink-0 text-[12.5px] text-muted">Context</span>
        <ContextBar status={status} className="min-w-0 flex-1" />
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING} className="grid shrink-0 place-items-center text-muted">
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>
      {latest && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-2 pr-2 pt-0.5 text-[11.5px] text-muted min-[440px]:pl-[74px]">
          <StepRow key={latest.at} event={latest} enter={Boolean(fresh)} small />
          <span>{ago(latest.at, now)}</span>
        </div>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
            transition={SPRING}
            style={{ transformOrigin: "top left" }}
            className="absolute inset-x-0 top-full z-30 mt-1.5 rounded-2xl bg-white p-3.5 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_12px_32px_rgba(0,0,0,0.12)]"
          >
            <p className="text-[13px] font-semibold">How {who} keeps the project in memory</p>
            <p className="mb-3 mt-0.5 text-[12px] leading-[17px] text-muted">Each compaction saves to the project files first, then summarizes, rebuilds and checks recall.</p>
            <CompactionHistory compactions={status.compactions} onOpenFile={onOpenFile} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
