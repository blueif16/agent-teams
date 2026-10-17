"use client";

import { createContext, useContext } from "react";
import { TEAMS, TEAMS_BY_ID } from "@/lib/data";
import type { Team } from "@/lib/types";

/**
 * Teams as the app knows them right now: the seed teams plus any the chief launched.
 * `teams` is the channel list; `teamsById` also has the chief's own team.
 */
export interface Org {
  teams: Team[];
  teamsById: Record<string, Team>;
}

export const OrgContext = createContext<Org>({ teams: TEAMS, teamsById: TEAMS_BY_ID });

export const useOrg = () => useContext(OrgContext);
