/*
 * The agent directory: the one place the server looks an agent or a team up (setup-flow spec, step 5). It checks the
 * code constants first (Mira and her company team, src/lib/data.ts), then the runtime db (src/server/runtime/db.ts),
 * where provisioning writes every agent and project it creates. Reads are synchronous (node:sqlite) and never
 * cached, so a launch shows up on the next call. Server only.
 */
import { AGENTS, CAST, CHIEF_ID, HQ, TEAMS_BY_ID } from "@/lib/data";
import type { AgentType } from "@/lib/inherent";
import { MODELS } from "@/lib/models";
import type { Archetype } from "@/lib/policy/types";
import { getArchetype } from "@/lib/skills/archetypes";
import type { Composition } from "@/lib/skills/types";
import type { Agent, AgentStatus, OrgPayload, Team } from "@/lib/types";
import { getRuntimeDb, MIRA_DM_PROJECT, type AgentRow, type ProjectRow } from "./runtime/db";

export interface AgentHome {
  id: string;
  kind: ProjectRow["kind"];
  /** null for a DM project (a solo expert). */
  channel: string | null;
  name: string;
  goal: string;
}

/** An agent as the server knows it: the client's Agent plus what only the server needs. */
export interface DirectoryAgent extends Agent {
  archetype: Archetype;
  /** The archetype and skills it was hired with (db agents). */
  composition?: Composition;
  /** Its role's qualifications on its current project. */
  qualifications: string[];
  /** The project it works on now; SOUL.md names it. */
  home: AgentHome;
  status: AgentStatus;
  source: "code" | "db";
}

/** The type of a code-constant agent, from its role (Mira is the chief). */
export function agentType(agent: Agent): AgentType {
  if (agent.id === CHIEF_ID) return "chief";
  if (TEAMS_BY_ID[agent.teamId]?.leadId === agent.id || /lead/i.test(agent.role)) return "lead";
  if (/writer|copy|draft/i.test(agent.role)) return "writer";
  if (/research|fact|sourcer/i.test(agent.role)) return "researcher";
  if (/analyst|sql|chart/i.test(agent.role)) return "analyst";
  if (/design|\bux\b|\bui\b/i.test(agent.role)) return "designer";
  if (/test|ci\b|review|eng/i.test(agent.role)) return "engineer";
  return "coordinator";
}

const teamHome = (t: Team): AgentHome => ({ id: t.id, kind: t.id === HQ.id ? "company" : "team", channel: t.channel, name: t.name, goal: t.goal });

function fromConstant(a: Agent): DirectoryAgent {
  return { ...a, archetype: agentType(a), qualifications: [], home: teamHome(TEAMS_BY_ID[a.teamId] ?? HQ), status: "idle", source: "code" };
}

const projectHome = (p: ProjectRow): AgentHome => ({ id: p.id, kind: p.kind, channel: p.channel, name: p.name, goal: p.goal ?? "" });

function fromRow(row: AgentRow): DirectoryAgent {
  const db = getRuntimeDb();
  // The newest live project it's a member of is its home: rehired agents keep their identity across projects.
  let project: ProjectRow | undefined;
  let role: string | null = null;
  let qualifications: string[] = [];
  for (const t of [...db.threads.byAgent(row.id)].reverse()) {
    const p = db.projects.get(t.projectId);
    const m = p && p.status === "active" ? db.members.list(p.id).find((x) => x.agentId === row.id) : undefined;
    if (p && m) {
      project = p;
      role = m.role;
      qualifications = m.qualifications;
      break;
    }
  }
  const def = getArchetype(row.archetype);
  return {
    id: row.id,
    name: row.name,
    role: role ?? def?.name ?? row.archetype,
    teamId: project?.id ?? HQ.id,
    model: MODELS[row.modelTier] ?? MODELS.main,
    look: CAST[row.archetype as keyof typeof CAST] ?? CAST.lead,
    brief: def?.summary ?? "",
    archetype: row.archetype,
    composition: row.config.composition,
    qualifications,
    home: project ? projectHome(project) : teamHome(HQ),
    status: row.status,
    source: "db",
  };
}

/** The agent with this id: a code constant, else a live row in the runtime db. */
export function getAgent(id: string): DirectoryAgent | undefined {
  const known = AGENTS[id];
  if (known) return fromConstant(known);
  const row = getRuntimeDb().agents.get(id);
  return row && !row.retiredAt ? fromRow(row) : undefined;
}

/** Every agent: the constants, then the db's in creation order. */
export function listAgents(): DirectoryAgent[] {
  const db = getRuntimeDb()
    .agents.list()
    .filter((r) => !AGENTS[r.id])
    .map(fromRow);
  return [...Object.values(AGENTS).map(fromConstant), ...db];
}

/** The client's view of an agent: no server-only fields. */
export function toClientAgent({ id, name, role, teamId, model, look, brief }: DirectoryAgent): Agent {
  return { id, name, role, teamId, model, look, brief };
}

function toTeam(p: ProjectRow): Team {
  const db = getRuntimeDb();
  const members = db.members.list(p.id);
  // The lead first, as every team view expects.
  members.sort((a, b) => Number(b.agentId === p.leadAgentId) - Number(a.agentId === p.leadAgentId));
  const agents = members.flatMap((m) => {
    const a = getAgent(m.agentId);
    return a ? [{ ...toClientAgent(a), role: m.role ?? a.role }] : [];
  });
  return {
    id: p.id,
    channel: p.channel ?? agents[0]?.name.toLowerCase() ?? p.id,
    name: p.name,
    goal: p.goal ?? "",
    leadId: p.leadAgentId ?? agents[0]?.id ?? "",
    agents,
    messages: [],
    launched: {
      spec: p.specMd ?? "",
      due: p.dueAt ?? undefined,
      assignments: Object.fromEntries(members.map((m) => [m.agentId, [m.role, m.qualifications.join(", ")].filter(Boolean).join(": ")])),
    },
  };
}

/** A db project the setup flow made (not Mira's own DM), or undefined. */
function setupProject(id: string): ProjectRow | undefined {
  if (id === MIRA_DM_PROJECT) return undefined;
  const p = getRuntimeDb().projects.get(id);
  return p && p.status === "active" && p.kind !== "company" ? p : undefined;
}

/** A team by id: the constants (the company), else a live db project. */
export function getTeam(id: string): Team | undefined {
  const known = TEAMS_BY_ID[id];
  if (known) return known;
  const p = setupProject(id);
  return p ? toTeam(p) : undefined;
}

/** Live projects of one kind, oldest first. */
const liveProjects = (kind: ProjectRow["kind"]) => getRuntimeDb().projects.list({ status: "active", kind });

/** The channels: live team projects in the db, oldest first. */
export function listTeams(): Team[] {
  return liveProjects("team").map(toTeam);
}

/** Live one-expert projects (solo DMs), Mira's own excluded. */
export function listDms(): Team[] {
  return liveProjects("dm")
    .filter((p) => p.id !== MIRA_DM_PROJECT)
    .map(toTeam);
}

/** GET /api/org: what the db adds to the constants. The client merges Mira and the company back in. */
export function orgPayload(): OrgPayload {
  return {
    teams: listTeams(),
    dms: listDms(),
    agents: listAgents()
      .filter((a) => a.source === "db")
      .map(toClientAgent),
  };
}
