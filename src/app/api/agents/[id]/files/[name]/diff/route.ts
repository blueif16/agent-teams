import { getVault, VaultNotFoundError } from "@/server/runtime/vault";
import { fileOr404, vaultError } from "../file";

/**
 * Word diff of one agent file: ?to=<change>[&from=<change>]. Without `from`, `to` is compared with the
 * version before it (or with nothing, for the file's first version).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/agents/[id]/files/[name]/diff">) {
  const { id, name } = await ctx.params;
  const file = fileOr404(id, name);
  if (file instanceof Response) return file;
  const query = new URL(req.url).searchParams;
  const to = query.get("to");
  if (!to) return Response.json({ error: "Send ?to=<change>, and optionally &from=<change>." }, { status: 400 });

  const vault = getVault();
  try {
    let from = query.get("from") || null;
    if (!from) {
      const commits = (await vault.history(file)).commits;
      const at = commits.findIndex((c) => c.change === to);
      if (at === -1) throw new VaultNotFoundError(`No change ${to} for ${file}`);
      from = commits[at + 1]?.change ?? null;
    }
    return Response.json(await vault.diff(file, from, to));
  } catch (e) {
    return vaultError(e);
  }
}
