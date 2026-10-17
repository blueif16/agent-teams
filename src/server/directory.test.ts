import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileHistory } from "@/lib/vault/types";
import type { Permission } from "@/lib/policy/types";
import type { SkillHit } from "@/lib/skills/types";

/*
 * The agent directory (setup-flow spec, step 5): every server lookup of an agent checks the code constants (Mira),
 * then the runtime db, so an agent that exists only as a db row gets SOUL/MEMORY, Permissions, Skills, stats and
 * History like Mira. Hermetic: a temp DATA_DIR and vault (cwd mocked), the fixture skill library.
 */
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type Global = { __agentTeamsCache?: { close(): void }; __agentTeamsVault?: unknown; __agentTeamsRuntimeDb?: { close(): void } };
const FIXTURES = path.join(process.cwd(), "src/lib/skills/__fixtures__/skills");
const ID = "swatch-k3p9";
const PID = "p_test01";

let root: string;
let cwd: { mockRestore(): void };
const env: Record<string, string | undefined> = {};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "directory-"));
  for (const k of ["DATA_DIR", "SKILLS_DIR", "VAULT_DIR"]) env[k] = process.env[k];
  process.env.DATA_DIR = path.join(root, ".data");
  process.env.SKILLS_DIR = FIXTURES;
  delete process.env.VAULT_DIR;
  cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.resetModules();
  const g = globalThis as Global;
  delete g.__agentTeamsCache;
  delete g.__agentTeamsVault;
  delete g.__agentTeamsRuntimeDb;

  // A designer hired onto #onboarding, as a db row only.
  const { getRuntimeDb } = await import("@/server/runtime/db");
  const db = getRuntimeDb();
  db.agents.create({
    id: ID,
    name: "Swatch",
    archetype: "designer",
    config: {
      composition: {
        id: "c1",
        archetype: "designer",
        skills: ["anthropics/frontend-design", "anthropics/canvas-design"],
        role: "Product designer",
        qualifications: ["wireframes"],
        source: "orchestrator",
        createdAt: "2026-10-17T00:00:00.000Z",
      },
    },
  });
  db.projects.create({ id: PID, kind: "team", channel: "onboarding", name: "Onboarding", goal: "Lift day-1 activation to 40%", status: "active", leadAgentId: ID });
  db.members.add({ projectId: PID, agentId: ID, role: "Product designer", qualifications: ["wireframes"] });
  db.threads.ensure(ID, PID);
});

afterEach(async () => {
  const g = globalThis as Global;
  g.__agentTeamsCache?.close();
  g.__agentTeamsRuntimeDb?.close();
  delete g.__agentTeamsCache;
  delete g.__agentTeamsVault;
  delete g.__agentTeamsRuntimeDb;
  cwd.mockRestore();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(root, { recursive: true, force: true });
});

const get = (url: string) => new Request(`http://localhost${url}`);

describe("a db-only agent", () => {
  it("has SOUL.md and MEMORY.md from its archetype's template, seeded in the vault", async () => {
    const { GET } = await import("@/app/api/agents/[id]/identity/route");
    const { INHERENT } = await import("@/lib/inherent");
    const res = await GET(get(`/api/agents/${ID}/identity`), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; soul: { content: string }; memory: { content: string } };
    expect(body.type).toBe("designer");
    expect(body.soul.content).toContain("# Swatch's soul");
    expect(body.soul.content).toContain("#onboarding");
    expect(body.soul.content).toContain(INHERENT.designer[0]);
    expect(body.memory.content).toContain("# Swatch's memory");

    const { getVault } = await import("@/server/runtime/vault");
    const { commits } = await getVault().history(`agents/${ID}/SOUL.md`);
    expect(commits.map((c) => [c.source, c.trailers.Archetype?.[0]])).toEqual([["seed", "designer"]]);
  });

  it("gets Permissions by its archetype", async () => {
    const { GET } = await import("@/app/api/rules/route");
    const toolset = async (qs: string) => {
      const res = await GET(get(`/api/rules?${qs}`));
      expect(res.status).toBe(200);
      const { permissions } = (await res.json()) as { permissions: Permission[] };
      return Object.fromEntries(permissions.map((p) => [p.id, p.inToolset]));
    };
    const mine = await toolset(`agent=${ID}`);
    expect(mine).toEqual(await toolset("agent=someone-else&archetype=designer"));
    expect(mine).not.toEqual(await toolset("agent=someone-else&archetype=engineer"));
  });

  it("lists the skills of its composition", async () => {
    const { GET } = await import("@/app/api/skills/route");
    const res = await GET(get(`/api/skills?agent=${ID}`));
    expect(res.status).toBe(200);
    const hits = (await res.json()) as SkillHit[];
    expect(hits.map((h) => h.entry.id)).toEqual(["anthropics/frontend-design", "anthropics/canvas-design"]);
  });

  it("has stats and a file history", async () => {
    const { GET: stats } = await import("@/app/api/stats/route");
    expect((await stats(get(`/api/stats?agent=${ID}`))).status).toBe(200);
    const { GET: history } = await import("@/app/api/agents/[id]/files/[name]/history/route");
    const res = await history(get(`/api/agents/${ID}/files/soul/history`), { params: Promise.resolve({ id: ID, name: "soul" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as FileHistory).path).toBe(`agents/${ID}/SOUL.md`);
  });

  it("is still 404 everywhere for an id that is in neither the constants nor the db", async () => {
    const { GET: identity } = await import("@/app/api/agents/[id]/identity/route");
    const { GET: rules } = await import("@/app/api/rules/route");
    const { GET: skills } = await import("@/app/api/skills/route");
    expect((await identity(get("/api/agents/ghost/identity"), { params: Promise.resolve({ id: "ghost" }) })).status).toBe(404);
    expect((await rules(get("/api/rules?agent=ghost"))).status).toBe(404);
    expect((await skills(get("/api/skills?agent=ghost"))).status).toBe(404);
  });
});
