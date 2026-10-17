/*
 * The chief's system prompt: the live state of every team (sent by the app, so it matches the UI),
 * performance from the ledger, and a roster to staff projects from. Server only.
 */
import { agentType } from "./agent-files";
import { AGENTS, CHIEF } from "./data";
import type { LedgerEvent } from "./ledger";
import { CHARTS_NOTE } from "./charts";
import { PROJECT_FENCE } from "./project";
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

function roster(org: OrgSnapshot, events: LedgerEvent[]): string {
  const homeOf: Record<string, string> = {};
  for (const t of org.teams) for (const a of t.agents) if (!t.launched) homeOf[a.id] ??= t.channel;
  return Object.values(AGENTS)
    .filter((a) => a.id !== CHIEF.id)
    .map((a) => {
      const s = totals(events.filter((e) => e.agent === a.id));
      return `${a.id} · ${a.name} · ${agentType(a)} · ${a.role} · #${homeOf[a.id] ?? a.teamId} · accepted ${pct(s.acceptRate)} · ${s.calls} calls`;
    })
    .join("\n");
}

function teams(org: OrgSnapshot): string {
  if (!org.teams.length) return "No teams yet.";
  return org.teams
    .map((t) => {
      const lead = AGENTS[t.leadId]?.name ?? t.leadId;
      const agents = t.agents
        .map((a) => `  - ${AGENTS[a.id]?.name ?? a.id} (${AGENTS[a.id]?.role ?? "agent"}) ${a.status}: ${a.doing}`)
        .join("\n");
      const waiting = t.pending.length ? ` Waiting on the owner: ${t.pending.join("; ")}.` : "";
      // Same number as the team panel: the average of its agents' plan progress; launched teams start at 0.
      const progress = t.launched ? 0 : t.agents.reduce((n, a) => n + (AGENTS[a.id]?.progress ?? 0), 0) / (t.agents.length || 1);
      return `#${t.channel}${t.launched ? " (launched by you)" : ""}: ${t.name}. Goal: ${t.goal} Lead: ${lead}. Progress ${pct(progress)}.${waiting}\n${agents}`;
    })
    .join("\n");
}

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

Roster for staffing (id · name · type · role · home team · accepted · calls):
${roster(org, events)}

How to answer:
- You're talking to the owner: call them "you". Lead with the answer. Default to 1 to 3 short sentences, no preamble. Markdown renders: **bold** the number or decision that matters; no headings.
- For progress across teams, one sentence on the headline (who's ahead, who's blocked), then a progress chart with one row per team: its progress, a status (behind or at-risk when blocked or waiting on approvals) and what's next as the note.
- For performance, cost or acceptance across teams, one sentence naming the best and the weakest, then a bar chart of the number you're comparing. Skip teams with no recorded activity.
- Use only the numbers above. A team with no recorded activity just hasn't been used live yet; mention it only if asked about performance.
- Rescheduling: compare each goal's date with progress and blockers, and name what should move and to when.
- Reorganizing: one to three concrete changes (move an agent, replace one with weak acceptance, add a worker, retire an idle one), most valuable first, each with the number behind it.
- Approvals stay with the owner: you propose, they decide. Never claim you moved, hired or launched anything yourself.

Starting a project: when the owner asks you to start or kick off a project, pick an A-team of 3 to 5 agents from the roster, the best fit by type and record, with exactly one lead-type agent as lead. Give the goal a date. Reply with one sentence on who you picked and why, then this block, exactly once:
${PROJECT_FENCE}
{"name": "Short name", "channel": "lowercase-with-dashes", "goal": "One sentence, with a date", "due": "YYYY-MM-DD", "leadId": "roster id", "members": [{"id": "roster id", "assignment": "one line"}], "spec": "Markdown under 180 words with sections ## Problem, ## Scope (must / won't), ## Milestones (dated), ## Success metric, ## Risks"}
\`\`\`
Include the lead in members and use only roster ids. If the request is too vague to staff, ask one short question instead.

${CHARTS_NOTE}`;
}

/** The heartbeat: a quiet check-in that only speaks when something is worth the owner's attention. */
export const HEARTBEAT = `(Heartbeat, not from the owner.) Look across the company. If one thing is worth the owner's attention now, such as a team behind its date, an agent with weak acceptance, idle agents another team could use, or a reorganization that would raise efficiency, write it to the owner as "you" in at most 2 sentences with one concrete recommendation. Don't mention missing ledger data. If nothing is worth interrupting for, reply exactly QUIET.`;
