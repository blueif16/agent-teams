import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLibrary, skillsDir } from "./library";

const FIXTURES = fileURLToPath(new URL("./__fixtures__/skills", import.meta.url));

describe("loadLibrary", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "skills-lib-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads the index from the given skills dir and gets an entry by id", async () => {
    const lib = await loadLibrary(FIXTURES);
    const onDisk = JSON.parse(readFileSync(path.join(FIXTURES, "index.json"), "utf8"));
    expect(lib.index.skills).toHaveLength(onDisk.skills.length);
    expect(lib.get("obra/systematic-debugging")?.source.repo).toBe("obra/superpowers");
    expect(lib.get("nobody/nothing")).toBeUndefined();
  });

  it("is an empty library, not a crash, when index.json doesn't exist yet", async () => {
    const lib = await loadLibrary(path.join(dir, "missing"));
    expect(lib.index.skills).toEqual([]);
    expect(lib.get("obra/systematic-debugging")).toBeUndefined();
  });

  it("refuses an index of another version", async () => {
    writeFileSync(path.join(dir, "index.json"), JSON.stringify({ version: 2, updatedAt: "2026-10-17", skills: [] }));
    await expect(loadLibrary(dir)).rejects.toThrow(/version/);
  });

  it("reads a vendored skill's files, keyed by their path inside the skill", async () => {
    const lib = await loadLibrary(FIXTURES);
    const files = await lib.readFiles("vercel-labs/react-best-practices");
    expect(Object.keys(files).sort()).toEqual(["SKILL.md", "rules/async-parallel.md"]);
    expect(files["SKILL.md"]).toBe(readFileSync(path.join(FIXTURES, "library/vercel-labs/react-best-practices/SKILL.md"), "utf8"));
  });

  it("won't read a skill that is listed with a link only", async () => {
    const lib = await loadLibrary(FIXTURES);
    await expect(lib.readFiles("anthropics/pptx")).rejects.toThrow(/not vendored/);
    await expect(lib.readFiles("nobody/nothing")).rejects.toThrow(/unknown skill/i);
  });

  it("won't read a listed file outside the skill's folder", async () => {
    mkdirSync(path.join(dir, "library", "a", "b"), { recursive: true });
    writeFileSync(path.join(dir, "secret.txt"), "TOP SECRET");
    const entry = JSON.parse(readFileSync(path.join(FIXTURES, "index.json"), "utf8")).skills[0];
    const index = { version: 1, updatedAt: "2026-10-17", skills: [{ ...entry, id: "a/b", files: ["../../../secret.txt"] }] };
    writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
    const lib = await loadLibrary(dir);
    await expect(lib.readFiles("a/b")).rejects.toThrow(/outside/);
  });
});

describe("skillsDir", () => {
  const before = process.env.SKILLS_DIR;
  afterEach(() => {
    if (before === undefined) delete process.env.SKILLS_DIR;
    else process.env.SKILLS_DIR = before;
  });

  it("is skills/ under the app root, unless SKILLS_DIR says otherwise", () => {
    delete process.env.SKILLS_DIR;
    expect(skillsDir()).toBe(path.join(process.cwd(), "skills"));
    process.env.SKILLS_DIR = "/elsewhere/skills";
    expect(skillsDir()).toBe("/elsewhere/skills");
  });
});
