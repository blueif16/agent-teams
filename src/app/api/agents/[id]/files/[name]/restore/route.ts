import { getVault, OWNER } from "@/server/runtime/vault";
import { fileOr404, vaultError } from "../file";

/**
 * Restores an agent file to an earlier version: { change }. Always a new commit (Source: restore,
 * Restores: <change>); answers { commit, content, updated } with the file as it is now.
 * `commit` is null when the file already matched that version.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[id]/files/[name]/restore">) {
  const { id, name } = await ctx.params;
  const file = fileOr404(id, name);
  if (file instanceof Response) return file;
  const body = (await req.json().catch(() => null)) as { change?: unknown } | null;
  if (typeof body?.change !== "string" || !body.change) {
    return Response.json({ error: "Send { change: <change id> }." }, { status: 400 });
  }

  const vault = getVault();
  try {
    const commit = await vault.restore(file, body.change, OWNER);
    const content = (await vault.show(file)) ?? "";
    const updated = commit?.at ?? (await vault.history(file)).commits[0]?.at ?? null;
    return Response.json({ commit, content, updated });
  } catch (e) {
    return vaultError(e);
  }
}
