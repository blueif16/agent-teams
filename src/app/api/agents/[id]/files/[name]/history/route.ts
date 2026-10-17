import { agentVault } from "@/lib/agent-files";
import { fileOr404 } from "../file";

/*
 * These routes stay dynamic under Cache Components without connection() (which throws outside a request,
 * so the routes couldn't be invoked directly): a param route with no generateStaticParams renders on every
 * request, and reading git is uncached I/O.
 */

/** Every version of an agent's SOUL.md, MEMORY.md or notes.md (name = soul | memory | notes), newest first. */
export async function GET(_req: Request, ctx: RouteContext<"/api/agents/[id]/files/[name]/history">) {
  const { id, name } = await ctx.params;
  const file = fileOr404(id, name);
  if (file instanceof Response) return file;
  return Response.json(await (await agentVault()).history(file));
}
