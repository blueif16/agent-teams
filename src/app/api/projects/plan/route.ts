import { readLedger } from "@/lib/ledger";
import { normalizeProposal } from "@/lib/project";
import { skillLibrary } from "@/server/cache";
import { getRuntimeDb } from "@/server/runtime/db";
import { planOptions } from "@/server/setup/plan";

/*
 * POST /api/projects/plan { proposal } → LaunchOptions: every option of Mira's proposal staffed from archetypes and
 * the skill library (no web calls), with rehire candidates from the runtime db. Nothing is written; the owner picks
 * an option on its card and POST /api/projects provisions it. 400 when the proposal can't be staffed.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { proposal?: unknown } | null;
  const proposal = normalizeProposal(body?.proposal);
  if (!proposal) return Response.json({ error: "Send { proposal } with a goal and at least one option with a staffable role." }, { status: 400 });
  const plan = await planOptions(proposal, { library: await skillLibrary(), db: getRuntimeDb(), events: await readLedger() });
  return Response.json(plan);
}
