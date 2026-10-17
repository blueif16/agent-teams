/*
 * The approvals API, calling the route handlers directly against a test Runtime (temp db, fake Crusoe, fake
 * You.com): GET lists the pending ones for a thread, POST decides one and resumes the paused run.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/approvals/[id]/route";
import { GET } from "@/app/api/approvals/route";
import { openCheckpointer } from "@/server/runtime/checkpointer";
import { openRuntimeDb, type ApprovalRow, type RuntimeDb } from "@/server/runtime/db";
import { Runtime, setRuntime } from "@/server/runtime";
import { tempEnv, type TempEnv } from "@/server/runtime/testing/env";
import { fakeCrusoe } from "@/server/runtime/testing/fake-crusoe";

const T = "a:mira:p:dm";
let env: TempEnv;
let db: RuntimeDb;
let checkpointer: ReturnType<typeof openCheckpointer>;
let rt: Runtime;
let youCalls = 0;

beforeEach(async () => {
  env = await tempEnv();
  db = openRuntimeDb(path.join(env.data, "runtime.db"));
  checkpointer = openCheckpointer(path.join(env.data, "checkpoints.db"));
  youCalls = 0;
  const you: typeof fetch = async () => {
    youCalls++;
    return Response.json({ output: { content: "An answer [[1]].", content_type: "text", sources: [{ url: "https://example.com/a", title: "A", snippets: ["a"] }] }, warnings: [] });
  };
  rt = new Runtime({
    db,
    checkpointer,
    fetch: fakeCrusoe([{ toolCalls: [{ name: "research", args: { question: "Is the sky blue?", tier: "lite" } }] }, { text: "Done." }]).fetch,
    research: { apiKey: "ydc-test-key", fetch: you },
  });
  setRuntime(rt);
  rt.send(T, { text: "Research it." });
  await rt.idle(T);
});
afterEach(async () => {
  await rt.close();
  setRuntime(null);
  checkpointer.db.close();
  db.close();
  await env.cleanup();
});

const list = async (query: string) => {
  const res = await GET(new Request(`http://localhost/api/approvals${query}`));
  return { status: res.status, body: (await res.json()) as { approvals?: ApprovalRow[]; error?: string } };
};
const decide = async (id: string, body: unknown) => {
  const res = await POST(new Request(`http://localhost/api/approvals/${id}`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as { approval?: ApprovalRow; runId?: string; error?: string } };
};

describe("GET /api/approvals", () => {
  it("lists the thread's pending approvals", async () => {
    const { status, body } = await list(`?thread=${encodeURIComponent(T)}`);
    expect(status).toBe(200);
    expect(body.approvals?.map((a) => [a.title, a.detail, a.state])).toEqual([["Research (lite, ~$0.012)", "Is the sky blue?", "pending"]]);
  });

  it("lists a project's pending approvals", async () => {
    expect((await list("?project=dm")).body.approvals).toHaveLength(1);
    expect((await list("?project=other")).body.approvals).toEqual([]);
  });

  it("asks for a thread or a project", async () => {
    expect((await list("")).status).toBe(400);
  });
});

describe("POST /api/approvals/[id]", () => {
  it("approves: the run resumes and the call goes out once", async () => {
    const [a] = (await list(`?thread=${encodeURIComponent(T)}`)).body.approvals!;
    const { status, body } = await decide(a.id, { decision: "approve" });
    expect(status).toBe(200);
    expect(body.approval).toMatchObject({ id: a.id, state: "approved" });
    await rt.idle(T);
    expect(youCalls).toBe(1);
    expect(db.runs.get(body.runId!)?.status).toBe("done");
    expect((await list(`?thread=${encodeURIComponent(T)}`)).body.approvals).toEqual([]);
  });

  it("declines with a note", async () => {
    const [a] = (await list(`?thread=${encodeURIComponent(T)}`)).body.approvals!;
    const { status, body } = await decide(a.id, { decision: "decline", note: "Not now" });
    expect(status).toBe(200);
    expect(body.approval).toMatchObject({ state: "declined", note: "Not now" });
    await rt.idle(T);
    expect(youCalls).toBe(0);
  });

  it("refuses a bad decision (400), an unknown id (404) and a second decision (409)", async () => {
    const [a] = (await list(`?thread=${encodeURIComponent(T)}`)).body.approvals!;
    expect((await decide(a.id, { decision: "maybe" })).status).toBe(400);
    expect((await decide("ap_nope", { decision: "approve" })).status).toBe(404);
    expect((await decide(a.id, { decision: "approve" })).status).toBe(200);
    await rt.idle(T);
    expect((await decide(a.id, { decision: "decline" })).status).toBe(409);
    expect(youCalls).toBe(1);
  });
});
