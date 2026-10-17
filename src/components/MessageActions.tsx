import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  Forward,
  MessageCircle,
  MessageSquareQuote,
  UserRound,
} from "lucide-react";
import { ORDERS, ORDERS_BY_KEY, type OrderKey } from "@/lib/orders";
import type { Agent } from "@/lib/types";
import { Mascot } from "./Mascot";
import { POP } from "./ui";

export interface MenuTarget {
  msgId: string;
  agentId: string;
  text: string;
  /** Viewport coordinates to open from. */
  anchor: { x: number; top: number; bottom: number };
}

export interface Reaction {
  order: OrderKey;
  at: string;
}

/** Slack-style bar that appears over a message on hover or keyboard focus. */
export function HoverBar({
  onOrder,
  onMore,
}: {
  onOrder: (key: OrderKey) => void;
  onMore: (el: HTMLElement) => void;
}) {
  return (
    <div
      className="pointer-events-none absolute -top-4 right-3 z-10 flex translate-y-1 items-center gap-0.5 rounded-full bg-white p-0.5 opacity-0 shadow-[0_2px_10px_rgba(0,0,0,0.1),0_0_0_1px_rgba(0,0,0,0.05)] transition-[opacity,translate] duration-150 group-focus-within/msg:pointer-events-auto group-focus-within/msg:translate-y-0 group-focus-within/msg:opacity-100 group-hover/msg:pointer-events-auto group-hover/msg:translate-y-0 group-hover/msg:opacity-100"
      onClick={(e) => e.stopPropagation()}
    >
      {ORDERS.map((o) => (
        <button
          key={o.key}
          type="button"
          title={`${o.label}: ${o.meaning}`}
          aria-label={`${o.label}: ${o.meaning}`}
          onClick={() => onOrder(o.key)}
          className="emoji-btn grid size-7 place-items-center rounded-full text-[15px] hover:bg-bubble"
        >
          {o.emoji}
        </button>
      ))}
      <span className="mx-0.5 h-4 w-px bg-line" />
      <button
        type="button"
        aria-label="More actions"
        title="More actions"
        onClick={(e) => onMore(e.currentTarget)}
        className="tap grid size-7 place-items-center rounded-full text-ink-2 hover:bg-bubble hover:text-ink"
      >
        <Ellipsis className="size-4" />
      </button>
    </div>
  );
}

