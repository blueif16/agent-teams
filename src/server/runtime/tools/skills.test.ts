import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLibrary } from "@/lib/skills/library";
import { createResearch } from "@/lib/skills/youcom";
import { skillTools } from "./skills";

const FIXTURES = fileURLToPath(new URL("../../../lib/skills/__fixtures__/skills", import.meta.url));
const fixture = (p: string) => readFileSync(new URL(`../../../lib/skills/__fixtures__/${p}`, import.meta.url), "utf8");
const REPO = JSON.parse(fixture("github/repo-obra-superpowers.json"));
const FORK = JSON.parse(fixture("github/repo-fork-vybenetwork-clickhouse-agent-skills.json"));

function setup() {
  const you: unknown[] = [];
  const gh: string[] = [];
  const youFetch: typeof fetch = async (_u, init) => {
    you.push(JSON.parse(String(init?.body)));
    return new Response(fixture("youcom/research-skill-candidates.json"), { status: 200 });
  };
  // The real fork stays a fork; every other repo exists, unforked, with 900 stars.
  const githubFetch: typeof fetch = async (url) => {
    gh.push(String(url));
    const full = String(url).replace("https://api.github.com/repos/", "");
    const body = full === FORK.full_name ? FORK : { ...REPO, full_name: full, stargazers_count: 900 };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const [searchSkills, findSkill] = skillTools({
    library: () => loadLibrary(FIXTURES),
    research: createResearch({ apiKey: "k", fetch: youFetch }),
    githubFetch,
    githubToken: "",
  });
  return { searchSkills, findSkill, you, gh };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("search_skills tool", () => {
  it("is named for the registry and returns the library's best skills for a need, without any network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { searchSkills, you, gh } = setup();
    expect(searchSkills.name).toBe("search_skills");
    const out = JSON.parse(await searchSkills.invoke({ query: "find the root cause of a bug before fixing it", archetype: "engineer" }));
    expect(out.skills[0].id).toBe("obra/systematic-debugging");
    expect(out.skills[0].why).toMatch(/\S/);
    expect(out.skills.map((s: { id: string }) => s.id)).not.toContain("quickfix-labs/debug-anything");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(you).toHaveLength(0);
    expect(gh).toHaveLength(0);
  });

  it("says plainly when nothing in the library matches", async () => {
    const { searchSkills } = setup();
    const out = JSON.parse(await searchSkills.invoke({ query: "quantum chromodynamics lattice simulations" }));
    expect(out.skills).toEqual([]);
    expect(out.note).toMatch(/find_skill/);
  });

  it("rejects an archetype that doesn't exist", async () => {
    const { searchSkills } = setup();
    await expect(searchSkills.invoke({ query: "debug", archetype: "wizard" as never })).rejects.toThrow();
  });
});

describe("find_skill tool", () => {
  it("answers from the library at no cost when it covers the need: no research, no GitHub", async () => {
    const { findSkill, you, gh } = setup();
    expect(findSkill.name).toBe("find_skill");
    const out = JSON.parse(await findSkill.invoke({ need: "find the root cause of a bug before fixing it", archetype: "engineer" }));
    expect(out.source).toBe("library");
    expect(out.costUsd).toBe(0);
    expect(out.skills[0].id).toBe("obra/systematic-debugging");
    expect(you).toHaveLength(0);
    expect(gh).toHaveLength(0);
  });

  it("on a miss, makes one research call and returns vetted candidates for the owner to approve", async () => {
    const { findSkill, you } = setup();
    const out = JSON.parse(await findSkill.invoke({ need: "design ClickHouse table schemas and write fast queries", archetype: "engineer", qualifications: ["database"] }));
    expect(you).toHaveLength(1);
    expect(out.source).toBe("web");
    expect(out.costUsd).toBe(0.1);
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.candidates.map((c: { repo: string }) => c.repo)).not.toContain("vybenetwork/clickhouse-agent-skills");
    expect(out.note).toMatch(/approv/);
  });
});
