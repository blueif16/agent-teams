import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentVault } from "@/lib/agent-files";
import { loadLibrary } from "@/lib/skills/library";
import { getServerCache } from "@/server/cache";
import { readState } from "@/server/project-state";
import { provision } from "@/server/setup/provision";
import { openCheckpointer } from "./checkpointer";
import { getRuntimeDb, type AgentRow, type RuntimeDb } from "./db";
import { Runtime } from "./index";
import { tempEnv, type TempEnv } from "./testing/env";
import { fakeCrusoe, systemOf, textOf, type ChatRequest, type Step, type Turn } from "./testing/fake-crusoe";
import { threadId } from "./threads";

/*
 * A launched team works on its own, with no tokens: the real Runtime, provision and project-state tools, and one
 * fake Crusoe scripted per agent. The kickoff in the PM's inbox starts its run; the PM's assign_task runs the expert
 * on the brief; the expert's report wakes the PM with the delta. Each agent's first request carries its tools.
 */
const FIXTURES = fileURLToPath(new URL("../../lib/skills/__fixtures__/skills", import.meta.url));
const DARWIN = process.platform === "darwin";

const PLAN = {
  charter: {
    kind: "project",
    name: "Pricing teardown",
    channel: "pricing-teardown",
    goal: "Compare three competitors' pricing pages",
    due: "2026-11-20",
    metric: "A table of every tier and price",
    scope: { must: ["three competitors"], wont: ["enterprise deals"] },
  },
  roster: [
    { archetype: "lead", role: "PM", need: "run the teardown", qualifications: ["planning"], composition: { skills: [] } },
    { archetype: "researcher", role: "Researcher", need: "find the pages", qualifications: ["sourcing"], composition: { skills: [] } },
    { archetype: "analyst", role: "Analyst", need: "compare prices", qualifications: ["spreadsheets"], composition: { skills: [] } },
  ],
  budgetUsd: 3,
};

let env: TempEnv;
let db: RuntimeDb;
let checkpointer: ReturnType<typeof openCheckpointer>;
let rt: Runtime | undefined;

beforeEach(async () => {
  env = await tempEnv();
  db = getRuntimeDb();
  checkpointer = openCheckpointer(path.join(env.data, "checkpoints.db"));
});
afterEach(async () => {
  await rt?.close();
  rt = undefined;
  checkpointer.db.close();
  await env.cleanup();
});

/** The agent of `archetype` on a project, from the db. */
const member = (projectId: string, archetype: string): AgentRow =>
  db.members.list(projectId).map((m) => db.agents.get(m.agentId)!).find((a) => a.archetype === archetype)!;

async function launch(nonce: string) {
  const { projectId } = await provision(PLAN, nonce, { db, library: await loadLibrary(FIXTURES), vault: await agentVault(), bus: getServerCache().bus });
  return { projectId, pm: member(projectId, "lead"), researcher: member(projectId, "researcher"), analyst: member(projectId, "analyst") };
}

/**
 * One fake Crusoe for every thread, scripted per archetype ("lead", "researcher", ...): a request goes to the agent
 * whose identity its system prompt opens with. Past its script an agent answers "Done.". `seen` keeps each agent's
 * requests in order.
 */
function crew(scripts: Partial<Record<string, Step[]>> = {}) {
  const seen = new Map<string, ChatRequest[]>();
  const route = (req: ChatRequest): Turn | Promise<Turn> => {
    const system = systemOf(req);
    const agent = db.agents.list().find((a) => system.includes(`You are ${a.name}, an AI agent`));
    const id = agent?.id ?? "?";
    seen.set(id, [...(seen.get(id) ?? []), req]);
    const step = (agent && scripts[agent.archetype]?.shift()) ?? { text: "Done." };
    return typeof step === "function" ? step(req) : step;
  };
  const fake = fakeCrusoe(Array.from({ length: 200 }, () => route));
  return { fetch: fake.fetch, seen: (a: AgentRow | string) => seen.get(typeof a === "string" ? a : a.id) ?? [] };
}

