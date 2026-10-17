"use client";

/*
 * The charter (charter.md), with the journal and your preferences. Answers "what are we building, by when, and
 * within what budget?": the goal as a headline, the deadline with a countdown, the metric, scope must / won't,
 * roles, the budget burn from the ledger, the last 8 journal lines and the prefs.md bullets.
 */
import { motion } from "motion/react";
import { Check, Flag, Minus } from "lucide-react";
import { SPRING } from "../ui";
import { card, Empty, IdChip, SectionTitle, shortDate, useNow, WhoMascot } from "./shared";
import type { CharterVM, JournalVM } from "./types";

const usd = (v: number) => (v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v)}`);
const clock = (at: string) => new Date(at.replace(/Z$/, ":00Z")).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function countdown(deadline: string, now: number): string {
  if (!now) return "";
  const days = Math.ceil((Date.parse(`${deadline}T23:59:59`) - now) / 86_400_000);
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} late`;
  if (days === 0) return "due today";
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

function List({ items, yes }: { items: string[]; yes: boolean }) {
  return (
    <ul className="space-y-1.5">
      {items.map((s) => (
        <li key={s} className="flex items-start gap-2 text-[13.5px] leading-[19px]">
          <span className={`mt-[1px] grid size-4 shrink-0 place-items-center rounded-full ${yes ? "bg-mint/15 text-mint" : "bg-black/[0.06] text-muted"}`}>
            {yes ? <Check className="size-2.5" strokeWidth={3.4} /> : <Minus className="size-2.5" strokeWidth={3.4} />}
          </span>
          <span className={yes ? "" : "text-ink-2"}>{s}</span>
        </li>
      ))}
    </ul>
  );
}

export function CharterView({ charter, journal, prefs }: { charter: CharterVM | null; journal: JournalVM[]; prefs: { id: string; text: string }[] }) {
  const now = useNow();
  if (!charter && !journal.length && !prefs.length) return <Empty>No charter yet. The PM writes it once you approve the brief.</Empty>;
  const burn = charter?.budget.usd ? charter.budget.spent / charter.budget.usd : null;
  const late = charter && now ? Date.parse(`${charter.deadline}T23:59:59`) < now : false;
  return (
    <div>
      {charter && (
        <section className={`${card} mt-6 px-5 py-4`}>
          <p className="text-[12.5px] font-medium text-muted">{charter.title}</p>
          <h3 className="mt-1 text-[19px] font-semibold leading-[26px] tracking-[-0.01em]">{charter.goal}</h3>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium ${late ? "bg-danger-wash text-danger" : "bg-accent-wash text-accent"}`}>
              <Flag className="size-3.5" />
              {shortDate(charter.deadline)}
              {now > 0 && <span className="font-normal opacity-80">· {countdown(charter.deadline, now)}</span>}
            </span>
          </div>
          <p className="mt-3 text-[13.5px] leading-[20px] text-ink-2">
            <span className="font-medium text-ink">Success: </span>
            {charter.metric}
          </p>
        </section>
      )}

      {charter && (
        <div className="mt-2.5 grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2">
          <section className={`${card} px-4 py-3.5`}>
            <h4 className="mb-2 text-[12.5px] font-medium text-muted">In scope</h4>
            <List items={charter.scope} yes />
          </section>
          <section className={`${card} px-4 py-3.5`}>
            <h4 className="mb-2 text-[12.5px] font-medium text-muted">Not in scope</h4>
            <List items={charter.outOfScope} yes={false} />
          </section>
        </div>
      )}

      {charter && charter.roles.length > 0 && (
        <>
          <SectionTitle>Roles</SectionTitle>
          <div className={`${card} divide-y divide-line`}>
            {charter.roles.map((r) => (
              <div key={r.role} className="flex items-baseline gap-3 px-4 py-2.5">
                <span className="w-[86px] shrink-0 text-[13.5px] font-semibold">{r.role}</span>
                <span className="min-w-0 text-[13px] leading-[19px] text-ink-2">{r.quals}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {charter && (
        <>
          <SectionTitle>Budget</SectionTitle>
          <section className={`${card} px-4 py-3.5`}>
            {burn !== null ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] font-semibold tabular-nums">
                    {usd(charter.budget.spent)} <span className="text-[13px] font-normal text-muted">of {usd(charter.budget.usd!)} spent</span>
                  </span>
                  <span className={`text-[12.5px] font-medium ${burn > 1 ? "text-danger" : burn > 0.8 ? "text-caution" : "text-muted"}`}>{burn > 1 ? "Over budget" : burn > 0.8 ? "Close to the cap" : "On budget"}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/[0.06]">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: Math.min(1, burn) }}
                    transition={SPRING}
                    className={`h-full origin-left rounded-full ${burn > 1 ? "bg-danger" : burn > 0.8 ? "bg-amber" : "bg-accent"}`}
                  />
                </div>
              </>
            ) : (
              <p className="text-[13.5px]">{usd(charter.budget.spent)} spent so far</p>
            )}
            <p className="mt-2 text-[12.5px] leading-[18px] text-muted">{charter.budget.text}</p>
          </section>
        </>
      )}

      <SectionTitle>Recent activity</SectionTitle>
      {journal.length ? (
        <ol className={`${card} px-2 py-1.5`}>
          {journal.map((l, i) => (
            <motion.li
              key={`${l.rev}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: i * 0.03 }}
              className="flex items-start gap-2.5 rounded-xl px-2 py-1.5"
            >
              <span className="w-[58px] shrink-0 pt-px text-right text-[11.5px] tabular-nums text-muted">{clock(l.at)}</span>
              <span className="mt-px">{l.actor ? <WhoMascot who={l.actor} size={18} /> : <span className="block size-[18px]" />}</span>
              <span className="min-w-0 text-[13px] leading-[19px]">{l.text}</span>
            </motion.li>
          ))}
        </ol>
      ) : (
        <p className="px-1 text-[13px] text-muted">Nothing logged yet.</p>
      )}

      <SectionTitle>Your preferences</SectionTitle>
      {prefs.length ? (
        <ul className={`${card} divide-y divide-line`}>
          {prefs.map((p) => (
            <li key={p.id} className="flex items-start gap-2.5 px-4 py-2.5 text-[13.5px] leading-[19px]">
              <IdChip id={p.id} className="mt-px" />
              {p.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 text-[13px] text-muted">None yet. Pin a message with 📌 to add one.</p>
      )}
    </div>
  );
}
