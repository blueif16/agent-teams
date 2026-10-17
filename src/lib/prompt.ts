import { CHARTS_NOTE, withChartSummaries } from "./charts";
import { AGENTS, TEAMS_BY_ID } from "./data";
import type { Message } from "./types";

export interface Turn {
  from: string;
  text: string;
}

function describeMessage(m: Message): string | null {
  const name = (id: string) => (id === "you" ? "You" : (AGENTS[id]?.name ?? id));
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
      return `${name(m.from)} proposed the "${m.project.name}" project (${m.state})`;
    case "status":
      return null;
  }
}

/**
 * Stable system prompt per agent: persona, team, plan, and the channel log.
 * Kept byte-identical between turns so Crusoe's prefix cache can hit.
 */
export function systemPrompt(
  agentId: string,
  mode: "channel" | "dm",
  files?: { soul: string; memory: string },
  project?: ProjectContext,
): string {
  if (project) return projectPrompt(agentId, mode, project, files);
  const agent = AGENTS[agentId];
  const team = TEAMS_BY_ID[agent.teamId];
  const lead = AGENTS[team.leadId];
  const teammates = team.agents
    .filter((a) => a.id !== agentId)
    .map((a) => `- ${a.name} (${a.role}): ${a.task}`)
    .join("\n");
  const plan = agent.steps.map((s) => `- [${s.state}] ${s.label}`).join("\n");
  const log = team.messages.map(describeMessage).filter(Boolean).join("\n");

  const home = homeFiles(files);

  return `You are ${agent.name}, the ${agent.role} on the "${team.name}" agent team (#${team.channel}).
Personality: ${agent.brief}
${home}
Team goal: ${team.goal}
Team lead: ${lead.name}${lead.id === agentId ? " (you)" : ""}
Teammates:
${teammates}

Your current task: ${agent.task} (${Math.round(agent.progress * 100)}% done, running ${agent.elapsed})
Your plan:
${plan}
${agent.schedule?.length ? `Scheduled: ${agent.schedule.join("; ")}\n` : ""}
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

function projectPrompt(agentId: string, mode: "channel" | "dm", p: ProjectContext, files?: { soul: string; memory: string }): string {
  const agent = AGENTS[agentId];
  const mine = p.members.find((m) => m.id === agentId);
  const others = p.members
    .filter((m) => m.id !== agentId && AGENTS[m.id])
    .map((m) => `- ${AGENTS[m.id].name} (${AGENTS[m.id].role}): ${m.assignment}`)
    .join("\n");
  return `You are ${agent.name}, ${agent.role}. Mira, the CEO, picked you for a new project team, "${p.name}" (#${p.channel}).
Personality: ${agent.brief}
${homeFiles(files)}
Project goal: ${p.goal}
Project lead: ${AGENTS[p.leadId]?.name ?? p.leadId}${p.leadId === agentId ? " (you)" : ""}
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
export function toChatMessages(agentId: string, history: Turn[]) {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const turn of history) {
    const role = turn.from === agentId ? "assistant" : "user";
    const content =
      role === "assistant" || turn.from === "you"
        ? turn.text
        : `[${AGENTS[turn.from]?.name ?? turn.from}] ${turn.text}`;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content += `\n\n${content}`;
    else out.push({ role, content });
  }
  // Chat templates expect the first non-system turn to come from the user.
  if (out[0]?.role === "assistant") out.unshift({ role: "user", content: "(conversation so far)" });
  return out;
}
