import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLedger, type CallEvent } from "@/lib/ledger";
import { openCheckpointer } from "./checkpointer";
import { openRuntimeDb, type RuntimeDb } from "./db";
import { Runtime, setRuntime } from "./index";
import { tempEnv, type TempEnv } from "./testing/env";
import { fakeCrusoe } from "./testing/fake-crusoe";

// Outside a Next request, connection() throws; the route only calls it to stay dynamic.
vi.mock("next/server", () => ({ connection: async () => {} }));

/*
 * R5 (D §11 step 5): an owner message posted to /api/threads/[id]/messages runs on the thread, and
 * /api/threads/[id]/events streams it as SSE: plan, now, tool, token, done. The ledger gets one `run` row
 * per model call, with the thread and run.
 */
const T = "a:mira:p:dm";
let env: TempEnv;
let db: RuntimeDb;
let checkpointer: ReturnType<typeof openCheckpointer>;

beforeEach(async () => {
  env = await tempEnv();
  db = openRuntimeDb(path.join(env.data, "runtime.db"));
  checkpointer = openCheckpointer(path.join(env.data, "checkpoints.db"));
});
afterEach(async () => {
  setRuntime(null);
  checkpointer.db.close();
  db.close();
  await env.cleanup();
});

type Ev = { type: string; run: string; [k: string]: unknown };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Reads SSE frames until one of type `until` arrives; rejects after `ms`. */
async function readEvents(body: ReadableStream<Uint8Array>, until: string, ms = 15_000): Promise<Ev[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: Ev[] = [];
  let buf = "";
  const deadline = Date.now() + ms;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`no "${until}" event within ${ms} ms; got ${JSON.stringify(events.map((e) => e.type))}`);
    const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), left))]);
    if (!chunk || chunk.done) continue;
    buf += decoder.decode(chunk.value, { stream: true });
    let end: number;
    while ((end = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, end);
      buf = buf.slice(end + 2);
      const name = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (!name || !data) continue;
      const ev = JSON.parse(data) as Ev;
      expect(ev.type).toBe(name);
      events.push(ev);
      if (name === until) {
        await reader.cancel();
        return events;
      }
    }
  }
}

describe("the streaming bridge", () => {
  it("streams plan, now, tool and token events for a run that plans then reads a file, and ledgers each call", async () => {
    const todos = [
      { content: "Read the brief", status: "in_progress" },
      { content: "Answer the owner", status: "pending" },
    ];
    const answer = "The brief says we ship on Friday.";
    const fake = fakeCrusoe([
      { toolCalls: [{ name: "write_todos", args: { todos } }], usage: { input: 3000, cached: 0, output: 40 } },
      { toolCalls: [{ name: "read_file", args: { file_path: "/project/brief.md" } }], usage: { input: 3200, cached: 2944, output: 30 } },
      { text: answer, usage: { input: 3400, cached: 3200, output: 12 } },
    ]);
    await mkdir(path.join(env.data, "projects", "dm", "files"), { recursive: true });
    await writeFile(path.join(env.data, "projects", "dm", "files", "brief.md"), "# Brief\n\nShip on Friday.\n");
    setRuntime(new Runtime({ db, checkpointer, fetch: fake.fetch }));
    const { GET } = await import("@/app/api/threads/[id]/events/route");
    const { POST } = await import("@/app/api/threads/[id]/messages/route");

    const client = new AbortController();
    const sse = await GET(new Request(`http://localhost/api/threads/${T}/events`, { signal: client.signal }), ctx(T));
    expect(sse.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const posted = await POST(
      new Request(`http://localhost/api/threads/${T}/messages`, { method: "POST", body: JSON.stringify({ text: "What does the brief say?" }) }),
      ctx(T),
    );
    expect(posted.status).toBe(202);
    const { runId } = (await posted.json()) as { runId: string };

    const events = await readEvents(sse.body!, "done");
    client.abort();

    expect(events.every((e) => e.run === runId)).toBe(true);
    expect(events.find((e) => e.type === "plan")?.todos).toEqual(todos);
    expect(events.filter((e) => e.type === "now").map((e) => e.text)).toContain("Reading brief.md");
    expect(events.filter((e) => e.type === "tool" && e.name === "read_file").map((e) => e.phase)).toEqual(["start", "end"]);
    expect(events.filter((e) => e.type === "token").map((e) => e.text).join("")).toBe(answer);
    expect(events.at(-1)).toMatchObject({ type: "done", text: answer });

    const calls = (await readLedger()).filter((e): e is CallEvent => e.t === "call" && e.thread === T && e.run === runId);
    expect(calls.map((c) => [c.kind, c.agent, c.input, c.cached, c.output])).toEqual([
      ["run", "mira", 3000, 0, 40],
      ["run", "mira", 3200, 2944, 30],
      ["run", "mira", 3400, 3200, 12],
    ]);
    expect(calls.every((c) => c.ok && c.cost > 0)).toBe(true);
    expect(db.runs.get(runId)).toMatchObject({ status: "done", calls: 3 });
  }, 30_000);

  it("streams an error event when the run fails, and marks the run", async () => {
    const failing = (async () => new Response("upstream down", { status: 400 })) as typeof fetch;
    setRuntime(new Runtime({ db, checkpointer, fetch: failing }));
    const { GET } = await import("@/app/api/threads/[id]/events/route");
    const { POST } = await import("@/app/api/threads/[id]/messages/route");

    const client = new AbortController();
    const sse = await GET(new Request(`http://localhost/api/threads/${T}/events`, { signal: client.signal }), ctx(T));
    const posted = await POST(new Request(`http://localhost/api/threads/${T}/messages`, { method: "POST", body: JSON.stringify({ text: "hi" }) }), ctx(T));
    const { runId } = (await posted.json()) as { runId: string };

    const events = await readEvents(sse.body!, "error", 60_000);
    client.abort();
    expect(events.at(-1)).toMatchObject({ type: "error", run: runId });
    expect(db.runs.get(runId)?.status).toBe("error");
  }, 90_000);
});

describe("the thread routes", () => {
  it("answer 404 for a thread the runtime doesn't have, and 400 for an empty message", async () => {
    setRuntime(new Runtime({ db, checkpointer, fetch: fakeCrusoe().fetch }));
    const { GET } = await import("@/app/api/threads/[id]/events/route");
    const { POST } = await import("@/app/api/threads/[id]/messages/route");
    const post = (id: string, body: unknown) =>
      POST(new Request(`http://localhost/api/threads/${id}/messages`, { method: "POST", body: JSON.stringify(body) }), ctx(id));

    expect((await GET(new Request("http://localhost/api/threads/a:ghost:p:dm/events"), ctx("a:ghost:p:dm"))).status).toBe(404);
    expect((await post("a:ghost:p:dm", { text: "hi" })).status).toBe(404);
    expect((await post(T, { text: "  " })).status).toBe(400);
    expect(db.runs.byThread(T)).toEqual([]);
  });
});
