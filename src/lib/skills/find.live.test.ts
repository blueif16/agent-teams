/*
 * Live check against You.com and GitHub, skipped unless YOUCOM_LIVE=1. One `deep` Research call ($0.10 list price).
 * The caller supplies the key:
 *
 *   YOUCOM_LIVE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run --reporter=verbose src/lib/skills/find.live.test.ts
 *
 * `--reporter=verbose`: the default reporter hides a passing test's console output, and with it the LIVE line.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findSkill } from "./find";
import { createSearchSkills } from "./search";
import type { SkillIndex } from "./types";
import { createResearch } from "./youcom";

const index = JSON.parse(readFileSync(new URL("./__fixtures__/skills/index.json", import.meta.url), "utf8")) as SkillIndex;

describe.skipIf(process.env.YOUCOM_LIVE !== "1")("live: findSkill on a need the library doesn't cover", () => {
  it("returns vetted GitHub candidates from one deep call", async () => {
    const need = "design ClickHouse table schemas and write fast analytical queries";
    const result = await findSkill(need, { archetype: "engineer", qualifications: ["database", "performance"] }, {
      search: createSearchSkills(index.skills),
      research: createResearch(),
    });
    expect(result.source).toBe("web");
    if (result.source !== "web") return;
    const top = result.candidates[0];
    console.log(
      `LIVE ${JSON.stringify({
        latencyMs: result.latencyMs,
        costUsd: result.costUsd,
        candidates: result.candidates.map((c) => `${c.repo} ${c.skillName} ★${c.stars}${c.official ? " official" : ""}${c.flags.length ? ` [${c.flags.join("; ")}]` : ""}`),
        dropped: result.dropped.map((d) => `${d.repoUrl}: ${d.reason}`),
        warnings: result.warnings,
      })}`,
    );
    expect(result.costUsd).toBe(0.1);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(top.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
  }, 180_000);
});
