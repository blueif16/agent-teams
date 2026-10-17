/*
 * The workbench: a stdio MCP server with one tool, bash. Every command runs inside srt (sandbox-exec on macOS)
 * under sandboxConfig (policy.ts): writes only to the workspace and a per-run temp dir, secret paths unreadable,
 * network only to the allowed domains. It fails closed: if srt can't sandbox here, the server exits.
 *
 *   node src/server/workbench/server.mts --workspace <dir> [--project <id>] [--allow-domain <host>]... [--deny-read <path>]...
 *
 * The server never loads .env.local, and each command's child gets only PATH, HOME, LANG and TMPDIR.
 * Commands run one at a time: srt's ask callback is told only { host, port }, so serial runs are what tie an
 * asked host to the call that asked.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { constants, homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, OUTPUT_CAP, sandboxConfig, type BashResult, type Violation } from "./policy.ts";

function fail(message: string): never {
  process.stderr.write(`workbench: ${message}\n`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    workspace: { type: "string" },
    "allow-domain": { type: "string", multiple: true },
    "deny-read": { type: "string", multiple: true },
  },
});
if (!values.workspace) fail("--workspace is required");

const workspace = realpathSync(values.workspace);
// srt anchors its mandatory write denies (.git/hooks, .git/config, .bashrc, .mcp.json, ...) at the cwd.
process.chdir(workspace);
const tmpDir = realpathSync(mkdtempSync(path.join(tmpdir(), "workbench-")));
const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** The code's checkout and, when that is a git worktree, the main checkout too (where .env.local lives). */
function repoRoots(root: string): string[] {
  try {
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(path.join(root, ".git"), "utf8"))?.[1]?.trim();
    if (!gitdir) return [root];
    const common = path.resolve(gitdir, readFileSync(path.join(gitdir, "commondir"), "utf8").trim());
    return [...new Set([root, path.dirname(common)])];
  } catch {
    return [root]; // .git is a directory (a main checkout) or missing
  }
}

// Typed loosely: Next.js declares NODE_ENV required on ProcessEnv, and the child deliberately gets none.
const childEnv: Record<string, string> = {
  PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
  HOME: process.env.HOME || homedir(),
  LANG: process.env.LANG || "en_US.UTF-8",
  TMPDIR: tmpDir,
};

/** Hosts the ask callback refused while the current command ran. */
let currentAsks: Violation[] | undefined;
let running: ChildProcess | undefined;

const deny = (reason: string) => (SandboxManager.askCallbackDenyReason ? { allow: false as const, reason } : false);

/** srt asks here about a host no rule decided. Plug-in point for the policy engine's decide() (T7 network). */
async function askHost({ host, port }: { host: string; port: number | undefined }) {
  currentAsks?.push(port === undefined ? { host } : { host, port });
  return deny(`${host} is not in this workbench's allowed domains`);
}

if (!SandboxManager.isSupportedPlatform()) fail(`srt cannot sandbox on ${process.platform}; refusing to run commands unsandboxed`);
const deps = SandboxManager.checkDependencies();
if (deps.errors.length) fail(`srt dependencies missing: ${deps.errors.join("; ")}`);
await SandboxManager.initialize(
  sandboxConfig({
    workspace,
    tmpDir,
    repoRoots: repoRoots(CODE_ROOT),
    home: homedir(),
    allowedDomains: values["allow-domain"] ?? [],
    extraDenyRead: values["deny-read"] ?? [],
  }),
  askHost,
  true, // the macOS log monitor: seatbelt denies become violations
);

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function killGroup(child: ChildProcess) {
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {
    // the group is already gone
  }
}

