import { cpSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillEntry, SkillHit, SkillIndex } from "@/lib/skills/types";
import { nextChange } from "./testing";

// Every whole-file read, by path, so a test can prove a request was served from memory.
const reads = vi.hoisted(() => [] as string[]);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = ((...args: Parameters<typeof actual.readFile>) => {
    reads.push(String(args[0]));
    return actual.readFile(...args);
  }) as typeof actual.readFile;
  return { ...actual, readFile, default: { ...actual, readFile } };
});

const FIXTURES = path.join(process.cwd(), "src/lib/skills/__fixtures__/skills");
const VENDORED = "obra/systematic-debugging";
type Global = { __agentTeamsCache?: { close(): void } };

describe("the skill library in the app", () => {
  let root: string;
  let dir: string;
  let env: string | undefined;
  let cwd: { mockRestore(): void };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "skills-app-"));
    dir = path.join(root, "skills");
    cpSync(FIXTURES, dir, { recursive: true });
    env = process.env.SKILLS_DIR;
    process.env.SKILLS_DIR = dir;
    cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
    reads.length = 0;
    vi.resetModules();
    delete (globalThis as Global).__agentTeamsCache;
  });

  afterEach(async () => {
    (globalThis as Global).__agentTeamsCache?.close();
    delete (globalThis as Global).__agentTeamsCache;
    cwd.mockRestore();
    if (env === undefined) delete process.env.SKILLS_DIR;
    else process.env.SKILLS_DIR = env;
    await rm(root, { recursive: true, force: true });
  });

  async function routes() {
    const { GET: list } = await import("@/app/api/skills/route");
    const { GET: one } = await import("@/app/api/skills/[...id]/route");
    return {
      list: async (qs = "") => (await (await list(new Request(`http://localhost/api/skills${qs}`))).json()) as SkillHit[],
      one: async (id: string) =>
        (await (await one(new Request(`http://localhost/api/skills/${id}`), { params: Promise.resolve({ id: id.split("/") }) })).json()) as {
          entry: SkillEntry;
          skillMd: string | null;
        },
    };
  }
  const diskReads = () => reads.filter((p) => p.startsWith(dir)).length;

  it("answers a second list, search and detail request without reading the library from disk", async () => {
    const { list, one } = await routes();
    const ask = () => Promise.all([list(), list(`?q=${encodeURIComponent("find the root cause of a bug")}`), one(VENDORED)]);
    const first = await ask();
    expect(diskReads()).toBeGreaterThan(0);
    const before = diskReads();

    const second = await ask();

    expect(diskReads()).toBe(before);
    expect(second).toEqual(first);
  });

  it("announces skills when index.json changes outside the app, and the next list has the change", async () => {
    const { getServerCache } = await import("@/server/cache");
    const { list } = await routes();
    expect((await list()).map((h) => h.entry.name)).not.toContain("Renamed outside the app");
    const changed = nextChange(getServerCache().bus, "skills");

    const file = path.join(dir, "index.json");
    const index = JSON.parse(readFileSync(file, "utf8")) as SkillIndex;
    index.skills.find((s) => s.id === VENDORED)!.name = "Renamed outside the app";
    await writeFile(file, JSON.stringify(index, null, 2));
    await changed;

    expect((await list()).map((h) => h.entry.name)).toContain("Renamed outside the app");
  });

  it("announces skills when a vendored SKILL.md changes, and the next detail has the new text", async () => {
    const { getServerCache } = await import("@/server/cache");
    const { one } = await routes();
    expect((await one(VENDORED)).skillMd).not.toContain("Edited outside the app");
    const changed = nextChange(getServerCache().bus, "skills");

    await writeFile(path.join(dir, "library", VENDORED, "SKILL.md"), "---\nname: systematic-debugging\n---\n\nEdited outside the app.\n");
    await changed;

    expect((await one(VENDORED)).skillMd).toContain("Edited outside the app");
  });
});
