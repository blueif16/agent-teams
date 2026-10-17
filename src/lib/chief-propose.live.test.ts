/*
 * Live eval against Crusoe, skipped unless CRUSOE_LIVE=1 (owner, 2026-10-17: "mira is asking a bit too much"): a
 * project ask gets 2-3 option cards right away, with undecided details left to the PM, never a list of questions first.
 * Was: a 2-turn DM to Mira through the thread routes, on
 * a temp DATA_DIR. The caller supplies the key:
 *
 *   CRUSOE_LIVE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run src/server/runtime/stream.live.test.ts
 *
 * Costs well under a cent (DeepSeek V4.1 Flash, two short turns).
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openCheckpointer } from "@/server/runtime/checkpointer";
import { openRuntimeDb, type RuntimeDb } from "@/server/runtime/db";
import { Runtime, setRuntime } from "@/server/runtime/index";
import { tempEnv, type TempEnv } from "@/server/runtime/testing/env";

vi.mock("next/server", () => ({ connection: async () => {} }));

const T = "a:mira:p:dm";
const ASKS = [
  "We're launching a rugged outdoor smartwatch for people who want less screen time. Size the US market and give me a dated launch plan.",
  "Start a project: a pricing benchmark for our AI meeting-notes app for field sales reps, so we know what to charge.",
  "I need a landing page for Bookbird, online booking for small clinics, launching in two weeks.",
];
const LIVE = process.env.CRUSOE_LIVE === "1";

describe.skipIf(!LIVE)("live eval: Mira proposes instead of quizzing the owner", () => {
  let env: TempEnv;
  let db: RuntimeDb;
  let checkpointer: ReturnType<typeof openCheckpointer>;

  beforeEach(async () => {
    const key = process.env.CRUSOE_API_KEY;
    env = await tempEnv();
    process.env.CRUSOE_API_KEY = key;
    db = openRuntimeDb(path.join(env.data, "runtime.db"));
    checkpointer = openCheckpointer(path.join(env.data, "checkpoints.db"));
    setRuntime(new Runtime({ db, checkpointer }));
  });
  afterEach(async () => {
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

  it.each(ASKS)("proposes options on the first reply: %s", async (ask) => {
    const { parseProject } = await import("@/lib/project");
    const r = await turn(ask);
    const p = parseProject(r.answer);
    if (!p) console.log("NO CARD. Reply was:\n" + r.answer.slice(0, 1200));
    expect(p?.options.length ?? 0).toBeGreaterThanOrEqual(2);
  }, 240_000);

  it.each([
    "Ok, go ahead.",
    "Why are the agents still blocked? What do you need from me?",
  ])("after proposing, leaves the details to the PM instead of quizzing the owner: %s", async (follow) => {
    await turn(ASKS[0]);
    const r = await turn(follow);
    const questions = (r.answer.match(/\?/g) ?? []).length;
    if (questions > 1) console.log("QUIZZED. Reply was:\n" + r.answer.slice(0, 1200));
    expect(questions).toBeLessThanOrEqual(1);
  }, 360_000);
});
