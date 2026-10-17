/*
 * A task's status → its colour and its board column: one mapping for the graph, the board, the drawer and the
 * status strip. Colours are theme tokens from globals.css (blocked = danger, review = caution, in progress =
 * accent, done = muted with a check).
 */
import type { TaskStatus } from "./types";

export type Tone = "accent" | "danger" | "caution" | "muted" | "idle";
export type ColumnKey = "next" | "doing" | "blocked" | "review" | "done" | "closed";

/** The board, left to right. "Closed" (failed or dropped) only draws when something is in it. */
export const BOARD_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "next", label: "Up next" },
  { key: "doing", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
  { key: "closed", label: "Closed" },
];

/** `dot` fills a status dot, `chip` is a tinted label, `text` colours a word, `ring` outlines a card. */
export const TONE: Record<Tone, { dot: string; chip: string; text: string; ring: string }> = {
  accent: { dot: "bg-accent", chip: "bg-accent-wash text-accent", text: "text-accent", ring: "shadow-[0_0_0_1px_var(--color-accent-soft)]" },
  danger: { dot: "bg-danger", chip: "bg-danger-wash text-danger", text: "text-danger", ring: "shadow-[0_0_0_1.5px_var(--color-danger)]" },
  caution: { dot: "bg-amber", chip: "bg-caution-wash text-caution", text: "text-caution", ring: "shadow-[0_0_0_1px_var(--color-amber)]" },
  muted: { dot: "bg-muted", chip: "bg-bubble text-muted", text: "text-muted", ring: "shadow-[0_0_0_1px_rgba(0,0,0,0.05)]" },
  idle: { dot: "bg-frame-hover", chip: "bg-bubble text-ink-2", text: "text-ink-2", ring: "shadow-[0_0_0_1px_rgba(0,0,0,0.06)]" },
};

const META: Record<TaskStatus, { label: string; tone: Tone; column: ColumnKey }> = {
  todo: { label: "To do", tone: "idle", column: "next" },
  ready: { label: "Ready", tone: "idle", column: "next" },
  in_progress: { label: "In progress", tone: "accent", column: "doing" },
  blocked: { label: "Blocked", tone: "danger", column: "blocked" },
  review: { label: "In review", tone: "caution", column: "review" },
  done: { label: "Done", tone: "muted", column: "done" },
  failed: { label: "Failed", tone: "danger", column: "closed" },
  dropped: { label: "Dropped", tone: "muted", column: "closed" },
};

export function statusMeta(status: TaskStatus): { label: string; tone: Tone; column: ColumnKey; check: boolean } {
  return { ...META[status], check: status === "done" };
}

/** Closed tasks read as finished: muted, and struck through when dropped. */
export const isClosed = (s: TaskStatus) => s === "done" || s === "failed" || s === "dropped";
