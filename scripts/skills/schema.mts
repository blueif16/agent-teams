/*
 * Runtime schemas for the skill library: the index contract (src/lib/skills/types.ts, checked with `satisfies`)
 * and the curation manifest that scripts/skills/import.mts reads. The selection criteria live here, in code,
 * so editing the manifest can't widen them.
 */
import { z } from "zod";
import type { Archetype } from "../../src/lib/policy/types.ts";
import type { SkillEntry, SkillIndex, SkillScan, SkillSource } from "../../src/lib/skills/types.ts";

export const ARCHETYPES = [
  "chief",
  "lead",
  "writer",
  "researcher",
  "analyst",
  "engineer",
  "designer",
  "coordinator",
] as const satisfies readonly Archetype[];

/** Licenses we vendor. Anything else is listed link-only (`vendored: false`). */
export const PERMISSIVE_LICENSES = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "CC-BY-4.0"] as const;

export const CRITERIA = {
  /** Unless the publisher is official. */
  minStars: 100,
  /** The repo was pushed within this many days of the curation date. */
  maxAgeDays: 365,
  /** Larger skill folders are listed link-only. */
  maxVendorBytes: 1_000_000,
} as const;

/** Compatibility tags: the skill assumes tools Deep Agents doesn't give our agents yet. */
export const COMPAT_TAGS = ["needs-shell", "needs-browser", "needs-mcp", "claude-code-specific"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const sha = z.string().regex(/^[0-9a-f]{40}$/, "full commit sha");
const repo = z.string().regex(/^[\w.-]+\/[\w.-]+$/, "owner/repo");

export const SkillSourceSchema = z.strictObject({
  repo,
  path: z.string(),
  commit: sha,
  url: z.url(),
  stars: z.number().int().nonnegative(),
  publisher: z.string().min(1),
  official: z.boolean(),
}) satisfies z.ZodType<SkillSource>;

export const SkillScanSchema = z.strictObject({
  at: isoDate,
  findings: z.number().int().nonnegative(),
  notes: z.string().optional(),
  executable: z.boolean(),
}) satisfies z.ZodType<SkillScan>;

export const SkillEntrySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/, "<publisher>/<skill-folder>, lowercase"),
  name: z.string().min(1),
  description: z.string().min(1),
  archetypes: z.array(z.enum(ARCHETYPES)).min(1),
  tags: z.array(z.string().min(1)),
  source: SkillSourceSchema,
  license: z.string().min(1),
  vendored: z.boolean(),
  files: z.array(z.string().min(1)),
  scan: SkillScanSchema,
  addedBy: z.enum(["curation", "find_skill", "owner"]),
  addedAt: isoDate,
}) satisfies z.ZodType<SkillEntry>;

export const SkillIndexSchema = z.strictObject({
  version: z.literal(1),
  updatedAt: isoDate,
  skills: z.array(SkillEntrySchema),
}) satisfies z.ZodType<SkillIndex>;

/** GitHub metadata for one repo, snapshotted at curation (`gh api repos/<repo>`), so the import is reproducible. */
export const RepoMetaSchema = z.strictObject({
  publisher: z.string().min(1),
  /** The product's own organization, or the vendor of the skill format for its own skill repo. */
  official: z.boolean(),
  stars: z.number().int().nonnegative(),
  /** SPDX id from GitHub, or "NOASSERTION" when the repo has no recognizable license. */
  license: z.string().min(1),
  /** Path of the license text in the repo, copied to LICENSES/skills/<repo>.txt when vendored. */
  licenseFile: z.string().nullable(),
  fork: z.boolean(),
  archived: z.boolean(),
  pushedAt: isoDate,
  note: z.string().optional(),
});

export const PickSchema = z.strictObject({
  repo,
  /** Skill folder inside the repo; "" when the repo root is the skill. */
  path: z.string(),
  commit: sha,
  archetypes: z.array(z.enum(ARCHETYPES)).min(1),
  tags: z.array(z.string().min(1)).min(1),
  /** One line for SOURCES.md: why this skill is in the library. */
  why: z.string().min(10),
  /** Defaults to "<owner>/<skill-folder>", lowercased. */
  id: z.string().optional(),
  /** Overrides the repo license when a skill carries its own (e.g. anthropics/skills LICENSE.txt per skill). */
  license: z.string().optional(),
  licenseFile: z.string().optional(),
  /** Only for a repo-root skill: the files that make up the skill (the rest is repo tooling). */
  include: z.array(z.string().min(1)).optional(),
  addedAt: isoDate.optional(),
});

export const ManifestSchema = z.strictObject({
  $comment: z.string().optional(),
  version: z.literal(1),
  /** The curation date: every timestamp in the index comes from here, never the clock. */
  curatedAt: isoDate,
  repos: z.record(repo, RepoMetaSchema),
  skills: z.array(PickSchema).min(1),
  /** Candidates considered and turned down at curation, with the reason (reported in SOURCES.md). */
  rejected: z.array(z.strictObject({ repo, path: z.string().optional(), reason: z.string().min(5) })),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type Pick = z.infer<typeof PickSchema>;
export type RepoMeta = z.infer<typeof RepoMetaSchema>;
