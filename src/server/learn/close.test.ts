import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLedger, type CallEvent } from "@/lib/ledger";
import { getRuntimeDb } from "@/server/runtime/db";
import { fakeCrusoe, textOf, type ChatRequest, type Turn } from "@/server/runtime/testing/fake-crusoe";
import { tempEnv, type TempEnv } from "@/server/runtime/testing/env";
import { closeProject } from "./close";
import { FEEDBACK, PID, seedProject, SKILL, vaultReader } from "./test-kit";

/*
 * The learning step at project close (test-mode design §7b), against a real vault (git), a real runtime db and the
 * real ledger in a temp DATA_DIR, with the fake model. Commits are read back with the git CLI, so a test can't pass by
 * trusting the close's own summary. The seeded project is in ./test-kit.ts.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const PRICE_REF = "rubric:landing-copy/prices_supported@v2";
const REDO_REF = "order:redo@40";

let env: TempEnv;
let vault: ReturnType<typeof vaultReader>;
const head = () => vault.head();
const commitsSince = (since: string) => vault.commitsSince(since);
const vaultFile = (p: string) => vault.file(p);

async function seed() {
  vault = vaultReader(await seedProject());
}

/** The model, scripted per step and agent from the `step:` and `agent:` lines the close puts in each request. */
type Script = { retro?: unknown; dream?: Record<string, unknown>; skill?: Record<string, unknown> };
function model(script: Script) {
  const answer = (req: ChatRequest): Turn => {
    const user = req.messages.filter((m) => m.role === "user").map((m) => textOf(m.content)).join("\n");
    const step = /^step: (\w+)$/m.exec(user)?.[1];
    const agent = /^agent: (\S+)$/m.exec(user)?.[1] ?? "";
    const out = step === "retro" ? script.retro : step === "dream" ? script.dream?.[agent] : step === "skill" ? script.skill?.[agent] : undefined;
    return { text: JSON.stringify(out ?? {}) };
  };
  return fakeCrusoe(Array.from({ length: 20 }, () => answer));
}

const RETRO = {
  kind: "product-launch-kit",
  lines: [
    { section: "wrong", text: "The landing copy shipped a number the facts sheet doesn't have", evidence: ["F1", "O1"] },
    { section: "slow", text: "The work phase ran half again as long as the run before", evidence: ["S1"] },
    { section: "well", text: "Kickoff went smoothly", evidence: [] },
  ],
};
const DREAMS = {
  pam: { ops: [{ op: "add", section: "Best approaches", text: "Check each deliverable against its rubric before it goes to the owner", evidence: ["F1"] }] },
  wren: { ops: [{ op: "add", section: "Mistakes", text: "Put a number in the hero that the facts sheet doesn't support", evidence: ["F1", "O1"] }] },
};
const SKILLS = {
  pam: { edits: [{ skill: "project-planning", old: "", new: "- Review every deliverable against its rubric before handing it over.", evidence: ["F1"] }] },
  wren: { edits: [{ skill: "copywriting", old: "", new: "- Check every number in the copy against the facts sheet; drop any that isn't there.", evidence: ["F1"] }] },
};

beforeEach(async () => {
  env = await tempEnv();
  await seed();
});
afterEach(async () => {
  await env.cleanup();
});

