import { connection } from "next/server";
import { getRuntime, UnknownThreadError } from "@/server/runtime";
import { isRef, pageQuery } from "@/server/runtime/transcript";

/*
 * An owner message to an agent's thread (research D §10):
 *   POST /api/threads/a:mira:p:dm/messages  { "text": "…", "ref"?: "<the sender's id for it>" }
 * 202 { delivered: "run" | "inbox", runId?, inboxId, messageId }. "run": it started a run. "inbox": a run is in
 * progress and gets the message before its next model call. `messageId` is its transcript row, which keeps `ref`.
 * Watch the run on GET /api/runs (every thread) or /api/threads/[id]/events. The run doesn't depend on this
 * request: it carries on if the tab closes.
 */
const MAX_TEXT = 20_000;

export async function POST(req: Request, ctx: RouteContext<"/api/threads/[id]/messages">) {
  const { id } = await ctx.params;
  let body: { text?: unknown; ref?: unknown };
  try {
    body = (await req.json()) as { text?: unknown; ref?: unknown };
  } catch {
    return Response.json({ error: "Send JSON: { \"text\": \"…\" }" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "The message is empty." }, { status: 400 });
  if (text.length > MAX_TEXT) return Response.json({ error: `Keep a message under ${MAX_TEXT} characters.` }, { status: 413 });
  const ref = isRef(body.ref) ? body.ref : undefined;
  try {
    return Response.json(getRuntime().send(id, { text, ref }), { status: 202 });
  } catch (e) {
    if (e instanceof UnknownThreadError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

/*
 * The thread's transcript: GET /api/threads/a:mira:p:dm/messages?before=<id>&limit=<n>
 * 200 { messages, more }: the latest `limit` (default 200, at most 500) rows older than `before`, oldest first;
 * `more` says older ones exist, to page back from the first id. What was said, not the agent's working context:
 * compaction never touches it. The client caches it and re-reads on `messages:<thread>`.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/threads/[id]/messages">) {
  await connection();
  const { id } = await ctx.params;
  const { db } = getRuntime();
  if (!db.threads.get(id)) return Response.json({ error: `There is no thread ${id}` }, { status: 404 });
  const page = pageQuery(req.url);
  if (typeof page === "string") return Response.json({ error: page }, { status: 400 });
  return Response.json(db.messages.page(id, page));
}
