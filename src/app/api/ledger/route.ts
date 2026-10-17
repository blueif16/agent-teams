import { record } from "@/lib/ledger";
import { getAgent } from "@/server/directory";

/** Records outcome events that happen only in the UI, such as approval decisions. */
export async function POST(req: Request) {
  const { agentId, decision } = (await req.json()) as { agentId: string; decision: "approved" | "declined" };
  const agent = getAgent(agentId);
  if (!agent) return Response.json({ error: `Unknown agent "${agentId}".` }, { status: 400 });
  if (decision !== "approved" && decision !== "declined") {
    return Response.json({ error: "decision must be approved or declined" }, { status: 400 });
  }
  await record({ t: "approval", at: new Date().toISOString(), team: agent.teamId, agent: agent.id, decision });
  return Response.json({ ok: true });
}
