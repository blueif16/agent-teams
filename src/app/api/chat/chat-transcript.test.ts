import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRuntimeDb, setRuntimeDb, type RuntimeDb } from "@/server/runtime/db";
import { tempEnv, type TempEnv } from "@/server/runtime/testing/env";
import { storeUpload } from "@/server/uploads";
import { png } from "@/server/uploads.testing";
import { POST } from "./route";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/agent-files", () => ({
  readAgentFiles: async () => ({ soul: { content: "", updated: "" }, memory: { content: "", updated: "" } }),
  addStandingInstruction: async () => {},
}));
vi.mock("@/lib/ledger", () => ({ record: async () => {}, readLedger: async () => [] }));

/*
 * A message with images still goes through /api/chat (the runtime doesn't take uploads yet), so the route saves it
 * and its reply to the agent's thread transcript itself: the owner sees it after a refresh like any other.
 */
const T = "a:mira:p:dm";
let env: TempEnv;
let db: RuntimeDb;

const crusoeReply = () =>
  new Response(
    [
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Got it." }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 120, completion_tokens: 3, total_tokens: 123, prompt_tokens_details: { cached_tokens: 0 } } })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );

beforeEach(async () => {
  env = await tempEnv();
  db = openRuntimeDb(path.join(env.data, "runtime.db"));
  setRuntimeDb(db);
  delete process.env.CRUSOE_MODEL;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => crusoeReply());
});
afterEach(async () => {
  vi.restoreAllMocks();
  setRuntimeDb(null);
  db.close();
  await env.cleanup();
});

const chat = async (body: Record<string, unknown>) => {
  const res = await POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, text: await res.text() };
};
const rows = () => db.messages.page(T).messages.map((m) => [m.role, m.author, m.text, m.uploads, m.ref]);

describe("POST /api/chat with record", () => {
  it("saves the owner's message with its upload ids, then the reply, to the agent's thread", async () => {
    const { id } = await storeUpload(png(6, 4, 120));
    const { status, text } = await chat({
      agentId: "mira",
      mode: "dm",
      history: [{ from: "you", text: "Match this layout\n\n(an image attached)" }],
      uploads: [id],
      record: { thread: T, text: "Match this layout", ref: "o1", replyRef: "r1" },
    });

    expect(status).toBe(200);
    expect(text).toBe("Got it.");
    expect(rows()).toEqual([
      ["owner", "owner", "Match this layout", [id], "o1"],
      ["agent", "mira", "Got it.", [], "r1"],
    ]);
  });

  it("saves nothing to a thread that isn't the agent's", async () => {
    db.projects.create({ id: "p1", kind: "team", name: "Tern", status: "active" });
    db.agents.create({ id: "pat", name: "Pat", archetype: "lead" });
    db.threads.ensure("pat", "p1");
    await chat({ agentId: "mira", mode: "dm", history: [{ from: "you", text: "Hi" }], record: { thread: "a:pat:p:p1", text: "Hi" } });
    expect(db.messages.page("a:pat:p:p1").messages).toEqual([]);
    expect(rows()).toEqual([]);
  });
});
