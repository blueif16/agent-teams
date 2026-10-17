import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LaunchOptions, LaunchPlan, Proposal } from "@/lib/project";
import type { SkillIndex } from "@/lib/skills/types";

/*
 * "Start a project", scripted end to end (setup-flow spec, acceptance): plan → launch from an empty DATA_DIR, the
 * retry, a failure half way, a tampered plan, and the new agents answering like Mira. Hermetic: a temp DATA_DIR and
 * vault (cwd mocked), the fixture skill library, and no network (fetch is a spy that must stay uncalled).
 */
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

type Global = { __agentTeamsCache?: { close(): void }; __agentTeamsVault?: unknown; __agentTeamsRuntimeDb?: { close(): void } };
const FIXTURES = path.join(process.cwd(), "src/lib/skills/__fixtures__/skills");
const INDEX = JSON.parse(readFileSync(path.join(FIXTURES, "index.json"), "utf8")) as SkillIndex;
const GIT = process.platform === "darwin" ? execFileSync("xcrun", ["--find", "git"], { encoding: "utf8" }).trim() : "git";

const PM = { archetype: "lead" as const, role: "PM", need: "run the revamp", qualifications: ["implementation plan"] };
const DESIGNER = { archetype: "designer" as const, role: "Product designer", need: "two onboarding directions", qualifications: ["visual design", "typography"] };
const RESEARCHER = { archetype: "researcher" as const, role: "UX researcher", need: "competitor teardown", qualifications: ["deep research with citations"] };
const WRITER = { archetype: "writer" as const, role: "Copywriter", need: "signup copy", qualifications: ["tax law"] };

const PROPOSAL: Proposal = {
  name: "Onboarding revamp",
  channel: "onboarding-revamp",
  goal: "Lift day-1 activation from 31% to 40%",
  due: "2026-11-20",
  metric: "Day-1 activation 40%",
  scope: { must: ["new signup flow"], wont: ["pricing changes"] },
  options: [
    { label: "Lean", summary: "One researcher, fastest read", kind: "solo", roles: [RESEARCHER], budgetUsd: 2, etaDays: 4 },
    { label: "Balanced", summary: "A PM runs design and research in parallel", kind: "project", roles: [PM, DESIGNER, RESEARCHER], budgetUsd: 6, etaDays: 9 },
  ],
};

let root: string;
let fetchSpy: ReturnType<typeof vi.spyOn>;
const env: Record<string, string | undefined> = {};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "start-project-"));
  for (const k of ["DATA_DIR", "SKILLS_DIR", "VAULT_DIR"]) env[k] = process.env[k];
  process.env.DATA_DIR = path.join(root, ".data");
  process.env.SKILLS_DIR = FIXTURES;
  delete process.env.VAULT_DIR;
  vi.spyOn(process, "cwd").mockReturnValue(root);
  fetchSpy = vi.spyOn(globalThis, "fetch");
  vi.resetModules();
  const g = globalThis as Global;
  delete g.__agentTeamsCache;
  delete g.__agentTeamsVault;
  delete g.__agentTeamsRuntimeDb;
});

afterEach(async () => {
  const g = globalThis as Global;
  g.__agentTeamsCache?.close();
  g.__agentTeamsRuntimeDb?.close();
  delete g.__agentTeamsCache;
  delete g.__agentTeamsVault;
  delete g.__agentTeamsRuntimeDb;
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(root, { recursive: true, force: true });
});

const json = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function plan(proposal: unknown = PROPOSAL) {
  const { POST } = await import("./plan/route");
  const res = await POST(json("/api/projects/plan", { proposal }));
  return { status: res.status, body: (await res.json()) as LaunchOptions & { error?: string } };
}

async function launch(body: { plan: unknown; nonce: unknown }) {
  const { POST } = await import("./route");
  const res = await POST(json("/api/projects", body));
  return { status: res.status, body: (await res.json()) as { projectId: string; created: boolean; error?: string } };
}

async function balancedPlan(): Promise<LaunchPlan> {
  const { launchPlanOf } = await import("@/lib/project");
  return launchPlanOf((await plan()).body, 1);
}

