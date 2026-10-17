import { CHARTS_NOTE, withChartSummaries } from "./charts";
import type { Agent, Message, Team } from "./types";

/** How a prompt looks agents and teams up: the server passes its directory (src/server/directory.ts). */
export interface PromptDirectory {
  agent(id: string): Agent | undefined;
  team(id: string): Team | undefined;
}

export interface Turn {
  from: string;
  text: string;
}

function describeMessage(m: Message, dir: PromptDirectory): string | null {
  const name = (id: string) => (id === "you" ? "You" : (dir.agent(id)?.name ?? id));
  switch (m.kind) {
    case "text":
      return `${name(m.from)}: ${withChartSummaries(m.text)}`;
    case "handoff":
      return m.byYou
        ? `You handed ${name(m.from)}'s message "${m.task}" to ${name(m.to)}`
        : `${name(m.from)} handed "${m.task}" to ${name(m.to)}`;
    case "approval":
      return `${name(m.from)} asked for approval: ${m.title} (${m.state})`;
    case "proposal":
      return m.proposal ? `${name(m.from)} proposed options for the "${m.proposal.name}" project (${m.state})` : null;
    case "status":
      return null;
  }
}

/**
 * Stable system prompt per agent: persona, team, and the channel log.
 * Kept byte-identical between turns so Crusoe's prefix cache can hit.
 */
export function systemPrompt(
  agentId: string,
  mode: "channel" | "dm",
  files: { soul: string; memory: string } | undefined,
  project: ProjectContext | undefined,
  dir: PromptDirectory,
): string {
  if (project) return projectPrompt(agentId, mode, project, files, dir);
  const agent = dir.agent(agentId)!;
  const team = dir.team(agent.teamId)!;
  const lead = dir.agent(team.leadId) ?? agent;
  const teammates = team.agents
    .filter((a) => a.id !== agentId)
    .map((a) => `- ${a.name} (${a.role})`)
    .join("\n");
  const log = team.messages.map((m) => describeMessage(m, dir)).filter(Boolean).join("\n");

  const home = homeFiles(files);

  return `You are ${agent.name}, the ${agent.role} on the "${team.name}" agent team (#${team.channel}).
Personality: ${agent.brief}
${home}
Team goal: ${team.goal}
Team lead: ${lead.name}${lead.id === agentId ? " (you)" : ""}
Teammates:
${teammates}

Recent #${team.channel} log:
${log}

You are talking with the human who owns this team, ${mode === "dm" ? "in a direct message" : `in the #${team.channel} channel, where teammates also post`}.
${ORDERS_NOTE}
${STYLE}`;
}

const ORDERS_NOTE = `Your human can react to your messages with quick orders: 👍 go ahead, 👀 dig deeper and report back, 🔁 take another pass, ✋ hold until told to go, 📌 remember as a standing instruction. When you get one, reply in one or two sentences saying exactly what you'll do next.`;

const STYLE = `Write like a teammate in a chat app: lead with the point in 1 to 3 short sentences. Markdown renders, so use it lightly: **bold** for the one number or decision that matters, a short list only for 3 or more parallel items, a table only to compare rows across columns, and no headings. Be specific about progress, numbers and next steps from the context above. If you would need to delegate, say which teammate you'd hand it to. Never claim you sent, bought, merged or scheduled something that needs approval; ask first.

${CHARTS_NOTE}`;

// Soul and memory change rarely, so they sit early in the prompt where the cache keeps hitting.
function homeFiles(files?: { soul: string; memory: string }): string {
  return files
    ? `\nYour SOUL.md (how you work; follow it):\n${files.soul.trim()}\n\nYour MEMORY.md (what you've learned by doing):\n${files.memory.trim()}\n`
    : "";
}

/** A team the chief launched at runtime; the app sends it, since only the browser holds it. */
export interface ProjectContext {
  id: string;
  channel: string;
  name: string;
  goal: string;
  leadId: string;
  members: { id: string; assignment: string }[];
  spec: string;
}

function projectPrompt(agentId: string, mode: "channel" | "dm", p: ProjectContext, files: { soul: string; memory: string } | undefined, dir: PromptDirectory): string {
  const agent = dir.agent(agentId)!;
  const mine = p.members.find((m) => m.id === agentId);
  const others = p.members
    .filter((m) => m.id !== agentId)
    .flatMap((m) => {
      const a = dir.agent(m.id);
      return a ? [`- ${a.name} (${a.role}): ${m.assignment}`] : [];
    })
    .join("\n");
  return `You are ${agent.name}, ${agent.role}. Mira, the CEO, picked you for a new project team, "${p.name}" (#${p.channel}).
Personality: ${agent.brief}
${homeFiles(files)}
Project goal: ${p.goal}
Project lead: ${dir.agent(p.leadId)?.name ?? p.leadId}${p.leadId === agentId ? " (you)" : ""}
Your assignment: ${mine?.assignment ?? "Support the lead"}
Teammates on this project:
${others || "- none"}

Spec:
${p.spec}

You are talking with the human who owns the company, ${mode === "dm" ? "in a direct message" : `in the #${p.channel} channel, where teammates also post`}.
${ORDERS_NOTE}
${STYLE}`;
}

/** Map the visible conversation into chat turns from this agent's point of view. */
export function toChatMessages(agentId: string, history: Turn[], dir: PromptDirectory) {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const turn of history) {
    const role = turn.from === agentId ? "assistant" : "user";
    const content =
      role === "assistant" || turn.from === "you"
        ? turn.text
        : `[${dir.agent(turn.from)?.name ?? turn.from}] ${turn.text}`;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content += `\n\n${content}`;
    else out.push({ role, content });
  }
  // Chat templates expect the first non-system turn to come from the user.
  if (out[0]?.role === "assistant") out.unshift({ role: "user", content: "(conversation so far)" });
  return out;
}
