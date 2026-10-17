import { MODELS } from "./models";
import type { Agent, AgentType, MascotLook, Team } from "./types";

/*
 * Seed state: a fresh company is just you and Mira, the CEO agent. Each team
 * is a channel; each agent has a mascot and a Crusoe model for live replies.
 */

/** Every agent starts on the main tier; per-agent overrides go here. */
const MAIN = MODELS.main;

type AgentSeed = Omit<Agent, "teamId">;

/**
 * A few memorable characters, one per agent type: every agent of a type wears it. Each is one of the
 * placeholder shapes, animated in Rive (rig) at 48 px and up; smaller sizes draw the same look in SVG.
 */
export const CAST: Record<AgentType, MascotLook> = {
  lead: { shape: "cloud", color: "#4f97f5", accessory: "beret", rig: "felipe" },
  writer: { shape: "pear", color: "#f6c945", accessory: "glasses-bowtie", rig: "alfred" },
  researcher: { shape: "bean", color: "#7ccf6b", accessory: "none", eyes: "diamond", rig: "dottie" },
  coordinator: { shape: "heart", color: "#f58fb4", accessory: "flower", rig: "pip" },
  analyst: { shape: "blob", color: "#9b7cf2", accessory: "glasses", rig: "ledger" },
  engineer: { shape: "pixel", color: "#ff8a3d", accessory: "headphones", rig: "pixel" },
  // No rig of its own yet: Pip's character at 48 px and up, its own color and sprout below.
  designer: { shape: "heart", color: "#3cc4d9", accessory: "sprout", rig: "pip" },
};

function team(
  t: Omit<Team, "agents"> & { agents: AgentSeed[] },
): Team {
  return { ...t, agents: t.agents.map((a) => ({ ...a, teamId: t.id })) };
}

/** Seed teams, shown as channels. A fresh company has none; teams Mira launches live in app state. */
export const TEAMS: Team[] = [];

/**
 * The chief: the top-level agent over every team, like a CEO while you're away. She answers for the
 * whole company, staffs new projects and speaks up when something needs changing. She sits in her own
 * "company" team, which is kept out of the team list.
 */
export const CHIEF_ID = "mira";

export const HQ: Team = team({
  id: "company",
  channel: "company",
  name: "Company",
  goal: "Run the company while you're away: every team on goal, staffed with the right agents, and efficient.",
  leadId: CHIEF_ID,
  messages: [],
  agents: [
    {
      id: CHIEF_ID,
      name: "Mira",
      role: "CEO",
      model: MAIN,
      look: { shape: "egg", color: "#2fb8a6", accessory: "crown", cheeks: true },
      brief:
        "Calm, direct and numerate, like a good chief of staff. Leads with the answer, backs it with one number, and keeps the owner's time sacred. Proposes; never decides for the owner.",
    },
  ],
});

export const CHIEF = HQ.agents[0];

export const AGENTS: Record<string, Agent> = Object.fromEntries(
  [...TEAMS, HQ].flatMap((t) => t.agents.map((a) => [a.id, a])),
);

/** Every team by id, the chief's included; TEAMS is the list shown as channels. */
export const TEAMS_BY_ID: Record<string, Team> = Object.fromEntries([...TEAMS, HQ].map((t) => [t.id, t]));
