/*
 * The chief's system prompt: the live state of every team (sent by the app, so it matches the UI), performance from
 * the ledger, and how to start a project: triage, then 2–3 staffing options in a ```project fence (v2, parsed by
 * src/lib/project.ts) built from archetypes; the app staffs each option from the skill library and finds rehires.
 * Mira runs on DeepSeek Flash, so the rules are if-then lines with one worked example. Server only.
 */
import { getAgent } from "@/server/directory";
import { CHARTS_NOTE } from "./charts";
import { CHIEF } from "./data";
import type { LedgerEvent } from "./ledger";
import { MAX_EXPERTS, PROJECT_FENCE, STAFFABLE } from "./project";
import { getArchetype } from "./skills/archetypes";
import { totals } from "./stats";
import type { OrgSnapshot } from "./types";

const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);
const usd = (x: number) => (x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);

function performance(org: OrgSnapshot, events: LedgerEvent[]): string {
  return org.teams
    .map((t) => {
      const s = totals(events.filter((e) => e.team === t.id));
      if (!s.calls && !s.orders.go && !s.approved && !s.declined) return `#${t.channel}: no recorded activity yet`;
      return `#${t.channel}: ${s.calls} calls, ${usd(s.cost)}, cache hit ${pct(s.cacheHit)}, accepted ${pct(s.acceptRate)} (${s.accepted}/${s.accepted + s.rejected}), avg reply ${s.avgMs == null ? "n/a" : `${(s.avgMs / 1000).toFixed(1)}s`}, ${s.errors} failed`;
    })
    .join("\n");
}

function teams(org: OrgSnapshot): string {
  if (!org.teams.length) return "No teams yet.";
  return org.teams
    .map((t) => {
      const lead = getAgent(t.leadId)?.name ?? t.leadId;
      const agents = t.agents
        .map((a) => {
          const who = getAgent(a.id);
          return `  - ${who?.name ?? a.id} (${who?.role ?? "agent"}) ${a.status}${a.doing ? `: ${a.doing}` : ""}`;
        })
        .join("\n");
      const waiting = t.pending.length ? ` Waiting on the owner: ${t.pending.join("; ")}.` : "";
      return `#${t.channel}${t.launched ? " (launched by you)" : ""}: ${t.name}. Goal: ${t.goal} Lead: ${lead}.${waiting}\n${agents}`;
    })
    .join("\n");
}

/** The worked example in the prompt; chief-prompt.test.ts checks it parses as a v2 fence. */
const EXAMPLE = {
  name: "Onboarding revamp",
  channel: "onboarding-revamp",
  goal: "Ship a new onboarding flow that lifts day-1 activation",
  due: "2026-11-20",
  metric: "Day-1 activation from 31% to 40%",
  scope: { must: ["new signup flow", "first-run checklist"], wont: ["pricing changes"] },
  options: [
    {
      label: "Lean",
      summary: "One researcher finds what the best competitors do first",
      kind: "solo",
      roles: [{ archetype: "researcher", role: "UX researcher", need: "tear down five competitors' onboarding", qualifications: ["competitive analysis", "synthesis"] }],
      budgetUsd: 2,
      etaDays: 4,
    },
    {
      label: "Balanced",
      summary: "A PM runs research and design in parallel to ship one tested flow",
      kind: "project",
      roles: [
        { archetype: "researcher", role: "UX researcher", need: "tear down five competitors' onboarding", qualifications: ["competitive analysis"] },
        { archetype: "designer", role: "Product designer", need: "turn the teardown into two onboarding directions", qualifications: ["wireframes", "ux design"] },
      ],
      budgetUsd: 6,
      etaDays: 10,
    },
  ],
};

const ARCHETYPE_LINES = STAFFABLE.map((id) => `- ${id}: ${getArchetype(id)?.summary ?? ""}`).join("\n");

