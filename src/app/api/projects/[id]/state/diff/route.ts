import { connection } from "next/server";
import { agentVault } from "@/lib/agent-files";
import { VaultNotFoundError } from "@/server/runtime/vault";
import { vaultError } from "@/app/api/agents/[id]/files/[name]/file";
import { stateFileOr400 } from "../file";

/** Word diff of one state file's version against the one before it: GET …/state/diff?file=dag.json&to=<change>. */
export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/state/diff">) {
  await connection();
  const { id } = await ctx.params;
  const query = new URL(req.url).searchParams;
  const file = stateFileOr400(id, query.get("file"));
  if (file instanceof Response) return file;
  const to = query.get("to");
  if (!to) return Response.json({ error: "Send ?to=<change>." }, { status: 400 });
  const vault = await agentVault();
  try {
    const commits = (await vault.history(file)).commits;
    const at = commits.findIndex((c) => c.change === to);
    if (at === -1) throw new VaultNotFoundError(`No change ${to} for ${file}`);
    return Response.json(await vault.diff(file, commits[at + 1]?.change ?? null, to));
  } catch (e) {
    return vaultError(e);
  }
}
