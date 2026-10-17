/*
 * The workbench escape tests: every command goes through workbenchTools → the real stdio MCP server → the real srt
 * (sandbox-exec on macOS). Nothing here mocks srt; a test passes only because the sandbox blocked the escape.
 *
 * Secrets never reach this process: a read of the repo's .env.local goes to /dev/null inside the sandbox, so even
 * a broken sandbox can't print it.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { workbenchTools, type BashResult } from "./client";

const SECRET_KEY_NAMES = ["CRUSOE_API_KEY", "LANGSMITH_API_KEY", "TYPESAFE_API_KEY", "YDC_API_KEY"];
const REPO_ROOT = realpathSync(fileURLToPath(new URL("../../../", import.meta.url)));
const OUTPUT_CAP = 32 * 1024;

/** The nearest .env.local at or above the repo (a worktree sits inside the main checkout, which holds the secrets). */
function nearestEnvLocal(): string | undefined {
  for (let dir = REPO_ROOT; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".env.local"))) return join(dir, ".env.local");
    if (dirname(dir) === dir) return undefined;
  }
}

async function run(tool: StructuredToolInterface, command: string, timeoutMs?: number): Promise<BashResult> {
  const out = await tool.invoke(timeoutMs === undefined ? { command } : { command, timeoutMs });
  return JSON.parse(String(out)) as BashResult;
}

