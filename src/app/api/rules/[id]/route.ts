import { policyStore } from "@/lib/policy/store";

/** DELETE /api/rules/[id] → { ok: true }. Built-in and locked rules can't be deleted (400). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/rules/[id]">) {
  const { id } = await ctx.params;
  const result = await policyStore().remove(id);
  if (result.ok) return Response.json({ ok: true });
  if (result.reason === "not_found") return Response.json({ error: `No rule "${id}".` }, { status: 404 });
  const why = result.reason === "default" ? "is a built-in default" : "is locked";
  return Response.json({ error: `Rule ${id} ${why}, so it can't be deleted.` }, { status: 400 });
}
