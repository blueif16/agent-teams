/*
 * Live check against Crusoe, skipped unless CRUSOE_LIVE=1: a 2-turn DM to Mira through the thread routes, on
 * a temp DATA_DIR. The caller supplies the key:
 *
 *   CRUSOE_LIVE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run src/server/runtime/stream.live.test.ts
 *
 * Costs well under a cent (DeepSeek V4.1 Flash, two short turns).
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readLedger, type CallEvent } from "@/lib/ledger";
import { openCheckpointer } from "./checkpointer";
import { openRuntimeDb, type RuntimeDb } from "./db";
import { Runtime, setRuntime } from "./index";
import { tempEnv, type TempEnv } from "./testing/env";

vi.mock("next/server", () => ({ connection: async () => {} }));

const T = "a:mira:p:dm";
const LIVE = process.env.CRUSOE_LIVE === "1";

describe.skipIf(!LIVE)("live: a 2-turn DM to Mira through the runtime", () => {
  let env: TempEnv;
  let db: RuntimeDb;
  let checkpointer: ReturnType<typeof openCheckpointer>;

  beforeAll(async () => {
    const key = process.env.CRUSOE_API_KEY;
    env = await tempEnv();
    process.env.CRUSOE_API_KEY = key;
    db = openRuntimeDb(path.join(env.data, "runtime.db"));
    checkpointer = openCheckpointer(path.join(env.data, "checkpoints.db"));
    setRuntime(new Runtime({ db, checkpointer }));
  });
  afterAll(async () => {
    setRuntime(null);
    checkpointer.db.close();
    db.close();
    await env.cleanup();
  });

  /** POSTs one message and reads the SSE stream until the run is done; returns the final text. */
  async function turn(text: string): Promise<{ runId: string; answer: string; tokens: number }> {
    const { GET } = await import("@/app/api/threads/[id]/events/route");
    const { POST } = await import("@/app/api/threads/[id]/messages/route");
    const ctx = { params: Promise.resolve({ id: T }) };
    const client = new AbortController();
    const sse = await GET(new Request(`http://localhost/api/threads/${T}/events`, { signal: client.signal }), ctx);
    const posted = await POST(new Request(`http://localhost/api/threads/${T}/messages`, { method: "POST", body: JSON.stringify({ text }) }), ctx);
    const { runId } = (await posted.json()) as { runId: string };
    const reader = sse.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let tokens = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before done");
      buf += decoder.decode(value, { stream: true });
      for (const frame of buf.split("\n\n").slice(0, -1)) {
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (!data) continue;
        const ev = JSON.parse(data) as { type: string; text?: string; message?: string };
        if (ev.type === "token") tokens++;
        if (ev.type === "error") throw new Error(ev.message);
        if (ev.type === "done") {
          client.abort();
          return { runId, answer: ev.text ?? "", tokens };
        }
      }
      buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
    }
  }

  it("answers both turns, streams tokens, and a later call reads from Crusoe's prefix cache", async () => {
    const one = await turn("Hi Mira. In one short sentence: what can you do for me?");
    const two = await turn("Thanks. In one short sentence: what is the first thing you'd do on a new project?");
    expect(one.answer.length).toBeGreaterThan(0);
    expect(two.answer.length).toBeGreaterThan(0);
    expect(one.tokens + two.tokens).toBeGreaterThan(0);

    const calls = (await readLedger()).filter((e): e is CallEvent => e.t === "call" && e.thread === T);
    const cost = calls.reduce((s, c) => s + c.cost, 0);
    console.log(
      JSON.stringify({
        answers: [one.answer, two.answer],
        calls: calls.map((c) => ({ run: c.run === one.runId ? 1 : 2, model: c.model, input: c.input, cached: c.cached, output: c.output, ms: c.ms, cost: c.cost })),
        cost,
      }),
    );
    expect(calls.every((c) => c.ok && c.input > 0 && c.output > 0)).toBe(true);
    expect(calls.slice(1).some((c) => c.cached > 0)).toBe(true);
    expect(cost).toBeLessThan(0.05);
  }, 240_000);
});
