import { getRuntime, UnknownThreadError } from "@/server/runtime";

/*
 * An owner message to an agent's thread (research D §10):
 *   POST /api/threads/a:mira:p:dm/messages  { "text": "…" }
 * 202 { delivered: "run" | "inbox", runId?, inboxId }. "run": it started a run. "inbox": a run is in progress
 * and gets the message before its next model call. Watch the run on GET /api/threads/[id]/events, opened
 * before posting so no token is missed. The run doesn't depend on this request: it carries on if the tab closes.
 */
const MAX_TEXT = 20_000;

export async function POST(req: Request, ctx: RouteContext<"/api/threads/[id]/messages">) {
  const { id } = await ctx.params;
  let body: { text?: unknown };
  try {
    body = (await req.json()) as { text?: unknown };
  } catch {
    return Response.json({ error: "Send JSON: { \"text\": \"…\" }" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "The message is empty." }, { status: 400 });
  if (text.length > MAX_TEXT) return Response.json({ error: `Keep a message under ${MAX_TEXT} characters.` }, { status: 413 });
  try {
    return Response.json(getRuntime().send(id, { text }), { status: 202 });
  } catch (e) {
    if (e instanceof UnknownThreadError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
