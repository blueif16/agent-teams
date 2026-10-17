"use client";

/*
 * The PM status strip, at the top of the team panel's Overview. Answers "is my PM on it?": the PM's mascot and
 * "now" line, plan progress as one segmented bar, what waits on you (opens Open), the last report, and the PM's
 * context bar with how it compacts.
 */
import { motion } from "motion/react";
import { Check, ChevronRight } from "lucide-react";
import { AGENTS } from "@/lib/data";
import { POP, SPRING } from "../ui";
import { ContextRow } from "./ContextBar";
import { ago, card, nameOf, useNow, useStateEnv, WhoMascot } from "./shared";
import type { ProjectStateVM, TaskStatus } from "./types";

/** Segment colours for the plan meter: finished reads as done (mint), the rest as their status. */
const SEGMENT: Partial<Record<TaskStatus, string>> = {
  done: "bg-mint",
  review: "bg-amber",
  in_progress: "bg-accent",
  blocked: "bg-danger",
};
const ORDER: TaskStatus[] = ["done", "review", "in_progress", "blocked", "ready", "todo", "failed", "dropped"];

function PlanMeter({ state }: { state: ProjectStateVM }) {
  const work = state.plan.tasks.filter((t) => t.kind === "work" && t.status !== "dropped").sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const { done, total, blocked, review } = state.plan.progress;
  return (
    <div>
      <div className="flex h-2 gap-[3px]" aria-hidden>
        {work.map((t, i) => (
          <motion.span
            key={t.id}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ ...SPRING, delay: 0.02 * i }}
            title={`${t.id} ${t.title}`}
            className={`h-full flex-1 origin-left rounded-full ${SEGMENT[t.status] ?? "bg-black/[0.08]"}`}
          />
        ))}
      </div>
      <p className="mt-2 text-[13px] text-ink-2">
        <span className="font-semibold text-ink">
          {done}/{total}
        </span>{" "}
        done
        {blocked > 0 && (
          <>
            {" · "}
            <span className="font-medium text-danger">{blocked} blocked</span>
          </>
        )}
        {review > 0 && <> · {review} in review</>}
      </p>
    </div>
  );
}

export function PmStrip({ state, now: shared }: { state: ProjectStateVM; now?: string }) {
  const env = useStateEnv();
  const clock = useNow();
  const pm = state.pm;
  const lead = AGENTS[env.leadId]?.name ?? "The PM";
  const waiting = pm.waiting.questions + pm.waiting.approvals;
  const now = shared || pm.now;
  const empty = state.plan.tasks.length === 0;

  return (
    <section className={`${card} mt-6 px-4 pb-3 pt-4`} aria-label={`${lead}, the PM`}>
      <div className="flex items-start gap-3">
        <WhoMascot who={{ kind: "pm" }} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-semibold">{lead}</span>
            <span className="text-[12.5px] text-muted">PM</span>
            <span className="flex-1" />
            {waiting > 0 ? (
              <motion.button
                key={waiting}
                type="button"
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={POP}
                onClick={() => env.onOpenTab?.("open")}
                className="group inline-flex items-center gap-1 rounded-full bg-caution-wash py-1 pl-2.5 pr-1.5 text-[12.5px] font-semibold text-caution hover:bg-[#ffecc7]"
              >
                <span className="tap inline-flex items-center gap-1">
                  {waiting} waiting on you
                  <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </motion.button>
            ) : (
              !empty && (
                <span className="inline-flex items-center gap-1 text-[12.5px] text-muted">
                  <Check className="size-3.5 text-mint" strokeWidth={2.6} />
                  Nothing waiting on you
                </span>
              )
            )}
          </div>
          {now && <p className="mt-0.5 line-clamp-2 text-[14px] leading-[20px] text-ink-2">{now}</p>}
        </div>
      </div>

      {empty ? (
        <p className="mt-3 text-[13.5px] text-muted">No tasks yet. The PM writes the plan at kickoff.</p>
      ) : (
        <div className="mt-3.5">
          <PlanMeter state={state} />
          {pm.lastReport && (
            <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
              Last report {ago(pm.lastReport.at, clock)} from
              <WhoMascot who={pm.lastReport.by} size={16} />
              {nameOf(pm.lastReport.by, env.leadId)}
            </p>
          )}
        </div>
      )}

      {pm.context && (
        <div className="-mx-2 mt-3 border-t border-line pt-2">
          <ContextRow
            status={pm.context}
            who={lead}
            onOpenFile={(path, change) => env.onOpenHistory({ path, change, title: path.split("/").pop() })}
          />
        </div>
      )}
    </section>
  );
}
