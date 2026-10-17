import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VaultAuthor } from "@/lib/vault/types";
import { OWNER, RUNTIME, Vault, VaultConflictError } from "./vault";

/*
 * The vault against real git in temp dirs. Every check reads the repo with the
 * git CLI directly, so a test can't pass by trusting the vault's own reports.
 */

const PIP: VaultAuthor = { kind: "agent", id: "pip", name: "Pip" };

// Our own git calls stay out of the user's config and out of any repo the test runner sits in.
const GIT_ENV: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
  NODE_ENV: process.env.NODE_ENV,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
// The real binary: a `git` wrapper on PATH can cost ~360 ms a spawn, which times the 25-write test out.
const GIT = process.platform === "darwin" ? execFileSync("xcrun", ["--find", "git"], { encoding: "utf8" }).trim() : "git";
function git(dir: string, ...args: string[]) {
  expect(existsSync(path.join(dir, ".git")), `a git repo at ${dir}`).toBe(true);
  return execFileSync(GIT, args, { cwd: dir, env: GIT_ENV, encoding: "utf8", maxBuffer: 64 << 20 });
}

let tmp: string;
let dir: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "vault-test-"));
  dir = path.join(tmp, "vault"); // doesn't exist yet: the vault creates and inits it
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("writer queue", () => {
  it("turns 25 concurrent writes into 25 commits in call order, each touching only its own file", async () => {
    const vault = new Vault({ dir });
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        vault.write({ path: `agents/a${i}/MEMORY.md`, content: `# a${i}\n\nfact ${i}\n`, author: OWNER, source: "owner" }),
      ),
    );

    const shas = git(dir, "log", "--reverse", "--format=%H").trim().split("\n");
    expect(shas).toHaveLength(25);
    expect(results.map((c) => c?.sha)).toEqual(shas);
    shas.forEach((sha, i) => {
      expect(git(dir, "show", "--name-only", "--format=", sha).trim()).toBe(`agents/a${i}/MEMORY.md`);
    });
    expect(await readFile(path.join(dir, "agents/a7/MEMORY.md"), "utf8")).toBe("# a7\n\nfact 7\n");
    expect(git(dir, "status", "--porcelain")).toBe("");
    // fsck exits non-zero on any broken object or ref, which throws here.
    expect(git(dir, "fsck", "--strict", "--no-dangling")).not.toMatch(/error|missing|broken/i);
  });

  it("makes no commit when the content is already what the file holds", async () => {
    const vault = new Vault({ dir });
    await vault.write({ path: "agents/mira/SOUL.md", content: "same\n", author: OWNER, source: "owner" });
    const again = await vault.write({ path: "agents/mira/SOUL.md", content: "same\n", author: OWNER, source: "owner" });
    expect(again).toBeNull();
    expect(git(dir, "rev-list", "--count", "HEAD").trim()).toBe("1");
  });
});

describe("expected blob", () => {
  const P = "agents/pip/MEMORY.md";

  it("rejects a write whose expected blob is stale and leaves the file and HEAD as they were", async () => {
    const vault = new Vault({ dir });
    await vault.write({ path: P, content: "v1\n", author: RUNTIME, source: "seed" });
    const readByDream = await vault.blob(P);
    await vault.write({ path: P, content: "the owner's edit\n", author: OWNER, source: "owner" });
    const head = git(dir, "rev-parse", "HEAD").trim();

    await expect(
      vault.write({ path: P, content: "dream rewrite\n", author: PIP, source: "dream", expectedBlob: readByDream }),
    ).rejects.toBeInstanceOf(VaultConflictError);

    expect(await readFile(path.join(dir, P), "utf8")).toBe("the owner's edit\n");
    expect(git(dir, "rev-parse", "HEAD").trim()).toBe(head);
    expect(git(dir, "status", "--porcelain")).toBe("");
  });

  it("accepts a write whose expected blob is the file's current blob", async () => {
    const vault = new Vault({ dir });
    await vault.write({ path: P, content: "v1\n", author: RUNTIME, source: "seed" });
    const current = await vault.blob(P);
    expect(current).toBe(git(dir, "rev-parse", `HEAD:${P}`).trim());

    const c = await vault.write({ path: P, content: "v2\n", author: PIP, source: "dream", expectedBlob: current });
    expect(c?.sha).toBe(git(dir, "rev-parse", "HEAD").trim());
    expect(await readFile(path.join(dir, P), "utf8")).toBe("v2\n");
  });

  it("treats a null expected blob as 'must not exist yet'", async () => {
    const vault = new Vault({ dir });
    await vault.write({ path: P, content: "template\n", author: RUNTIME, source: "seed", expectedBlob: null });
    await expect(
      vault.write({ path: P, content: "second template\n", author: RUNTIME, source: "seed", expectedBlob: null }),
    ).rejects.toBeInstanceOf(VaultConflictError);
    expect(await readFile(path.join(dir, P), "utf8")).toBe("template\n");
  });
});
