/*
 * The vault: one git repo under every agent-facing file (G §2), at .data/vault/
 * by default and never pushed. All writes go through one FIFO queue per repo,
 * so commits never interleave; each write can carry the blob sha its writer
 * read, and a stale one is rejected (an owner edit beats a racing dream).
 *
 * Server only. Uses the git CLI via execFile with the user's config, hooks and
 * signing kept out.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileDiff, FileHistory, VaultAuthor, VaultCommit, VaultSource, VaultWriteRequest } from "@/lib/vault/types";

export interface ScrubResult {
  text: string;
  redacted: number;
}
/** Runs over every file body and trailer value before anything touches disk (E5's fourth site, G §6). */
export type Scrub = (text: string) => string | ScrubResult | Promise<string | ScrubResult>;
/** Called after each commit, once per file it wrote, with the content as committed. */
export type CommitHook = (path: string, content: string, commit: VaultCommit) => void | Promise<void>;

export interface VaultOptions {
  /** Repo directory; created and `git init`ed on first write. Default `.data/vault` under the cwd. */
  dir?: string;
  scrub?: Scrub;
  onCommit?: CommitHook;
  /** git binary; default `xcrun --find git` on macOS (skips the /usr/bin shim), else `git`. */
  git?: string;
}

export const OWNER: VaultAuthor = { kind: "owner", id: "owner", name: "Owner" };
export const RUNTIME: VaultAuthor = { kind: "system", id: "runtime", name: "Agent Teams runtime" };

/** A write's expected blob didn't match the file; nothing was written. */
export class VaultConflictError extends Error {
  constructor(
    readonly path: string,
    readonly expected: string | null,
    readonly actual: string | null,
  ) {
    super(`${path} changed since it was read (expected ${expected ?? "no file"}, found ${actual ?? "no file"})`);
    this.name = "VaultConflictError";
  }
}

/** A change, version or file the caller named isn't in the vault. */
export class VaultNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultNotFoundError";
  }
}

// ---------------------------------------------------------------------------------------------- git

const COMMITTER = { name: RUNTIME.name, email: "runtime@agent-teams.local" };
const CONFIG = [
  "-c", "core.hooksPath=/dev/null",
  "-c", "commit.gpgsign=false",
  "-c", "core.autocrlf=false",
  "-c", "core.quotepath=false",
  "-c", "core.fsmonitor=false",
];

let resolvedGit: Promise<string> | undefined;
function defaultGit(): Promise<string> {
  return (resolvedGit ??= new Promise((resolve) => {
    if (process.platform !== "darwin") return resolve("git");
    execFile("xcrun", ["--find", "git"], (err, stdout) => resolve(err || !stdout.trim() ? "git" : stdout.trim()));
  }));
}

interface GitResult {
  stdout: string;
  code: number;
}

function gitEnv(dir: string): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_")) env[k] = v;
  return {
    ...env,
    NODE_ENV: process.env.NODE_ENV,
    // Pin the repo so a missing .git can never fall through to an enclosing repo (the app's own).
    GIT_DIR: path.join(dir, ".git"),
    GIT_WORK_TREE: dir,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_COMMITTER_NAME: COMMITTER.name,
    GIT_COMMITTER_EMAIL: COMMITTER.email,
  };
}

