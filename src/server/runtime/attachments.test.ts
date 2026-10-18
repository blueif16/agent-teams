import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storeUpload } from "@/server/uploads";
import { png } from "@/server/uploads.testing";
import { openCheckpointer } from "./checkpointer";
import { openRuntimeDb, type RuntimeDb } from "./db";
import { Runtime, setRuntime } from "./index";
import { tempEnv, type TempEnv } from "./testing/env";
import { fakeCrusoe, textOf, type ChatRequest, type FakeCrusoe } from "./testing/fake-crusoe";

vi.mock("next/server", () => ({ connection: async () => {} }));

/*
 * Files the owner attaches to a DM reach the agent through the runtime: a text document is copied to the thread's
 * project folder (/project/inputs/<name>) and inlined in the run's human message as an <attachment> block; an image
 * rides on that message as an image part. Asserted on what the (fake) model is actually sent.
 */
const T = "a:mira:p:dm";
let env: TempEnv;
let db: RuntimeDb;
let checkpointer: ReturnType<typeof openCheckpointer>;
let rt: Runtime;

beforeEach(async () => {
  env = await tempEnv();
  db = openRuntimeDb(path.join(env.data, "runtime.db"));
  checkpointer = openCheckpointer(path.join(env.data, "checkpoints.db"));
});
afterEach(async () => {
  await rt?.close();
  setRuntime(null);
  checkpointer.db.close();
  db.close();
  await env.cleanup();
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const start = (fake: FakeCrusoe) => {
  rt = new Runtime({ db, checkpointer, fetch: fake.fetch });
  setRuntime(rt);
};
async function post(body: unknown, id = T) {
  const { POST } = await import("@/app/api/threads/[id]/messages/route");
  const res = await POST(new Request(`http://localhost/api/threads/${id}/messages`, { method: "POST", body: JSON.stringify(body) }), ctx(id));
  return { status: res.status, body: (await res.json()) as { runId?: string; error?: string } };
}
/** The newest user message of a model request. */
const lastUser = (req: ChatRequest) => req.messages.filter((m) => m.role === "user").at(-1);
const inputs = () => path.join(env.data, "projects", "dm", "files", "inputs");

describe("POST /api/threads/[id]/messages with uploads", () => {
  it("copies a text document to /project/inputs/<name> and inlines it in an <attachment> block the agent can also read at that path", async () => {
    const spec = "# Client spec\n\nBrightside Dental wants online booking above the fold.\nBudget: $4k.\n";
    const { id } = await storeUpload(new TextEncoder().encode(spec), "spec.md");
    const fake = fakeCrusoe([{ toolCalls: [{ name: "read_file", args: { file_path: "/project/inputs/spec.md" } }] }, { text: "Got the spec." }]);
    start(fake);

    const { status } = await post({ text: "Here's the client's spec.", uploads: [id] });
    expect(status).toBe(202);
    await rt.idle(T);

    const sent = textOf(lastUser(fake.requests[0])?.content);
    expect(sent).toContain("Here's the client's spec.");
    expect(sent).toContain(`<attachment name="spec.md" path="/project/inputs/spec.md">\n${spec}\n</attachment>`);
    expect(await readFile(path.join(inputs(), "spec.md"), "utf8")).toBe(spec);
    // The path in the block is the agent's real /project/ folder: reading it there returns the file.
    const read = fake.requests[1].messages.find((m) => m.role === "tool");
    expect(textOf(read?.content)).toContain("Brightside Dental wants online booking above the fold.");
  }, 30_000);

  it("gives a text document over 20,000 characters as its path and size only, not its content", async () => {
    const long = `# Packages\n\n${"Starter, Growth and Pro tiers. ".repeat(800)}THE-END-MARKER\n`;
    const { id, bytes } = await storeUpload(new TextEncoder().encode(long), "packages.md");
    const fake = fakeCrusoe([{ text: "I'll read it from the folder." }]);
    start(fake);

    expect((await post({ text: "Our packages.", uploads: [id] })).status).toBe(202);
    await rt.idle(T);

    const sent = textOf(lastUser(fake.requests[0])?.content);
    expect(sent).toMatch(/<attachment name="packages\.md" path="\/project\/inputs\/packages\.md"[^>]*>/);
    expect(sent).toContain(String(bytes));
    expect(sent).not.toContain("THE-END-MARKER");
    expect(sent).not.toContain("Starter, Growth and Pro tiers. Starter");
    expect(await readFile(path.join(inputs(), "packages.md"), "utf8")).toBe(long);
  }, 30_000);

  it("sends an attached image to the model as an image part of the run's human message", async () => {
    const bytes = png(3, 2, 120);
    const { id } = await storeUpload(bytes);
    const fake = fakeCrusoe([{ text: "Nice screenshot." }]);
    start(fake);

    expect((await post({ text: "A competitor's landing page.", uploads: [id] })).status).toBe(202);
    await rt.idle(T);

    const content = lastUser(fake.requests[0])?.content;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toContainEqual({ type: "image_url", image_url: { url: `data:image/png;base64,${bytes.toString("base64")}` } });
    expect(textOf(content)).toContain("A competitor's landing page.");
    expect(existsSync(inputs())).toBe(false);
  }, 30_000);

  it("refuses an upload id that isn't stored with 400, and starts no run", async () => {
    start(fakeCrusoe());

    const { status, body } = await post({ text: "See attached.", uploads: [`${"c".repeat(64)}-spec.md`] });

    expect(status).toBe(400);
    expect(body.error).toMatch(/attach/i);
    expect(db.runs.byThread(T)).toEqual([]);
  });
});
