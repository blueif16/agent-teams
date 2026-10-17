import { describe, expect, it, vi } from "vitest";
import { record } from "@/lib/ledger";
import { getVault, OWNER } from "@/server/runtime/vault";
import { addMember, leadTools, type DispatchRequest } from "./index";
import { call, tempProject } from "./test-kit";

// Real git: every tool call is a commit, and some tests make dozens.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/*
 * M1 (F §10.1): the lead's state tools against a real temp vault. The rules are the feature: a minimal version that
 * writes JSON without checks passes none of the refusal tests below.
 */
const PID = "p_42";
const PM = "pm-p_42";
const S = (f: string) => `projects/${PID}/state/${f}`;
const { commits, file } = tempProject();

let clock = Date.parse("2026-10-17T15:00:00Z");
const now = () => new Date((clock += 60_000));

async function team(deps: Parameters<typeof leadTools>[2] = {}) {
  await addMember(PID, { agentId: "ana", role: "writer", archetype: "writer", thread: "ana-p_42" }, { now });
  await addMember(PID, { agentId: "bo", role: "designer", archetype: "designer" }, { now });
  return leadTools(PID, PM, { now, ...deps });
}

const dag = async () => JSON.parse((await file(S("dag.json")))!) as { rev: number; tasks: { id: string; status: string; owner: string | null; deps: string[]; evidence: string[]; brief?: string; rev: number }[] };
const task = async (id: string) => (await dag()).tasks.find((t) => t.id === id)!;

/** Asserts a refusal changed nothing: no new commit, dag.json byte-identical. */
async function unchanged(before: { commits: number; dag: string | null }) {
  expect(commits()).toHaveLength(before.commits);
  expect(await file(S("dag.json"))).toBe(before.dag);
}
const snapshot = async () => ({ commits: commits().length, dag: await file(S("dag.json")) });

describe("add_task", () => {
  it("adds a task as one vault commit on dag.json and the journal, and returns its id, the rev and a recite line", async () => {
    const lead = await team();
    const before = commits().length;

    const out = await call(lead, "add_task", { title: "Draft pricing page copy", kind: "work", acceptance: "3 tiers", owner: "ana" });

    expect(out.error).toBeUndefined();
    expect(out.id).toBe("t1");
    expect(out.recite).toMatch(new RegExp(`^DAG r${out.rev} · 0/1 done`));
    const made = commits().slice(before);
    expect(made).toHaveLength(1);
    expect(made[0].files.sort()).toEqual([S("dag.json"), S("journal/1.md")]);
    expect(made[0].subject).toMatch(/^state\(p_42\): /);
    expect((await task("t1")).status).toBe("ready");
  });

  it("refuses an owner who is not on the roster, the pm or the owner", async () => {
    const lead = await team();
    const before = await snapshot();

    const out = await call(lead, "add_task", { title: "Copy", kind: "work", acceptance: "x", owner: "zed" });

    expect(out.error).toBe("unknown_owner");
    await unchanged(before);
  });

  it("refuses a dependency on a task that doesn't exist", async () => {
    const lead = await team();
    const before = await snapshot();

    const out = await call(lead, "add_task", { title: "Copy", kind: "work", acceptance: "x", deps: ["t9"] });

    expect(out.error).toBe("unknown_id");
    await unchanged(before);
  });

  it("refuses a 61st open task", async () => {
    const lead = await team();
    for (let i = 1; i <= 60; i++) expect((await call(lead, "add_task", { title: `Task ${i}`, kind: "todo", acceptance: "x", owner: "pm" })).error).toBeUndefined();
    const before = await snapshot();

    const out = await call(lead, "add_task", { title: "One too many", kind: "todo", acceptance: "x" });

    expect(out.error).toBe("cap_reached");
    await unchanged(before);
  });
});

