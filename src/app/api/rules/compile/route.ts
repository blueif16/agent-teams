import { getAgent, listAgents, listDms, listTeams } from "@/server/directory";
import { compileRules, type CompileContext } from "@/lib/policy/compile";
import { policyStore } from "@/lib/policy/store";

/*
 * POST /api/rules/compile { text, agent?, project? } → CompileResult: the owner's sentence as proposed rules, with
 * read-backs, assumptions, at most 3 questions and conflicts. Nothing is saved; POST /api/rules saves.
 * The compiler sees trusted context only: the tool catalog, agents, projects and the rules in force.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { text?: unknown; agent?: unknown; project?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 1000) return Response.json({ error: "Send { text } with the rule in plain English (up to 1,000 characters)." }, { status: 400 });
  const agent = typeof body?.agent === "string" && body.agent ? body.agent.slice(0, 40) : undefined;
  const project = typeof body?.project === "string" && body.project ? body.project.slice(0, 60) : undefined;

  const rules = await policyStore().list();
  const agents: CompileContext["agents"] = listAgents().map((a) => ({ id: a.id, name: a.name, archetype: a.archetype }));
  // An agent launched at runtime isn't in the seed data; the owner typed the sentence on its panel, so it exists.
  if (agent && !getAgent(agent)) agents.push({ id: agent, name: agent.charAt(0).toUpperCase() + agent.slice(1) });
  const projects = [
    ...new Set(["company", ...[...listTeams(), ...listDms()].map((t) => t.id), ...(project ? [project] : []), ...rules.flatMap((r) => (r.scope.projects ?? []).filter((p) => p !== "*" && !p.startsWith("dm:")))]),
  ];

  const out = await compileRules({ text, agent, project }, { agents, projects, rules, now: new Date() });
  if (!out.ok) return Response.json({ error: out.error, issues: out.issues }, { status: out.status });
  return Response.json(out.result);
}
