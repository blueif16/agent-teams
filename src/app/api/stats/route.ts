import { connection } from "next/server";
import { AGENTS, TEAMS, TEAMS_BY_ID } from "@/lib/data";
import { readLedger } from "@/lib/ledger";
import { agentReport, teamReport, totals } from "@/lib/stats";

/*
 * Performance stats from the ledger, for the Performance tabs and the HR agent.
 *   GET /api/stats?team=<id>    team totals, per-agent stats, last 24h by hour
 *                               (a team launched at runtime adds &agents=<id>,<id>)
 *   GET /api/stats?agent=<id>   one agent's stats and its recent calls
 *   GET /api/stats              totals for every team
 * Served from the in-memory ledger. With Cache Components a GET handler that
 * touches no request data or async IO is prerendered at build time, so
 * connection() keeps this one at request time.
 */
export async function GET(req: Request) {
  await connection();
  const params = new URL(req.url).searchParams;
  const events = await readLedger();

  const agentId = params.get("agent");
  if (agentId) {
    const agent = AGENTS[agentId];
    if (!agent) return Response.json({ error: `Unknown agent "${agentId}".` }, { status: 404 });
    return Response.json(agentReport(events, agent.id, agent.teamId));
  }

  const teamId = params.get("team");
  if (teamId) {
    const team = TEAMS_BY_ID[teamId];
    const members = team
      ? team.agents.map((a) => a.id)
      : (params.get("agents") ?? "").split(",").filter((id) => AGENTS[id]);
    if (!members.length) return Response.json({ error: `Unknown team "${teamId}".` }, { status: 404 });
    return Response.json(teamReport(events, teamId, members));
  }

  return Response.json({
    teams: TEAMS.map((t) => ({ team: t.id, ...totals(events.filter((e) => e.team === t.id)) })),
  });
}
