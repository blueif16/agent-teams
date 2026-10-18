import { connection } from "next/server";
import { getRuntime } from "@/server/runtime";

/*
 * Approvals waiting on the owner (R6, src/server/runtime/approvals.ts):
 *   GET /api/approvals?thread=a:mira:p:dm   one thread's
 *   GET /api/approvals?project=<id>         every thread's in a project (a channel)
 * 200 { approvals: ApprovalRow[] }, oldest first. The client caches it and refreshes on the `approvals` topic, which
 * fires when one is created or decided. connection() keeps it at request time: the db is read synchronously.
 */
export async function GET(req: Request) {
  await connection();
  const params = new URL(req.url).searchParams;
  const thread = params.get("thread") ?? undefined;
  const project = params.get("project") ?? undefined;
  if (!thread && !project) return Response.json({ error: "Name a thread or a project: /api/approvals?thread=a:mira:p:dm" }, { status: 400 });
  return Response.json({ approvals: getRuntime().db.approvals.pending({ thread, project }) });
}
