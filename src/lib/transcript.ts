/*
 * The client side of the transcript (src/server/runtime/db.ts `messages`): what a DM or a channel shows is its
 * saved rows (GET /api/projects/[id]/messages, cached, re-read on `messages:project:<id>`), merged with what this
 * page holds only locally (status lines, option cards, a message on its way) and with replies still streaming
 * (src/lib/live-runs.ts).
 *
 * One id per message across all three, so a message never draws twice and never remounts as it moves from
 * local or live to saved: the sender's ref (the owner's messages, and replies through /api/chat), else
 * `run:<id>` for a run's answer (one per run), else `m:<row id>`.
 */
import type { Resource } from "./client-cache";
import { visibleText } from "./project";
import type { Message } from "./types";

/** A transcript row as the GET routes send it (src/server/runtime/db.ts MessageRow). */
export interface SavedRow {
  id: number;
  threadId: string;
  runId: string | null;
  role: "owner" | "agent";
  author: string;
  text: string;
  uploads: string[];
  ref: string | null;
  at: string;
}

export interface SavedPage {
  /** Oldest first. */
  messages: SavedRow[];
  /** Older rows exist: page back with `before` = the first id. */
  more: boolean;
}

/** A run in flight on a thread, with the answer typed so far (src/lib/live-runs.ts). */
export interface LiveReply {
  thread: string;
  run: string;
  text: string;
}

/** A project's conversation (a channel, or a DM project), optionally the page before row `before`. */
export function transcriptOf(projectId: string, before?: number): Resource {
  const key = `/api/projects/${encodeURIComponent(projectId)}/messages${before ? `?before=${before}` : ""}`;
  return { key, topic: `messages:project:${projectId}` };
}

/** `a:{agentId}:p:{projectId}` (src/server/runtime/threads.ts). */
export const threadOf = (agentId: string, projectId: string) => `a:${agentId}:p:${projectId}`;
const agentOf = (thread: string) => /^a:([^:]+):p:/.exec(thread)?.[1] ?? thread;

export const replyId = (runId: string) => `run:${runId}`;

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Saved rows as the messages a view draws: the owner's as their bubbles, each agent's as that agent. */
export function savedMessages(rows: SavedRow[]): Message[] {
  return rows.map((r) => {
    const id = r.ref ?? (r.role === "agent" && r.runId ? replyId(r.runId) : `m:${r.id}`);
    const at = clock(r.at);
    if (r.role === "owner") return { id, kind: "text", from: "you", at, text: r.text, ...(r.uploads.length ? { images: r.uploads } : {}), saved: true };
    // A project block is the option cards' input, not prose.
    return { id, kind: "text", from: r.author, at, text: visibleText(r.text) || r.text, saved: true };
  });
}

/**
 * The saved messages in their order, with this page's local ones placed where they were said: each local run of
 * messages goes right before the next local message the saved list also has. A message in both shows the local
 * copy, whose state on this page (a card's progress, a reply settling) is newer.
 */
export function mergeTimeline(saved: Message[], local: Message[]): Message[] {
  const localIds = new Set(local.map((m) => m.id));
  const out: Message[] = [];
  let next = 0;
  for (const m of saved) {
    if (!localIds.has(m.id)) {
      out.push(m);
      continue;
    }
    while (next < local.length && local[next].id !== m.id) out.push(local[next++]);
    if (next < local.length) out.push(local[next++]);
  }
  while (next < local.length) out.push(local[next++]);
  return out;
}

/** Runs in flight on `threads` that have said something and aren't shown yet (`shown` ids), as streaming replies. */
export function liveReplies(runs: LiveReply[], threads: string[], shown: Set<string>): Message[] {
  const on = new Set(threads);
  return runs
    .filter((r) => on.has(r.thread) && r.text.trim() && !shown.has(replyId(r.run)))
    .map((r) => ({ id: replyId(r.run), kind: "text", from: agentOf(r.thread), at: clock(new Date().toISOString()), text: visibleText(r.text) || "…", streaming: true }));
}

/** Everything a view shows: saved rows, merged with the page's local messages, then the replies still streaming. */
export function viewMessages(rows: SavedRow[], local: Message[], live: LiveReply[], threads: string[]): Message[] {
  const merged = mergeTimeline(savedMessages(rows), local);
  return [...merged, ...liveReplies(live, threads, new Set(merged.map((m) => m.id)))];
}
