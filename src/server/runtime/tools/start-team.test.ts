import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openCheckpointer } from "../checkpointer";
import { getRuntimeDb, type RuntimeDb } from "../db";
import { tempEnv, type TempEnv } from "../testing/env";
import { fakeCrusoe, textOf } from "../testing/fake-crusoe";
import { buildWorker } from "../worker";

vi.mock("next/server", () => ({ connection: async () => {} }));

/*
 * Owner, 2026-10-17: "why can't we just have a tool that's called start a team with a PM". Mira starts the team
 * herself: one call staffs the option from the skill library and provisions it (project, PM, experts, channel,
 * the PM's kickoff), the same path as the Launch button.
 */
let env: TempEnv;
let db: RuntimeDb;
let checkpointer: ReturnType<typeof openCheckpointer>;

beforeEach(async () => {
  env = await tempEnv();
  process.env.SKILLS_DIR = path.join(process.cwd(), "src/lib/skills/__fixtures__/skills");
  db = getRuntimeDb();
  checkpointer = openCheckpointer(path.join(env.data, "checkpoints.db"));
});
afterEach(async () => {
  checkpointer.db.close();
  delete process.env.SKILLS_DIR;
  await env.cleanup();
});

const team = {
  name: "Watch US launch",
  channel: "watch-us-launch",
  goal: "Size the US market for the rugged watch and ship a dated launch plan by 2026-11-14",
  due: "2026-11-14",
  open: ["Which price band?"],
  option: {
    label: "Balanced",
    summary: "A PM runs research and analysis in parallel",
    kind: "project",
    roles: [
      { archetype: "researcher", role: "Market researcher", need: "size the US segments", qualifications: ["market sizing"] },
      { archetype: "analyst", role: "Data analyst", need: "model the TAM", qualifications: ["spreadsheets"] },
    ],
    budgetUsd: 6,
    etaDays: 7,
  },
};

describe("start_team (Mira)", () => {
  it("creates the project with a PM first and the experts, and leaves the PM's kickoff in its inbox", async () => {
    const fake = fakeCrusoe([{ toolCalls: [{ name: "start_team", args: team }] }, { text: "Started." }]);
    const mira = buildWorker(db.agents.get("mira")!, db.projects.get("dm")!, { checkpointer, fetch: fake.fetch });
    await mira.invoke({ messages: [{ role: "user", content: "Go, start it." }] });

    const project = db.projects.list().find((p) => p.name === team.name);
    expect(project).toBeTruthy();
    const members = db.members.list(project!.id).map((m) => db.agents.get(m.agentId)!.archetype);
    expect(members).toEqual(["lead", "researcher", "analyst"]);
    const pm = db.members.list(project!.id)[0].agentId;
    expect(db.inbox.pending(`a:${pm}:p:${project!.id}`)).toHaveLength(1);
    const result = fake.requests[1].messages.find((m) => m.role === "tool");
    expect(textOf(result?.content)).toContain("#watch-us-launch");
  }, 60_000);

  it("is idempotent: the same call twice makes one team", async () => {
    const fake = fakeCrusoe([
      { toolCalls: [{ name: "start_team", args: team }] },
      { toolCalls: [{ name: "start_team", args: team }] },
      { text: "Started." },
    ]);
    const mira = buildWorker(db.agents.get("mira")!, db.projects.get("dm")!, { checkpointer, fetch: fake.fetch });
    await mira.invoke({ messages: [{ role: "user", content: "Go." }] });
    expect(db.projects.list().filter((p) => p.name === team.name)).toHaveLength(1);
  }, 60_000);
});
