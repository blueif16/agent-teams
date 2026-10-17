import { connection } from "next/server";
import { AgentId, ProjectId, StateFileError } from "@/server/project-state";
import { buildStateView } from "@/server/state-view";

/*
 * The PM's project state for the state views:
 *   GET /api/projects/<pid>/state[?lead=<agentId>]
 * Every state file, read through the state module (zod-validated, one consistent snapshot) and shaped for the
 * views, plus each file's last change in the vault. `lead` names the team lead so its context bar fills.
 * Clients read it through useCached with topic state:<pid>, which the app vault announces on every state commit.
 * connection() keeps it at request time under Cache Components.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/state">) {
  await connection();
  const { id } = await ctx.params;
  if (!ProjectId.safeParse(id).success) return Response.json({ error: `"${id}" isn't a project id.` }, { status: 400 });
  const lead = new URL(req.url).searchParams.get("lead") || undefined;
  if (lead && !AgentId.safeParse(lead).success) return Response.json({ error: `"${lead}" isn't an agent id.` }, { status: 400 });
  try {
    return Response.json(await buildStateView(id, { lead }));
  } catch (e) {
    // A hand edit gone wrong: say which file, and show nothing made up.
    if (e instanceof StateFileError) return Response.json({ error: e.message, file: e.file }, { status: 422 });
    throw e;
  }
}
