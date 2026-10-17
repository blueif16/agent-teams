/*
 * The archetypes: primitive roles with no skills and no memory (docs/design/team-setup.md §2).
 * A Composition adds the skills for one role on top (./compose.ts).
 *
 * Tools follow §3b and §6: every agent searches the web and reads pages through You.com, and works in its own files.
 * The researcher adds deep research; the analyst and Mira add one-pass answers and the ```chart block; the
 * orchestrators (the PM and Mira) source skills. Shell (`execute`) and `delete` stay off: tier T7 needs a sandbox.
 */
import { INHERENT } from "../agent-files";
import type { Archetype } from "../policy/types";
import type { ArchetypeDef } from "./types";

/** Deep Agents' filesystem tools, minus `delete` and `execute`. */
export const FILE_TOOLS = ["ls", "read_file", "write_file", "edit_file", "glob", "grep"];
/** What every agent gets. */
export const BASE_TOOLS = ["web_search", "fetch_page", ...FILE_TOOLS];
const SKILL_SOURCING = ["search_skills", "find_skill"];

export const ARCHETYPES: ArchetypeDef[] = [
  {
    id: "engineer",
    name: "Engineer",
    summary: "Builds and fixes code: reproduces first, ships small reviewed changes with tests.",
    inherent: INHERENT.engineer,
    tools: [...BASE_TOOLS],
    modelTier: "main",
    qualifications: ["software engineering", "typescript", "javascript", "python", "debugging", "testing", "code review", "refactoring", "api", "backend", "frontend", "database", "performance", "ci"],
  },
  {
    id: "designer",
    name: "Designer",
    summary: "Designs screens and visuals that fit the product, with every state covered.",
    inherent: INHERENT.designer,
    tools: [...BASE_TOOLS],
    modelTier: "main",
    qualifications: ["ui design", "ux design", "visual design", "interaction design", "prototyping", "design systems", "typography", "accessibility", "branding", "illustration", "presentations", "web design"],
  },
  {
    id: "researcher",
    name: "Researcher",
    summary: "Finds and checks facts from primary sources, with a date and a link for each.",
    inherent: INHERENT.researcher,
    tools: [...BASE_TOOLS, "research"],
    modelTier: "main",
    qualifications: ["research", "fact checking", "market research", "competitive analysis", "literature review", "sourcing", "interviews", "synthesis", "citations"],
  },
  {
    id: "analyst",
    name: "Analyst",
    summary: "Turns data into one number, one comparison and one chart.",
    inherent: INHERENT.analyst,
    tools: [...BASE_TOOLS, "answer", "chart"],
    modelTier: "main",
    qualifications: ["data analysis", "sql", "metrics", "dashboards", "charts", "spreadsheets", "statistics", "forecasting", "cohort analysis", "finance"],
  },
  {
    id: "writer",
    name: "Writer",
    summary: "Writes copy and docs in the team's voice for one clear reader.",
    inherent: INHERENT.writer,
    tools: [...BASE_TOOLS],
    modelTier: "main",
    qualifications: ["copywriting", "editing", "documentation", "technical writing", "blog posts", "marketing copy", "email", "tone of voice", "proofreading", "summaries"],
  },
  {
    id: "lead",
    name: "PM",
    summary: "Leads a project: sets the goal, staffs the experts and accepts work on evidence.",
    inherent: INHERENT.lead,
    tools: [...BASE_TOOLS, ...SKILL_SOURCING],
    modelTier: "main",
    qualifications: ["project management", "planning", "staffing", "prioritization", "stakeholder updates", "scope", "deadlines", "risk management"],
  },
  {
    id: "chief",
    name: "Chief",
    summary: "Mira, the CEO agent: triages your requests, sets up PMs and answers for the whole company.",
    inherent: INHERENT.chief,
    tools: [...BASE_TOOLS, "answer", "chart", ...SKILL_SOURCING],
    modelTier: "main",
    qualifications: ["triage", "company operations", "staffing", "reporting", "prioritization", "budget", "scheduling"],
  },
];

export function getArchetype(id: Archetype): ArchetypeDef | undefined {
  return ARCHETYPES.find((a) => a.id === id);
}
