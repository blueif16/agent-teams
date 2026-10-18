import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimeDb } from "@/server/runtime/db";
import { tempEnv, type TempEnv } from "@/server/runtime/testing/env";
import { POST } from "./route";

/*
 * POST /api/projects/[id]/close: the route's own answers (unknown project, Mira's DM, a malformed body, a project
 * already closed). What a close commits is tested in src/server/learn/close.test.ts. No network: fetch is a spy.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let env: TempEnv;
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  env = await tempEnv();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(async () => {
  fetchSpy.mockRestore();
  await env.cleanup();
});

const post = (id: string, body?: unknown) =>
  POST(
    new Request(`http://localhost/api/projects/${id}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

describe("POST /api/projects/[id]/close", () => {
  it("answers 404 for a project that doesn't exist", async () => {
    const res = await post("p_nope");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/p_nope/);
  });

  it("answers 400 for Mira's DM, which never closes", async () => {
    getRuntimeDb();
    const res = await post("dm");
    expect(res.status).toBe(400);
  });

  it("answers 400 for feedback that isn't a RunFeedback, and closes nothing", async () => {
    const db = getRuntimeDb();
    db.projects.create({ id: "p_open", kind: "team", name: "Open", status: "active" });
    const res = await post("p_open", { feedback: { failed: "everything" } });
    expect(res.status).toBe(400);
    expect(db.projects.get("p_open")!.status).toBe("active");
  });

  it("answers 200 with a no-op summary for a project that is already closed, without calling a model", async () => {
    const db = getRuntimeDb();
    db.projects.create({ id: "p_done", kind: "team", name: "Done", status: "active" });
    db.projects.setStatus("p_done", "done");
    const res = await post("p_done", {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ projectId: "p_done", closed: true, commits: [], usd: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
