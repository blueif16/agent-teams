import { ApprovalDecidedError, UnknownApprovalError } from "@/server/runtime/approvals";
import { getRuntime } from "@/server/runtime";

/*
 * The owner decides an approval (R6):
 *   POST /api/approvals/<id>  { "decision": "approve" | "decline", "note"?: "…" }
 * 200 { approval, runId }: the decision is recorded (with a ledger row) and the paused run resumes as `runId`, whose
 * events stream on GET /api/threads/<approval.threadId>/events. Approve runs the tool; decline tells the agent, with
 * the note. 400 for a bad body, 404 for an unknown id, 409 when it was already decided.
 */
const MAX_NOTE = 2_000;

export async function POST(req: Request, ctx: RouteContext<"/api/approvals/[id]">) {
  const { id } = await ctx.params;
  let body: { decision?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Send JSON: { "decision": "approve" | "decline", "note"?: "…" }' }, { status: 400 });
  }
  if (body.decision !== "approve" && body.decision !== "decline") return Response.json({ error: 'decision must be "approve" or "decline"' }, { status: 400 });
  if (body.note !== undefined && typeof body.note !== "string") return Response.json({ error: "note must be a string" }, { status: 400 });
  const note = body.note?.trim().slice(0, MAX_NOTE) || undefined;
  try {
    return Response.json(await getRuntime().decide(id, body.decision, note));
  } catch (e) {
    if (e instanceof UnknownApprovalError) return Response.json({ error: e.message }, { status: 404 });
    if (e instanceof ApprovalDecidedError) return Response.json({ error: e.message, approval: e.approval }, { status: 409 });
    throw e;
  }
}
