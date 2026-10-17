/*
 * Test kit for the state module: a temp vault per test with process.cwd() pointed at a temp dir (so the real repo
 * and its .data never leak in), and git read back with the CLI directly, so a test can't pass by trusting the
 * module's own reports. Imported by *.test.ts only.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { setVault, Vault } from "@/server/runtime/vault";

type Global = { __agentTeamsCache?: { close(): void }; __agentTeamsVault?: unknown };

const GIT_ENV: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
  NODE_ENV: process.env.NODE_ENV,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
const GIT = process.platform === "darwin" ? execFileSync("xcrun", ["--find", "git"], { encoding: "utf8" }).trim() : "git";

export interface Commit {
  sha: string;
  subject: string;
  author: string;
  trailers: Record<string, string[]>;
  files: string[];
}

export function tempProject() {
  const ctx = { root: "", dir: "" };
  let cwd: { mockRestore(): void };

  beforeEach(async () => {
    ctx.root = await mkdtemp(path.join(tmpdir(), "project-state-"));
    ctx.dir = path.join(ctx.root, "vault");
    cwd = vi.spyOn(process, "cwd").mockReturnValue(ctx.root);
    (globalThis as Global).__agentTeamsCache?.close();
    delete (globalThis as Global).__agentTeamsCache;
    setVault(new Vault({ dir: ctx.dir }));
  });

  afterEach(async () => {
    (globalThis as Global).__agentTeamsCache?.close();
    delete (globalThis as Global).__agentTeamsCache;
    setVault(null);
    cwd.mockRestore();
    await rm(ctx.root, { recursive: true, force: true });
  });

  const git = (...args: string[]) => {
    expect(existsSync(path.join(ctx.dir, ".git")), `a git repo at ${ctx.dir}`).toBe(true);
    return execFileSync(GIT, args, { cwd: ctx.dir, env: GIT_ENV, encoding: "utf8", maxBuffer: 64 << 20 });
  };

  /** Every commit in the vault, oldest first, read with git itself. */
  const commits = (): Commit[] => {
    if (!existsSync(path.join(ctx.dir, ".git"))) return [];
    const count = Number(git("rev-list", "--count", "--all").trim() || "0");
    if (!count) return [];
    const out = git("log", "--reverse", "--name-only", "--format=%x1e%H%x1f%s%x1f%an <%ae>%x1f%(trailers:only,unfold,separator=%x1d,key_value_separator=%x1c)%x1f");
    return out
      .split("\x1e")
      .filter((c) => c.trim())
      .map((c) => {
        const [sha, subject, author, raw, names = ""] = c.split("\x1f");
        const trailers: Record<string, string[]> = {};
        for (const t of raw.split("\x1d")) {
          const cut = t.indexOf("\x1c");
          if (cut > 0) (trailers[t.slice(0, cut)] ??= []).push(t.slice(cut + 1));
        }
        return { sha, subject, author, trailers, files: names.split("\n").filter(Boolean) };
      });
  };

  /** A state file's bytes in the working tree, or null. */
  const file = async (p: string) => {
    try {
      return await readFile(path.join(ctx.dir, p), "utf8");
    } catch {
      return null;
    }
  };

  return { ctx, git, commits, file };
}

/** Calls a LangChain tool and parses its JSON result. */
export async function call(tools: readonly { name: string; invoke(input: unknown): Promise<unknown> }[], name: string, args: unknown) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  const out = await t.invoke(args);
  return JSON.parse(String(out)) as Record<string, unknown> & { error?: string; message?: string; rev: number; recite: string; id?: string };
}