const db = async () => (await import("@/server/runtime/db")).getRuntimeDb();
const vaultDir = () => path.join(root, ".data", "vault");
const commitCount = () => (existsSync(path.join(vaultDir(), ".git")) ? Number(execFileSync(GIT, ["rev-list", "--count", "HEAD"], { cwd: vaultDir(), encoding: "utf8" }).trim()) : 0);

/** Everything the setup flow wrote to the db, Mira's seed left out. */
async function counts() {
  const d = await db();
  const q = (sql: string) => Number((d.sql.prepare(sql).get() as { n: number }).n);
  return {
    projects: q("SELECT COUNT(*) AS n FROM projects WHERE id != 'dm'"),
    agents: q("SELECT COUNT(*) AS n FROM agents WHERE id != 'mira'"),
    members: q("SELECT COUNT(*) AS n FROM project_members WHERE project_id != 'dm'"),
    threads: q("SELECT COUNT(*) AS n FROM threads WHERE project_id != 'dm'"),
    inbox: q("SELECT COUNT(*) AS n FROM inbox"),
  };
}

const loadable = new Set(INDEX.skills.filter((s) => s.vendored && s.scan.findings === 0 && !s.scan.executable).map((s) => s.id));

describe("POST /api/projects/plan", () => {
  it("staffs every option from archetypes and the library, with no network call", async () => {
    const { status, body } = await plan();
    expect(status).toBe(200);
    expect(body.charter).toMatchObject({ goal: PROPOSAL.goal, due: "2026-11-20", channel: "onboarding-revamp" });
    expect(body.options.map((o) => [o.label, o.kind, o.roster.map((r) => r.archetype)])).toEqual([
      ["Lean", "solo", ["researcher"]],
      ["Balanced", "project", ["lead", "designer", "researcher"]],
    ]);
    const pm = body.options[1].roster[0];
    expect(pm.skills.map((s) => s.id)).toContain("obra/writing-plans");
    for (const entry of body.options.flatMap((o) => o.roster)) {
      expect(entry.composition).toMatchObject({ archetype: entry.archetype, role: entry.role, skills: entry.skills.map((s) => s.id) });
      expect(entry.skills.length).toBeLessThanOrEqual(4);
      for (const s of entry.skills) expect(loadable.has(s.id), s.id).toBe(true);
      expect(entry.name).toMatch(/^[A-Z][a-z]+$/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lists a need the library doesn't cover as no skill yet", async () => {
    const { body } = await plan({ ...PROPOSAL, options: [{ ...PROPOSAL.options[1], roles: [PM, WRITER] }] });
    const writer = body.options[0].roster[1];
    expect(writer.uncovered).toEqual(["tax law"]);
    expect(writer.skills).toEqual([]);
  });

  it("offers at most one idle agent of the same archetype to rehire, with its record from the ledger", async () => {
    const d = await db();
    d.agents.create({ id: "swatch-aaaa", name: "Swatch", archetype: "designer" });
    d.agents.create({ id: "doodle-bbbb", name: "Doodle", archetype: "designer" });
    d.agents.create({ id: "tally-cccc", name: "Tally", archetype: "analyst" });
    const { record } = await import("@/lib/ledger");
    await record({ t: "order", at: "2026-10-17T10:00:00.000Z", team: "x", agent: "doodle-bbbb", order: "go" });

    const { body } = await plan();
    const designer = body.options[1].roster[1];
    expect(designer.candidate).toMatchObject({ id: "doodle-bbbb", name: "Doodle" });
    expect(designer.candidate!.record).toMatch(/accepted/);
    expect(designer.rehire).toBe("doodle-bbbb");
    expect(body.options[1].roster.filter((r) => r.archetype !== "designer").every((r) => !r.candidate)).toBe(true);
  });

  it("refuses a proposal it can't staff with 400", async () => {
    expect((await plan({ ...PROPOSAL, goal: "" })).status).toBe(400);
    expect((await plan({ ...PROPOSAL, options: [{ ...PROPOSAL.options[0], roles: [{ ...RESEARCHER, archetype: "wizard" }] }] })).status).toBe(400);
  });
});

describe("POST /api/projects", () => {
  it("hands Mira's open questions to the PM: listed in the charter, and the kickoff tells the PM to ask the owner", async () => {
    const { launchPlanOf } = await import("@/lib/project");
    const open = ["Which price band?", "Bluetooth pairing or a one-way link?"];
    const launchPlan = launchPlanOf((await plan({ ...PROPOSAL, open })).body, 1);
    const { body } = await launch({ plan: launchPlan, nonce: "nonce-open-01" });
    const d = await db();
    const project = d.projects.get(body.projectId)!;
    const pm = d.members.list(project.id)[0];
    const vault = (await import("@/server/runtime/vault")).getVault();
    const charter = await vault.show(`projects/${project.id}/state/charter.md`);
    expect(charter).toMatch(/## Open questions/);
    for (const q of open) expect(charter).toContain(q);
    const [kickoff] = d.inbox.pending(`a:${pm.agentId}:p:${project.id}`);
    expect(String((kickoff.payload as { instruction: string }).instruction)).toMatch(/ask the owner/i);
  });

  it("provisions the picked option from an empty DATA_DIR: rows, home files, skills, charter and one kickoff", async () => {
    const launchPlan = await balancedPlan();
    const { nextChange } = await import("@/server/cache/testing");
    const { getServerCache } = await import("@/server/cache");
    const announced = nextChange(getServerCache().bus, "org");

    const { status, body } = await launch({ plan: launchPlan, nonce: "nonce-0001" });
    expect(status).toBe(201);
    expect(body.created).toBe(true);
    await announced;

    expect(await counts()).toEqual({ projects: 1, agents: 3, members: 3, threads: 3, inbox: 1 });
    const d = await db();
    const project = d.projects.get(body.projectId)!;
    expect(project).toMatchObject({ kind: "team", channel: "onboarding-revamp", goal: PROPOSAL.goal, successMetric: "Day-1 activation 40%", dueAt: "2026-11-20", status: "active" });
    const members = d.members.list(project.id);
    const agents = members.map((m) => d.agents.get(m.agentId)!);
    expect(agents.map((a) => a.archetype)).toEqual(["lead", "designer", "researcher"]);
    expect(project.leadAgentId).toBe(agents[0].id);
    for (const a of agents) {
      expect(a.id).toMatch(/^[a-z]+-[a-z0-9]{4}$/);
      expect(a.config.composition?.archetype).toBe(a.archetype);
      expect(d.threads.get(`a:${a.id}:p:${project.id}`)).toBeDefined();
    }

    // The vault: one seed commit per agent holding SOUL.md, MEMORY.md and its skills, plus the charter.
    const { getVault } = await import("@/server/runtime/vault");
    const vault = getVault();
    for (const a of agents) {
      for (const f of ["SOUL.md", "MEMORY.md"]) {
        const { commits } = await vault.history(`agents/${a.id}/${f}`);
        expect(commits.map((c) => [c.source, c.trailers.Archetype?.[0]])).toEqual([["seed", a.archetype]]);
      }
      for (const id of a.config.composition!.skills) {
        const folder = id.split("/").pop()!;
        expect(existsSync(path.join(vaultDir(), "agents", a.id, "skills", folder, "SKILL.md")), `${a.id} ${id}`).toBe(true);
      }
    }
    const charter = await vault.history(`projects/${project.id}/state/charter.md`);
    expect(charter.commits.map((c) => c.source)).toEqual(["seed"]);
    expect(await vault.show(`projects/${project.id}/state/charter.md`)).toContain(PROPOSAL.goal);
    expect(commitCount()).toBe(agents.length + 1);

    // The kickoff waits in the PM's inbox; nothing ran a model.
    const [kickoff] = d.inbox.pending(`a:${agents[0].id}:p:${project.id}`);
    expect(kickoff.kind).toBe("assignment");
    expect(JSON.stringify(kickoff.payload)).toContain(PROPOSAL.goal);
    expect(JSON.stringify(kickoff.payload)).toMatch(/write the plan and assign first tasks/i);
    expect(d.runs.byStatus("queued")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates nothing more when the same launch is retried with the same nonce", async () => {
    const launchPlan = await balancedPlan();
    const first = await launch({ plan: launchPlan, nonce: "nonce-0002" });
    const before = { rows: await counts(), commits: commitCount() };

    const again = await launch({ plan: launchPlan, nonce: "nonce-0002" });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ projectId: first.body.projectId, created: false });
    expect({ rows: await counts(), commits: commitCount() }).toEqual(before);
  });

  it("leaves no partial rows when provisioning fails half way", async () => {
    const launchPlan = await balancedPlan();
    const d = await db();
    vi.spyOn(d.inbox, "add").mockImplementation(() => {
      throw new Error("disk full");
    });
    const { status } = await launch({ plan: launchPlan, nonce: "nonce-0003" }).catch(() => ({ status: 500 }));
    expect(status).toBe(500);
    expect(await counts()).toEqual({ projects: 0, agents: 0, members: 0, threads: 0, inbox: 0 });
    expect(commitCount()).toBe(0);
  });

  it("refuses a plan with an unknown archetype, and writes nothing", async () => {
    const launchPlan = await balancedPlan();
    launchPlan.roster[1] = { ...launchPlan.roster[1], archetype: "wizard" as never };
    const { status, body } = await launch({ plan: launchPlan, nonce: "nonce-0004" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/archetype/i);
    expect(await counts()).toEqual({ projects: 0, agents: 0, members: 0, threads: 0, inbox: 0 });
  });

  it("refuses a launch without a nonce", async () => {
    expect((await launch({ plan: await balancedPlan(), nonce: "" })).status).toBe(400);
  });

  it("launches a solo option as a DM project with one expert and its kickoff", async () => {
    const { launchPlanOf } = await import("@/lib/project");
    const { body } = await launch({ plan: launchPlanOf((await plan()).body, 0), nonce: "nonce-0005" });
    const d = await db();
    const project = d.projects.get(body.projectId)!;
    expect(project).toMatchObject({ kind: "dm", channel: null });
    const [m] = d.members.list(project.id);
    expect(d.agents.get(m.agentId)?.archetype).toBe("researcher");
    expect(d.inbox.pending(`a:${m.agentId}:p:${project.id}`)).toHaveLength(1);
  });

  it("gives the new agents identity, Permissions by archetype and Skills, and lists the team in GET /api/org", async () => {
    const { body } = await launch({ plan: await balancedPlan(), nonce: "nonce-0006" });
    const d = await db();
    const pm = d.projects.get(body.projectId)!.leadAgentId!;
    const req = (url: string) => new Request(`http://localhost${url}`);

    const { GET: identity } = await import("@/app/api/agents/[id]/identity/route");
    const id = await identity(req(`/api/agents/${pm}/identity`), { params: Promise.resolve({ id: pm }) });
    expect(id.status).toBe(200);
    const files = (await id.json()) as { type: string; soul: { content: string } };
    expect(files.type).toBe("lead");
    expect(files.soul.content).toContain("#onboarding-revamp");

    const { GET: rules } = await import("@/app/api/rules/route");
    const r = await rules(req(`/api/rules?agent=${pm}`));
    expect(r.status).toBe(200);
    const asLead = await rules(req("/api/rules?agent=nobody&archetype=lead"));
    const ids = async (res: Response) => ((await res.json()) as { permissions: { id: string; inToolset: boolean }[] }).permissions.map((p) => `${p.id}:${p.inToolset}`);
    expect(await ids(r)).toEqual(await ids(asLead));

    const { GET: skills } = await import("@/app/api/skills/route");
    const s = await skills(req(`/api/skills?agent=${pm}`));
    expect(s.status).toBe(200);
    expect(((await s.json()) as { entry: { id: string } }[]).map((h) => h.entry.id)).toEqual(d.agents.get(pm)!.config.composition!.skills);

    const { GET: org } = await import("@/app/api/org/route");
    const o = (await (await org()).json()) as { teams: { id: string; channel: string; leadId: string; agents: { id: string }[] }[] };
    expect(o.teams).toHaveLength(1);
    expect(o.teams[0]).toMatchObject({ id: body.projectId, channel: "onboarding-revamp", leadId: pm });
    expect(o.teams[0].agents.map((a) => a.id)[0]).toBe(pm);
  });
});
