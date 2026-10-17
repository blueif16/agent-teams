/*
 * Live check against You.com and GitHub, skipped unless YOUCOM_LIVE=1. One `deep` Research call ($0.10 list price).
 * The caller supplies the key; the full result is written to .data/skills/find-live.json:
 *
 *   YOUCOM_LIVE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run --reporter=verbose src/lib/skills/find.live.test.ts
 *
 * (The default reporter hides a passing test's console output; the file is the record.)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findSkill } from "./find";
import { createSearchSkills } from "./search";
import type { SkillIndex } from "./types";
import { createResearch } from "./youcom";

const index = JSON.parse(readFileSync(new URL("./__fixtures__/skills/index.json", import.meta.url), "utf8")) as SkillIndex;
export const LIVE_OUT = path.join(process.cwd(), ".data", "skills", "find-live.json");

describe.skipIf(process.env.YOUCOM_LIVE !== "1")("live: findSkill on a need the library doesn't cover", () => {
  it("returns vetted GitHub candidates from one deep call", async () => {
    const need = "design ClickHouse table schemas and write fast analytical queries";
    const started = performance.now();
    const result = await findSkill(need, { archetype: "engineer", qualifications: ["database", "performance"] }, {
      search: createSearchSkills(index.skills),
      research: createResearch(),
    });
    const totalMs = Math.round(performance.now() - started);
    expect(result.source).toBe("web");
    if (result.source !== "web") return;

    const record = {
      at: new Date().toISOString(),
      need,
      researchLatencyMs: result.latencyMs,
      totalMs,
      costUsd: result.costUsd,
      candidates: result.candidates.map((c) => ({
        repo: c.repo,
        skill: c.skillName,
        stars: c.stars,
        official: c.official,
        claimedOfficial: c.claimedOfficial,
        license: c.license,
        pushedAt: c.pushedAt,
        install: c.installCommand,
        flags: c.flags,
        // findSkill doesn't scan; the curator's import pipeline scans an approved pick before it is vendored.
        scan: "not scanned yet (scanned on import after approval)",
        why: c.whyItFits,
      })),
      dropped: result.dropped,
      warnings: result.warnings,
    };
    mkdirSync(path.dirname(LIVE_OUT), { recursive: true });
    writeFileSync(LIVE_OUT, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`LIVE ${LIVE_OUT}`);

    expect(result.costUsd).toBe(0.1);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
  }, 180_000);
});
