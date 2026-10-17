"use client";

/*
 * Open questions and risks (open.json), plus reviews waiting on your approval. Answers "what's waiting on me,
 * and what could go wrong?": your questions first with how long they've waited, then risks by severity, then the
 * rest; resolved items folded away.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { SPRING } from "../ui";
import { TaskDrawer } from "./PlanView";
import { ago, card, Empty, IdChip, nameOf, pressable, SectionTitle, shortDate, useNow, useStateEnv, WhoMascot } from "./shared";
import type { OpenItemVM, OpenVM, PlanVM } from "./types";

const SEVERITY = {
  high: "bg-danger-wash text-danger",
  medium: "bg-caution-wash text-caution",
  low: "bg-bubble text-ink-2",
} as const;

function Links({ links, onOpenTask }: { links: string[]; onOpenTask: (id: string) => void }) {
  if (!links.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {links.map((l) =>
        /^t\d+$/.test(l) ? (
          <button key={l} type="button" onClick={() => onOpenTask(l)} className="tap rounded-md" title={`Open ${l}`}>
            <IdChip id={l} className="hover:bg-black/[0.09]" />
          </button>
        ) : /^(D-\d+|[QR]-\d+|m\d+)$/.test(l) ? (
          <IdChip key={l} id={l} />
        ) : null,
      )}
    </span>
  );
}

function Row({ item, onOpenTask, index }: { item: OpenItemVM; onOpenTask: (id: string) => void; index: number }) {
  const env = useStateEnv();
  const now = useNow();
  const you = item.group === "you";
  return (
    <motion.li
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...SPRING, delay: index * 0.03 }}
      className={`${card} flex gap-3 px-4 py-3.5 ${you ? "shadow-[0_0_0_1.5px_var(--color-amber)]" : ""}`}
    >
      <span className="mt-0.5">
        {item.kind === "risk" ? (
          <span className="grid size-6 place-items-center rounded-full bg-danger-wash text-danger">
            <ShieldAlert className="size-3.5" strokeWidth={2.2} />
          </span>
        ) : (
          <WhoMascot who={item.askOf} size={24} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <IdChip id={item.id} />
          {item.severity && <span className={`rounded-full px-1.5 py-px text-[11px] font-semibold capitalize ${SEVERITY[item.severity]}`}>{item.severity}</span>}
          {item.kind === "question" && !you && <span className="text-[12px] text-muted">for {nameOf(item.askOf, env)}</span>}
        </div>
        <p className={`mt-1 text-[14.5px] leading-[21px] ${item.status === "resolved" ? "text-ink-2" : ""}`}>{item.text}</p>
        {item.resolution && (
          <p className="mt-1 text-[13px] leading-[19px] text-ink-2">
            <span className="text-muted">Answer:</span> {item.resolution}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
          {you ? <span className="font-medium text-caution">waiting {ago(item.raised, now).replace(/ ago$/, "")}</span> : <span>raised {ago(item.raised, now)}</span>}
          {item.due && item.status === "open" && <span>· due {shortDate(item.due)}</span>}
          {item.resolvedAt && <span>· resolved {ago(item.resolvedAt, now)}</span>}
          <Links links={item.links} onOpenTask={onOpenTask} />
        </div>
      </div>
    </motion.li>
  );
}

export function OpenView({ open, plan }: { open: OpenVM; plan: PlanVM }) {
  const [task, setTask] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const you = open.items.filter((i) => i.group === "you");
  const risks = open.items.filter((i) => i.group === "risk");
  const other = open.items.filter((i) => i.group === "other");
  const resolved = open.items.filter((i) => i.group === "resolved");
  const waiting = you.length + open.approvals.length;

  if (!open.items.length && !open.approvals.length) return <Empty>Nothing open. Questions and risks show here.</Empty>;

  return (
    <div>
      {waiting > 0 && (
        <>
          <SectionTitle>
            <span className="inline-flex items-center gap-1.5 font-semibold text-caution">
              Waiting on you <span className="rounded-full bg-caution-wash px-1.5 text-[11.5px] tabular-nums">{waiting}</span>
            </span>
          </SectionTitle>
          <ul className="space-y-2">
            {you.map((i, n) => (
              <Row key={i.id} item={i} onOpenTask={setTask} index={n} />
            ))}
            {open.approvals.map((a, n) => (
              <motion.li key={a.id} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...SPRING, delay: (you.length + n) * 0.03 }}>
                <div
                  {...pressable(() => setTask(a.id))}
                  className={`${card} lift flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left shadow-[0_0_0_1.5px_var(--color-amber)] hover:shadow-[0_0_0_1.5px_var(--color-amber),0_8px_20px_rgba(0,0,0,0.08)]`}
                >
                  <WhoMascot who={a.owner} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <IdChip id={a.id} />
                      <span className="text-[12px] font-medium text-caution">needs your approval</span>
                    </span>
                    <span className="mt-1 block truncate text-[14.5px] leading-[21px]">{a.title}</span>
                  </span>
                  <span className="shrink-0 text-[12.5px] text-muted">Review</span>
                </div>
              </motion.li>
            ))}
          </ul>
        </>
      )}
      {risks.length > 0 && (
        <>
          <SectionTitle>Risks</SectionTitle>
          <ul className="space-y-2">
            {risks.map((i, n) => (
              <Row key={i.id} item={i} onOpenTask={setTask} index={n} />
            ))}
          </ul>
        </>
      )}
      {other.length > 0 && (
        <>
          <SectionTitle>Questions for the team</SectionTitle>
          <ul className="space-y-2">
            {other.map((i, n) => (
              <Row key={i.id} item={i} onOpenTask={setTask} index={n} />
            ))}
          </ul>
        </>
      )}
      {resolved.length > 0 && (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setShowResolved((s) => !s)}
            aria-expanded={showResolved}
            className="tap inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12.5px] text-ink-2 hover:bg-bubble"
          >
            <motion.span animate={{ rotate: showResolved ? 180 : 0 }} transition={SPRING} className="grid place-items-center">
              <ChevronDown className="size-3.5" />
            </motion.span>
            {resolved.length} resolved
          </button>
          <AnimatePresence initial={false}>
            {showResolved && (
              <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING} className="mt-2 space-y-2 overflow-hidden">
                {resolved.map((i, n) => (
                  <Row key={i.id} item={i} onOpenTask={setTask} index={n} />
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
      <TaskDrawer plan={plan} id={task} onOpen={setTask} onClose={() => setTask(null)} />
    </div>
  );
}
