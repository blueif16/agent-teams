/*
 * The archetypes: primitive roles with no skills and no memory (docs/design/team-setup.md §2).
 * A Composition adds the skills for one role on top (./compose.ts).
 *
 * `tools` are tool-registry ids (src/lib/tools/types.ts) in prompt order: the curated set of
 * docs/research/H-archetype-toolsets.md §3, actions first, then the archetype's panes. The base set every
 * archetype inherits (file tools, web_search, fetch_page, report, chart, mermaid) is not listed; the registry's
 * resolver adds it, and drops planned or sandbox-only (T7) entries.
 */
import { INHERENT } from "../agent-files";
import type { Archetype } from "../policy/types";
import type { ArchetypeDef } from "./types";

export const ARCHETYPES: ArchetypeDef[] = [
  {
    id: "engineer",
    name: "Engineer",
    summary: "Builds and fixes code: reproduces first, ships small reviewed changes with tests.",
    inherent: INHERENT.engineer,
    tools: ["propose_patch", "repo_read", "run_tests", "diff", "files", "tests"],
    modelTier: "main",
    qualifications: ["software engineering", "typescript", "javascript", "python", "debugging", "testing", "code review", "refactoring", "api", "backend", "frontend", "database", "performance", "ci"],
  },
  {
    id: "designer",
    name: "Designer",
    summary: "Designs screens and visuals that fit the product, with every state covered.",
    inherent: INHERENT.designer,
    tools: ["canvas_edit", "canvas_read", "canvas_export", "request_review", "write_mockup", "fetch_image", "canvas", "mockup"],
    modelTier: "main",
    qualifications: ["ui design", "ux design", "visual design", "interaction design", "prototyping", "design systems", "typography", "accessibility", "branding", "illustration", "presentations", "web design"],
  },
  {
    id: "researcher",
    name: "Researcher",
    summary: "Finds and checks facts from primary sources, with a date and a link for each.",
    inherent: INHERENT.researcher,
    tools: ["research", "add_source", "doc_write", "sources", "doc", "citations"],
    modelTier: "main",
    qualifications: ["research", "fact checking", "market research", "competitive analysis", "literature review", "sourcing", "interviews", "synthesis", "citations"],
  },
  {
    id: "analyst",
    name: "Analyst",
    summary: "Turns data into one number, one comparison and one chart.",
    inherent: INHERENT.analyst,
    tools: ["describe", "answer", "write_table", "table"],
    modelTier: "main",
    qualifications: ["data analysis", "sql", "metrics", "dashboards", "charts", "spreadsheets", "statistics", "forecasting", "cohort analysis", "finance"],
  },
  {
    id: "writer",
    name: "Writer",
    summary: "Writes copy and docs in the team's voice for one clear reader.",
    inherent: INHERENT.writer,
    tools: ["doc_write", "doc_suggest", "doc_comment", "doc_read", "doc"],
    modelTier: "main",
    qualifications: ["copywriting", "editing", "documentation", "technical writing", "blog posts", "marketing copy", "email", "tone of voice", "proofreading", "summaries"],
  },
  {
    id: "lead",
    name: "PM",
    summary: "Leads a project: sets the goal, staffs the experts and accepts work on evidence.",
    inherent: INHERENT.lead,
    tools: ["add_task", "update_task", "assign_task", "record_decision", "raise_item", "resolve_item", "find_skill", "search_skills", "plan", "board", "timeline", "decisions"],
    modelTier: "main",
    qualifications: ["project management", "planning", "staffing", "prioritization", "stakeholder updates", "scope", "deadlines", "risk management"],
  },
  {
    id: "chief",
    name: "Chief",
    summary: "Mira, the CEO agent: triages your requests, sets up PMs and answers for the whole company.",
    inherent: INHERENT.chief,
    tools: ["project", "find_agent", "dispatch", "answer", "research", "find_skill", "search_skills", "plan", "dashboard", "inbox"],
    modelTier: "main",
    qualifications: ["triage", "company operations", "staffing", "reporting", "prioritization", "budget", "scheduling"],
  },
];

export function getArchetype(id: Archetype): ArchetypeDef | undefined {
  return ARCHETYPES.find((a) => a.id === id);
}