/** Run a wrapped command with a wall-clock kill and an output cap. */
function spawnBounded(wrapped: string, timeoutMs: number): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    // detached: the child leads its own process group, so one kill reaches everything it started.
    const child: ChildProcess = spawn(wrapped, [], { shell: "/bin/sh", cwd: workspace, env: childEnv as NodeJS.ProcessEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    running = child;
    const chunks: Buffer[] = [];
    let kept = 0;
    let total = 0;
    const take = (data: Buffer) => {
      total += data.length;
      if (kept >= OUTPUT_CAP) return;
      const part = data.subarray(0, OUTPUT_CAP - kept);
      chunks.push(part);
      kept += part.length;
    };
    child.stdout!.on("data", take);
    child.stderr!.on("data", take);

    let exitCode = 1;
    let timedOut = false;
    let done = false;
    let grace: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child);
    }, timeoutMs);
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      running = undefined;
      let output = Buffer.concat(chunks).toString("utf8");
      if (total > kept) output += `\n[workbench: output truncated, ${total - kept} of ${total} bytes dropped]`;
      if (timedOut) output += `\n[workbench: killed after the ${timeoutMs} ms timeout]`;
      resolve({ output, exitCode: timedOut ? 124 : exitCode });
    };
    child.on("exit", (code, signal) => {
      exitCode = code ?? 128 + (signal ? constants.signals[signal] : 0);
      killGroup(child); // what the command left running in its group dies with it
      // A process that left the group (setsid) can hold the pipes open; don't wait on it.
      grace = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish();
      }, 500);
    });
    child.on("close", finish);
    child.on("error", (error) => {
      take(Buffer.from(`workbench: ${error.message}\n`));
      finish();
    });
  });
}

async function violationsFor(commandId: string, exitCode: number): Promise<Violation[]> {
  const store = SandboxManager.getSandboxViolationStore();
  // Seatbelt denies arrive through `log stream`, usually before the command closes; give a failed one a moment.
  for (let waited = 0; exitCode !== 0 && waited < 200 && store.getViolationsForCommand(commandId).length === 0; waited += 20) {
    await sleep(20);
  }
  return store.getViolationsForCommand(commandId).map((v) => ({ line: v.line }));
}

async function runSandboxed(command: string, timeoutMs: number, commandId: string): Promise<BashResult> {
  const asks: Violation[] = [];
  currentAsks = asks;
  try {
    // srt hands the child TMPDIR=/tmp/claude (denied by policy); point it at this run's temp dir. commandText keeps
    // violations naming the agent's command rather than this prefix.
    const inner = `export TMPDIR=${shQuote(tmpDir)}\n${command}`;
    const wrapped = await SandboxManager.wrapWithSandbox(inner, "bash", undefined, undefined, { commandId, commandText: command });
    if (wrapped === inner) throw new Error("srt returned the command unwrapped; refusing to run it");
    const { output, exitCode } = await spawnBounded(wrapped, timeoutMs);
    return { output, exitCode, violations: [...(await violationsFor(commandId, exitCode)), ...asks] };
  } finally {
    currentAsks = undefined;
    SandboxManager.cleanupAfterCommand();
  }
}

const server = new McpServer({ name: "workbench", version: "0.1.0" });
let queue: Promise<unknown> = Promise.resolve();

server.registerTool(
  "bash",
  {
    description: [
      "Run one bash command in this project's sandbox. Returns JSON { output, exitCode, violations }.",
      "- The working directory is the project workspace. You can write only there and in $TMPDIR; any other write fails with 'Operation not permitted'.",
      "- Secret paths (~/.ssh, ~/.aws, ~/.config, keychains, the repo's .env* files and .data stores) can't be read.",
      "- The network reaches only this project's allowed domains; any other host is refused and listed in violations as { host, port }.",
      `- The command is killed after timeoutMs (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}) with exitCode 124; anything it left running is killed when it exits.`,
      `- output is stdout and stderr combined, cut to the first ${OUTPUT_CAP} bytes.`,
      "- violations lists what the sandbox blocked during this call. A blocked action stays blocked: work inside the workspace, or report what you need, rather than retrying it.",
    ].join("\n"),
    inputSchema: {
      command: z.string().min(1),
      timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
    },
  },
  async ({ command, timeoutMs }, extra) => {
    // One stdio connection per server process, so the JSON-RPC request id is unique for the store's lifetime.
    const result = queue.then(() => runSandboxed(command, timeoutMs ?? DEFAULT_TIMEOUT_MS, String(extra.requestId)));
    queue = result.catch(() => undefined);
    return { content: [{ type: "text", text: JSON.stringify(await result) }] };
  },
);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (running) killGroup(running);
  await SandboxManager.reset().catch(() => undefined);
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(0);
}
process.stdin.on("end", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await server.connect(new StdioServerTransport());
