/*
 * Live proof against Crusoe, skipped unless CRUSOE_LIVE=1 (owner, 2026-10-17: "mira start a team with the pm, a team
 * got formed, and pm makes all the decisions and everything starts rolling"). Two owner messages to Mira; then the
 * runtime alone: start_team provisions, the kickoff wakes the PM, the PM assigns, an expert runs.
 *   CRUSOE_LIVE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run src/server/runtime/team.live.test.ts
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openCheckpointer } from "./checkpointer";
import { getRuntimeDb, type RuntimeDb } from "./db";
import { getRuntime, Runtime, setRuntime } from "./index";
import { tempEnv, type TempEnv } from "./testing/env";

vi.mock("next/server", () => ({ connection: async () => {} }));

const LIVE = process.env.CRUSOE_LIVE === "1";
const T = "a:mira:p:dm";

describe.skipIf(!LIVE)("live: Mira starts a team and the PM gets it rolling", () => {
  let env: TempEnv;
  let db: RuntimeDb;
  let checkpointer: ReturnType<typeof openCheckpointer>;
  beforeAll(async () => {
    const keys = { c: process.env.CRUSOE_API_KEY, y: process.env.YDC_API_KEY };
    env = await tempEnv();
    process.env.CRUSOE_API_KEY = keys.c;
    if (keys.y) process.env.YDC_API_KEY = keys.y;
    process.env.SKILLS_DIR = path.join(process.cwd(), "skills");
    db = getRuntimeDb();
    checkpointer = openCheckpointer(path.join(env.data, "checkpoints.db"));
    setRuntime(new Runtime({ db, checkpointer }));
  });
  afterAll(async () => {
    await getRuntime().close();
    setRuntime(null);
    checkpointer.db.close();
    await env.cleanup();
    // The team keeps working after the check passes; close waits for every run.
  }, 600_000);

  const settle = async (threadId: string, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await getRuntime().idle(threadId);
      await new Promise((r) => setTimeout(r, 1500));
      if (!getRuntime().activeRun(threadId)) return;
    }
  };

  it("start_team → PM run → assign_task → an expert runs", async () => {
    const rt = getRuntime();
    rt.send(T, { text: "Start a project: we're launching a rugged outdoor smartwatch for people who want less screen time. Size the US market and give me a dated launch plan." });
    await settle(T, 180_000);
    rt.send(T, { text: "Go, start it." });
    await settle(T, 180_000);

    const project = db.projects.list().find((p) => p.id !== "dm" && p.kind !== "dm");
    console.log("PROJECT", project?.id, project?.name);
    expect(project).toBeTruthy();
    const members = db.members.list(project!.id);
    const threads = members.map((m) => `a:${m.agentId}:p:${project!.id}`);
    console.log("MEMBERS", members.map((m) => `${m.agentId}:${m.role}`).join(", "));

    // The PM's kickoff run, then whatever it assigned.
    const deadline = Date.now() + 420_000;
    let expertRuns = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      expertRuns = threads.slice(1).filter((t) => db.runs.byThread(t).length > 0).length;
      if (expertRuns > 0) break;
    }
    for (const t of threads) {
      const msgs = db.messages.page(t, { limit: 50 }).messages;
      console.log(`--- ${t}\n` + msgs.map((m) => `${m.role}/${m.author}: ${m.text.slice(0, 300)}`).join("\n"));
    }
    expect(expertRuns).toBeGreaterThan(0);
  }, 900_000);
});
