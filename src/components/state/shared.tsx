/*
 * Pieces every state view shares: the card, a section title, the short-id chip (t7, D-007, Q-2: the only ids the
 * owner sees), a mascot for whoever owns or asks something, relative times, and one-line empty states.
 */
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { CircleDashed } from "lucide-react";
import { AGENTS, CAST } from "@/lib/data";
import type { AgentStatus, AgentType, MascotLook } from "@/lib/types";
import { relativeTime } from "@/lib/vault/present";
import { Mascot } from "../Mascot";
import { YouAvatar } from "../ui";
import type { Who } from "./types";

/** What a state view needs from the team around it. */
export interface StateViewEnv {
  pid: string;
  leadId: string;
  status: Record<string, AgentStatus>;
  onOpenAgent: (id: string) => void;
  /** Opens one of the team panel's state tabs (the strip's "waiting on you" opens Open). */
  onOpenTab?: (tab: StateTab) => void;
  /** Opens Plan or Decisions full size in the workspace. */
  onOpenFull?: (view: "plan" | "decisions") => void;
  /** Opens a state file's History, at a change or filtered to a task. */
  onOpenHistory: (target: HistoryTarget) => void;
}

export type StateTab = "plan" | "decisions" | "open" | "team" | "charter";
export type HistoryTarget = { path: string; change?: string; task?: string; title?: string };

const Env = createContext<StateViewEnv | null>(null);
export const StateViewProvider = Env.Provider;
export function useStateEnv(): StateViewEnv {
  const env = useContext(Env);
  if (!env) throw new Error("State views need a StateViewProvider");
  return env;
}

export const card = "rounded-[20px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.05)]";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${card} ${className}`}>{children}</div>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-end justify-between gap-3 px-1">
      <h3 className="text-[13px] font-medium text-muted">{children}</h3>
      {aside}
    </div>
  );
}

/** The shared vocabulary: t7, m1, D-007, Q-2. */
export function IdChip({ id, className = "" }: { id: string; className?: string }) {
  return <span className={`inline-flex shrink-0 items-center rounded-md bg-black/[0.05] px-1.5 py-px font-mono text-[11px] font-medium text-ink-2 ${className}`}>{id}</span>;
}

/**
 * Props for a card that opens something but holds a mascot button: a div acting as a button (Enter and Space
 * work), so the mascot inside stays its own button and still opens its agent.
 */
export function pressable(onPress: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onPress,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        onPress();
      }
    },
  };
}

/** One short line, in the panel's voice. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className={`${card} mt-5 px-4 py-4 text-center text-[13.5px] text-muted`}>{children}</p>;
}

const ARCHETYPES = new Set<string>(Object.keys(CAST));
export function lookOf(who: Who, leadId: string): MascotLook | null {
  if (who.kind === "pm") return AGENTS[leadId]?.look ?? CAST.lead;
  if (who.kind === "agent") return AGENTS[who.id]?.look ?? CAST[(ARCHETYPES.has(who.archetype ?? "") ? who.archetype : "coordinator") as AgentType];
  return null;
}

export function nameOf(who: Who, leadId: string): string {
  if (who.kind === "pm") return AGENTS[leadId]?.name ?? "The PM";
  if (who.kind === "owner") return "You";
  if (who.kind === "agent") return who.name;
  return "Unassigned";
}

const agentIdOf = (who: Who, leadId: string) => (who.kind === "pm" ? leadId : who.kind === "agent" ? who.id : null);

/**
 * Whoever owns or asks something, as a mascot (you are the accent disc). A mascot always opens that agent's panel,
 * so it is a button whenever the app knows the agent.
 */
export function WhoMascot({ who, size = 24, className = "", still = false }: { who: Who; size?: number; className?: string; still?: boolean }) {
  const { leadId, status, onOpenAgent } = useStateEnv();
  if (who.kind === "owner") return <YouAvatar size={size} className={className} />;
  const look = lookOf(who, leadId);
  if (!look)
    return (
      <span className={`grid shrink-0 place-items-center text-muted ${className}`} style={{ width: size, height: size }} title="Unassigned">
        <CircleDashed className="size-[80%]" strokeWidth={1.6} />
      </span>
    );
  const id = agentIdOf(who, leadId);
  const mascot = <Mascot look={look} size={size} status={size >= 48 && id ? status[id] : undefined} bob={size >= 48 && id ? status[id] === "working" : false} />;
  if (still || !id || !AGENTS[id]) return <span className={`block shrink-0 ${className}`} title={nameOf(who, leadId)}>{mascot}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenAgent(id);
      }}
      aria-label={`${nameOf(who, leadId)}'s profile`}
      title={nameOf(who, leadId)}
      className={`squish block shrink-0 rounded-full ${className}`}
    >
      {mascot}
    </button>
  );
}

// Relative times re-read the clock once a minute; render code never calls Date.now() itself.
const MINUTE = 60_000;
const subscribeClock = (tick: () => void) => {
  const t = setInterval(tick, MINUTE);
  return () => clearInterval(t);
};
const clockNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;
export const useNow = () => useSyncExternalStore(subscribeClock, clockNow, () => 0);

export const ago = (iso: string, now: number) => (now ? relativeTime(iso, now) : "");

/** "Oct 28" from 2026-10-28. */
export const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