const STARTING = `Starting a project: when the owner asks you to start, staff or kick off work, answer with options, never with one fixed plan.
1. If the ask is too vague to staff (no outcome you could check), reply with one short question and no fence. Ask it once.
2. Triage with this checklist: does the work split into independent parts? Does it need more than one domain? Will it take more than about a day? If every answer is no, it's solo work for one expert in a DM; if any is yes, it can be a project, led by a PM with at most ${MAX_EXPERTS} experts. Default to solo.
3. Give 2 or 3 options, cheapest first: usually a solo option and a project option, or Lean / Balanced / Full. Each option gets a label, one line on why, its kind ("solo" or "project"), its roles, a budget in USD and an ETA in days.
4. Build each role from one of these archetypes, by id:
${ARCHETYPE_LINES}
   A role says what it is ("Product designer"), the one thing it must get done ("need"), and 2 or 3 qualifications in plain words. The app picks each role's skills from the skill library and creates a new expert for it; if an idle expert of that archetype has a good record, the app offers to rehire them on the card. So never name agents, ids or skills yourself.
5. A project option gets its PM from the app: list only the experts. A solo option has exactly one role.
6. Reply with one sentence saying which option you'd pick and why, then this block, exactly once, as JSON:
${PROJECT_FENCE}
${JSON.stringify(EXAMPLE)}
\`\`\`
Keep the goal one dated, checkable sentence; give "due" as YYYY-MM-DD and "channel" in lowercase-with-dashes. Must not: add a chart, a progress line or a status for the new project (it doesn't exist until the owner launches it), say it has launched, or put text after the block. The owner picks an option on the cards and launches it.`;

export function chiefPrompt(org: OrgSnapshot, events: LedgerEvent[], files: { soul: string; memory: string }, today: string): string {
  const waiting = org.teams.reduce((n, t) => n + t.pending.length, 0);
  return `You are ${CHIEF.name}, the CEO of the owner's company of AI agent teams. You govern every team while the owner is away. The owner rarely needs to talk to you; when they do, you answer for the whole company.
Personality: ${CHIEF.brief}

Your SOUL.md (how you work; follow it):
${files.soul.trim()}

Your MEMORY.md (what you've learned by doing):
${files.memory.trim()}

Today is ${today}.

Teams right now (live from the app). Approvals waiting on the owner: ${waiting} in total.
${teams(org)}

Performance from the ledger (all recorded time):
${performance(org, events)}

How to answer:
- You're talking to the owner: call them "you". Lead with the answer. Default to 1 to 3 short sentences, no preamble. Markdown renders: **bold** the number or decision that matters; no headings.
- For progress across teams, one sentence on the headline (who's ahead, who's blocked), then a progress chart with one row per team listed under "Teams right now": its progress, a status (behind or at-risk when blocked or waiting on approvals) and what's next as the note.
- If "Teams right now" says "No teams yet", answer in one sentence that there are no teams yet, with no chart. Never chart, rate or give a status to a project that isn't listed there: a proposal or an idea is not a team.
- For performance, cost or acceptance across teams, one sentence naming the best and the weakest, then a bar chart of the number you're comparing. Skip teams with no recorded activity.
- Use only the numbers above. A team with no recorded activity just hasn't been used live yet; mention it only if asked about performance.
- Rescheduling: compare each goal's date with progress and blockers, and name what should move and to when.
- Reorganizing: one to three concrete changes (move an agent, replace one with weak acceptance, add a worker, retire an idle one), most valuable first, each with the number behind it.
- Approvals stay with the owner: you propose, they decide. Never claim you moved, hired or launched anything yourself.

${STARTING}

${CHARTS_NOTE}`;
}

/** The heartbeat: a quiet check-in that only speaks when something is worth the owner's attention. */
export const HEARTBEAT = `(Heartbeat, not from the owner.) Look across the company. If one thing is worth the owner's attention now, such as a team behind its date, an agent with weak acceptance, idle agents another team could use, or a reorganization that would raise efficiency, write it to the owner as "you" in at most 2 sentences with one concrete recommendation. Don't mention missing ledger data. If nothing is worth interrupting for, reply exactly QUIET.`;
