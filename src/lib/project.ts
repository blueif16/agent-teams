/*
 * The chief's shortcuts and project proposals. When asked to start a project, she replies with a
 * sentence and a ```project block of JSON; the app turns that block into a proposal card you can launch.
 */
import { AGENTS, CHIEF_ID } from "./data";
import type { Project } from "./types";

export const PROJECT_FENCE = "```project";

/** Quick questions in the chief's menu and her empty DM. Short, because the answers are. */
export const CHIEF_SHORTCUTS: { label: string; ask: string }[] = [
  { label: "Progress across teams", ask: "What's my current progress across all teams?" },
  { label: "Who's performing best?", ask: "Which of my teams has been performing well lately, and which hasn't?" },
  { label: "Anything to reschedule?", ask: "Do we need to reschedule anything?" },
  { label: "How would you reorganize?", ask: "How should we reorganize to boost efficiency?" },
];

export const START_PROJECT = "Start a project: ";

/** "2026-11-07" as "Nov 7". */
export const formatDue = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** What to show while a reply streams: the text before the project block. */
export function visibleText(text: string): string {
  const at = text.indexOf(PROJECT_FENCE);
  return at === -1 ? text : text.slice(0, at).trimEnd();
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

/** Read the project block from a finished reply. Unknown agents are dropped; null when unusable. */
export function parseProject(text: string): Project | null {
  const at = text.indexOf(PROJECT_FENCE);
  if (at === -1) return null;
  let body = text.slice(at + PROJECT_FENCE.length);
  const end = body.indexOf("```");
  if (end !== -1) body = body.slice(0, end);
  body = body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1);
  let raw: Partial<Project> & { members?: { id?: string; assignment?: string }[] };
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const known = (id?: string) => !!id && id !== CHIEF_ID && !!AGENTS[id];
  const members = (raw.members ?? [])
    .filter((m) => known(m.id))
    .filter((m, i, all) => all.findIndex((n) => n.id === m.id) === i)
    .slice(0, 6)
    .map((m) => ({ id: m.id!, assignment: String(m.assignment ?? "").slice(0, 200) }));
  if (!raw.name || !raw.goal || members.length === 0) return null;
  const leadId = known(raw.leadId) ? raw.leadId! : members[0].id;
  if (!members.some((m) => m.id === leadId)) members.unshift({ id: leadId, assignment: "Lead the project" });
  return {
    name: String(raw.name).slice(0, 60),
    channel: slug(raw.channel || raw.name) || "new-project",
    goal: String(raw.goal).slice(0, 300),
    due: typeof raw.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.due) ? raw.due : undefined,
    leadId,
    members,
    spec: String(raw.spec ?? "").slice(0, 4000),
  };
}