/** Orders you've given on a message, shown under it with their meaning. */
export function ReactionChips({ items, agentName }: { items: Reaction[]; agentName: string }) {
  if (!items.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {items.map((r) => {
        const o = ORDERS_BY_KEY[r.order];
        return (
          <motion.span
            key={r.order}
            initial={{ scale: 0.4, opacity: 0, y: -6 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={POP}
            title={`You told ${agentName}: ${o.meaning} (${r.at})`}
            className="inline-flex items-center gap-1 rounded-full bg-accent-wash px-2 py-0.5 text-[12.5px] font-medium text-accent shadow-[inset_0_0_0_1px_rgba(65,102,235,0.22)]"
          >
            <span className="text-[13px]">{o.emoji}</span>
            {o.label}
          </motion.span>
        );
      })}
    </div>
  );
}

const W = 280;

/** Quick actions for one agent message: orders first, then everyday actions. */
export function ActionMenu({
  target,
  agent,
  teammates,
  onClose,
  onOrder,
  onMessage,
  onAsk,
  onHandOff,
  onProfile,
  onCopy,
}: {
  target: MenuTarget;
  agent: Agent;
  /** Empty in DMs, where hand-offs don't apply. */
  teammates: Agent[];
  onClose: () => void;
  onOrder: (key: OrderKey) => void;
  onMessage: () => void;
  onAsk: () => void;
  onHandOff: (agentId: string) => void;
  onProfile: () => void;
  onCopy: () => void;
}) {
  const [hovered, setHovered] = useState<OrderKey | null>(null);
  const [sub, setSub] = useState<"main" | "handoff">("main");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(8, Math.min(target.anchor.x, vw - W - 8));
  const above = target.anchor.bottom > vh * 0.58;
  const pos = above ? { left, bottom: vh - target.anchor.top + 8 } : { left, top: target.anchor.bottom + 8 };
  const hint = hovered ? ORDERS_BY_KEY[hovered] : null;

  const row = (Icon: typeof Copy, label: string, onClick: () => void, chevron = false) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      onClick={onClick}
      className="tap-soft flex w-full items-center gap-2.5 rounded-xl px-2.5 py-[7px] text-left text-[14px] hover:bg-bubble"
    >
      <Icon className="size-4 shrink-0 text-ink-2" strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {chevron && <ChevronRight className="size-4 text-muted" />}
    </button>
  );

  const back = (title: string) => (
    <button
      type="button"
      onClick={() => setSub("main")}
      className="tap-soft mb-0.5 flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-left text-[12.5px] font-medium text-muted hover:bg-bubble hover:text-ink"
    >
      <ChevronLeft className="size-4" />
      {title}
    </button>
  );

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <motion.div
        role="menu"
        aria-label={`Quick actions for ${agent.name}'s message`}
        initial={{ opacity: 0, scale: 0.94, y: above ? 6 : -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
        transition={POP}
        style={{ ...pos, width: W, transformOrigin: above ? "bottom left" : "top left" }}
        className="fixed z-50 rounded-[20px] border border-line bg-white p-1.5 shadow-[0_14px_44px_rgba(0,0,0,0.13)]"
      >
        <div className="flex items-center justify-between px-0.5">
          {ORDERS.map((o, i) => (
            <motion.span
              key={o.key}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...POP, delay: 0.025 * i }}
            >
              <button
                type="button"
                aria-label={`${o.label}: ${o.meaning}`}
                onMouseEnter={() => setHovered(o.key)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(o.key)}
                onBlur={() => setHovered(null)}
                onClick={() => onOrder(o.key)}
                className="emoji-btn grid size-[46px] place-items-center rounded-full text-[22px] hover:bg-bubble"
              >
                {o.emoji}
              </button>
            </motion.span>
          ))}
        </div>
        <div className="flex h-8 items-center px-2.5 text-[12.5px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={hint?.key ?? "idle"}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.12 }}
              className="truncate"
            >
              {hint ? (
                <>
                  <span className="font-semibold">{hint.label}:</span>{" "}
                  <span className="text-ink-2">{hint.meaning.charAt(0).toLowerCase() + hint.meaning.slice(1)}</span>
                </>
              ) : (
                <span className="text-muted">React to give {agent.name} a quick order</span>
              )}
            </motion.span>
          </AnimatePresence>
        </div>
        <div className="mx-1 mb-1 h-px bg-line" />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={sub}
            initial={{ opacity: 0, x: sub === "main" ? -12 : 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: sub === "main" ? -12 : 12 }}
            transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {sub === "main" && (
              <>
                {row(MessageCircle, `Message ${agent.name}`, onMessage)}
                {row(MessageSquareQuote, "Ask about this", onAsk)}
                {teammates.length > 0 && row(Forward, "Hand off to a teammate", () => setSub("handoff"), true)}
                {row(UserRound, `View ${agent.name}'s profile`, onProfile)}
                {row(Copy, "Copy text", onCopy)}
              </>
            )}
            {sub === "handoff" && (
              <>
                {back("Hand off to")}
                {teammates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="menuitem"
                    onClick={() => onHandOff(t.id)}
                    className="tap-soft group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left hover:bg-bubble"
                  >
                    <span className="squish-group">
                      <Mascot look={t.look} size={26} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px]">{t.name}</span>
                      <span className="block truncate text-[12px] text-muted">{t.role}</span>
                    </span>
                  </button>
                ))}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </>
  );
}
