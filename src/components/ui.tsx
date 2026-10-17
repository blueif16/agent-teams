import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import type { AgentStatus } from "@/lib/types";

/** Spring used for selection highlights and pop-ins across the app. */
export const SPRING = { type: "spring", stiffness: 520, damping: 38, mass: 0.8 } as const;
export const POP = { type: "spring", stiffness: 600, damping: 26 } as const;

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: "Working",
  "needs-you": "Needs you",
  idle: "Idle",
  done: "Done",
};

const STATUS_DOT: Record<AgentStatus, string> = {
  working: "bg-accent pulse-dot",
  "needs-you": "bg-amber",
  idle: "bg-[#c4c4c4]",
  done: "bg-mint",
};

/** You, the owner. Agents are plush mascots; the one human is a flat accent disc, the colour of your bubbles. */
export function YouAvatar({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden className={`shrink-0 ${className}`}>
      <circle cx="10" cy="10" r="10" fill="#4166eb" />
      <circle cx="10" cy="7.9" r="3.2" fill="#fff" />
      <path d="M4.3 16.2C5.4 13.7 7.5 12.4 10 12.4S14.6 13.7 15.7 16.2" fill="#fff" />
    </svg>
  );
}

export function StatusDot({ status, className = "" }: { status: AgentStatus; className?: string }) {
  return <span className={`inline-block size-2 rounded-full ${STATUS_DOT[status]} ${className}`} />;
}

export function StatusChip({ status }: { status: AgentStatus }) {
  const tone =
    status === "needs-you"
      ? "bg-[#fff4de] text-[#9a5b00]"
      : status === "working"
        ? "bg-accent-wash text-accent"
        : status === "done"
          ? "bg-[#e6f6ee] text-[#16794c]"
          : "bg-bubble text-ink-2";
  // Keyed on status so a change pops the chip instead of swapping silently.
  return (
    <motion.span
      key={status}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={POP}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium ${tone}`}
    >
      <StatusDot status={status} className="size-1.5" />
      {STATUS_LABEL[status]}
    </motion.span>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  active = false,
  className = "",
  disabled = false,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  active?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`tap grid size-8 place-items-center rounded-lg text-[#6b6b6b] hover:bg-black/[0.06] hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent ${active ? "bg-black/[0.08] text-ink" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

/** Chat text: paragraphs, line breaks, **bold**, `code` and links. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i} className={i > 0 ? "mt-3" : ""}>
          {para.split("\n").map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {inline(line)}
            </span>
          ))}
        </p>
      ))}
    </>
  );
}

export function inline(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    if (m[1]) {
      const target = m[2];
      if (/^https?:\/\//.test(target)) {
        out.push(
          <a key={m.index} href={target} target="_blank" rel="noreferrer" className="underline decoration-1 underline-offset-[3px]">
            {m[1]}
          </a>,
        );
      } else {
        out.push(<span key={m.index} className="underline decoration-1 underline-offset-[3px]">{m[1]}</span>);
      }
    } else if (m[3]) {
      out.push(<strong key={m.index} className="font-semibold">{m[3]}</strong>);
    } else if (m[4]) {
      out.push(
        <code key={m.index} className="rounded bg-black/[0.06] px-1 py-px font-mono text-[0.86em]">
          {m[4]}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** Dark pill confirming an action, e.g. a download or a pause. */
export function Toast({ toast }: { toast: { id: number; text: string } | null }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 14, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97, transition: { duration: 0.15 } }}
            transition={POP}
            className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13.5px] text-white shadow-[0_8px_30px_rgba(0,0,0,0.18)]"
          >
            <Check className="size-4 text-[#7be0a8]" strokeWidth={2.6} />
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
