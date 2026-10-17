/*
 * Live check against Crusoe, skipped unless CRUSOE_LIVE=1. The caller supplies the key:
 *
 *   LANGSMITH_TRACING=false CRUSOE_LIVE=1 node --env-file=.env.local \
 *     node_modules/vitest/vitest.mjs run src/server/runtime/durable-thread.live.test.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODELS } from "@/lib/models";
import { buildAgent } from "./agents";
import { openCheckpointer } from "./checkpointer";
import { crusoe } from "./models";

describe.skipIf(process.env.CRUSOE_LIVE !== "1")("live: durable thread on DeepSeek V4.1 Flash", () => {
  it("answers the code word from run 1 after the checkpointer and agent are rebuilt", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "runtime-live-"));
    const db = path.join(dir, "checkpoints.db");
    const agentFor = (checkpointer: ReturnType<typeof openCheckpointer>) =>
      buildAgent({
        agentId: "test",
        projectId: "t1",
        systemPrompt: "You are a concise assistant. Answer in one short sentence.",
        model: crusoe(MODELS.main, { maxTokens: 16_384, think: true }),
        checkpointer,
      });
    try {
      const first = openCheckpointer(db);
      await agentFor(first).invoke({ messages: [{ role: "user", content: "Remember the code word is OKAPI-41." }] });
      first.db.close();

      const second = openCheckpointer(db);
      const agent = agentFor(second);
      const out = await agent.invoke({ messages: [{ role: "user", content: "What is the code word?" }] });
      expect(out.messages.at(-1)?.text).toContain("OKAPI-41");
      const state = await agent.graph.getState({ configurable: { thread_id: "a:test:p:t1" } });
      expect(state.values.messages?.length ?? 0).toBeGreaterThanOrEqual(4);
      second.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
