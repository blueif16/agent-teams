/*
 * Checks the generated library (skills/index.json + skills/library/ + LICENSES/skills/) against the contract and
 * the curation rules. Regenerate with `node scripts/skills/import.mts`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SkillIndex } from "../../src/lib/skills/types.ts";
import { ManifestSchema, PERMISSIVE_LICENSES, SkillIndexSchema } from "./schema.mts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LIBRARY = path.join(ROOT, "skills/library");
const readJson = (p: string): unknown => JSON.parse(readFileSync(path.join(ROOT, p), "utf8"));

const index = readJson("skills/index.json") as SkillIndex;
const manifest = ManifestSchema.parse(readJson("skills/manifest.json"));
const vendored = index.skills.filter((s) => s.vendored);

/** Every file under a directory, relative to it. */
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join("/")];
  });
}

describe("skills/index.json", () => {
  it("validates against the SkillIndex contract", () => {
    const parsed = SkillIndexSchema.safeParse(index);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it("has unique ids", () => {
    const seen = new Map<string, number>();
    for (const s of index.skills) seen.set(s.id, (seen.get(s.id) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([id]) => id)).toEqual([]);
  });

  it("vendors only permissively licensed skills", () => {
    const bad = vendored.filter((s) => !(PERMISSIVE_LICENSES as readonly string[]).includes(s.license));
    expect(bad.map((s) => `${s.id}: ${s.license}`)).toEqual([]);
  });

  it("has every vendored file on disk, and nothing else in the library", () => {
    const missing = vendored.flatMap((s) => s.files.filter((f) => !existsSync(path.join(LIBRARY, s.id, f))).map((f) => `${s.id}/${f}`));
    expect(missing).toEqual([]);
    const listed = new Set(vendored.flatMap((s) => s.files.map((f) => `${s.id}/${f}`)));
    const extra = existsSync(LIBRARY) ? walk(LIBRARY).filter((f) => !listed.has(f)) : [];
    expect(extra).toEqual([]);
  });

  it("gives every vendored skill a SKILL.md", () => {
    expect(vendored.filter((s) => !s.files.includes("SKILL.md")).map((s) => s.id)).toEqual([]);
  });

  it("keeps link-only entries free of files", () => {
    expect(index.skills.filter((s) => !s.vendored && s.files.length > 0).map((s) => s.id)).toEqual([]);
  });

  it("ships the license text of every vendored repo", () => {
    const repos = [...new Set(vendored.map((s) => s.source.repo))];
    expect(repos.filter((r) => !existsSync(path.join(ROOT, "LICENSES/skills", `${r}.txt`)))).toEqual([]);
  });

  it("lists no skill with a scan finding", () => {
    expect(index.skills.filter((s) => s.scan.findings > 0).map((s) => `${s.id}: ${s.scan.findings}`)).toEqual([]);
  });

  it("traces every entry to a manifest pick at the same commit", () => {
    const picks = new Set(manifest.skills.map((p) => `${p.repo}|${p.path}|${p.commit}`));
    const untraced = index.skills.filter((s) => !picks.has(`${s.source.repo}|${s.source.path}|${s.source.commit}`));
    expect(untraced.map((s) => s.id)).toEqual([]);
  });

  it("covers each target archetype with at least 4 skills, 30 to 60 in total", () => {
    const targets = ["engineer", "designer", "researcher", "analyst", "writer", "lead", "chief"] as const;
    const thin = targets.filter((a) => index.skills.filter((s) => s.archetypes.includes(a)).length < 4);
    expect(thin).toEqual([]);
    expect(index.skills.length).toBeGreaterThanOrEqual(30);
    expect(index.skills.length).toBeLessThanOrEqual(60);
  });
});
