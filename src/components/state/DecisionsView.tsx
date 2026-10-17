"use client";

/*
 * The decisions log (decisions.md) as a timeline. Answers "what did we decide, why, and who said yes?": active
 * decisions first, each with who approved it; superseded ones struck through and linked to what replaced them;
 * "why" on expand.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { POP, SPRING, YouAvatar } from "../ui";
import { OpenFullButton } from "./PlanView";
import { card, Empty, IdChip, shortDate, useStateEnv, WhoMascot } from "./shared";
import type { DecisionVM } from "./types";

function Approved({ by }: { by: DecisionVM["approvedBy"] }) {
  return by === "owner" ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-wash py-px pl-0.5 pr-2 text-[11.5px] font-medium text-accent">
      <YouAvatar size={15} />
      You approved
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bubble py-px pl-0.5 pr-2 text-[11.5px] font-medium text-ink-2">
      <WhoMascot who={{ kind: "pm" }} size={15} still />
      PM decided
    </span>
  );
}

function Entry({ d, last, open, flash, onToggle, onJump }: { d: DecisionVM; last: boolean; open: boolean; flash: boolean; onToggle: () => void; onJump: (id: string) => void }) {
  const active = d.status === "active";
  return (
    <motion.li id={`decision-${d.id}`} layout="position" initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING} className="relative pl-7">
      {!last && <span aria-hidden className="absolute bottom-[-10px] left-[7px] top-[22px] w-px bg-[#e3e3e3]" />}
      <span
        aria-hidden
        className={`absolute left-0 top-[17px] size-[15px] rounded-full ${active ? "bg-accent shadow-[0_0_0_3px_var(--color-accent-wash)]" : "bg-white shadow-[inset_0_0_0_1.5px_#cfcfcf]"}`}
      />
      <motion.div animate={flash ? { scale: [1, 1.015, 1] } : { scale: 1 }} transition={POP} className={`${card} ${flash ? "shadow-[0_0_0_2px_var(--color-accent-soft)]" : ""}`}>
        <button type="button" onClick={onToggle} aria-expanded={open} className="tap-soft block w-full rounded-[20px] px-4 py-3 text-left hover:bg-black/[0.02]">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <IdChip id={d.id} />
            <span className="text-[12px] text-muted">{shortDate(d.date)}</span>
            <span className="flex-1" />
            {active ? <Approved by={d.approvedBy} /> : <span className="text-[11.5px] font-medium text-muted">{d.status === "revoked" ? "Revoked" : "Superseded"}</span>}
          </span>
          <span className={`mt-1.5 block text-[15px] font-semibold leading-[21px] ${active ? "" : "text-muted line-through decoration-[#c8c8c8]"}`}>{d.title}</span>
          <span className={`mt-0.5 block text-[13.5px] leading-[20px] ${active ? "text-ink-2" : "text-muted"}`}>{d.decision}</span>
          <span className="mt-1.5 flex items-center gap-1 text-[12px] text-muted">
            <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING} className="grid place-items-center">
              <ChevronDown className="size-3.5" />
            </motion.span>
            {open ? "Hide why" : "Why"}
          </span>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING} className="overflow-hidden">
              <p className="mx-4 mb-3 rounded-2xl bg-bubble px-3.5 py-2.5 text-[13.5px] leading-[20px]">{d.why}</p>
            </motion.div>
          )}
        </AnimatePresence>
        {(d.supersededBy || d.supersedes) && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-2 text-[12.5px] text-ink-2">
            {d.supersededBy ? (
              <button type="button" onClick={() => onJump(d.supersededBy!)} className="tap inline-flex items-center gap-1 rounded-full px-1 hover:bg-bubble">
                Replaced by <IdChip id={d.supersededBy} /> <ArrowRight className="size-3.5 text-muted" />
              </button>
            ) : (
              <button type="button" onClick={() => onJump(d.supersedes!)} className="tap inline-flex items-center gap-1 rounded-full px-1 hover:bg-bubble">
                Replaces <IdChip id={d.supersedes!} />
              </button>
            )}
          </div>
        )}
      </motion.div>
    </motion.li>
  );
}

export function DecisionsView({ decisions, full = false }: { decisions: DecisionVM[]; full?: boolean }) {
  const env = useStateEnv();
  const [open, setOpen] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const active = decisions.filter((d) => d.status === "active");
  const rest = decisions.filter((d) => d.status !== "active");
  const jump = (id: string) => {
    document.getElementById(`decision-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 900);
  };
  const list = (ds: DecisionVM[]) => (
    <ol className="space-y-2.5">
      {ds.map((d, i) => (
        <Entry key={d.id} d={d} last={i === ds.length - 1} open={open === d.id} flash={flash === d.id} onToggle={() => setOpen(open === d.id ? null : d.id)} onJump={jump} />
      ))}
    </ol>
  );

  return (
    <div className={full ? "mx-auto max-w-[720px] px-5 pb-10 pt-6" : ""}>
      <div className={`flex items-center gap-2 ${full ? "" : "mt-6"}`}>
        <div className="min-w-0 flex-1">
          {full && <h2 className="text-[20px] font-semibold tracking-[-0.01em]">Decisions</h2>}
          <p className="text-[13px] text-muted">{decisions.length ? `${active.length} active${rest.length ? ` · ${rest.length} replaced` : ""}` : "None yet"}</p>
        </div>
        {!full && env.onOpenFull && decisions.length > 0 && <OpenFullButton onClick={() => env.onOpenFull?.("decisions")} label="Open decisions full size" />}
      </div>
      {!decisions.length ? (
        <Empty>No decisions yet. The PM records each one here.</Empty>
      ) : (
        <>
          <div className="mt-3">{list(active)}</div>
          {rest.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 px-1 text-[13px] font-medium text-muted">Replaced</h3>
              {list(rest)}
            </>
          )}
        </>
      )}
    </div>
  );
}
