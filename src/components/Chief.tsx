"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarClock, ChartColumnIncreasing, ChevronRight, MessageCircle, Plus, Shuffle, Sparkles, Trophy } from "lucide-react";
import { AGENTS, CHIEF } from "@/lib/data";
import { CHIEF_SHORTCUTS, formatDue } from "@/lib/project";
import type { AgentStatus, Message } from "@/lib/types";
import { Markdown } from "./Identity";
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

/** The chief's proposed A-team: goal, who and why, the spec, and a launch button. */
export function ProposalCard({
  m,
  onLaunch,
  onRevise,
  onOpenChannel,
}: {
  m: Extract<Message, { kind: "proposal" }>;
  onLaunch: () => void;
  onRevise: () => void;
  onOpenChannel: (teamId: string) => void;
}) {
  const p = m.project;
  const [specOpen, setSpecOpen] = useState(false);
  const members = [p.leadId, ...p.members.map((x) => x.id).filter((id) => id !== p.leadId)];
  const assignment = Object.fromEntries(p.members.map((x) => [x.id, x.assignment]));
  return (
    <div className="w-[min(540px,100%)] rounded-[20px] bg-bubble px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent">
        <Sparkles className="size-3.5" />
        Proposed A-team
      </div>
      <p className="mt-1.5 text-[15px] font-semibold leading-snug">{p.name}</p>
      <p className="text-[12.5px] text-muted">
        #{p.channel}
        {p.due ? ` · due ${formatDue(p.due)}` : ""}
      </p>
      <p className="mt-1.5 text-[14px] leading-[20px] text-ink-2">{p.goal}</p>

      <ul className="mt-3 overflow-hidden rounded-[14px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
        {members.map((id) => {
          const a = AGENTS[id];
          return (
            <li key={id} className="flex items-start gap-2.5 border-t border-line px-3 py-2 first:border-t-0">
              <Mascot look={a.look} size={26} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-[13.5px] font-semibold">{a.name}</span>
                  <span className="truncate text-[12px] text-muted">
                    {a.role}
                    {id === p.leadId ? " · lead" : ""}
                  </span>
                </span>
                <span className="block text-[13px] leading-[18px] text-ink-2">{assignment[id]}</span>
              </span>
            </li>
          );
        })}
      </ul>

      {p.spec && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setSpecOpen((o) => !o)}
            aria-expanded={specOpen}
            className="tap flex items-center gap-1 rounded-full px-1.5 py-1 text-[13px] font-medium text-ink-2 hover:bg-black/[0.05]"
          >
            <motion.span animate={{ rotate: specOpen ? 90 : 0 }} transition={SPRING} className="grid">
              <ChevronRight className="size-3.5" />
            </motion.span>
            Spec
          </button>
          <AnimatePresence initial={false}>
            {specOpen && (
              <motion.div
                key="spec"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-1 rounded-[14px] bg-white px-3.5 py-2 shadow-[0_0_0_1px_rgba(0,0,0,0.05)] [&_h4:first-child]:mt-1">
                  <Markdown text={p.spec} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="mt-3 h-[34px]">
        <AnimatePresence mode="wait" initial={false}>
          {m.state === "pending" ? (
            <motion.div key="pending" exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }} className="flex gap-2">
              <button
                type="button"
                onClick={onLaunch}
                className="tap rounded-full bg-accent px-4 py-1.5 text-[14px] font-medium text-white hover:bg-[#3557d6] hover:shadow-[0_4px_14px_rgba(65,102,235,0.35)]"
              >
                Launch team
              </button>
              <button
                type="button"
                onClick={onRevise}
                className="tap rounded-full bg-white px-4 py-1.5 text-[14px] font-medium shadow-[0_0_0_1px_#e2e2e2] hover:bg-[#fafafa] hover:shadow-[0_0_0_1px_#d0d0d0]"
              >
                Change something
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="launched"
              initial={{ opacity: 0, scale: 0.85, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={POP}
              style={{ transformOrigin: "0% 50%" }}
              className="flex h-full items-center gap-3"
            >
              <span className="flex items-center gap-1.5 text-[14px] font-medium text-[#16794c]">
                <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                  <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.08, ease: "easeOut" }} />
                </svg>
                Launched
              </span>
              {m.teamId && (
                <button
                  type="button"
                  onClick={() => onOpenChannel(m.teamId!)}
                  className="tap rounded-full bg-white px-3 py-1 text-[13.5px] font-medium shadow-[0_0_0_1px_#e2e2e2] hover:bg-[#fafafa]"
                >
                  Open #{m.teamId}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
