/*
 * find_skill: local-first skill sourcing for the orchestrators (docs/design/team-setup.md §3b). The loop is code, so
 * Flash spends no tokens searching:
 *   1. Search the skill library. If the top hit clears LIBRARY_THRESHOLD, return library hits: $0, no network.
 *   2. Otherwise one You.com Research call at `deep`, typed by SKILL_CANDIDATES_SCHEMA, limited to github.com and
 *      skills.sh (~$0.10, 20–26 s measured).
 *   3. Vet in code with GitHub's repo metadata: drop forks, archived and unknown repos and non-GitHub links; rank
 *      official-then-stars; flag "official" claims GitHub doesn't back (You.com marked a 1-star repo official).
 *   4. Return the candidates for the owner to approve. Approval, the SKILL.md scan and storing the pick are NOT done
 *      here: an approved candidate goes to the curator's import pipeline (scripts/skills/), which vendors it,
 *      scans it and adds it to skills/index.json with `addedBy: "find_skill"`. This module never writes the library.
 */
import type { Archetype } from "../policy/types";
import type { SearchSkills, SkillHit } from "./types";
import type { Research } from "./youcom";

/** Top-hit score (weighted coverage, see search.ts) that counts as a library hit. On the fixture library, needs it
 * covers score 0.26–0.75 and needs it doesn't ≤ 0.15; calibrate again on the curated index. */
export const LIBRARY_THRESHOLD = 0.2;
/** Below this, a publisher's "official" claim is flagged and not ranked as official. */
export const OFFICIAL_MIN_STARS = 50;
const MAX_CANDIDATES = 5;

/** Design §3b's fields, in You.com's schema subset: root object, no optional keys, no extra properties. */
export const SKILL_CANDIDATES_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          skill_name: { type: "string" },
          repo_url: { type: "string" },
          publisher: { type: "string" },
          is_official_publisher: { type: "boolean" },
          install_command: { type: "string" },
          last_updated: { type: "string" },
          why_it_fits: { type: "string" },
        },
        required: ["skill_name", "repo_url", "publisher", "is_official_publisher", "install_command", "last_updated", "why_it_fits"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
};

export const SKILL_SOURCE_CONTROL = { include_domains: ["github.com", "skills.sh"] };

/** One row of SKILL_CANDIDATES_SCHEMA, as You.com returns it. */
interface RawCandidate {
  skill_name: string;
  repo_url: string;
  publisher: string;
  is_official_publisher: boolean;
  install_command: string;
  last_updated: string;
  why_it_fits: string;
}

export interface WebCandidate {
  skillName: string;
  /** "owner/repo" as GitHub names it. */
  repo: string;
  /** The link You.com returned (a GitHub path or a skills.sh page). */
  repoUrl: string;
  publisher: string;
  /** What You.com said. */
  claimedOfficial: boolean;
  /** Claimed and backed by at least OFFICIAL_MIN_STARS stars. */
  official: boolean;
  stars: number;
  /** GitHub's last push, ISO. */
  pushedAt: string;
  ownerType: string;
  /** SPDX id from GitHub, when it detected one. */
  license: string | null;
  installCommand: string;
  /** What You.com said; prefer pushedAt. */
  lastUpdated: string;
  whyItFits: string;
  /** Reasons for the owner to look twice. */
  flags: string[];
}

export interface DroppedCandidate {
  skillName: string;
  repoUrl: string;
  reason: string;
}

export type FindSkillResult =
  | { source: "library"; need: string; hits: SkillHit[]; costUsd: 0 }
  | {
      source: "web";
      need: string;
      /** Best first; nothing is added to the library until the owner approves one. */
      candidates: WebCandidate[];
      dropped: DroppedCandidate[];
      /** Library hits under the threshold, for the orchestrator to weigh against the candidates. */
      nearMisses: SkillHit[];
      costUsd: number;
      latencyMs: number;
      warnings: string[];
    };

export interface FindSkillDeps {
  search: SearchSkills;
  research: Research;
  /** Fetch for api.github.com (default: global fetch). */
  githubFetch?: typeof fetch;
  /** Default: GITHUB_TOKEN. Without one GitHub allows 60 requests an hour. */
  githubToken?: string;
  threshold?: number;
}

/** The research agent's brief: the bar for a candidate, stated so it can check its own list. */
function researchInput(need: string, archetype?: Archetype, qualifications: string[] = []): string {
  const who = [archetype ? `a ${archetype} agent` : "an agent", qualifications.length ? `qualified in ${qualifications.join(", ")}` : ""].filter(Boolean).join(", ");
  return [
    "Find agent skills (folders with a SKILL.md file, the Agent Skills format used by skills.sh, Claude Code and Codex) for this need.",
    `Need: ${need}`,
    `For: ${who}.`,
    `Return up to ${MAX_CANDIDATES} candidates, best first. Every candidate must:`,
    "- be a skill package with a SKILL.md, not a library, an MCP server, a prompt list or an article;",
    "- have repo_url pointing at the canonical upstream GitHub repo (or its skills.sh page) of the author or vendor, never a directory site, mirror, fork or blog post;",
    "- have install_command exactly as the publisher documents it (for example `npx skills add owner/repo`);",
    "- have last_updated as the date of the repo's latest commit, YYYY-MM-DD;",
    "- have is_official_publisher true only when the publisher is the organization that makes the product the skill is about;",
    "- have why_it_fits as one sentence naming what the skill does for this need.",
    "If nothing fits the need, return an empty candidates list rather than a weak match.",
  ].join("\n");
}

