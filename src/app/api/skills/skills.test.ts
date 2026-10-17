import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillEntry, SkillHit, SkillIndex } from "@/lib/skills/types";
import { GET as getSkill } from "./[...id]/route";
import { GET } from "./route";

const FIXTURES = path.join(process.cwd(), "src/lib/skills/__fixtures__/skills");
const index = JSON.parse(readFileSync(path.join(FIXTURES, "index.json"), "utf8")) as SkillIndex;
const SCAN_FAILED = "quickfix-labs/debug-anything";

const list = async (qs: string) => {
  const res = await GET(new Request(`http://localhost/api/skills${qs}`));
  return { status: res.status, body: (await res.json()) as SkillHit[] & { error?: string } };
};
const one = async (id: string) => {
  const res = await getSkill(new Request(`http://localhost/api/skills/${id}`), { params: Promise.resolve({ id: id.split("/") }) });
  return { status: res.status, body: (await res.json()) as { entry: SkillEntry; skillMd: string | null; error?: string } };
};

let before: string | undefined;
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  before = process.env.SKILLS_DIR;
  process.env.SKILLS_DIR = FIXTURES;
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => {
  if (before === undefined) delete process.env.SKILLS_DIR;
  else process.env.SKILLS_DIR = before;
  vi.restoreAllMocks();
});

describe("GET /api/skills", () => {
  it("searches the library for a need, local only: no network call", async () => {
    const { status, body } = await list(`?q=${encodeURIComponent("find the root cause of a bug before fixing it")}&archetype=engineer`);
    expect(status).toBe(200);
    expect(body[0].entry.id).toBe("obra/systematic-debugging");
    expect(body[0].why).toMatch(/for engineer/);
    expect(body.map((h) => h.entry.id)).not.toContain(SCAN_FAILED);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lists every scan-clean skill, most starred first, when there is no query", async () => {
    const { status, body } = await list("");
    expect(status).toBe(200);
    expect(body.map((h) => h.entry.id).sort()).toEqual(index.skills.filter((s) => s.scan.findings === 0).map((s) => s.id).sort());
    const stars = body.map((h) => h.entry.source.stars);
    expect(stars).toEqual([...stars].sort((a, b) => b - a));
  });

  it("rejects an unknown archetype with 400", async () => {
    const { status, body } = await list("?q=debug&archetype=wizard");
    expect(status).toBe(400);
    expect(body.error).toMatch(/archetype/);
  });

  it("is an empty list when the library has no index yet", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "skills-route-"));
    process.env.SKILLS_DIR = dir;
    try {
      const { status, body } = await list("?q=debug");
      expect(status).toBe(200);
      expect(body).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("GET /api/skills/[...id]", () => {
  it("returns a vendored skill's entry and its SKILL.md", async () => {
    const { status, body } = await one("obra/systematic-debugging");
    expect(status).toBe(200);
    expect(body.entry.id).toBe("obra/systematic-debugging");
    expect(body.skillMd).toBe(readFileSync(path.join(FIXTURES, "library/obra/systematic-debugging/SKILL.md"), "utf8"));
  });

  it("returns a link-only skill without SKILL.md", async () => {
    const { status, body } = await one("anthropics/pptx");
    expect(status).toBe(200);
    expect(body.skillMd).toBeNull();
  });

  it("is 404 for an unknown skill and for one that failed its scan", async () => {
    expect((await one("nobody/nothing")).status).toBe(404);
    expect((await one(SCAN_FAILED)).status).toBe(404);
  });
});