describe("update_task", () => {
  async function started() {
    const lead = await team();
    const { rev } = await call(lead, "add_task", { title: "Copy", kind: "work", acceptance: "3 tiers", owner: "ana" });
    const out = await call(lead, "update_task", { id: "t1", expectedRev: rev, status: "in_progress" });
    expect(out.error).toBeUndefined();
    return { lead, rev: out.rev };
  }

  it("refuses an illegal transition and leaves dag.json as it was", async () => {
    const lead = await team();
    const { rev } = await call(lead, "add_task", { title: "Copy", kind: "work", acceptance: "x", owner: "ana" });
    const before = await snapshot();

    // ready -> review skips in_progress.
    const out = await call(lead, "update_task", { id: "t1", expectedRev: rev, status: "review" });

    expect(out.error).toBe("illegal_transition");
    expect(out.message).toMatch(/in_progress/);
    await unchanged(before);
  });

  it("refuses done without evidence, and accepts it with an evidence ref", async () => {
    const { lead, rev } = await started();
    const before = await snapshot();

    const refused = await call(lead, "update_task", { id: "t1", expectedRev: rev, status: "done" });
    expect(refused.error).toBe("evidence_required");
    await unchanged(before);

    const ok = await call(lead, "update_task", { id: "t1", expectedRev: rev, status: "done", evidence: ["file:projects/p_42/files/copy.md"] });
    expect(ok.error).toBeUndefined();
    expect(await task("t1")).toMatchObject({ status: "done", evidence: ["file:projects/p_42/files/copy.md"] });
    expect(commits().at(-1)!.trailers.Evidence).toEqual(["file:projects/p_42/files/copy.md"]);
  });

  it("refuses a dependency that would close a cycle", async () => {
    const lead = await team();
    await call(lead, "add_task", { title: "A", kind: "work", acceptance: "x" });
    await call(lead, "add_task", { title: "B", kind: "work", acceptance: "x", deps: ["t1"] });
    const { rev } = await call(lead, "add_task", { title: "C", kind: "work", acceptance: "x", deps: ["t2"] });
    const before = await snapshot();

    // t1 -> t3 -> t2 -> t1
    const out = await call(lead, "update_task", { id: "t1", expectedRev: rev, addDeps: ["t3"] });

    expect(out.error).toBe("cycle");
    expect(out.message).toMatch(/t1/);
    await unchanged(before);
  });

  it("refuses a stale expectedRev with a conflict that names the current rev, leaves the file unchanged, and accepts the retry", async () => {
    const { lead, rev } = await started();
    const stale = rev - 1;
    const before = await snapshot();

    const out = await call(lead, "update_task", { id: "t1", expectedRev: stale, status: "blocked", blocker: { text: "tier names" } });

    expect(out.error).toBe("conflict");
    expect(out.message).toContain(String(rev));
    expect(out.message).toMatch(/in_progress/);
    await unchanged(before);

    const retry = await call(lead, "update_task", { id: "t1", expectedRev: rev, status: "blocked", blocker: { text: "tier names" } });
    expect(retry.error).toBeUndefined();
    expect((await task("t1")).status).toBe("blocked");
  });

  it("refuses an expectedRev newer than any rev the project has had", async () => {
    const { lead, rev } = await started();
    const before = await snapshot();

    const out = await call(lead, "update_task", { id: "t1", expectedRev: rev + 50, status: "review" });

    expect(out.error).toBe("conflict");
    await unchanged(before);
  });

  it("makes a task ready by code once all its deps are done", async () => {
    const lead = await team();
    await call(lead, "add_task", { title: "A", kind: "work", acceptance: "x", owner: "ana" });
    const { rev } = await call(lead, "add_task", { title: "B", kind: "work", acceptance: "x", deps: ["t1"] });
    expect((await task("t2")).status).toBe("todo");

    const r1 = await call(lead, "update_task", { id: "t1", expectedRev: rev, status: "in_progress" });
    await call(lead, "update_task", { id: "t1", expectedRev: r1.rev, status: "done", evidence: ["led:2026-10-17T15:10:00.000Z/approval"] });

    expect((await task("t2")).status).toBe("ready");
  });

  it("refuses to drop a task without a reason", async () => {
    const lead = await team();
    const { rev } = await call(lead, "add_task", { title: "A", kind: "work", acceptance: "x" });
    const before = await snapshot();

    expect((await call(lead, "update_task", { id: "t1", expectedRev: rev, status: "dropped" })).error).toBe("reason_required");
    await unchanged(before);
  });

  it("refuses runtime-owned fields such as lastReport from the PM", async () => {
    const { lead, rev } = await started();
    const before = await snapshot();

    await expect(call(lead, "update_task", { id: "t1", expectedRev: rev, lastReport: { summary: "all done" } })).rejects.toThrow();
    await unchanged(before);
  });
});

