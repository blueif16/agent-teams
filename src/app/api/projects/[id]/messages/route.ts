import { connection } from "next/server";
import { getRuntime } from "@/server/runtime";
import { pageQuery } from "@/server/runtime/transcript";

/*
 * A project's conversation: GET /api/projects/<id>/messages?before=<id>&limit=<n>
 * Every member thread's transcript (src/server/runtime/db.ts) merged in the order it was said, so a channel shows
 * the owner and each agent as itself; a DM project (Mira's `dm`, a solo expert's) has just the one thread.
 * 200 { messages, more }, paged as GET /api/threads/[id]/messages is. The client caches it and re-reads on
 * `messages:project:<id>`.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/messages">) {
  await connection();
  const { id } = await ctx.params;
  const { db } = getRuntime();
  if (!db.projects.get(id)) return Response.json({ error: `There is no project ${id}` }, { status: 404 });
  const page = pageQuery(req.url);
  if (typeof page === "string") return Response.json({ error: page }, { status: 400 });
  return Response.json(db.messages.projectPage(id, page));
}
