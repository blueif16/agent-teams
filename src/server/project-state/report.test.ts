import { describe, expect, it, vi } from "vitest";
import { addMember, leadTools, takeDeltas, workerTools, type StateDelta } from "./index";
import { call, tempProject } from "./test-kit";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/*
 * M2 (F §10.2): the worker's report lands in the lead's DAG and roster, files the report, and hands the lead a
 * <state_delta> line, all as one vault commit (G §2.4).
 */
const PID = "p_42";
const PM = "pm-p_42";
const S = (f: string) => `projects/${PID}/state/${f}`;
const R = (f: string) => `projects/${PID}/files/reports/${f}`;
const { commits, file } = tempProject();

let clock = Date.parse("2026-10-17T15:00:00Z");
const now = () => new Date((clock += 60_000));

/** The F sample: seven tasks, t7 assigned to ana, and Q-2 open for the owner. */
async function pricingProject() {
  await addMember(PID, { agentId: "ana", role: "writer", archetype: "writer", thread: "ana-p_42" }, { now });
  await addMember(PID, { agentId: "bo", role: "designer", archetype: "designer" }, { now });
  const lead = leadTools(PID, PM, { now, dispatch: () => undefined });
  for (let i = 1; i <= 7; i++) await call(lead, "add_task", { title: i === 7 ? "Draft pricing page copy" : `Task ${i}`, kind: "work", acceptance: "3 tiers" });
  await call(lead, "assign_task", { id: "t7", agentId: "ana", brief: "Draft the three tiers." });
  await call(lead, "raise_item", { kind: "question", text: "Which tiers?", askOf: "owner" });
  await call(lead, "raise_item", { kind: "question", text: "Final names for the three tiers?", askOf: "owner", links: ["t7"] });
  return lead;
}

const json = async (f: string) => JSON.parse((await file(S(f)))!);

describe("report", () => {
  it("puts a blocked report on t7 into the DAG and ana's roster entry, files it, and ends the lead's thread with the delta line", async () => {
    await pricingProject();
    const leadThread: string[] = ["…earlier messages"];
    const [report] = workerTools(PID, "ana", { now, notifyLead: (d) => void leadThread.push(d.line) });

    const out = await call([report], "report", { taskId: "t7", status: "blocked", summary: "v1 Pro/Team done; Free tier blocked on naming", evidence: [], blocker: { text: "needs final tier names", on: "Q-2" } });

    expect(out.error).toBeUndefined();
    const t7 = (await json("dag.json")).tasks.find((t: { id: string }) => t.id === "t7");
    expect(t7).toMatchObject({ status: "blocked", owner: "ana", blocker: { text: "needs final tier names", on: "Q-2" } });
    expect(t7.lastReport).toMatchObject({ by: "ana", status: "blocked", summary: "v1 Pro/Team done; Free tier blocked on naming", ref: R("t7-01.md") });
    const ana = (await json("roster.json")).members.find((m: { agentId: string }) => m.agentId === "ana");
    expect(ana).toMatchObject({ state: "blocked", blockers: [{ text: "needs final tier names", on: "Q-2", task: "t7" }] });
    expect(ana.lastCheckIn).toBe(t7.lastReport.at);
    expect(ana.lastReport).toContain("Free tier blocked on naming");
    expect(await file(R("t7-01.md"))).toContain("v1 Pro/Team done; Free tier blocked on naming");
    expect(leadThread.at(-1)).toBe(`<state_delta rev="${out.rev}">t7 blocked (ana): "v1 Pro/Team done; Free tier blocked on naming" · on Q-2 · report ${R("t7-01.md")}</state_delta>`);
  });

  it("is exactly one commit touching dag.json, roster.json, the report file and the journal, with the report's trailers", async () => {
    await pricingProject();
    const before = commits().length;
    const [report] = workerTools(PID, "ana", { now, notifyLead: () => undefined });

    const out = await call([report], "report", { taskId: "t7", status: "review", summary: "Draft ready for review", evidence: ["file:projects/p_42/files/copy-v1.md"] });

    const made = commits().slice(before);
    expect(made).toHaveLength(1);
    expect(made[0].files.sort()).toEqual([R("t7-01.md"), S("dag.json"), S("journal/1.md"), S("roster.json")].sort());
    expect(made[0].trailers).toMatchObject({ Source: ["report"], Tool: ["report"], Task: ["t7"], Rev: [String(out.rev)], Project: [PID], Agent: ["ana"], Evidence: ["file:projects/p_42/files/copy-v1.md"] });
    expect(made[0].author).toBe("ana <ana@agents.agent-teams.local>");
    expect(made[0].subject).toMatch(/^state\(p_42\): t7 in_progress -> review/);
  });

  it("refuses a report on a task the worker doesn't own, writing nothing and telling the lead nothing", async () => {
    await pricingProject();
    const before = { commits: commits().length, dag: await file(S("dag.json")) };
    const told: StateDelta[] = [];
    const [report] = workerTools(PID, "bo", { now, notifyLead: (d) => void told.push(d) });

    const out = await call([report], "report", { taskId: "t7", status: "progress", summary: "Started", evidence: [] });

    expect(out.error).toBe("not_owner");
    expect(commits()).toHaveLength(before.commits);
    expect(await file(S("dag.json"))).toBe(before.dag);
    expect(told).toEqual([]);
  });

  it("refuses a done report without evidence", async () => {
    await pricingProject();
    const before = commits().length;
    const [report] = workerTools(PID, "ana", { now, notifyLead: () => undefined });

    expect((await call([report], "report", { taskId: "t7", status: "done", summary: "Finished", evidence: [] })).error).toBe("evidence_required");
    expect(commits()).toHaveLength(before);
  });

  it("refuses a blocked report without a blocker", async () => {
    await pricingProject();
    const [report] = workerTools(PID, "ana", { now, notifyLead: () => undefined });
    expect((await call([report], "report", { taskId: "t7", status: "blocked", summary: "Stuck", evidence: [] })).error).toBe("blocker_required");
  });

  it("clears the blocker from the task and the roster when the worker reports progress again, and numbers each report", async () => {
    await pricingProject();
    const [report] = workerTools(PID, "ana", { now, notifyLead: () => undefined });
    await call([report], "report", { taskId: "t7", status: "blocked", summary: "Waiting on names", evidence: [], blocker: { text: "names", on: "Q-2" } });

    await call([report], "report", { taskId: "t7", status: "progress", summary: "Names in; drafting Free", evidence: [] });

    const t7 = (await json("dag.json")).tasks.find((t: { id: string }) => t.id === "t7");
    expect(t7).toMatchObject({ status: "in_progress", blocker: null, lastReport: { ref: R("t7-02.md") } });
    expect((await json("roster.json")).members.find((m: { agentId: string }) => m.agentId === "ana")).toMatchObject({ state: "working", blockers: [] });
    expect(await file(R("t7-01.md"))).toContain("Waiting on names");
  });

  it("keeps the delta for the lead in takeDeltas when no notifyLead is wired", async () => {
    await pricingProject();
    const [report] = workerTools(PID, "ana", { now });

    const out = await call([report], "report", { taskId: "t7", status: "progress", summary: "Halfway", evidence: [] });

    expect(takeDeltas(PID)).toEqual([{ projectId: PID, rev: out.rev, taskId: "t7", line: expect.stringMatching(/^<state_delta rev="\d+">t7 progress \(ana\): "Halfway"/) }]);
    expect(takeDeltas(PID)).toEqual([]);
  });
});