describe("concurrent writes", () => {
  it("turns 25 concurrent update_task calls on different tasks into 25 commits and a dag.json holding every change", async () => {
    const lead = await team();
    let rev = 0;
    for (let i = 1; i <= 25; i++) rev = (await call(lead, "add_task", { title: `Task ${i}`, kind: "work", acceptance: "x", owner: "ana" })).rev;
    const before = commits().length;

    const outs = await Promise.all(Array.from({ length: 25 }, (_, i) => call(lead, "update_task", { id: `t${i + 1}`, expectedRev: rev, status: "in_progress" })));

    expect(outs.map((o) => o.error)).toEqual(Array(25).fill(undefined));
    const made = commits().slice(before);
    expect(made).toHaveLength(25);
    expect(made.map((c) => Number(c.trailers.Rev[0]))).toEqual(Array.from({ length: 25 }, (_, i) => rev + 1 + i));
    expect(made.map((c) => c.trailers.Task[0]).sort()).toEqual(Array.from({ length: 25 }, (_, i) => `t${i + 1}`).sort());
    const final = await dag();
    expect(final.rev).toBe(rev + 25);
    expect(final.tasks.map((t) => t.status)).toEqual(Array(25).fill("in_progress"));
    expect(new Set(final.tasks.map((t) => t.rev)).size).toBe(25);
  });
});

describe("assign_task", () => {
  it("sets owner and in_progress, stores the brief, and dispatches it to the worker", async () => {
    const sent: DispatchRequest[] = [];
    const lead = await team({ dispatch: (req) => void sent.push(req) });
    await call(lead, "add_task", { title: "Copy", kind: "work", acceptance: "3 tiers" });

    const out = await call(lead, "assign_task", { id: "t1", agentId: "ana", brief: "Draft three tiers in the owner's tone." });

    expect(out.error).toBeUndefined();
    expect(await task("t1")).toMatchObject({ owner: "ana", status: "in_progress", brief: "Draft three tiers in the owner's tone." });
    expect(sent).toEqual([expect.objectContaining({ projectId: PID, taskId: "t1", agentId: "ana", brief: "Draft three tiers in the owner's tone.", rev: out.rev })]);
    expect(commits().at(-1)!.trailers.Tool).toEqual(["assign_task"]);
  });

  it("writes nothing when the dispatch fails", async () => {
    const lead = await team({
      dispatch: () => {
        throw new Error("ana's thread is gone");
      },
    });
    await call(lead, "add_task", { title: "Copy", kind: "work", acceptance: "x" });
    const before = await snapshot();

    const out = await call(lead, "assign_task", { id: "t1", agentId: "ana", brief: "Go." });

    expect(out.error).toBe("dispatch_failed");
    await unchanged(before);
  });

  it("rejects the whole write as a conflict when dag.json is edited outside the tools between the read and the commit", async () => {
    const owners = '{"edited":"by hand"}\n';
    const lead = await team({
      // Runs after the tool read dag.json and before it commits: the owner edits the file in the vault meanwhile.
      dispatch: async () => void (await getVault().write({ path: S("dag.json"), content: owners, author: OWNER, source: "owner" })),
    });
    await call(lead, "add_task", { title: "Copy", kind: "work", acceptance: "x" });
    const before = commits().length;

    const out = await call(lead, "assign_task", { id: "t1", agentId: "ana", brief: "Go." });

    expect(out.error).toBe("conflict");
    expect(commits()).toHaveLength(before + 1); // only the owner's edit
    expect(await file(S("dag.json"))).toBe(owners);
  });

  it("refuses an agent who isn't on the roster, without dispatching", async () => {
    const sent: DispatchRequest[] = [];
    const lead = await team({ dispatch: (req) => void sent.push(req) });
    await call(lead, "add_task", { title: "Copy", kind: "work", acceptance: "x" });
    const before = await snapshot();

    expect((await call(lead, "assign_task", { id: "t1", agentId: "zed", brief: "Go." })).error).toBe("unknown_owner");
    expect(sent).toEqual([]);
    await unchanged(before);
  });
});

