import path from "node:path";
import { tool } from "langchain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { openCheckpointer } from "./checkpointer";
import { openRuntimeDb, type RuntimeDb } from "./db";
import { Runtime } from "./index";
import { tempEnv, type TempEnv } from "./testing/env";
import { fakeCrusoe, textOf, type ChatRequest } from "./testing/fake-crusoe";

/*
 * R4 (D §11 step 4): one run per thread. A DM sent mid-run waits in the inbox and reaches the model before
 * its next call, inside the same run; the checkpoint chain never forks.
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

/** A tool that sleeps, and says when it started. */
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

/** Waits until no run on the thread is queued or running. Reads the db, so it doesn't trust the queue. */
async function settled(threadId = T, ms = 15_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    await new Promise((r) => setTimeout(r, 50));
    const runs = db.runs.byThread(threadId);
    if (runs.length && runs.every((r) => r.status !== "queued" && r.status !== "running") && !rt?.isBusy(threadId)) return;
    if (Date.now() > deadline) throw new Error(`runs still going: ${JSON.stringify(runs.map((r) => r.status))}`);
  }
}

const lastUser = (req: ChatRequest) => req.messages.filter((m) => m.role !== "system").at(-1);

/** The thread's root-namespace checkpoints: id → parent id. */
async function chain(threadId: string) {
  const links = new Map<string, string | undefined>();
  for await (const c of checkpointer.list({ configurable: { thread_id: threadId } })) {
    if ((c.config.configurable?.checkpoint_ns ?? "") !== "") continue;
    links.set(c.config.configurable!.checkpoint_id as string, c.parentConfig?.configurable?.checkpoint_id as string | undefined);
  }
  return links;
}

describe("send() on a busy thread", () => {
  it("delivers a DM sent during a 2 s tool call before the next model call, in the same run, with no fork", async () => {
    const { sleep, running } = sleeper();
    const fake = fakeCrusoe([{ toolCalls: [{ name: "sleep", args: { ms: 2000 } }] }, { text: "Added the cost line." }]);
    rt = new Runtime({ db, checkpointer, fetch: fake.fetch, tools: () => [sleep] });

    const first = rt.send(T, { text: "Start the report." });
    expect(first.delivered).toBe("run");
    await running;
    const second = rt.send(T, { text: "Also add the cost line." });
    await settled();

    // One run, and its checkpoints form a line: one root, no checkpoint the parent of two others.
    expect(db.runs.byThread(T).map((r) => [r.id, r.status])).toEqual([[first.runId, "done"]]);
    const links = await chain(T);
    const parents = [...links.values()].filter((p): p is string => p !== undefined);
    expect([...links.values()].filter((p) => p === undefined)).toHaveLength(1);
    expect(new Set(parents).size).toBe(parents.length);

    // The DM reached the model right after the tool result.
    expect(fake.requests).toHaveLength(2);
    const after = fake.requests[1].messages.filter((m) => m.role !== "system");
    expect(after.at(-2)?.role).toBe("tool");
    expect(after.at(-1)).toMatchObject({ role: "user" });
    expect(textOf(after.at(-1)?.content)).toBe("Also add the cost line.");
    expect(db.inbox.pending(T)).toEqual([]);
    expect(second.delivered).toBe("inbox");
  }, 30_000);

  it("answers a DM that lands after the run's last model call in a follow-up run", async () => {
    let late: ReturnType<Runtime["send"]> | undefined;
    const fake = fakeCrusoe([
      () => {
        // The run's final call is in flight: the thread is busy, so this goes to the inbox.
        late = rt!.send(T, { text: "One more thing." });
        return { text: "Here is the summary." };
      },
      { text: "Sure, the one more thing." },
    ]);
    rt = new Runtime({ db, checkpointer, fetch: fake.fetch });

    rt.send(T, { text: "Summarize." });
    await settled();

    expect(late?.delivered).toBe("inbox");
    expect(fake.requests).toHaveLength(2);
    expect(textOf(lastUser(fake.requests[1])?.content)).toBe("One more thing.");
    expect(db.runs.byThread(T).map((r) => r.status)).toEqual(["done", "done"]);
  }, 30_000);
});

describe("send()", () => {
  it("refuses a thread that isn't in the runtime db", () => {
    rt = new Runtime({ db, checkpointer, fetch: fakeCrusoe().fetch });
    expect(() => rt!.send("a:ghost:p:dm", { text: "hi" })).toThrow(/no thread/i);
  });
});
