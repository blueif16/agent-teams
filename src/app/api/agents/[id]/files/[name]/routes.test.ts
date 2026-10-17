import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDiff, FileHistory, VaultCommit } from "@/lib/vault/types";
import { OWNER, RUNTIME, setVault, Vault } from "@/server/runtime/vault";
import { GET as getDiff } from "./diff/route";
import { GET as getHistory } from "./history/route";
import { POST as postRestore } from "./restore/route";

/*
 * The history, diff and restore routes, invoked directly against a real temp
 * vault holding three versions of Mira's SOUL.md.
 */

// Real git on a shared, loaded machine: the 5 s default is too tight.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const GIT = process.platform === "darwin" ? execFileSync("xcrun", ["--find", "git"], { encoding: "utf8" }).trim() : "git";
const SOUL = "agents/mira/SOUL.md";
const V1 = "# Mira's soul\n\n- Lead with the answer.\n";
const V2 = "# Mira's soul\n\n- Lead with the number.\n";
const V3 = "# Mira's soul\n\n- 📌 Keep it short.\n- Lead with the number.\n";

let tmp: string;
let vault: Vault;
let c: VaultCommit[];
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "vault-routes-"));
  vault = new Vault({ dir: path.join(tmp, "vault") });
  setVault(vault);
  c = [
    (await vault.write({ path: SOUL, content: V1, author: RUNTIME, source: "seed" }))!,
    (await vault.write({ path: SOUL, content: V2, author: OWNER, source: "owner" }))!,
    (await vault.write({ path: SOUL, content: V3, author: OWNER, source: "pin" }))!,
  ];
});
afterEach(async () => {
  setVault(null);
  await rm(tmp, { recursive: true, force: true });
});

const ctx = (id: string, name: string) => ({ params: Promise.resolve({ id, name }) });
const url = (id: string, name: string, route: string, query = "") => `http://localhost/api/agents/${id}/files/${name}/${route}${query}`;
const history = (id: string, name: string) => getHistory(new Request(url(id, name, "history")), ctx(id, name));
const diff = (id: string, name: string, query: string) => getDiff(new Request(url(id, name, "diff", query)), ctx(id, name));
const restore = (id: string, name: string, body: unknown) =>
  postRestore(
    new Request(url(id, name, "restore"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    ctx(id, name),
  );
const commitCount = () => execFileSync(GIT, ["rev-list", "--count", "HEAD"], { cwd: vault.dir, encoding: "utf8" }).trim();

describe("GET history", () => {
  it("lists the file's commits newest first", async () => {
    const res = await history("mira", "soul");
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileHistory;
    expect(body.path).toBe(SOUL);
    expect(body.commits.map((x) => x.change)).toEqual([c[2].change, c[1].change, c[0].change]);
    expect(body.commits.map((x) => x.source)).toEqual(["pin", "owner", "seed"]);
    expect(body.blob).toBe(await vault.blob(SOUL));
  });

  it("answers an empty list for a known file with no versions yet", async () => {
    const res = await history("mira", "notes");
    expect(res.status).toBe(200);
    expect(((await res.json()) as FileHistory).commits).toEqual([]);
  });
});

describe("GET diff", () => {
  it("compares a change with the version before it when from is left out", async () => {
    const res = await diff("mira", "soul", `?to=${c[1].change}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileDiff;
    expect(body.from).toBe(c[0].change);
    expect(body.to).toBe(c[1].change);
    const segs = body.hunks.flatMap((h) => h.lines.flat());
    expect(segs).toContainEqual({ op: "del", text: "answer." });
    expect(segs).toContainEqual({ op: "add", text: "number." });
  });

  it("compares the first change against nothing", async () => {
    const body = (await (await diff("mira", "soul", `?to=${c[0].change}`)).json()) as FileDiff;
    expect(body.from).toBeNull();
    expect(body.hunks.flatMap((h) => h.lines.flat()).every((s) => s.op === "add")).toBe(true);
  });

  it("takes an explicit from", async () => {
    const body = (await (await diff("mira", "soul", `?from=${c[0].change}&to=${c[2].change}`)).json()) as FileDiff;
    expect(body.from).toBe(c[0].change);
    const segs = body.hunks.flatMap((h) => h.lines.flat());
    // Only V1 says "answer.", so this proves the diff starts at `from` and not at the version before `to`.
    expect(segs).toContainEqual({ op: "del", text: "answer." });
    expect(segs).toContainEqual({ op: "add", text: "📌 Keep it short." });
  });

  it("404s a change the file never had and 400s a missing to", async () => {
    expect((await diff("mira", "soul", "?to=c_01JA7Q2X8KJ3ZZZZZZZZZZZZZZ")).status).toBe(404);
    expect((await diff("mira", "memory", `?to=${c[1].change}`)).status).toBe(404);
    expect((await diff("mira", "soul", "")).status).toBe(400);
  });
});

describe("POST restore", () => {
  it("commits the chosen version back and returns the file as it is now", async () => {
    const res = await restore("mira", "soul", { change: c[0].change });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { commit: VaultCommit; content: string; updated: string };
    expect(body.commit.source).toBe("restore");
    expect(body.commit.trailers.Restores).toEqual([c[0].change]);
    expect(body.content).toBe(V1);
    expect(body.updated).toBe(body.commit.at);
    expect(await readFile(path.join(vault.dir, SOUL), "utf8")).toBe(V1);
    expect(commitCount()).toBe("4");
  });

  it("404s an unknown change and 400s a body without one, committing nothing", async () => {
    expect((await restore("mira", "soul", { change: "c_01JA7Q2X8KJ3ZZZZZZZZZZZZZZ" })).status).toBe(404);
    expect((await restore("mira", "soul", {})).status).toBe(400);
    expect(commitCount()).toBe("3");
    expect(await readFile(path.join(vault.dir, SOUL), "utf8")).toBe(V3);
  });
});

describe("unknown agents and files", () => {
  it("404s every route for an agent that doesn't exist or a file that isn't soul, memory or notes", async () => {
    for (const [id, name] of [
      ["nobody", "soul"],
      ["mira", "profile"],
      ["mira", "SOUL.md"],
    ]) {
      expect((await history(id, name)).status).toBe(404);
      expect((await diff(id, name, `?to=${c[1].change}`)).status).toBe(404);
      expect((await restore(id, name, { change: c[0].change })).status).toBe(404);
    }
    expect(commitCount()).toBe("3");
  });
});