describe("record_decision", () => {
  it("refuses approvedBy owner without a real ledger approval, and accepts one that resolves", async () => {
    const lead = await team();
    const before = commits().length;

    const fake = await call(lead, "record_decision", { title: "Three tiers", decision: "Free, Pro, Team.", why: "Simple page.", approvedBy: "owner", approvalRef: "led:2026-10-16T21:04:11.000Z/approval" });
    expect(fake.error).toBe("approval_required");
    const missing = await call(lead, "record_decision", { title: "Three tiers", decision: "Free, Pro, Team.", why: "Simple page.", approvedBy: "owner" });
    expect(missing.error).toBe("approval_required");
    expect(commits()).toHaveLength(before);

    const at = "2026-10-17T15:30:00.000Z";
    await record({ t: "approval", at, team: "launch", agent: PM, decision: "approved" });
    const ok = await call(lead, "record_decision", { title: "Three tiers", decision: "Free, Pro, Team.", why: "Simple page.", approvedBy: "owner", approvalRef: `led:${at}/approval` });

    expect(ok.error).toBeUndefined();
    expect(ok.id).toBe("D-001");
    expect(await file(S("decisions.md"))).toContain("## D-001 · ");
    expect(commits().at(-1)!.trailers["Approved-By"]).toEqual([`owner led:${at}/approval`]);
  });

  it("refuses an owner approval ref that points at a declined approval", async () => {
    const lead = await team();
    const at = "2026-10-17T15:31:00.000Z";
    await record({ t: "approval", at, team: "launch", agent: PM, decision: "declined" });

    const out = await call(lead, "record_decision", { title: "Annual plan", decision: "Add annual.", why: "Asked.", approvedBy: "owner", approvalRef: `led:${at}/approval` });

    expect(out.error).toBe("approval_required");
  });

  it("marks the superseded decision and writes a Supersedes trailer", async () => {
    const lead = await team();
    await call(lead, "record_decision", { title: "Framer", decision: "Use Framer.", why: "Fast.", approvedBy: "pm" });

    const out = await call(lead, "record_decision", { title: "Figma", decision: "Use Figma.", why: "Team knows it.", approvedBy: "pm", supersedes: "D-001" });

    expect(out.id).toBe("D-002");
    expect(await file(S("decisions.md"))).toMatch(/## D-001 · [^\n]*\n- Status: superseded by D-002/);
    expect(commits().at(-1)!.trailers.Supersedes).toEqual(["D-002 -> D-001"]);
  });

  it("refuses a 26th active decision unless it supersedes one", async () => {
    const lead = await team();
    for (let i = 1; i <= 25; i++) expect((await call(lead, "record_decision", { title: `Rule ${i}`, decision: "d", why: "w", approvedBy: "pm" })).error).toBeUndefined();
    const before = commits().length;

    expect((await call(lead, "record_decision", { title: "Rule 26", decision: "d", why: "w", approvedBy: "pm" })).error).toBe("cap_reached");
    expect(commits()).toHaveLength(before);

    expect((await call(lead, "record_decision", { title: "Rule 26", decision: "d", why: "w", approvedBy: "pm", supersedes: "D-003" })).error).toBeUndefined();
  });
});

describe("open items, prefs, members, journal and charter", () => {
  it("raises and resolves a question, and refuses a 21st open item", async () => {
    const lead = await team();
    const q = await call(lead, "raise_item", { kind: "question", text: "Final names for the three tiers?", askOf: "owner" });
    expect(q.id).toBe("Q-1");
    expect((await call(lead, "resolve_item", { id: "Q-1", resolution: "Free, Pro, Team" })).error).toBeUndefined();
    const open = JSON.parse((await file(S("open.json")))!);
    expect(open.items[0]).toMatchObject({ id: "Q-1", status: "resolved", resolution: "Free, Pro, Team" });

    for (let i = 0; i < 20; i++) expect((await call(lead, "raise_item", { kind: "risk", text: `Risk ${i}`, askOf: "pm", severity: "low" })).error).toBeUndefined();
    expect((await call(lead, "raise_item", { kind: "risk", text: "One more", askOf: "pm" })).error).toBe("cap_reached");
  });

  it("notes an owner pref only with a source that resolves to a 📌 or an owner message", async () => {
    const lead = await team();
    const at = "2026-10-17T15:40:00.000Z";

    expect((await call(lead, "note_owner_pref", { text: "No exclamation marks.", sourceRef: `led:${at}/order` })).error).toBe("unknown_source");
    await record({ t: "order", at, team: "launch", agent: "ana", order: "pin" });
    const ok = await call(lead, "note_owner_pref", { text: "No exclamation marks.", sourceRef: `led:${at}/order` });

    expect(ok.error).toBeUndefined();
    expect(await file(S("prefs.md"))).toContain(`- P-1 No exclamation marks. (led:${at}/order)`);
  });

  it("lets the PM write only pmNote and a blocker on a member", async () => {
    const lead = await team();
    expect((await call(lead, "update_member", { agentId: "ana", pmNote: "fast; asks before guessing" })).error).toBeUndefined();
    const before = await file(S("roster.json"));

    await expect(call(lead, "update_member", { agentId: "ana", lastReport: "t7 done" })).rejects.toThrow();
    await expect(call(lead, "update_member", { agentId: "ana", state: "idle" })).rejects.toThrow();

    expect(await file(S("roster.json"))).toBe(before);
    expect(JSON.parse(before!).members[0]).toMatchObject({ agentId: "ana", pmNote: "fast; asks before guessing", lastReport: null });
  });

  it("appends a log_progress line to the journal with the rev", async () => {
    const lead = await team();
    const out = await call(lead, "log_progress", { line: "kickoff done; waiting on tier names" });
    expect(await file(S("journal/1.md"))).toMatch(new RegExp(`\\dZ r${out.rev} pm: kickoff done; waiting on tier names\\n`));
  });

  it("sets the charter only behind a real owner approval", async () => {
    const lead = await team();
    const charter = { title: "Pricing page relaunch", goal: "Ship a new pricing page.", metric: "trial to paid >= 4% over 14 days", deadline: "2026-10-28", scope: "copy, design, Stripe links", outOfScope: "annual billing", qualifications: "writer: SaaS copy", budget: "$15 model spend" };
    expect((await call(lead, "set_charter", { ...charter, approvalRef: "led:2026-10-17T15:50:00.000Z/approval" })).error).toBe("approval_required");
    expect(await file(S("charter.md"))).toBeNull();

    await record({ t: "approval", at: "2026-10-17T15:50:00.000Z", team: "launch", agent: PM, decision: "approved" });
    expect((await call(lead, "set_charter", { ...charter, approvalRef: "led:2026-10-17T15:50:00.000Z/approval" })).error).toBeUndefined();
    expect(await file(S("charter.md"))).toMatch(/^# Pricing page relaunch \(p_42\)\n[\s\S]*- Goal: Ship a new pricing page\./);
  });
});

describe("every write is one vault commit with trailers", () => {
  it("gives every state commit Source tool and Tool, Rev, Project and Agent trailers, plus Task for task tools, with revs counting up by one", async () => {
    const at = "2026-10-17T16:00:00.000Z";
    await record({ t: "approval", at, team: "launch", agent: PM, decision: "approved" });
    await record({ t: "order", at: "2026-10-17T16:01:00.000Z", team: "launch", agent: "ana", order: "pin" });
    const lead = await team({ dispatch: () => undefined });
    const before = commits().length;

    const { rev } = await call(lead, "add_task", { title: "Copy", kind: "work", acceptance: "x" });
    await call(lead, "update_task", { id: "t1", expectedRev: rev, owner: "ana" });
    await call(lead, "assign_task", { id: "t1", agentId: "ana", brief: "Go." });
    await call(lead, "record_decision", { title: "Tiers", decision: "Three.", why: "Simple.", approvedBy: "owner", approvalRef: `led:${at}/approval` });
    await call(lead, "raise_item", { kind: "question", text: "Names?", askOf: "owner", links: ["t1"] });
    await call(lead, "resolve_item", { id: "Q-1", resolution: "Free/Pro/Team" });
    await call(lead, "note_owner_pref", { text: "Calm tone.", sourceRef: "led:2026-10-17T16:01:00.000Z/order" });
    await call(lead, "update_member", { agentId: "bo", pmNote: "new" });
    await call(lead, "log_progress", { line: "all set" });
    await call(lead, "set_charter", { title: "Pricing", goal: "g", metric: "m", deadline: "2026-10-28", scope: "s", outOfScope: "o", qualifications: "q", budget: "b", approvalRef: `led:${at}/approval` });

    const made = commits().slice(before);
    const tools = ["add_task", "update_task", "assign_task", "record_decision", "raise_item", "resolve_item", "note_owner_pref", "update_member", "log_progress", "set_charter"];
    expect(made.map((c) => c.trailers.Tool)).toEqual(tools.map((t) => [t]));
    made.forEach((c, i) => {
      expect(c.trailers.Source).toEqual(["tool"]);
      expect(c.trailers.Project).toEqual([PID]);
      expect(c.trailers.Agent).toEqual([PM]);
      expect(c.trailers.Rev).toEqual([String(rev + i)]);
      expect(c.subject).toMatch(/^state\(p_42\): \S/);
      expect(c.author).toBe(`${PM} <${PM}@agents.agent-teams.local>`);
      expect(c.files).toContain(S("journal/1.md"));
    });
    expect(made.slice(0, 3).map((c) => c.trailers.Task)).toEqual([["t1"], ["t1"], ["t1"]]);
  });
});
