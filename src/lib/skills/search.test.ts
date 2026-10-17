import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSearchSkills } from "./search";
import type { SkillEntry, SkillIndex } from "./types";

const index = JSON.parse(readFileSync(new URL("./__fixtures__/skills/index.json", import.meta.url), "utf8")) as SkillIndex;
const search = createSearchSkills(index.skills);
const entry = (id: string) => index.skills.find((s) => s.id === id)!;

/** Needs as a PM or an expert would phrase them, never the skill's name. */
export const NEED_QUERIES: [need: string, expected: string][] = [
  ["find the root cause of a bug before fixing it", "obra/systematic-debugging"],
  ["write the failing test first, then the code", "obra/test-driven-development"],
  ["make a video programmatically with React", "remotion-dev/remotion-best-practices"],
  ["my Next.js pages are slow, speed them up", "vercel-labs/react-best-practices"],
  ["build a slide deck for the board meeting", "anthropics/pptx"],
  ["fill in a PDF form and pull the tables out", "anthropics/pdf"],
  ["compute formulas in a spreadsheet", "anthropics/xlsx"],
  ["make the landing page look distinctive, not like a template", "anthropics/frontend-design"],
  ["design a poster", "anthropics/canvas-design"],
  ["compare vendors with cited sources", "youdotcom-oss/you-research"],
  ["check the work really passes before saying it's done", "obra/verification-before-completion"],
  ["audit my UI for accessibility", "vercel-labs/web-design-guidelines"],
  ["turn a spec into a step-by-step implementation plan", "obra/writing-plans"],
];

describe("searchSkills", () => {
  it.each(NEED_QUERIES)("ranks the right skill first for %j", (need, expected) => {
    expect(search(need)[0]?.entry.id).toBe(expected);
  });

  it("never returns an entry whose scan found something, even when it is the best text match", () => {
    const evil = entry("quickfix-labs/debug-anything");
    const hits = search(evil.description, { limit: 50 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.entry.id)).not.toContain(evil.id);
    expect(createSearchSkills([evil])(evil.description)).toEqual([]);
  });

  it("boosts the entries made for the asking archetype", () => {
    const base = entry("obra/brainstorming");
    const forDesigner: SkillEntry = { ...base, id: "a/twin", archetypes: ["designer"] };
    const forEngineer: SkillEntry = { ...base, id: "b/twin", archetypes: ["engineer"] };
    const twins = createSearchSkills([forDesigner, forEngineer]);
    expect(twins("plan a new feature", { archetype: "designer" })[0].entry.id).toBe("a/twin");
    expect(twins("plan a new feature", { archetype: "engineer" })[0].entry.id).toBe("b/twin");
    const plain = twins("plan a new feature");
    expect(plain[0].score).toBe(plain[1].score);
    expect(twins("plan a new feature", { archetype: "designer" })[0].score).toBeGreaterThan(plain[0].score);
  });

  it("boosts, but doesn't filter: a far better match for another archetype still wins", () => {
    expect(search("fill in a PDF form", { archetype: "designer" })[0].entry.id).toBe("anthropics/pdf");
  });

  it("says which fields matched, and when the archetype boosted it", () => {
    const [hit] = search("systematic root cause analysis of a test failure", { archetype: "engineer" });
    expect(hit.entry.id).toBe("obra/systematic-debugging");
    expect(hit.why).toMatch(/name: systematic/);
    expect(hit.why).toMatch(/tags: [^;]*root/);
    expect(hit.why).toMatch(/engineer/);
    const [unboosted] = search("systematic root cause analysis of a test failure");
    expect(unboosted.why).not.toMatch(/engineer/);
  });

  it("returns 5 hits by default and honours limit", () => {
    // Broad on purpose: more than 5 fixture entries match at least one of these words.
    const broad = "code design test plan pdf react video";
    expect(search(broad, { limit: 50 }).length).toBeGreaterThan(5);
    expect(search(broad)).toHaveLength(5);
    expect(search(broad, { limit: 2 })).toHaveLength(2);
  });

  it("returns nothing for a need the library doesn't cover, or an empty query", () => {
    expect(search("quantum chromodynamics lattice simulations")).toEqual([]);
    expect(search("   ")).toEqual([]);
  });

  it("scores a fuller match higher than a partial one", () => {
    const full = search("root cause of a bug")[0];
    const partial = search("root cause of a bug in my kubernetes helm chart")[0];
    expect(full.entry.id).toBe(partial.entry.id);
    expect(full.score).toBeGreaterThan(partial.score);
  });
});

describe("searchSkills latency", () => {
  /** 200 entries: the fixtures, each repeated with a shuffled vocabulary so terms and lengths vary. */
  function twoHundred(): SkillEntry[] {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const words = index.skills.flatMap((s) => s.description.split(/\s+/));
    return Array.from({ length: 200 }, (_, i) => {
      const s = index.skills[i % index.skills.length];
      const description = Array.from({ length: 30 + Math.floor(rand() * 40) }, () => words[Math.floor(rand() * words.length)]).join(" ");
      return { ...s, id: `${s.id}-${i}`, description, scan: { ...s.scan, findings: 0 } };
    });
  }

  it("answers in under 5 ms over 200 entries (index built once)", () => {
    const entries = twoHundred();
    const t0 = performance.now();
    const search200 = createSearchSkills(entries);
    const build = performance.now() - t0;
    for (const [need] of NEED_QUERIES) search200(need); // warm up the JIT
    const times: number[] = [];
    for (let round = 0; round < 5; round++) {
      for (const [need] of NEED_QUERIES) {
        const t = performance.now();
        search200(need, { archetype: "engineer" });
        times.push(performance.now() - t);
      }
    }
    times.sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length / 2)];
    const p95 = times[Math.floor(times.length * 0.95)];
    console.log(`search latency over 200 entries: build ${build.toFixed(2)} ms · query p50 ${p50.toFixed(3)} ms · p95 ${p95.toFixed(3)} ms · max ${times.at(-1)!.toFixed(3)} ms`);
    // The median, so a GC pause or a busy CI core doesn't flake it; p95 and the build time are reported above.
    expect(p50).toBeLessThan(5);
  });
});
