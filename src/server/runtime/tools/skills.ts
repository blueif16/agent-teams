/*
 * Skill sourcing tools for the orchestrators (the PM and Mira; archetype tool ids `search_skills`, `find_skill`).
 * The loop lives in code (src/lib/skills/find.ts), so the model makes one call per need and spends no tokens
 * searching. Results are compact JSON strings, small enough for Flash to read.
 *
 * Value imports stay relative (no `@/`) so a plain `node` can load this file, like ../agents.ts.
 */
import { tool } from "langchain";
import { z } from "zod";
import { findSkill } from "../../../lib/skills/find";
import { type Library, loadLibrary } from "../../../lib/skills/library";
import { ARCHETYPES } from "../../../lib/policy/schema";
import { createSearchSkills } from "../../../lib/skills/search";
import type { SkillHit } from "../../../lib/skills/types";
import { createResearch, type Research } from "../../../lib/skills/youcom";

export interface SkillToolsDeps {
  /** Default: the library under SKILLS_DIR (or skills/), read fresh per call so a new import shows up. */
  library?: () => Promise<Library>;
  /** Default: You.com with YDC_API_KEY. */
  research?: Research;
  githubFetch?: typeof fetch;
  githubToken?: string;
  threshold?: number;
}

const brief = (h: SkillHit) => ({
  id: h.entry.id,
  name: h.entry.name,
  description: h.entry.description.length > 200 ? `${h.entry.description.slice(0, 197)}...` : h.entry.description,
  score: Math.round(h.score * 100) / 100,
  why: h.why,
  publisher: h.entry.source.publisher,
  official: h.entry.source.official,
  stars: h.entry.source.stars,
  installable: h.entry.vendored && !h.entry.scan.executable,
});

const archetype = z.enum(ARCHETYPES).optional().describe("The archetype the skill is for; its own skills rank higher.");

export function skillTools(deps: SkillToolsDeps = {}) {
  const library = deps.library ?? (() => loadLibrary());

  const searchSkills = tool(
    async ({ query, archetype, limit }) => {
      const { index } = await library();
      const hits = createSearchSkills(index.skills)(query, { archetype, limit });
      return JSON.stringify({
        skills: hits.map(brief),
        ...(hits.length ? {} : { note: "Nothing in the library matches. Call find_skill with this need to search the web." }),
      });
    },
    {
      name: "search_skills",
      description:
        "Search the company's skill library (vetted SKILL.md packages) for a need. Local and free. " +
        "Use it first whenever you staff a role or an expert needs a procedure. Write the query as the need " +
        '("find the root cause of a bug"), not a product name. Returns skills best first; a score of 0.2 or more is a good match. ' +
        "If nothing fits, call find_skill.",
      schema: z.object({
        query: z.string().min(1).describe("The need, in plain words."),
        archetype,
        limit: z.number().int().min(1).max(10).optional().describe("How many skills to return (default 5)."),
      }),
    },
  );

  const findSkillTool = tool(
    async ({ need, archetype, qualifications }) => {
      const { index } = await library();
      const result = await findSkill(need, { archetype, qualifications }, {
        search: createSearchSkills(index.skills),
        research: deps.research ?? createResearch(),
        githubFetch: deps.githubFetch,
        githubToken: deps.githubToken,
        threshold: deps.threshold,
      });
      if (result.source === "library") return JSON.stringify({ source: "library", costUsd: 0, skills: result.hits.map(brief) });
      return JSON.stringify({
        source: "web",
        costUsd: result.costUsd,
        candidates: result.candidates.map((c) => ({
          repo: c.repo,
          skill: c.skillName,
          stars: c.stars,
          official: c.official,
          license: c.license,
          install: c.installCommand,
          why: c.whyItFits,
          flags: c.flags,
        })),
        dropped: result.dropped.map((d) => `${d.repoUrl}: ${d.reason}`),
        note: "Not installed. Put your pick on the launch card (or its own approval card) for the owner to approve; it joins the library after approval.",
      });
    },
    {
      name: "find_skill",
      description:
        "Find the best skill for one need. It searches the library first (free); only when nothing there fits does it run " +
        "one web research call (about $0.10 and 20-30 s) and return vetted GitHub candidates, best first. " +
        "Web candidates are not installed: put your pick on the launch card for the owner to approve. " +
        "Call it once per need; don't repeat it for the same need.",
      schema: z.object({
        need: z.string().min(1).describe('What the expert must be able to do, e.g. "design ClickHouse table schemas".'),
        archetype,
        qualifications: z.array(z.string()).optional().describe("The role's qualifications, for context."),
      }),
    },
  );

  return [searchSkills, findSkillTool] as const;
}
