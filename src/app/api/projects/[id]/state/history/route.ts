import { connection } from "next/server";
import { agentVault } from "@/lib/agent-files";
import { stateFileOr400 } from "../file";

/**
 * Every version of one project state file, newest first:
 *   GET /api/projects/<pid>/state/history?file=dag.json[&task=t7]
 * `task` keeps the versions whose commit names that task (the state tools' Task trailer). Read-only: only the
 * PM's tools write state, so there is no restore route.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/state/history">) {
  await connection();
  const { id } = await ctx.params;
  const query = new URL(req.url).searchParams;
  const file = stateFileOr400(id, query.get("file"));
  if (file instanceof Response) return file;
  const history = await (await agentVault()).history(file);
  const task = query.get("task");
  return Response.json(task ? { ...history, commits: history.commits.filter((c) => c.trailers.Task?.includes(task)) } : history);
}
