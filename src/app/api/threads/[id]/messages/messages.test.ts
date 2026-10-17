import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openCheckpointer } from "@/server/runtime/checkpointer";
import { openRuntimeDb, type MessagePage, type NewMessage, type RuntimeDb } from "@/server/runtime/db";
import { Runtime, setRuntime } from "@/server/runtime";
import { tempEnv, type TempEnv } from "@/server/runtime/testing/env";
import { fakeCrusoe } from "@/server/runtime/testing/fake-crusoe";
import { GET as getProjectMessages } from "@/app/api/projects/[id]/messages/route";
import { GET } from "./route";

// Outside a Next request, connection() throws; the routes only call it to stay dynamic.
vi.mock("next/server", () => ({ connection: async () => {} }));

/*
 * The transcript over HTTP: GET /api/threads/[id]/messages for one thread, GET /api/projects/[id]/messages for every
 * member thread of a project (a channel) merged in the order it was said. Both page back with ?before=<id>.
 */
const T = "a:mira:p:dm";
let env: TempEnv;
let db: RuntimeDb;
let checkpointer: ReturnType<typeof openCheckpointer>;

beforeEach(async () => {
  env = await tempEnv();
  db = openRuntimeDb(path.join(env.data, "runtime.db"));
  checkpointer = openCheckpointer(path.join(env.data, "checkpoints.db"));
  setRuntime(new Runtime({ db, checkpointer, fetch: fakeCrusoe().fetch }));
});
afterEach(async () => {
  setRuntime(null);
  checkpointer.db.close();
  db.close();
  await env.cleanup();
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const say = (threadId: string, role: NewMessage["role"], author: string, text: string) => db.messages.add({ threadId, role, author, text });

async function thread(id: string, query = "") {
  const res = await GET(new Request(`http://localhost/api/threads/${id}/messages${query}`), ctx(id));
  return { status: res.status, body: (await res.json()) as MessagePage };
}
async function project(id: string, query = "") {
  const res = await getProjectMessages(new Request(`http://localhost/api/projects/${id}/messages${query}`), ctx(id));
  return { status: res.status, body: (await res.json()) as MessagePage };
}

describe("GET /api/threads/[id]/messages", () => {
  it("returns the thread's messages oldest first, with their uploads", async () => {
    db.messages.add({ threadId: T, role: "owner", author: "owner", text: "Here's the mockup", uploads: ["a".repeat(64) + ".png"] });
    say(T, "agent", "mira", "The header is crowded.");
    say(T, "owner", "owner", "Fix it?");

    const { status, body } = await thread(T);
    expect(status).toBe(200);
    expect(body.messages.map((m) => [m.role, m.author, m.text])).toEqual([
      ["owner", "owner", "Here's the mockup"],
      ["agent", "mira", "The header is crowded."],
      ["owner", "owner", "Fix it?"],
    ]);
    expect(body.messages[0].uploads).toEqual(["a".repeat(64) + ".png"]);
    expect(body.more).toBe(false);
  });

  it("serves the latest 200 by default and pages back from ?before=<id>", async () => {
    for (let i = 0; i < 205; i++) say(T, i % 2 ? "agent" : "owner", i % 2 ? "mira" : "owner", `m${i}`);

    const latest = await thread(T);
    expect(latest.body.messages).toHaveLength(200);
    expect(latest.body.messages[0].text).toBe("m5");
    expect(latest.body.messages.at(-1)?.text).toBe("m204");
    expect(latest.body.more).toBe(true);

    const older = await thread(T, `?before=${latest.body.messages[0].id}`);
    expect(older.body.messages.map((m) => m.text)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(older.body.more).toBe(false);

    const two = await thread(T, `?before=${latest.body.messages[0].id}&limit=2`);
    expect(two.body.messages.map((m) => m.text)).toEqual(["m3", "m4"]);
    expect(two.body.more).toBe(true);
  });

  it("answers 404 for a thread the runtime doesn't have", async () => {
    expect((await thread("a:ghost:p:dm")).status).toBe(404);
  });
});

describe("GET /api/projects/[id]/messages", () => {
  it("merges every member's thread in the order it was said, each agent as itself", async () => {
    db.projects.create({ id: "p1", kind: "team", name: "Tern launch", status: "active" });
    for (const [id, archetype] of [
      ["pat", "lead"],
      ["rae", "researcher"],
    ] as const) {
      db.agents.create({ id, name: id, archetype });
      db.members.add({ projectId: "p1", agentId: id });
      db.threads.ensure(id, "p1");
    }
    const pm = "a:pat:p:p1";
    const expert = "a:rae:p:p1";
    say(pm, "owner", "owner", "Kick off the launch.");
    say(pm, "agent", "pat", "Plan is up; Rae sizes the market.");
    say(T, "owner", "owner", "Not in the channel.");
    say(expert, "agent", "rae", "US market: $2.1B.");
    say(expert, "owner", "owner", "@rae source?");

    const { status, body } = await project("p1");
    expect(status).toBe(200);
    expect(body.messages.map((m) => [m.threadId, m.author, m.text])).toEqual([
      [pm, "owner", "Kick off the launch."],
      [pm, "pat", "Plan is up; Rae sizes the market."],
      [expert, "rae", "US market: $2.1B."],
      [expert, "owner", "@rae source?"],
    ]);

    const older = await project("p1", `?before=${body.messages[2].id}&limit=1`);
    expect(older.body.messages.map((m) => m.text)).toEqual(["Plan is up; Rae sizes the market."]);
    expect(older.body.more).toBe(true);
  });

  it("answers 404 for a project the runtime doesn't have", async () => {
    expect((await project("p_ghost")).status).toBe(404);
  });
});
