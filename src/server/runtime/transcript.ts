/*
 * The transcript's edges: the bus topics a new row announces, and the paging query the GET routes read.
 * The rows themselves are in db.ts (`messages`): append-only, written as the owner's message is accepted and as a
 * run answers, never by compaction. Server only.
 */
import { getServerCache } from "@/server/cache";
import { TOPICS } from "@/server/cache/bus";
import type { PageOptions } from "./db";
import { parseThreadId } from "./threads";

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
