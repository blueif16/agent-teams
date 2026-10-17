import { getRuntime, UnknownThreadError } from "@/server/runtime";
import { parseThreadId } from "@/server/runtime/threads";
import { attachUploads, UploadError } from "@/server/uploads";

/*
 * An owner message to an agent's thread (research D §10):
 *   POST /api/threads/a:mira:p:dm/messages  { "text": "…", "uploads"?: ["<upload id>", …] }
 * 202 { delivered: "run" | "inbox", runId?, inboxId }. "run": it started a run. "inbox": a run is in progress
 * and gets the message before its next model call. Watch the run on GET /api/threads/[id]/events, opened
 * before posting so no token is missed. The run doesn't depend on this request: it carries on if the tab closes.
 * Uploads (ids from POST /api/uploads, at most 8, 4 of them images): each text document is copied to the thread's
 * /project/inputs/<name> and inlined as an <attachment> block; images ride on the message as image parts. A text
 * alone, or uploads alone, is a message. 400 for an unknown upload id.
 */
const MAX_TEXT = 20_000;

export async function POST(req: Request, ctx: RouteContext<"/api/threads/[id]/messages">) {
  const { id } = await ctx.params;
  let body: { text?: unknown; uploads?: unknown };
  try {
    body = (await req.json()) as { text?: unknown; uploads?: unknown };
  } catch {
    return Response.json({ error: "Send JSON: { \"text\": \"…\" }" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const hasUploads = Array.isArray(body.uploads) && body.uploads.length > 0;
  if (!text && !hasUploads) return Response.json({ error: "The message is empty." }, { status: 400 });
  if (text.length > MAX_TEXT) return Response.json({ error: `Keep a message under ${MAX_TEXT} characters.` }, { status: 413 });
  const rt = getRuntime();
  const thread = rt.db.threads.get(id) && parseThreadId(id);
  if (!thread) return Response.json({ error: new UnknownThreadError(id).message }, { status: 404 });
  try {
    const { blocks, images, uploads } = hasUploads ? await attachUploads(body.uploads, thread.projectId) : { blocks: "", images: [], uploads: [] };
    return Response.json(rt.send(id, { text: [text, blocks].filter(Boolean).join("\n\n"), images, uploads }), { status: 202 });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof UnknownThreadError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
