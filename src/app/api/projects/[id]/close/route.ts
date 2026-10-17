import { z } from "zod";
import { CloseError, closeProject } from "@/server/learn/close";
import { RunFeedbackSchema } from "@/server/learn/types";

/*
 * POST /api/projects/[id]/close { feedback?, facts?, kind? } → the project closes and the company learns from it
 * (src/server/learn/close.ts): a retro, a dream per member, skill tuning where the feedback points at a skill, and a
 * composition note, each a vault commit.
 *   200 CloseSummary { projectId, closed, commits[], skipped[], usd }   closed false: a step failed; POST again to retry
 *   400 { error }   Mira's DM, a project that hasn't launched, or a body that isn't the shape below
 *   404 { error }   no such project
 * feedback: RunFeedback (test mode's run feedback); facts: strings to keep out of learning (the client's name,
 * competitors, figures); kind: the kind of work as a slug ("product-launch-kit").
 */
const Body = z.object({
  feedback: RunFeedbackSchema.optional(),
  facts: z.array(z.string().min(1).max(200)).max(200).optional(),
  kind: z.string().max(48).optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/close">) {
  const { id } = await ctx.params;
  const text = await req.text();
  let raw: unknown = {};
  try {
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    return Response.json({ error: "Send JSON: { feedback?, facts?, kind? }." }, { status: 400 });
  }
  const body = Body.safeParse(raw);
  if (!body.success) {
    const issue = body.error.issues[0];
    return Response.json({ error: `Bad ${issue?.path.join(".") || "body"}: ${issue?.message ?? "not the expected shape"}.` }, { status: 400 });
  }
  try {
    return Response.json(await closeProject(id, body.data));
  } catch (e) {
    if (e instanceof CloseError) return Response.json({ error: e.message }, { status: e.status });
    console.error(`[projects] close of ${id} failed:`, e);
    return Response.json({ error: `Couldn't close the project: ${(e as Error).message}` }, { status: 500 });
  }
}
