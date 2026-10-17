import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHIEF_ID } from "@/lib/data";
import { storeUpload } from "@/server/uploads";
import { png } from "@/server/uploads.testing";
import { POST } from "./route";

// Side effects this test isn't about: after() needs a Next request, and the agent's files and the ledger live on disk.
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/agent-files", () => ({
  readAgentFiles: async () => ({ soul: { content: "", updated: "" }, memory: { content: "", updated: "" } }),
  addStandingInstruction: async () => {},
}));
vi.mock("@/lib/ledger", () => ({ record: async () => {}, readLedger: async () => [] }));

/** Crusoe's streamed reply: one content delta, then usage, then [DONE]. */
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

let root: string;
let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;
const env = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "chat-route-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  process.env.CRUSOE_API_KEY = "test-key";
  delete process.env.CRUSOE_MODEL;
  delete process.env.LANGSMITH_TRACING;
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => crusoeReply());
});
afterEach(async () => {
  vi.restoreAllMocks();
  process.env = { ...env };
  await rm(root, { recursive: true, force: true });
});

const chat = async (body: Record<string, unknown>) => {
  const res = await POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, text: await res.text() };
};
const sentMessages = () => {
  const [, init] = fetchSpy.mock.calls[0];
  return (JSON.parse(String(init?.body)) as { messages: { role: string; content: unknown }[] }).messages;
};

describe("POST /api/chat with uploads", () => {
  it("sends the newest user turn as text plus an image_url part per upload, built from the stored bytes", async () => {
    const bytes = png(6, 4, 120);
    const { id } = await storeUpload(bytes);

    const { status, text } = await chat({
      agentId: CHIEF_ID,
      mode: "dm",
      history: [{ from: "you", text: "Match this layout" }],
      images: ["https://example.com/competitor.png"],
      uploads: [id],
    });

    expect(status).toBe(200);
    expect(text).toBe("Got it.");
    expect(sentMessages().at(-1)).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Match this layout" },
        { type: "image_url", image_url: { url: "https://example.com/competitor.png" } },
        { type: "image_url", image_url: { url: `data:image/png;base64,${bytes.toString("base64")}` } },
      ],
    });
  });

  it("refuses more than 4 uploads with 400 and never calls the model", async () => {
    const ids = [];
    for (let shade = 0; shade < 5; shade++) ids.push((await storeUpload(png(2, 2, shade * 50))).id);

    const { status, text } = await chat({ agentId: CHIEF_ID, mode: "dm", history: [{ from: "you", text: "Look" }], uploads: ids });

    expect(status).toBe(400);
    expect(JSON.parse(text).error).toMatch(/at most 4/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
