import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findSkill, LIBRARY_THRESHOLD, SKILL_CANDIDATES_SCHEMA, SKILL_SOURCE_CONTROL } from "./find";
import { createSearchSkills } from "./search";
import type { SkillIndex } from "./types";
import { createResearch } from "./youcom";

const fixture = (p: string) => readFileSync(new URL(`./__fixtures__/${p}`, import.meta.url), "utf8");
const index = JSON.parse(fixture("skills/index.json")) as SkillIndex;
const search = createSearchSkills(index.skills);
const RESEARCH_RESPONSE = fixture("youcom/research-skill-candidates.json");

/** Real GitHub responses (GET /repos/{owner}/{repo}, 2026-10-17): a plain repo and a fork. */
const REPO = JSON.parse(fixture("github/repo-obra-superpowers.json"));
const FORK = JSON.parse(fixture("github/repo-fork-vybenetwork-clickhouse-agent-skills.json"));

/** A complete repo body: the real one with only the fields that vary between cases replaced. */
function repo(fullName: string, { stars, archived = false, ownerType = "Organization" }: { stars: number; archived?: boolean; ownerType?: "User" | "Organization" }) {
  const [login, name] = fullName.split("/");
  return {
    ...REPO,
    name,
    full_name: fullName,
    owner: { ...REPO.owner, login, type: ownerType, html_url: `https://github.com/${login}` },
    html_url: `https://github.com/${fullName}`,
    url: `https://api.github.com/repos/${fullName}`,
    stargazers_count: stars,
    watchers_count: stars,
    watchers: stars,
    archived,
  };
}

const GITHUB: Record<string, unknown> = {
  "ClickHouse/agent-skills": repo("ClickHouse/agent-skills", { stars: 412 }),
  "vybenetwork/clickhouse-agent-skills": FORK,
  "addyosmani/agent-skills": repo("addyosmani/agent-skills", { stars: 108_000, ownerType: "User" }),
  "olap-tools/clickhouse-skill": repo("olap-tools/clickhouse-skill", { stars: 1 }),
  "legacy-data/clickhouse-sql-skill": repo("legacy-data/clickhouse-sql-skill", { stars: 230, archived: true }),
};