/** Polls `cond` (reading the db, not trusting the queue) until it holds. */
async function until(what: string, cond: () => boolean, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const done = (thread: string) => db.runs.byThread(thread).filter((r) => r.status === "done");
const settled = (thread: string) => db.runs.byThread(thread).every((r) => r.status !== "queued" && r.status !== "running") && !rt?.isBusy(thread);
const users = (req: ChatRequest) => req.messages.filter((m) => m.role === "user").map((m) => textOf(m.content));
const toolNames = (req: ChatRequest | undefined) => (req?.tools ?? []).map((t) => t.function.name);

describe("a launched team", () => {
  it("starts the PM with no owner message, runs the researcher on its assignment, and wakes the PM with the report", async () => {
    let projectId = "";
    const thread = (a: AgentRow) => threadId(a.id, projectId);
    const { fetch, seen } = crew({
      lead: [
        { toolCalls: [{ name: "add_task", args: { title: "Pull three pricing pages", kind: "work", acceptance: "Every tier and price of A, B and C" } }] },
        // The researcher's id is provision's pick: read when the PM gets there.
        () => ({
          toolCalls: [{ name: "assign_task", args: { id: "t1", agentId: member(projectId, "researcher").id, brief: "Find the pricing pages of A, B and C and save them to /project/pricing.md." } }],
        }),
        { text: "Assigned t1 to the researcher." },
        { text: "Got the report on t1." },
      ],
      researcher: [
        // Report only once the PM's kickoff run is over, so the report has to wake it.
        async () => {
          await rt!.idle(thread(member(projectId, "lead")));
          return { toolCalls: [{ name: "report", args: { taskId: "t1", status: "review", summary: "Saved the three pricing pages to pricing.md.", evidence: ["file:pricing.md"] } }] };
        },
        { text: "Reported t1." },
      ],
    });
    rt = new Runtime({ db, checkpointer, fetch });

    const team = await launch("nonce-team-0001");
    projectId = team.projectId;
    const pmThread = thread(team.pm);
    const researcherThread = thread(team.researcher);
    await until("the PM's second run", () => done(pmThread).length === 2 && settled(pmThread) && settled(researcherThread));

    // The kickoff started the PM: its first request carried the charter and the instruction.
    expect(db.runs.byThread(pmThread).map((r) => [r.trigger, r.status])).toEqual([
      ["kickoff", "done"],
      ["callback", "done"],
    ]);
    const pmSeen = seen(team.pm);
    expect(users(pmSeen[0]).join("\n")).toContain(PLAN.charter.goal);
    expect(users(pmSeen[0]).join("\n")).toMatch(/write the plan and assign first tasks/i);

    // assign_task delivered the brief, with its task id, to the researcher's thread, which ran on it.
    const brief = users(seen(team.researcher)[0]).join("\n");
    expect(brief).toMatch(/\bt1\b/);
    expect(brief).toContain("Find the pricing pages of A, B and C");
    expect(done(researcherThread)).toHaveLength(1);

    // The report's delta reached the PM in its second run.
    const woken = pmSeen.filter((r) => users(r).some((u) => u.includes("<state_delta")));
    expect(woken.length, "PM requests with the delta").toBeGreaterThan(0);
    expect(users(woken[0]).join("\n")).toMatch(new RegExp(`t1 review \\(${team.researcher.id}\\)`));
    expect(db.inbox.pending(pmThread)).toEqual([]);

    // The state says so too, and the analyst, never assigned, never ran.
    const state = await readState(team.projectId);
    expect(state.dag.tasks.find((t) => t.id === "t1")).toMatchObject({ owner: team.researcher.id, status: "review" });
    expect(db.runs.byThread(thread(team.analyst))).toEqual([]);
  }, 60_000);

  it("shows the PM its project state when it wakes, and its own SOUL.md", async () => {
    const { fetch, seen } = crew();
    rt = new Runtime({ db, checkpointer, fetch });
    const team = await launch("nonce-team-0002");
    const pmThread = threadId(team.pm.id, team.projectId);
    await until("the PM's kickoff run", () => done(pmThread).length === 1 && settled(pmThread));

    const [first] = seen(team.pm);
    // The digest is rendered by code from the state files: the roster provision staffed is in it.
    const state = users(first).find((u) => u.includes("<project_state"));
    expect(state, "a <project_state> digest").toBeDefined();
    expect(state).toContain(team.researcher.id);
    expect(state).toContain(team.analyst.id);
    expect(systemOf(first)).toContain(`# ${team.pm.name}'s soul`);
    expect(systemOf(first)).toContain("#pricing-teardown");
  }, 60_000);

  it("runs a kickoff that was waiting before the runtime started", async () => {
    const team = await launch("nonce-team-0003");
    const pmThread = threadId(team.pm.id, team.projectId);
    expect(db.inbox.pending(pmThread)).toHaveLength(1);

    rt = new Runtime({ db, checkpointer, fetch: crew().fetch });
    await until("the PM's kickoff run", () => done(pmThread).length === 1 && settled(pmThread));
    expect(db.inbox.pending(pmThread)).toEqual([]);
  }, 60_000);
});

describe("each agent's tools", () => {
  it("binds the PM's state tools, the experts' report and shell, and Mira's skill search, with web search for all", async () => {
    const { fetch, seen } = crew();
    rt = new Runtime({ db, checkpointer, fetch });
    const team = await launch("nonce-team-0004");
    const pmThread = threadId(team.pm.id, team.projectId);
    const researcherThread = threadId(team.researcher.id, team.projectId);
    rt.send(researcherThread, { text: "Hi" });
    rt.send("a:mira:p:dm", { text: "Hi" });
    await until("three first runs", () => [pmThread, researcherThread, "a:mira:p:dm"].every((t) => done(t).length >= 1 && settled(t)));

    const pm = toolNames(seen(team.pm)[0]);
    expect(pm).toEqual(expect.arrayContaining(["assign_task", "add_task", "web_search", "fetch_page", "find_skill"]));
    expect(pm).not.toContain("bash");
    expect(pm).not.toContain("report");

    const researcher = toolNames(seen(team.researcher)[0]);
    expect(researcher).toEqual(expect.arrayContaining(["report", "web_search", "fetch_page", "read_file"]));
    expect(researcher).not.toContain("assign_task");
    if (DARWIN) expect(researcher).toContain("bash");

    const mira = toolNames(seen("mira")[0]);
    expect(mira).toEqual(expect.arrayContaining(["find_skill", "search_skills", "web_search"]));
    expect(mira).not.toContain("assign_task");
    expect(mira).not.toContain("bash");
  }, 60_000);

  it.skipIf(!DARWIN)("gives the researcher a bash whose files are the ones read_file sees at /project/", async () => {
    const { fetch, seen } = crew({
      researcher: [
        { toolCalls: [{ name: "bash", args: { command: "echo hi > out.txt" } }] },
        { toolCalls: [{ name: "read_file", args: { file_path: "/project/out.txt" } }] },
        { text: "It says hi." },
      ],
    });
    rt = new Runtime({ db, checkpointer, fetch });
    const team = await launch("nonce-team-0005");
    const researcherThread = threadId(team.researcher.id, team.projectId);
    rt.send(researcherThread, { text: "Write hi to out.txt, then read it back." });
    await until("the researcher's run", () => done(researcherThread).length === 1 && settled(researcherThread));

    expect(readFileSync(path.join(env.data, "projects", team.projectId, "files", "out.txt"), "utf8")).toBe("hi\n");
    const requests = seen(team.researcher);
    expect(requests).toHaveLength(3);
    const read = requests[2].messages.filter((m) => m.role === "tool").at(-1);
    expect(textOf(read?.content)).toMatch(/\bhi\b/);
  }, 60_000);
});
