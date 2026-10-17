/*
 * start_team: Mira starts a team herself (owner, 2026-10-17: "a tool that's called start a team with a PM"). One call
 * staffs the option from the skill library and provisions it through the same path as the Launch button: project,
 * a PM first, the experts, the channel and the PM's kickoff in its inbox. The PM then scopes and runs the work.
 * Idempotent: the same arguments name the same project, so a retried call makes no second team. Server only.
 */
import { createHash } from "node:crypto";
import { tool } from "langchain";
import { z } from "zod";
import { readLedger } from "@/lib/ledger";
import { launchPlanOf, normalizeProposal } from "@/lib/project";
import { agentVault } from "@/lib/agent-files";
import { getServerCache, skillLibrary } from "@/server/cache";
import { getTeam } from "@/server/directory";
import { planOptions } from "@/server/setup/plan";
import { provision } from "@/server/setup/provision";
import { getRuntimeDb } from "../db";

const role = z.object({
  archetype: z.string().describe("An archetype id from your list, e.g. researcher"),
  role: z.string().describe('What the role is, e.g. "Market researcher"'),
  need: z.string().describe("The one thing it must get done"),
  qualifications: z.array(z.string()).describe("2 or 3, in plain words"),
});

const schema = z.object({
  name: z.string(),
  channel: z.string().describe("lowercase-with-dashes"),
  goal: z.string().describe("One dated, checkable sentence"),
  due: z.string().optional().describe("YYYY-MM-DD"),
  metric: z.string().optional(),
  scope: z.object({ must: z.array(z.string()), wont: z.array(z.string()) }).optional(),
  open: z.array(z.string()).optional().describe("Up to 3 details you left undecided; the PM asks the owner"),
  option: z.object({
    label: z.string(),
    summary: z.string(),
    kind: z.enum(["project", "solo"]),
    roles: z.array(role).describe("The experts only; the app adds the PM to a project"),
    budgetUsd: z.number(),
    etaDays: z.number().optional(),
  }),
});

export function startTeamTool() {
  return tool(
    async (input) => {
      const proposal = normalizeProposal({ ...input, options: [input.option] });
      if (!proposal) return "Couldn't start the team: it needs a goal and at least one role from your archetypes.";
      const db = getRuntimeDb();
      const library = await skillLibrary();
      const options = await planOptions(proposal, { library, db, events: await readLedger() });
      const nonce = `start-team-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32)}`;
      const { projectId, created } = await provision(launchPlanOf(options, 0), nonce, { db, library, vault: await agentVault(), bus: getServerCache().bus });
      const team = getTeam(projectId);
      const who = db.members.list(projectId).map((m) => `${db.agents.get(m.agentId)?.name ?? m.agentId} (${m.role})`);
      return `${created ? "Started" : "Already running"}: ${team?.channel ? `#${team.channel}` : proposal.name} with ${who.join(", ")}. The PM has the charter and is starting now; it asks the owner any open questions.`;
    },
    {
      name: "start_team",
      description:
        "Start a project team now: creates the project, its channel, a PM and the experts you list, and hands the PM the charter. Call it when the owner says go, start, launch or picks an option. Never claim a team exists unless this returned it.",
      schema,
    },
  );
}
