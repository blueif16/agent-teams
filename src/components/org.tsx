"use client";

import { createContext, useContext, useMemo } from "react";
import { useCached, type Resource } from "@/lib/client-cache";
import { AGENTS, TEAMS, TEAMS_BY_ID } from "@/lib/data";
import type { Agent, OrgPayload, Team } from "@/lib/types";

/**
 * The org as the app knows it: the code constants (Mira and her company team) merged with what the runtime db holds
 * (GET /api/org), refreshed on the `org` topic a launch announces, never on a timer.
 * `teams` is the channel list; `teamsById` also has the company and solo experts' DM projects; `agents` is every
 * agent by id, so a mascot, a name or a profile never needs src/lib/data.ts.
 */
export interface Org {
  teams: Team[];
  teamsById: Record<string, Team>;
  agents: Record<string, Agent>;
}

export const orgResource: Resource = { key: "/api/org", topic: "org" };

export function mergeOrg(payload?: OrgPayload): Org {
  const teams = [...TEAMS, ...(payload?.teams ?? [])];
  const all = [...teams, ...(payload?.dms ?? [])];
  return {
    teams,
    teamsById: { ...TEAMS_BY_ID, ...Object.fromEntries(all.map((t) => [t.id, t])) },
    agents: { ...Object.fromEntries((payload?.agents ?? []).map((a) => [a.id, a])), ...AGENTS },
  };
}

export const OrgContext = createContext<Org>(mergeOrg());

export const useOrg = () => useContext(OrgContext);

/** The provider's value: the cached org, painted from the last snapshot at once. */
export function useOrgSource(): Org {
  const { data } = useCached<OrgPayload>(orgResource);
  return useMemo(() => mergeOrg(data), [data]);
}