/** "owner/repo" from a github.com or skills.sh link; null for anything else. */
function repoOf(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  if (host !== "github.com" && host !== "skills.sh") return null;
  const [owner, repo] = u.pathname.split("/").filter(Boolean);
  if (!owner || !repo) return null;
  return `${owner}/${repo.replace(/\.git$/, "")}`;
}

interface GitHubRepo {
  full_name: string;
  fork: boolean;
  archived: boolean;
  disabled: boolean;
  stargazers_count: number;
  pushed_at: string;
  owner: { login: string; type: string };
  license: { spdx_id: string | null } | null;
  parent?: { full_name: string };
}

async function getRepo(repo: string, fetchFn: typeof fetch, token?: string): Promise<GitHubRepo | { error: string }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "agent-teams",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchFn(`https://api.github.com/repos/${repo}`, { headers });
  if (res.status === 404) return { error: "repo not found on GitHub" };
  if (!res.ok) return { error: `GitHub answered ${res.status}` };
  return (await res.json()) as GitHubRepo;
}

export async function findSkill(
  need: string,
  { archetype, qualifications = [] }: { archetype?: Archetype; qualifications?: string[] },
  deps: FindSkillDeps,
): Promise<FindSkillResult> {
  const threshold = deps.threshold ?? LIBRARY_THRESHOLD;
  const local = deps.search(need, { archetype, limit: 5 });
  if (local[0] && local[0].score >= threshold) {
    return { source: "library", need, hits: local.filter((h) => h.score >= threshold), costUsd: 0 };
  }

  const res = await deps.research({
    input: researchInput(need, archetype, qualifications),
    effort: "deep",
    outputSchema: SKILL_CANDIDATES_SCHEMA,
    sourceControl: SKILL_SOURCE_CONTROL,
  });
  const raw = (typeof res.content === "object" && Array.isArray((res.content as { candidates?: unknown }).candidates)
    ? (res.content as { candidates: RawCandidate[] }).candidates
    : []) as RawCandidate[];

  const dropped: DroppedCandidate[] = [];
  const seen = new Set<string>();
  const wanted: { c: RawCandidate; repo: string }[] = [];
  for (const c of raw) {
    const repo = repoOf(c.repo_url);
    if (!repo) {
      dropped.push({ skillName: c.skill_name, repoUrl: c.repo_url, reason: "not a GitHub repo link" });
      continue;
    }
    const key = `${repo}#${c.skill_name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push({ c, repo });
  }

  const fetchFn = deps.githubFetch ?? globalThis.fetch;
  const token = deps.githubToken ?? process.env.GITHUB_TOKEN;
  const repos = new Map<string, Promise<GitHubRepo | { error: string }>>();
  for (const { repo } of wanted) {
    const key = repo.toLowerCase();
    if (!repos.has(key)) repos.set(key, getRepo(repo, fetchFn, token));
  }

  const candidates: WebCandidate[] = [];
  for (const { c, repo } of wanted) {
    const meta = await repos.get(repo.toLowerCase())!;
    const drop = (reason: string) => dropped.push({ skillName: c.skill_name, repoUrl: c.repo_url, reason });
    if ("error" in meta) drop(meta.error);
    else if (meta.fork) drop(`fork of ${meta.parent?.full_name ?? "another repo"}`);
    else if (meta.archived) drop("archived");
    else if (meta.disabled) drop("disabled on GitHub");
    else {
      const stars = meta.stargazers_count;
      const backed = c.is_official_publisher && stars >= OFFICIAL_MIN_STARS;
      const flags: string[] = [];
      if (c.is_official_publisher && !backed) flags.push(`claims to be official but has only ${stars} star${stars === 1 ? "" : "s"}`);
      candidates.push({
        skillName: c.skill_name,
        repo: meta.full_name,
        repoUrl: c.repo_url,
        publisher: c.publisher,
        claimedOfficial: c.is_official_publisher,
        official: backed,
        stars,
        pushedAt: meta.pushed_at,
        ownerType: meta.owner.type,
        license: meta.license?.spdx_id ?? null,
        installCommand: c.install_command,
        lastUpdated: c.last_updated,
        whyItFits: c.why_it_fits,
        flags,
      });
    }
  }
  // Official first, then stars; ties keep You.com's order (sort is stable).
  candidates.sort((a, b) => Number(b.official) - Number(a.official) || b.stars - a.stars);

  return { source: "web", need, candidates, dropped, nearMisses: local, costUsd: res.costUsd, latencyMs: res.latencyMs, warnings: res.warnings };
}
