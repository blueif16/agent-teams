import path from "node:path";
import { tool } from "langchain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { openCheckpointer } from "@/server/runtime/checkpointer";
import { openRuntimeDb, type RuntimeDb } from "@/server/runtime/db";
import { Runtime, setRuntime } from "@/server/runtime";
import { tempEnv, type TempEnv } from "@/server/runtime/testing/env";
import { fakeCrusoe } from "@/server/runtime/testing/fake-crusoe";
import { GET } from "./route";

vi.mock("next/server", () => ({ connection: async () => {} }));

/*
 * GET /api/runs: every thread's run events on one stream, each tagged with its thread, so a page follows a whole
 * channel (and every agent's "now" line) on one connection. A page that opens it mid-run gets the run so far first.
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

type Ev = { type: string; thread: string; run: string; [k: string]: unknown };

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

function sleeper() {
  let started!: () => void;
  const running = new Promise<void>((r) => (started = r));
  const sleep = tool(
    async ({ ms }: { ms: number }) => {
      started();
      await new Promise((r) => setTimeout(r, ms));
      return `slept ${ms} ms`;
    },
    { name: "sleep", description: "Waits.", schema: z.object({ ms: z.number() }) },
  );
  return { sleep, running };
}

describe("GET /api/runs", () => {
  it("opens with what a run in flight has said so far, then streams the rest tagged with its thread", async () => {
    const { sleep, running } = sleeper();
    const fake = fakeCrusoe([{ text: "Reading the brief.", toolCalls: [{ name: "sleep", args: { ms: 1500 } }] }, { text: "It ships Friday." }]);
    const rt = new Runtime({ db, checkpointer, fetch: fake.fetch, tools: () => [sleep] });
    setRuntime(rt);
    const { runId } = rt.send(T, { text: "What does the brief say?" });
    await running;

    const client = new AbortController();
    const sse = await GET(new Request("http://localhost/api/runs", { signal: client.signal }));
    expect(sse.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const events = await readEvents(sse.body!, "done");
    client.abort();

    expect(events[0]).toEqual({ type: "live", thread: T, run: runId, text: "Reading the brief." });
    expect(events.every((e) => e.thread === T && e.run === runId)).toBe(true);
    expect(
      events
        .filter((e) => e.type === "token")
        .map((e) => e.text)
        .join(""),
    ).toBe("It ships Friday.");
    expect(events.at(-1)).toMatchObject({ type: "done", text: "It ships Friday.", message: db.messages.page(T).messages.at(-1)!.id });
  }, 30_000);

  it("tells a page a run has started before it says anything", async () => {
    const rt = new Runtime({ db, checkpointer, fetch: fakeCrusoe([{ text: "Hi." }]).fetch });
    setRuntime(rt);
    const client = new AbortController();
    const sse = await GET(new Request("http://localhost/api/runs", { signal: client.signal }));
    const { runId } = rt.send(T, { text: "Hello" });

    const events = await readEvents(sse.body!, "done");
    client.abort();
    expect(events[0]).toEqual({ type: "start", thread: T, run: runId });
  }, 30_000);
});