describe.skipIf(process.platform !== "darwin")("workbench bash tool (srt on macOS)", () => {
  let root: string;
  let workspace: string;
  let sibling: string;
  let secretDir: string;
  let bench: Awaited<ReturnType<typeof workbenchTools>>;
  let bash: StructuredToolInterface;

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "wb-test-")));
    workspace = join(root, "workspace");
    sibling = join(root, "sibling");
    secretDir = join(root, "secret");
    for (const d of [workspace, sibling, secretDir]) mkdirSync(d);
    writeFileSync(join(secretDir, "token.txt"), "fake-secret-sentinel-7f3a");
    // The host that calls workbenchTools (Next.js) has .env.local loaded; fake values stand in for the real ones.
    for (const k of SECRET_KEY_NAMES) if (process.env[k] === undefined) vi.stubEnv(k, `fake-${k.toLowerCase()}`);
    bench = await workbenchTools({ projectId: "test", workspace, allowedDomains: [], extraDenyRead: [secretDir] });
    const found = bench.tools.find((t) => t.name === "bash");
    if (!found) throw new Error("workbench exposes no bash tool");
    bash = found;
  }, 30_000);

  afterAll(async () => {
    await bench?.close();
    vi.unstubAllEnvs();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("1: runs a command in the workspace and the file lands on disk", async () => {
    const r = await run(bash, "echo hi > out.txt && cat out.txt");
    expect(r.exitCode).toBe(0);
    expect(r.output.trim()).toBe("hi");
    expect(readFileSync(join(workspace, "out.txt"), "utf8")).toBe("hi\n");
  });

  it("2: a write outside the workspace fails and leaves no file", async () => {
    const tag = `wb-escape-${randomUUID()}.txt`;
    const targets = [
      join(sibling, tag), // a sibling of the workspace
      join(REPO_ROOT, tag), // the repo root
      join(homedir(), ".claude", "debug", tag), // srt leaves this writable by default
    ];
    try {
      for (const target of targets) {
        const r = await run(bash, `echo escaped > '${target}'`);
        expect(r.exitCode, target).not.toBe(0);
        expect(existsSync(target), target).toBe(false);
      }
    } finally {
      for (const target of targets) rmSync(target, { force: true });
    }
  });

  it("3a: a path passed as extraDenyRead can't be read", async () => {
    const r = await run(bash, `cat '${join(secretDir, "token.txt")}'`);
    expect(r.exitCode).not.toBe(0);
    expect(r.output).not.toContain("fake-secret-sentinel-7f3a");
  });

  const envLocal = nearestEnvLocal();
  it.skipIf(!envLocal)("3b: the repo's .env.local can't be read", async () => {
    // Output goes to /dev/null inside the sandbox: if the read ever succeeds, the bytes still never leave it.
    const r = await run(bash, `cat '${envLocal}' > /dev/null`);
    expect(r.exitCode).not.toBe(0);
  });

  it("4a: the child's env carries none of the .env.local key names", async () => {
    const r = await run(bash, "env");
    expect(r.exitCode).toBe(0);
    const names = new Set(r.output.split("\n").map((line) => line.split("=")[0]));
    // Report names only: a failure message must never carry a value.
    expect(SECRET_KEY_NAMES.filter((k) => names.has(k))).toEqual([]);
  });

  it("4b: the child's env is the minimal set plus what srt and bash add", async () => {
    const r = await run(bash, "env");
    const names = r.output
      .split("\n")
      .map((line) => line.split("=")[0])
      .filter((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
    const minimal = new Set(["PATH", "HOME", "LANG", "TMPDIR"]);
    const shell = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);
    // srt's proxy plumbing (all *_PROXY spellings, CLOUDSDK_PROXY_*, SRT_*, its git/java hooks) and its marker.
    const srt = /PROXY|^SRT_|^SANDBOX_RUNTIME$|^GIT_CONFIG_PARAMETERS$|^GIT_SSH_COMMAND$|^JAVA_TOOL_OPTIONS$/i;
    const extra = names.filter((n) => !minimal.has(n) && !shell.has(n) && !srt.test(n));
    expect(extra).toEqual([]);
    for (const n of minimal) expect(names, n).toContain(n);
  });

  it("5: a command past its timeout is killed and returns fast with a non-zero exit", async () => {
    const started = Date.now();
    const r = await run(bash, "sleep 30", 1000);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(r.exitCode).not.toBe(0);
  });

  it("6: output over 32 KB is truncated with a marker", async () => {
    const r = await run(bash, "head -c 100000 /dev/zero | tr '\\0' a");
    expect(r.output).toMatch(/\[workbench: output truncated/);
    expect(r.output.startsWith("a".repeat(1000))).toBe(true);
    expect(Buffer.byteLength(r.output)).toBeLessThan(OUTPUT_CAP + 200);
  });

  it("7: a denied write and a denied read each report a violation for that call only", async () => {
    const target = join(sibling, `v-${randomUUID()}.txt`);
    const write = await run(bash, `echo x > '${target}'`);
    expect(write.violations.some((v) => "line" in v && v.line.includes(target))).toBe(true);
    const read = await run(bash, `cat '${join(secretDir, "token.txt")}'`);
    expect(read.violations.some((v) => "line" in v && v.line.includes(join(secretDir, "token.txt")))).toBe(true);
    const clean = await run(bash, "true");
    expect(clean.violations).toEqual([]);
  });
});

describe.skipIf(process.platform !== "darwin" || process.env.WORKBENCH_NET !== "1")("workbench network (WORKBENCH_NET=1)", () => {
  let root: string;
  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "wb-net-")));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("8: curl fails with no allowed domains and succeeds once example.com is allowed", async () => {
    const closed = await workbenchTools({ projectId: "net-closed", workspace: join(root, "a"), allowedDomains: [] });
    try {
      const r = await run(closed.tools[0], "curl -sS -m 10 -o /dev/null https://example.com");
      expect(r.exitCode).not.toBe(0);
      expect(r.violations).toContainEqual({ host: "example.com", port: 443 });
    } finally {
      await closed.close();
    }
    const open = await workbenchTools({ projectId: "net-open", workspace: join(root, "b"), allowedDomains: ["example.com"] });
    try {
      const r = await run(open.tools[0], "curl -sS -m 10 -o /dev/null https://example.com");
      expect(r.exitCode).toBe(0);
    } finally {
      await open.close();
    }
  }, 30_000);
});
