/*
 * The skill library and archetype templates (docs/design/team-setup.md §2, §3b).
 *
 * The library is our curated marketplace: SKILL.md packages copied (when the license allows) under
 * `skills/library/<id>/`, indexed in `skills/index.json`. Orchestrators search it first; only a miss goes out to
 * You.com Research, and a vetted, approved pick is added back. An archetype template is a ready-to-use agent
 * definition (role + tools + default skills) with no memory; the PM instantiates experts from it.
 */
import type { Archetype } from "../policy/types";

export interface SkillSource {
  /** "owner/repo" on GitHub. */
  repo: string;
  /** Path of the skill folder inside the repo. */
  path: string;
  /** The exact commit the files were copied from. */
  commit: string;
  url: string;
  stars: number;
  publisher: string;
  /** Published by the product's own organization (e.g. remotion-dev for Remotion). */
  official: boolean;
}

export interface SkillScan {
  /** ISO date. */
  at: string;
  /** Secrets, injection phrases, remote-code patterns found; 0 to be listed as usable. */
  findings: number;
  notes?: string;
  /** Ships scripts that run code; such skills stay off until shell tools are sandboxed (tier T7). */
  executable: boolean;
}

export interface SkillEntry {
  /** "<publisher>/<skill-folder>", e.g. "obra/systematic-debugging". */
  id: string;
  name: string;
  /** From the SKILL.md frontmatter; what search matches first. */
  description: string;
  archetypes: Archetype[];
  tags: string[];
  source: SkillSource;
  /** SPDX id, e.g. "MIT", "Apache-2.0". */
  license: string;
  /** Files copied under skills/library/<id>/. False = listed with a link only (license or size). */
  vendored: boolean;
  /** Paths relative to skills/library/<id>/ when vendored. */
  files: string[];
  scan: SkillScan;
  addedBy: "curation" | "find_skill" | "owner";
  /** ISO date. */
  addedAt: string;
}

export interface SkillIndex {
  version: 1;
  updatedAt: string;
  skills: SkillEntry[];
}

/** A ready-to-use agent definition: no memory, just its role, tools and default skills. */
export interface ArchetypeTemplate {
  id: Archetype;
  name: string;
  /** One line, shown on the launch card. */
  summary: string;
  /** The Inherent section of SOUL.md: how this type does the job best. */
  inherent: string[];
  /** Tool names it gets by default (policy tiers still apply). */
  tools: string[];
  modelTier: "main" | "cheap" | "advisor" | "vision";
  /** SkillEntry ids loaded into its /skills/ at hire. */
  defaultSkills: string[];
  /** Words the PM's qualifications are matched against when staffing. */
  qualifications: string[];
}

export interface SkillHit {
  entry: SkillEntry;
  score: number;
  /** Which fields matched, for the orchestrator's reasoning and the UI. */
  why: string;
}

/** Local search over the library: fast, no network. */
export type SearchSkills = (query: string, opts?: { archetype?: Archetype; limit?: number }) => SkillHit[];
