import path from "node:path";
import { HumanMessage, RemoveMessage, type BaseMessage } from "@langchain/core/messages";
import { REMOVE_ALL_MESSAGES } from "@langchain/langgraph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getServerCache } from "@/server/cache";
import { TOPICS } from "@/server/cache/bus";
import { openCheckpointer } from "./checkpointer";
import { openRuntimeDb, type RuntimeDb } from "./db";
import { Runtime } from "./index";
import { tempEnv, type TempEnv } from "./testing/env";
import { fakeCrusoe } from "./testing/fake-crusoe";

/*
 * The DM transcript: what the owner and the agent said, append-only, in runtime.db. It is not the agent's
 * working context: the checkpointer's messages get compacted, the transcript never does.
 */
const T = "a:mira:p:dm";
let env: TempEnv;
let db: RuntimeDb;
let checkpointer: ReturnType<typeof openCheckpointer>;
let rt: Runtime | undefined;

beforeEach(async () => {
  env = await tempEnv();
  db = openRuntimeDb(path.join(env.data, "runtime.db"));
  checkpointer = openCheckpointer(path.join(env.data, "checkpoints.db"));
});
afterEach(async () => {
  await rt?.close();
  rt = undefined;
  checkpointer.db.close();
  db.close();
  await env.cleanup();
});

async function settled(ms = 15_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    await new Promise((r) => setTimeout(r, 50));
    const runs = db.runs.byThread(T);
    if (runs.length && runs.every((r) => r.status !== "queued" && r.status !== "running") && !rt?.isBusy(T)) return;
    if (Date.now() > deadline) throw new Error(`runs still going: ${JSON.stringify(runs.map((r) => r.status))}`);
  }
}

const said = () => db.messages.page(T).messages.map((m) => [m.role, m.text]);

describe("the transcript", () => {
  it("has the owner's row as soon as send() accepts it, and the agent's final answer once the run is done", async () => {
    const todos = [{ content: "Look at revenue", status: "in_progress" }];
    const fake = fakeCrusoe([{ text: "Let me plan.", toolCalls: [{ name: "write_todos", args: { todos } }] }, { text: "Revenue is up 4%." }]);
    rt = new Runtime({ db, checkpointer, fetch: fake.fetch });

    const sent = rt.send(T, { text: "How is revenue?" });
    expect(db.messages.page(T).messages).toEqual([
      expect.objectContaining({ id: sent.messageId, threadId: T, runId: sent.runId, role: "owner", author: "owner", text: "How is revenue?" }),
    ]);

    await settled();
    // The plan, the tool call and the text before it are the run's working, not the conversation.
    expect(said()).toEqual([
      ["owner", "How is revenue?"],
      ["agent", "Revenue is up 4%."],
    ]);
    expect(db.messages.page(T).messages[1]).toMatchObject({ author: "mira", runId: sent.runId });
  }, 30_000);

  it("announces each row it writes on the thread's messages topic", async () => {
    rt = new Runtime({ db, checkpointer, fetch: fakeCrusoe([{ text: "Hi." }]).fetch });
    const heard: string[] = [];
    getServerCache().bus.subscribe([TOPICS.messages(T)], (c) => heard.push(c.topic));

    rt.send(T, { text: "Hello" });
    expect(heard).toEqual([TOPICS.messages(T)]);
    await settled();
    expect(heard).toEqual([TOPICS.messages(T), TOPICS.messages(T)]);
  }, 30_000);

  it("keeps every message, in order, after the agent's working context is compacted", async () => {
    const fake = fakeCrusoe([{ text: "One." }, { text: "Two." }, { text: "Three." }]);
    rt = new Runtime({ db, checkpointer, fetch: fake.fetch });
    rt.send(T, { text: "First" });
    await settled();
    rt.send(T, { text: "Second" });
    await settled();

    // Compaction as summarization does it: the old messages go, a summary takes their place.
    const graph = (await rt.worker(T)).graph;
    const config = { configurable: { thread_id: T } };
    await graph.updateState(config, { messages: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), new HumanMessage("Summary: revenue talk.")] });
    const kept = ((await graph.getState(config)).values as { messages: BaseMessage[] }).messages.map((m) => m.text);
    expect(kept).toEqual(["Summary: revenue talk."]);

    rt.send(T, { text: "Third" });
    await settled();
    expect(said()).toEqual([
      ["owner", "First"],
      ["agent", "One."],
      ["owner", "Second"],
      ["agent", "Two."],
      ["owner", "Third"],
      ["agent", "Three."],
    ]);
  }, 30_000);
});