// --------------------------------------------------------------------------------------- conventions

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** `c_<ulid>`: 48 bits of ms time + 80 random bits, Crockford base32. */
function changeId(now = Date.now()): string {
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let rand = "";
  for (const b of bytes) rand += CROCKFORD[b % 32];
  return `c_${time}${rand}`;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function authorLine(a: VaultAuthor): string {
  if (!SAFE_ID.test(a.id)) throw new Error(`Bad author id "${a.id}"`);
  const name = a.name.replace(/[<>\n\r]/g, "").trim() || a.id;
  const email =
    a.kind === "agent" ? `${a.id}@agents.agent-teams.local` : a.kind === "system" ? `${a.id}@system.agent-teams.local` : `${a.id}@agent-teams.local`;
  return `${name} <${email}>`;
}

function checkPath(p: string): string {
  const ok =
    p.length > 0 &&
    !p.startsWith("/") &&
    !p.includes("\\") &&
    !p.includes("\0") &&
    path.posix.normalize(p) === p &&
    !p.split("/").some((seg) => seg === ".." || seg === "." || seg === ".git");
  if (!ok) throw new Error(`Bad vault path "${p}"`);
  return p;
}

const agentOf = (p: string) => /^agents\/([^/]+)\//.exec(p)?.[1];

function typeOf(p: string): string {
  if (!agentOf(p)) return "company";
  const file = path.posix.basename(p);
  if (file === "SOUL.md") return "soul";
  if (file === "MEMORY.md" || file === "notes.md") return "memory";
  return "agent";
}

const SUMMARY: Record<VaultSource, (file: string) => string> = {
  seed: (f) => `seed ${f} from the template`,
  owner: (f) => `edit ${f}`,
  pin: () => "pin a standing instruction",
  dream: (f) => `consolidate ${f} after a dream`,
  tool: (f) => `update ${f} with a tool`,
  report: (f) => `update ${f} from a report`,
  inherit: (f) => `inherit ${f}`,
  restore: (f) => `restore an earlier ${f}`,
};

function defaultSubject(p: string, source: VaultSource): string {
  return `${typeOf(p)}(${agentOf(p) ?? "vault"}): ${SUMMARY[source](path.posix.basename(p))}`;
}

const SOURCES = new Set<VaultSource>(["seed", "owner", "pin", "dream", "tool", "report", "inherit", "restore"]);

// ------------------------------------------------------------------------------------------- vault

/** One queue per repo directory, so two Vault objects on the same dir still never interleave. */
const queues = new Map<string, Promise<unknown>>();

export class Vault {
  readonly dir: string;
  private scrub?: Scrub;
  private onCommit?: CommitHook;
  private gitBin?: string;
  private ready?: Promise<void>;

  constructor(opts: VaultOptions = {}) {
    this.dir = path.resolve(opts.dir ?? path.join(process.cwd(), ".data", "vault"));
    this.scrub = opts.scrub;
    this.onCommit = opts.onCommit;
    this.gitBin = opts.git;
  }

  /** Writes one file and commits it. Resolves to the commit, or null when the content didn't change. */
  write(req: VaultWriteRequest): Promise<VaultCommit | null> {
    checkPath(req.path);
    if (!SOURCES.has(req.source)) throw new Error(`Bad source "${req.source}"`);
    return this.enqueue(() => this.writeNow(req));
  }

  /** Blob sha of the file as it is on disk now, or null if there's no such file. */
  async blob(p: string): Promise<string | null> {
    checkPath(p);
    if (!existsSync(path.join(this.dir, ".git")) || !existsSync(path.join(this.dir, p))) return null;
    return (await this.git(["hash-object", "--", p])).stdout.trim();
  }

  async history(p: string): Promise<FileHistory> {
    return { path: p, blob: null, commits: [] };
  }

  async diff(p: string, from: string | null, to: string): Promise<FileDiff> {
    return { path: p, from, to, hunks: [], stats: { added: 0, removed: 0 } };
  }

  // ---------------------------------------------------------------------------------------- internals

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = (queues.get(this.dir) ?? Promise.resolve()).then(job);
    queues.set(
      this.dir,
      next.catch(() => undefined),
    );
    return next;
  }

  private async git(args: string[], opts: { input?: string; ok?: number[] } = {}): Promise<GitResult> {
    const bin = this.gitBin ?? (await defaultGit());
    const ok = opts.ok ?? [0];
    return new Promise((resolve, reject) => {
      const child = execFile(
        bin,
        [...CONFIG, ...args],
        { cwd: this.dir, env: gitEnv(this.dir), maxBuffer: 64 << 20, encoding: "utf8" },
        (err, stdout, stderr) => {
          const code = err ? (typeof err.code === "number" ? err.code : -1) : 0;
          if (ok.includes(code)) resolve({ stdout, code });
          else reject(new Error(`git ${args[0]} failed (${code}): ${(stderr || err?.message || "").trim()}`));
        },
      );
      child.stdin?.end(opts.input ?? "");
    });
  }

  private init(): Promise<void> {
    this.ready ??= (async () => {
      await mkdir(this.dir, { recursive: true });
      if (!existsSync(path.join(this.dir, ".git"))) await this.git(["init", "-q", "-b", "main"]);
    })().catch((e) => {
      this.ready = undefined;
      throw e;
    });
    return this.ready;
  }

  private async writeNow(req: VaultWriteRequest): Promise<VaultCommit | null> {
    await this.init();
    const abs = path.join(this.dir, req.path);
    if (req.expectedBlob !== undefined) {
      const actual = await this.blob(req.path);
      if (actual !== req.expectedBlob) throw new VaultConflictError(req.path, req.expectedBlob, actual);
    }

    const before = existsSync(abs) ? await readFile(abs) : null;
    await mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.${Date.now().toString(36)}.tmp`;
    await writeFile(tmp, req.content);
    await rename(tmp, abs);

    try {
      await this.git(["add", "--", req.path]);
      const staged = await this.git(["diff", "--cached", "--quiet", "--", req.path], { ok: [0, 1] });
      if (staged.code === 0) return null;

      const change = changeId();
      const subject = req.subject ?? defaultSubject(req.path, req.source);
      const agent = agentOf(req.path);
      const trailers: [string, string][] = [
        ["Change", change],
        ["Vault-Schema", "1"],
        ["Source", req.source],
        ...(agent ? ([["Agent", agent]] as [string, string][]) : []),
      ];
      await this.git(
        [
          "commit", "-q", "--no-verify", "-F", "-", `--author=${authorLine(req.author)}`,
          ...trailers.flatMap(([k, v]) => ["--trailer", `${k}: ${v}`]),
          "--", req.path,
        ],
        { input: `${subject}\n` },
      );
      const sha = (await this.git(["rev-parse", "HEAD"])).stdout.trim();
      const trailerMap: Record<string, string[]> = {};
      for (const [k, v] of trailers) (trailerMap[k] ??= []).push(v);
      return {
        change,
        sha,
        at: new Date().toISOString(),
        author: req.author,
        subject,
        source: req.source,
        trailers: trailerMap,
        stats: { added: 0, removed: 0 },
      };
    } catch (e) {
      // Leave the working tree as HEAD had it: agents read these files directly.
      await this.git(["reset", "-q", "--", req.path], { ok: [0, 1, 128] }).catch(() => undefined);
      if (before) await writeFile(abs, before);
      else await unlink(abs).catch(() => undefined);
      throw e;
    }
  }
}