/** Fakes for both network boundaries, recording every call. */
function fakes(github = GITHUB) {
  const you: { body: Record<string, unknown> }[] = [];
  const gh: { url: string; headers: Headers }[] = [];
  const youFetch: typeof fetch = async (_url, init) => {
    you.push({ body: JSON.parse(String(init?.body)) });
    return new Response(RESEARCH_RESPONSE, { status: 200, headers: { "content-type": "application/json" } });
  };
  const githubFetch: typeof fetch = async (url, init) => {
    gh.push({ url: String(url), headers: new Headers(init?.headers) });
    const full = String(url).replace("https://api.github.com/repos/", "");
    const body = github[full];
    if (!body) return new Response(JSON.stringify({ message: "Not Found", documentation_url: "https://docs.github.com/rest/repos/repos#get-a-repository", status: "404" }), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { you, gh, deps: { search, research: createResearch({ apiKey: "k", fetch: youFetch }), githubFetch, githubToken: "" } };
}

const HIT = "find the root cause of a bug before fixing it";
const MISS = "design ClickHouse table schemas and write fast queries";

describe("findSkill: library first", () => {
  it("returns library hits at no cost and makes zero network calls when the top hit clears the threshold", async () => {
    const f = fakes();
    const result = await findSkill(HIT, { archetype: "engineer", qualifications: ["debugging"] }, f.deps);
    expect(result.source).toBe("library");
    if (result.source !== "library") return;
    expect(result.hits[0].entry.id).toBe("obra/systematic-debugging");
    expect(result.hits.every((h) => h.score >= LIBRARY_THRESHOLD)).toBe(true);
    expect(result.costUsd).toBe(0);
    expect(f.you).toHaveLength(0);
    expect(f.gh).toHaveLength(0);
  });

  it("goes to the web when the top hit is under the threshold, even if the library has a partial match", async () => {
    const f = fakes();
    const result = await findSkill(HIT, { archetype: "engineer" }, { ...f.deps, threshold: 0.99 });
    expect(result.source).toBe("web");
    expect(f.you).toHaveLength(1);
  });
});

describe("findSkill: on a miss, one deep Research call", () => {
  it("makes exactly one Research call at deep, with the documented output_schema and source_control", async () => {
    const f = fakes();
    await findSkill(MISS, { archetype: "engineer", qualifications: ["database", "performance"] }, f.deps);
    expect(f.you).toHaveLength(1);
    const { body } = f.you[0];
    expect(body.research_effort).toBe("deep");
    expect(body.source_control).toEqual({ include_domains: ["github.com", "skills.sh"] });
    expect(SKILL_SOURCE_CONTROL).toEqual(body.source_control);
    expect(body.output_schema).toEqual(SKILL_CANDIDATES_SCHEMA);
    // Design §3b's fields, every one required, no extras (You.com's schema rules).
    const item = (body.output_schema as { properties: { candidates: { items: { properties: object; required: string[]; additionalProperties: boolean } } } }).properties.candidates.items;
    const fields = ["skill_name", "repo_url", "publisher", "is_official_publisher", "install_command", "last_updated", "why_it_fits"];
    expect(Object.keys(item.properties).sort()).toEqual([...fields].sort());
    expect([...item.required].sort()).toEqual([...fields].sort());
    expect(item.additionalProperties).toBe(false);
    // The need, the archetype and the qualifications reach the research agent.
    expect(body.input).toContain(MISS);
    expect(body.input).toMatch(/engineer/);
    expect(body.input).toMatch(/database, performance/);
  });

  it("returns vetted candidates for owner approval, with the call's cost and the library's near misses", async () => {
    const f = fakes();
    const result = await findSkill(MISS, { archetype: "engineer" }, f.deps);
    expect(result.source).toBe("web");
    if (result.source !== "web") return;
    expect(result.costUsd).toBe(0.1);
    expect(result.nearMisses.every((h) => h.score < LIBRARY_THRESHOLD)).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
  });
});

describe("findSkill: vetting in code", () => {
  async function web(github = GITHUB) {
    const f = fakes(github);
    const result = await findSkill(MISS, { archetype: "engineer" }, f.deps);
    if (result.source !== "web") throw new Error("expected a web result");
    return { ...result, gh: f.gh };
  }

  it("drops forks, naming the parent", async () => {
    const { candidates, dropped } = await web();
    expect(candidates.map((c) => c.repo)).not.toContain("vybenetwork/clickhouse-agent-skills");
    expect(dropped.find((d) => d.repoUrl.includes("vybenetwork"))?.reason).toMatch(/fork of ClickHouse\/agent-skills/);
  });

  it("drops archived repos", async () => {
    const { candidates, dropped } = await web();
    expect(candidates.map((c) => c.repo)).not.toContain("legacy-data/clickhouse-sql-skill");
    expect(dropped.find((d) => d.repoUrl.includes("legacy-data"))?.reason).toMatch(/archived/);
  });

  it("drops links that aren't a GitHub repo, and repos GitHub doesn't know", async () => {
    const { dropped } = await web({ ...GITHUB, "addyosmani/agent-skills": undefined as never });
    expect(dropped.find((d) => d.repoUrl.includes("cookiesforai"))?.reason).toMatch(/not a GitHub repo/);
    expect(dropped.find((d) => d.repoUrl.includes("addyosmani"))?.reason).toMatch(/not found/);
  });

  it("ranks an official repo above a higher-star unofficial one", async () => {
    const { candidates } = await web();
    const official = candidates.findIndex((c) => c.repo === "ClickHouse/agent-skills");
    const popular = candidates.findIndex((c) => c.repo === "addyosmani/agent-skills");
    expect(candidates[official].stars).toBeLessThan(candidates[popular].stars);
    expect(official).toBeGreaterThanOrEqual(0);
    expect(official).toBeLessThan(popular);
    expect(candidates[0].official).toBe(true);
  });

  it("flags a 1-star 'official' claim and doesn't rank it as official", async () => {
    const { candidates } = await web();
    const fake = candidates.find((c) => c.repo === "olap-tools/clickhouse-skill")!;
    expect(fake.claimedOfficial).toBe(true);
    expect(fake.official).toBe(false);
    expect(fake.flags.join(" ")).toMatch(/official.*1 star/);
    expect(candidates.indexOf(fake)).toBeGreaterThan(candidates.findIndex((c) => c.repo === "addyosmani/agent-skills"));
    expect(candidates.find((c) => c.repo === "ClickHouse/agent-skills")!.flags).toEqual([]);
  });

  it("reads a skills.sh page as its GitHub repo, and asks GitHub once per repo", async () => {
    const { candidates, gh } = await web();
    expect(candidates.find((c) => c.skillName === "chdb-datastore")?.repo).toBe("ClickHouse/agent-skills");
    const urls = gh.map((c) => c.url);
    expect(urls.filter((u) => u.endsWith("/repos/ClickHouse/agent-skills"))).toHaveLength(1);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("uses the repo's real stars and last push from GitHub, not the research agent's claims", async () => {
    const { candidates } = await web();
    const pick = candidates.find((c) => c.repo === "ClickHouse/agent-skills")!;
    expect(pick.stars).toBe(412);
    expect(pick.pushedAt).toBe(REPO.pushed_at);
  });

  it("sends GITHUB_TOKEN as a bearer token when there is one, and nothing when there isn't", async () => {
    const withToken = fakes();
    await findSkill(MISS, {}, { ...withToken.deps, githubToken: "ghp_test" });
    expect(withToken.gh[0].headers.get("authorization")).toBe("Bearer ghp_test");
    const without = fakes();
    await findSkill(MISS, {}, without.deps);
    expect(without.gh[0].headers.get("authorization")).toBeNull();
  });
});

describe("findSkill: calibrated on the curated library (skills/index.json)", () => {
  // Scores on the 55-skill index, 2026-10-17: needs it covers score ≥ 0.326, needs it doesn't ≤ 0.224.
  const real = async () => {
    const { loadLibrary } = await import("./library");
    const f = fakes();
    return { f, deps: { ...f.deps, search: createSearchSkills((await loadLibrary()).index.skills) } };
  };

  it("goes to the web for a ClickHouse need, though the library's sql-queries skill partly matches", async () => {
    const { f, deps } = await real();
    const result = await findSkill("design ClickHouse table schemas and write fast analytical queries", { archetype: "analyst" }, deps);
    expect(result.source).toBe("web");
    expect(f.you).toHaveLength(1);
  });

  it("goes to the web for a patent application, though the library's docx skill partly matches", async () => {
    const { f, deps } = await real();
    const result = await findSkill("file a patent application", { archetype: "writer" }, deps);
    expect(result.source).toBe("web");
    expect(f.you).toHaveLength(1);
  });

  it("stays in the library for the weakest need it does cover, a revenue chart", async () => {
    const { f, deps } = await real();
    const result = await findSkill("build a chart of monthly revenue", { archetype: "analyst" }, deps);
    expect(result.source).toBe("library");
    if (result.source === "library") expect(result.hits[0].entry.id).toBe("anthropics/data-visualization");
    expect(f.you).toHaveLength(0);
  });
});
