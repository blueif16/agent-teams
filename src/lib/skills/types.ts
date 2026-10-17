/*
 * Archetypes, the skill library, and compositions built on them (docs/design/team-setup.md §2, §3b).
 *
 * The library is our curated marketplace: SKILL.md packages copied (when the license allows) under
 * `skills/library/<id>/`, indexed in `skills/index.json`. Orchestrators search it first; only a miss goes out to
 * You.com Research, and a vetted, approved pick is added back.
 *
 * Archetypes and the skill library are the only primitives. A Composition (archetype + chosen skills) is built on
 * top of them: the orchestrator composes one when staffing a role, or adapts one from the history of past
 * compositions. Nothing ships a fixed "default skills per archetype".
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

/** A primitive role: how this type of agent works and what it can use. No skills, no memory. */
export interface ArchetypeDef {
  id: Archetype;
  name: string;
  /** One line, shown on the launch card. */
  summary: string;
  /** The Inherent section of SOUL.md: how this type does the job best. */
  inherent: string[];
  /** Registry tool ids (src/lib/tools/types.ts) in prompt order, beyond the base set every archetype gets. */
  tools: string[];
  modelTier: "main" | "cheap" | "advisor" | "vision";
  /** Words the PM's qualifications are matched against when staffing. */
  qualifications: string[];
}

/**
 * An agent composition: an archetype plus the skills chosen for one role. Built on the primitives, never a
 * primitive itself: composed by the orchestrator when staffing, or adapted from history.
 */
export interface Composition {
  id: string;
  archetype: Archetype;
  /** SkillEntry ids loaded into the agent's /skills/ at hire. */
  skills: string[];
  /** The role it was composed for, e.g. "Onboarding UX designer". */
  role: string;
  qualifications: string[];
  source: "orchestrator" | "history";
  /** Past compositions this one was adapted from. */
  basedOn?: string[];
  /** Registry tool ids beyond the archetype's set (≤ 3), approved on the launch card. */
  extraTools?: { id: string; why: string }[];
  /** ISO date. */
  createdAt: string;
}

export interface SkillHit {
  entry: SkillEntry;
  score: number;
  /** Which fields matched, for the orchestrator's reasoning and the UI. */
  why: string;
}

/** Local search over the library: fast, no network. */
export type SearchSkills = (query: string, opts?: { archetype?: Archetype; limit?: number }) => SkillHit[];
