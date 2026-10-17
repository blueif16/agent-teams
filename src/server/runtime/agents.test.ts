import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAgent, threadId } from "./agents";
import { openCheckpointer } from "./checkpointer";

describe("threadId", () => {
  it("is a:{agentId}:p:{projectId}, one thread per agent × project", () => {
    expect(threadId("pip", "dm-01JA")).toBe("a:pip:p:dm-01JA");
  });
});

describe("buildAgent on the SQLite checkpointer", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "runtime-agents-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Runs one turn of agent `test` on project `projectId` in a fresh `node` process. */
  function turnInNewProcess(db: string, projectId: string, message: string) {
    const fixture = fileURLToPath(new URL("./testing/durable-turn.mts", import.meta.url));
    const child = spawnSync(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", fixture, db, projectId, message],
      { encoding: "utf8", env: { ...process.env, LANGSMITH_TRACING: "false" } },
    );
    const line = child.stdout.split("\n").find((l) => l.startsWith("RESULT "));
    expect(line, `turn "${message}" exited ${child.status}:\n${child.stderr}`).toBeDefined();
    return JSON.parse(line!.slice("RESULT ".length)) as { received: { type: string; text: string }[] };
  }

  it("keeps the thread across a restart: a new process on a:test:p:t1 sees the first run", async () => {
    const db = path.join(dir, "checkpoints.db");
    turnInNewProcess(db, "t1", "Remember the code word is OKAPI-41");
    const run2 = turnInNewProcess(db, "t1", "What is the code word?");

    // (a) The model in the second process was given the first run's message.
    expect(run2.received.map((m) => m.text)).toContain("Remember the code word is OKAPI-41");

    // (b) Read back from the file by a third instance: both turns are on the thread.
    const checkpointer = openCheckpointer(db);
    const reader = buildAgent({ agentId: "test", projectId: "t1", systemPrompt: "", model: new FakeListChatModel({ responses: [] }), checkpointer });
    const state = await reader.graph.getState({ configurable: { thread_id: "a:test:p:t1" } });
    expect(state.values.messages?.length ?? 0).toBeGreaterThanOrEqual(4);
    checkpointer.db.close();
  }, 60_000);
});
