/*
 * The transcript's edges: the bus topics a new row announces, and the paging query the GET routes read.
 * The rows themselves are in db.ts (`messages`): append-only, written as the owner's message is accepted and as a
 * run answers, never by compaction. Server only.
 */
import { getServerCache } from "@/server/cache";
import { TOPICS } from "@/server/cache/bus";
import { getRuntimeDb, type PageOptions } from "./db";
import { parseThreadId } from "./threads";

/** A sender's own id for a message (`ref`): short and plain, since it ends up as a React key. */
export const isRef = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,64}$/.test(v);

export interface SaveTo {
  thread: string;
  text: string;
  ref?: string;
  replyRef?: string;
}

/**
 * Where /api/chat saves a message it answers outside the runtime (one with images): `raw` is the page's
 * `{ thread, text, ref?, replyRef? }`, kept only when the thread exists and is `agentId`'s own.
 */
export function saveTo(raw: unknown, agentId: string): SaveTo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { thread, text, ref, replyRef } = raw as Record<string, unknown>;
  if (typeof thread !== "string" || typeof text !== "string" || text.length > 20_000) return undefined;
  if (parseThreadId(thread)?.agentId !== agentId || !getRuntimeDb().threads.get(thread)) return undefined;
  return { thread, text, ref: isRef(ref) ? ref : undefined, replyRef: isRef(replyRef) ? replyRef : undefined };
}

/** Tells the app a thread's transcript has a new row: `messages:<thread>` and its project's `messages:project:<id>`. */
export function announceMessage(threadId: string): void {
  const { bus } = getServerCache();
  bus.emit(TOPICS.messages(threadId));
  const ids = parseThreadId(threadId);
  if (ids) bus.emit(TOPICS.projectMessages(ids.projectId));
}

export const MAX_PAGE = 500;

/** `?before=<id>&limit=<n>` from a request URL; a string when either is malformed. */
export function pageQuery(url: string): PageOptions | string {
  const q = new URL(url).searchParams;
  const int = (name: string) => {
    const raw = q.get(name);
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : NaN;
  };
  const before = int("before");
  const limit = int("limit");
  if (Number.isNaN(before)) return "before must be a message id.";
  if (Number.isNaN(limit) || (limit ?? 0) > MAX_PAGE) return `limit must be 1 to ${MAX_PAGE}.`;
  return { before, limit };
}
