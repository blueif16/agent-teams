"use client";

/*
 * The roster (roster.json) with each member's current task and load from the plan. Answers "who is doing what,
 * and who is stuck?". A mascot (or the card, when the app knows the agent) opens that agent's panel.
 */
import { motion } from "motion/react";
import { SPRING } from "../ui";
import { ContextBar } from "./ContextBar";
import { StatusDot } from "./PlanView";
import { ago, card, Empty, IdChip, useNow, useStateEnv, WhoMascot } from "./shared";
import type { MemberVM } from "./types";

const STATE: Record<MemberVM["state"], { label: string; chip: string }> = {
  working: { label: "Working", chip: "bg-accent-wash text-accent" },
  idle: { label: "Idle", chip: "bg-bubble text-ink-2" },
  blocked: { label: "Blocked", chip: "bg-danger-wash text-danger" },
  waiting_owner: { label: "Waiting on you", chip: "bg-caution-wash text-caution" },
};

function MemberCard({ m, index }: { m: MemberVM; index: number }) {
  const env = useStateEnv();
  const now = useNow();
  const known = Boolean(env.agents[m.id]);
  const s = STATE[m.state];
  const body = (
    <>
      <div className="flex items-start gap-3">
        <WhoMascot who={{ kind: "agent", id: m.id, name: m.name, archetype: m.archetype }} size={40} still={known} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{m.name}</span>
            <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${s.chip}`}>{s.label}</span>
          </div>
          <p className="truncate text-[12.5px] text-muted">
            {m.role} · {m.archetype}
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-1.5 text-[13px]">
        {m.current ? (
          <p className="flex min-w-0 items-center gap-1.5">
            <StatusDot task={m.current} />
            <IdChip id={m.current.id} />
            <span className="min-w-0 truncate">{m.current.title}</span>
          </p>
        ) : (
          <p className="text-muted">No task right now</p>
        )}
        {m.blocker && (
          <p className="truncate rounded-xl bg-danger-wash px-2.5 py-1 text-[12.5px] text-danger" title={m.blocker.text}>
            {m.blocker.on ? `On ${m.blocker.on}: ` : ""}
            {m.blocker.text}
          </p>
        )}
        {m.lastReport && (
          <p className="line-clamp-2 text-[12.5px] leading-[18px] text-ink-2">
            “{m.lastReport}”{m.lastCheckIn && <span className="text-muted"> · {ago(m.lastCheckIn, now)}</span>}
          </p>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        <span className="shrink-0 text-[11.5px] text-muted">Context</span>
        <ContextBar status={m.context} slim className="min-w-0 flex-1" />
      </div>
      <p className="mt-2 text-[12px] text-muted">
        {m.load.open} open · {m.load.done} done
        {m.pmNote && <span className="text-ink-2"> · “{m.pmNote}”</span>}
      </p>
    </>
  );
  return (
    <motion.li initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...SPRING, delay: index * 0.04 }}>
      {known ? (
        <button type="button" onClick={() => env.onOpenAgent(m.id)} className={`${card} lift group flex h-full w-full flex-col justify-start px-4 py-3.5 text-left hover:shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_8px_20px_rgba(0,0,0,0.08)]`}>
          {body}
        </button>
      ) : (
        <div className={`${card} h-full px-4 py-3.5`}>{body}</div>
      )}
    </motion.li>
  );
}

export function TeamView({ team }: { team: MemberVM[] }) {
  if (!team.length) return <Empty>No one on the roster yet. The PM staffs the team at kickoff.</Empty>;
  return (
    // Two columns only where a card keeps its task title on one line (container width, not the window's).
    <ul className="@container mt-6 grid grid-cols-1 gap-2.5 @[34rem]:grid-cols-2">
      {team.map((m, i) => (
        <MemberCard key={m.id} m={m} index={i} />
      ))}
    </ul>
  );
}
