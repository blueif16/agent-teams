import { agentVault } from "@/lib/agent-files";
import { getServerCache, skillLibrary } from "@/server/cache";
import { getTeam } from "@/server/directory";
import { getRuntimeDb } from "@/server/runtime/db";
import { isNonce, PlanError, provision } from "@/server/setup/provision";

/*
 * POST /api/projects { plan: LaunchPlan, nonce } → the picked option provisioned (src/server/setup/provision.ts):
 *   201 { projectId, created: true, team }   rows in one transaction, home files, skills and the charter in the vault,
 *                                            one kickoff in the lead's inbox; `org` is announced
 *   200 { projectId, created: false, team }  a retry with the same nonce: nothing more is created
 *   400 { error }                            no nonce, or a plan that can't be launched as sent
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { plan?: unknown; nonce?: unknown } | null;
  if (!isNonce(body?.nonce)) return Response.json({ error: "Send { plan, nonce } with the launch card's nonce (8 to 100 letters, digits, - or _)." }, { status: 400 });
  try {
    const out = await provision(body.plan, body.nonce, {
      db: getRuntimeDb(),
      library: await skillLibrary(),
      vault: await agentVault(),
      bus: getServerCache().bus,
    });
    return Response.json({ ...out, team: getTeam(out.projectId) ?? null }, { status: out.created ? 201 : 200 });
  } catch (e) {
    if (e instanceof PlanError) return Response.json({ error: e.message }, { status: 400 });
    console.error("[projects] launch failed:", e);
    return Response.json({ error: `Couldn't launch the team: ${(e as Error).message}` }, { status: 500 });
  }
}
