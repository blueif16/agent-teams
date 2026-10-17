import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openRuntimeDb, type RuntimeDb } from "./db";

let dir: string;
let file: string;
const open: RuntimeDb[] = [];
const openAt = (f = file) => {
  const db = openRuntimeDb(f);
  open.push(db);
  return db;
};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "runtime-db-"));
  file = path.join(dir, "runtime.db");
});
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("openRuntimeDb", () => {
  it("defaults to <DATA_DIR>/runtime.db", () => {
    const before = process.env.DATA_DIR;
    process.env.DATA_DIR = path.join(dir, "data");
    try {
      openRuntimeDb().close();
      expect(existsSync(path.join(dir, "data", "runtime.db"))).toBe(true);
    } finally {
      if (before === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = before;
    }
  });

  it("keeps rows across a close and reopen", () => {
    const first = openAt();
    first.agents.create({ id: "pip", name: "Pip", archetype: "writer" });
    first.close();

    const again = openAt();
    expect(again.agents.get("pip")).toMatchObject({ id: "pip", name: "Pip", archetype: "writer", homeDir: "agents/pip" });
  });
});

describe("the seed", () => {
  it("is Mira, archetype chief, on her dm project with its thread", () => {
    const db = openAt();
    expect(db.agents.get("mira")).toMatchObject({ name: "Mira", archetype: "chief", modelTier: "main", status: "idle" });
    expect(db.projects.get("dm")).toMatchObject({ kind: "dm", status: "active", leadAgentId: "mira" });
    expect(db.members.has("dm", "mira")).toBe(true);
    expect(db.threads.get("a:mira:p:dm")).toMatchObject({ agentId: "mira", projectId: "dm", status: "idle" });
  });

  it("runs once: an edit to a seeded row survives a reopen", () => {
    const db = openAt();
    db.threads.setStatus("a:mira:p:dm", "error");
    db.close();

    expect(openAt().threads.get("a:mira:p:dm")?.status).toBe("error");
  });
});

describe("threads", () => {
  it("refuses a thread for an agent that doesn't exist", () => {
    const db = openAt();
    expect(() => db.threads.ensure("ghost", "dm")).toThrow();
  });

  it("ensure returns the same row on a second call", () => {
    const db = openAt();
    db.agents.create({ id: "pip", name: "Pip", archetype: "writer" });
    const a = db.threads.ensure("pip", "dm");
    db.threads.setStatus(a.id, "running");
    const b = db.threads.ensure("pip", "dm");
    expect(b).toMatchObject({ id: "a:pip:p:dm", status: "running" });
  });
});

describe("members", () => {
  it("has() is false for an agent that isn't on the project", () => {
    const db = openAt();
    db.agents.create({ id: "pip", name: "Pip", archetype: "writer" });
    expect(db.members.has("dm", "pip")).toBe(false);
    db.members.add({ projectId: "dm", agentId: "pip", role: "writer" });
    expect(db.members.has("dm", "pip")).toBe(true);
  });
});

describe("runs", () => {
  it("moves queued → running → done, and byStatus finds only the running one", () => {
    const db = openAt();
    const a = db.runs.create({ threadId: "a:mira:p:dm", trigger: "dm", lane: "interactive" });
    const b = db.runs.create({ threadId: "a:mira:p:dm", trigger: "dm", lane: "interactive" });
    expect(a.status).toBe("queued");
    expect(a.startedAt).toBeNull();

    db.runs.start(a.id);
    expect(db.runs.byStatus("running").map((r) => r.id)).toEqual([a.id]);

    db.runs.addCall(a.id, 0.002);
    db.runs.addCall(a.id, 0.001);
    db.runs.finish(a.id, "done");
    const done = db.runs.get(a.id)!;
    expect(done).toMatchObject({ status: "done", calls: 2, error: null });
    expect(done.costUsd).toBeCloseTo(0.003, 10);
    expect(done.startedAt).not.toBeNull();
    expect(done.endedAt).not.toBeNull();
    expect(db.runs.byStatus("running")).toEqual([]);
    expect(db.runs.byThread("a:mira:p:dm").map((r) => r.id)).toEqual([a.id, b.id]);
  });

  it("records the error of a failed run", () => {
    const db = openAt();
    const r = db.runs.create({ threadId: "a:mira:p:dm", trigger: "dm", lane: "interactive" });
    db.runs.start(r.id);
    db.runs.finish(r.id, "error", "Crusoe returned 503");
    expect(db.runs.get(r.id)).toMatchObject({ status: "error", error: "Crusoe returned 503" });
  });
});

describe("inbox", () => {
  it("hands out undelivered items oldest first, once, marked with the run", () => {
    const db = openAt();
    const run = db.runs.create({ threadId: "a:mira:p:dm", trigger: "dm", lane: "interactive" });
    db.inbox.add("a:mira:p:dm", "dm", { text: "first" });
    db.inbox.add("a:mira:p:dm", "dm", { text: "second" });

    const taken = db.inbox.take("a:mira:p:dm", run.id);
    expect(taken.map((i) => i.payload)).toEqual([{ text: "first" }, { text: "second" }]);
    expect(taken.every((i) => i.deliveredRunId === run.id && i.deliveredAt !== null)).toBe(true);
    expect(db.inbox.take("a:mira:p:dm", run.id)).toEqual([]);
    expect(db.inbox.pending("a:mira:p:dm")).toEqual([]);
  });

  it("take() with kinds leaves the other kinds waiting", () => {
    const db = openAt();
    const run = db.runs.create({ threadId: "a:mira:p:dm", trigger: "dm", lane: "interactive" });
    db.inbox.add("a:mira:p:dm", "assignment", { text: "brief" });
    db.inbox.add("a:mira:p:dm", "dm", { text: "hi" });

    expect(db.inbox.take("a:mira:p:dm", run.id, ["dm"]).map((i) => i.kind)).toEqual(["dm"]);
    expect(db.inbox.pending("a:mira:p:dm").map((i) => i.kind)).toEqual(["assignment"]);
  });
});