describe("closeProject", () => {
  it("commits one retro, one dream per member, a skill edit only for the author of the failed item, and one composition", async () => {
    const before = head();
    const fake = model({ retro: RETRO, dream: DREAMS, skill: SKILLS });

    const summary = await closeProject(PID, { feedback: FEEDBACK, fetch: fake.fetch });

    const commits = commitsSince(before);
    const touching = (re: RegExp) => commits.filter((c) => c.files.some((f) => re.test(f)));
    expect(commits).toHaveLength(5);
    expect(touching(/^projects\/p_launch01\/state\/retro\.md$/)).toHaveLength(1);
    expect(touching(/^agents\/pam\/MEMORY\.md$/)).toHaveLength(1);
    expect(touching(/^agents\/wren\/MEMORY\.md$/)).toHaveLength(1);
    expect(touching(/\/skills\//).map((c) => c.files)).toEqual([["agents/wren/skills/copywriting/SKILL.md"]]);
    expect(touching(/^company\/compositions\/product-launch-kit\/p_launch01\.md$/)).toHaveLength(1);
    // Nothing outside the project's own files, its members' homes and the new composition note.
    expect(commits.flatMap((c) => c.files).filter((f) => f.startsWith("skills/") || f.includes("p_other"))).toEqual([]);

    for (const c of commits) {
      expect(c.trailers.Project, c.subject).toEqual([PID]);
      expect(c.trailers.Evidence, c.subject).toContain(PRICE_REF);
    }
    expect(touching(/retro\.md$/)[0].trailers.Evidence).toContain(REDO_REF);
    expect(touching(/MEMORY\.md$/).map((c) => c.trailers.Source)).toEqual([["dream"], ["dream"]]);

    expect(await vaultFile("agents/wren/MEMORY.md")).toContain("Put a number in the hero that the facts sheet doesn't support");
    expect(await vaultFile("agents/wren/skills/copywriting/SKILL.md")).toContain("Check every number in the copy against the facts sheet");
    expect(await vaultFile("skills/writer/copywriting/SKILL.md")).not.toContain("facts sheet");
    // Code-computed numbers: this project's two calls only, not the other project's.
    const retro = await vaultFile(`projects/${PID}/state/retro.md`);
    expect(retro).toContain("$0.0123");
    expect(retro).toContain("The landing copy shipped a number the facts sheet doesn't have");

    expect(summary.closed).toBe(true);
    expect(summary.commits.map((c) => c.step).sort()).toEqual(["composition", "dream", "dream", "retro", "skill"]);
    // The uncited retro line was dropped and said so.
    expect(summary.skipped).toContainEqual(expect.objectContaining({ step: "retro", reason: expect.stringMatching(/evidence/) }));
    // usd is what the close's own calls cost, as the ledger recorded them.
    const learned = (await readLedger()).filter((e): e is CallEvent => e.t === "call" && e.run === `close:${PID}`);
    expect(learned).toHaveLength(fake.requests.length);
    expect(summary.usd).toBeGreaterThan(0);
    expect(summary.usd).toBeCloseTo(learned.reduce((s, e) => s + e.cost, 0), 10);
    const row = getRuntimeDb().projects.get(PID)!;
    expect(row.status).toBe("done");
    expect(row.closedAt).not.toBeNull();
  });

  it("drops dream ops without evidence, with unknown evidence, duplicates, and those over the cap, and lists each", async () => {
    const add = (text: string, evidence = ["F1"]) => ({ op: "add", section: "Best approaches", text, evidence });
    const ops = [
      add("Ask the owner which facts are fair game before drafting", []),
      add("Keep a list of the claims the copy makes", ["F9"]),
      add("Asked the PM for the facts sheet before drafting"),
      ...["one", "two", "three", "four", "five", "six"].map((n) => add(`Lesson ${n}: tie each claim to a fact`)),
    ];
    const before = head();

    const summary = await closeProject(PID, { feedback: FEEDBACK, fetch: model({ retro: RETRO, dream: { pam: DREAMS.pam, wren: { ops } } }).fetch });

    const wren = summary.skipped.filter((s) => s.step === "dream" && s.agentId === "wren");
    expect(wren.map((s) => s.reason)).toEqual([
      expect.stringMatching(/no evidence/),
      expect.stringMatching(/unknown evidence/),
      expect.stringMatching(/duplicate/),
      expect.stringMatching(/cap/),
    ]);
    expect(wren[3].item).toContain("Lesson six");
    const memory = await vaultFile("agents/wren/MEMORY.md");
    expect(memory.match(/Lesson \w+: tie each claim/g)).toHaveLength(5);
    expect(memory).not.toContain("fair game");
    expect(memory).not.toContain("list of the claims");
    expect(memory.match(/Asked the PM for the facts sheet/g)).toHaveLength(1);
    // Still one dream commit for the agent.
    expect(commitsSince(before).filter((c) => c.files.includes("agents/wren/MEMORY.md"))).toHaveLength(1);
  });

  it("refuses a learning edit that carries the client's price from the charter, and commits nothing for that agent", async () => {
    const before = head();
    const leaky = { ops: [{ op: "add", section: "Best approaches", text: "Quote the $49/month price in the hero", evidence: ["F1"] }] };

    const summary = await closeProject(PID, { feedback: FEEDBACK, fetch: model({ retro: RETRO, dream: { pam: DREAMS.pam, wren: leaky }, skill: SKILLS }).fetch });

    const files = commitsSince(before).flatMap((c) => c.files);
    expect(files.filter((f) => f.startsWith("agents/wren/"))).toEqual([]);
    expect(files).toContain("agents/pam/MEMORY.md");
    expect(await vaultFile("agents/wren/MEMORY.md")).not.toContain("$49");
    expect(summary.skipped).toContainEqual(expect.objectContaining({ step: "dream", agentId: "wren", reason: expect.stringMatching(/leak/) }));
  });

  it("refuses an edit that names a configured fact, such as a competitor", async () => {
    const before = head();
    const leaky = { ops: [{ op: "add", section: "Best approaches", text: "Benchmark the copy against gong's landing page", evidence: ["F1"] }] };

    const summary = await closeProject(PID, {
      feedback: FEEDBACK,
      facts: ["Gong"],
      fetch: model({ retro: RETRO, dream: { pam: leaky, wren: DREAMS.wren }, skill: SKILLS }).fetch,
    });

    const files = commitsSince(before).flatMap((c) => c.files);
    expect(files.filter((f) => f.startsWith("agents/pam/"))).toEqual([]);
    expect(files).toContain("agents/wren/MEMORY.md");
    expect(summary.skipped).toContainEqual(expect.objectContaining({ step: "dream", agentId: "pam", reason: expect.stringMatching(/leak/) }));
  });

  it("drops skill edits that don't cite the agent's own failed item, aren't its own copy, or are too big", async () => {
    const before = head();
    const edits = [
      { skill: "copywriting", old: "", new: "- A lesson that cites only the slow phase.", evidence: ["S1"] },
      { skill: "brand-voice", old: "", new: "- A lesson for a skill Wren doesn't have.", evidence: ["F1"] },
      { skill: "copywriting", old: "", new: `- ${"Too long. ".repeat(120)}`, evidence: ["F1"] },
      { skill: "copywriting", old: "name: copywriting", new: "name: renamed", evidence: ["F1"] },
    ];

    const summary = await closeProject(PID, { feedback: FEEDBACK, fetch: model({ retro: RETRO, dream: DREAMS, skill: { wren: { edits } } }).fetch });

    expect(summary.skipped.filter((s) => s.step === "skill").map((s) => s.reason)).toEqual([
      expect.stringMatching(/failed item or 🔁/),
      expect.stringMatching(/own cop/),
      expect.stringMatching(/size/),
      expect.stringMatching(/frontmatter/),
    ]);
    expect(commitsSince(before).flatMap((c) => c.files).filter((f) => f.includes("/skills/"))).toEqual([]);
    expect(await vaultFile("agents/wren/skills/copywriting/SKILL.md")).toBe(SKILL("copywriting", "Write benefit-led copy"));
  });

  it("leaves the project open when a step fails, and a retry commits only what is missing", async () => {
    const before = head();
    const good = model({ retro: RETRO, dream: DREAMS, skill: SKILLS });
    const broken = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("step: dream") && body.includes("agent: wren")) return Response.json({ error: { message: "upstream is down" } }, { status: 400 });
      return good.fetch(input, init);
    }) as typeof fetch;

    const first = await closeProject(PID, { feedback: FEEDBACK, fetch: broken });

    expect(first.closed).toBe(false);
    expect(getRuntimeDb().projects.get(PID)!.status).toBe("active");
    expect(first.skipped).toContainEqual(expect.objectContaining({ step: "dream", agentId: "wren", reason: expect.stringMatching(/^error/) }));

    const second = await closeProject(PID, { feedback: FEEDBACK, fetch: good.fetch });

    expect(second.closed).toBe(true);
    expect(second.commits.map((c) => `${c.step}:${c.agentId}`)).toEqual(["dream:wren"]);
    // Across both closes, each learning file was committed once.
    expect(commitsSince(before)).toHaveLength(5);
  });

  it("is a no-op the second time: no model call, no commit", async () => {
    const fake = model({ retro: RETRO, dream: DREAMS, skill: SKILLS });
    await closeProject(PID, { feedback: FEEDBACK, fetch: fake.fetch });
    const before = head();
    const calls = fake.requests.length;

    const again = await closeProject(PID, { feedback: FEEDBACK, fetch: fake.fetch });

    expect(commitsSince(before)).toEqual([]);
    expect(fake.requests.length).toBe(calls);
    expect(again).toMatchObject({ closed: true, commits: [], usd: 0 });
    expect(again.skipped).toContainEqual(expect.objectContaining({ step: "close", reason: expect.stringMatching(/already closed/) }));
  });
});
