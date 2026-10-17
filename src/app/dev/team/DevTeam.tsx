"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { AgentTeams } from "@/components/AgentTeams";
import { AGENTS, CAST } from "@/lib/data";
import { MODELS } from "@/lib/models";
import type { Agent, AgentType, Team } from "@/lib/types";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isType = (s: string): s is AgentType => Object.hasOwn(CAST, s);

/** Builds the launched team from the query and registers its agents, as launching a staffed project would. */
function teamFrom(q: URLSearchParams): Team {
  const pid = q.get("pid") || "pricing";
  const lead = q.get("lead") || "juno";
  const roster = (q.get("members") || "")
    .split(",")
    .filter(Boolean)
    .map((m) => m.split(":"));
  const agent = (id: string, type: AgentType, role: string): Agent => ({ id, name: cap(id), role, teamId: pid, model: MODELS.main, look: CAST[type], brief: `${cap(role)} on #${pid}.` });
  const agents = [agent(lead, "lead", "PM"), ...roster.map(([id, type = "coordinator"]) => agent(id, isType(type) ? type : "coordinator", type))];
  for (const a of agents) AGENTS[a.id] ??= a;
  return {
    id: pid,
    channel: pid,
    name: q.get("name") || cap(pid),
    goal: q.get("goal") || "A seeded project for developing the state views.",
    leadId: lead,
    agents,
    messages: [],
    launched: { spec: "", assignments: {} },
  };
}

export function DevTeam() {
  const q = useSearchParams();
  const [team] = useState(() => teamFrom(new URLSearchParams(q.toString())));
  return <AgentTeams initialTeams={[team]} />;
}
