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
  // git's default (addIfDifferentNeighbor) silently drops a trailer identical to the one before it.
  "-c", "trailer.ifexists=add",
  "-c", "trailer.where=end",
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

/** G §3: `<type>(<scope>): <summary>`, one line, from a template. Model text belongs in files only. */
const SUBJECT = /^(memory|soul|state|skill|agent|company|restore|forget|sweep)\([A-Za-z0-9_.*,-]+\): [^\n\r]{1,100}$/;
function checkSubject(s: string): string {
  if (!SUBJECT.test(s) || CONTROL.test(s)) throw new Error(`Bad subject "${s.slice(0, 80)}": write "<type>(<scope>): <summary>" on one line`);
  return s;
}

const SOURCES = new Set<VaultSource>(["seed", "owner", "pin", "dream", "tool", "report", "inherit", "restore"]);
const RESERVED = new Set(["change", "vault-schema", "source"]);
const TRAILER_KEY = /^[A-Za-z][A-Za-z0-9-]*$/;
// Control characters would break the trailer block and our parse.
const CONTROL = /[\x00-\x1f\x7f]/;

/** A writer's trailers as ordered pairs; anything git couldn't round-trip is refused up front. */
function trailerPairs(input: VaultWriteRequest["trailers"]): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, v] of Object.entries(input ?? {})) {
    if (v === undefined) continue;
    if (!TRAILER_KEY.test(key)) throw new Error(`Bad trailer key "${key}"`);
    if (RESERVED.has(key.toLowerCase())) throw new Error(`The vault writes the ${key} trailer itself`);
    for (const raw of Array.isArray(v) ? v : [v]) {
      const value = raw.trim();
      if (!value || CONTROL.test(raw)) throw new Error(`Bad value for trailer ${key}: one non-empty line`);
      out.push([key, value]);
    }
  }
  return out;
}

// %x1e starts a commit, %x1f separates fields, %x1d separates trailers, %x1c splits key from value.
const LOG_FORMAT = "%x1e%H%x1f%aI%x1f%an%x1f%ae%x1f%s%x1f%(trailers:only,unfold,separator=%x1d,key_value_separator=%x1c)%x1f";

function parseAuthor(name: string, email: string): VaultAuthor {
  const at = email.lastIndexOf("@");
  const local = at > 0 ? email.slice(0, at) : email;
  const domain = at > 0 ? email.slice(at + 1) : "";
  if (domain === "agents.agent-teams.local") return { kind: "agent", id: local, name };
  if (domain === "system.agent-teams.local") return { kind: "system", id: local, name };
  // The owner, including hand commits made in the vault with a real address.
  return { kind: "owner", id: local || "owner", name };
}

/** Parses `git log --format=LOG_FORMAT --numstat` output, newest first. */
function parseLog(out: string): VaultCommit[] {
  return out
    .split("\x1e")
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [sha, at, name, email, subject, rawTrailers, numstat = ""] = chunk.split("\x1f");
      const trailers: Record<string, string[]> = {};
      for (const t of rawTrailers.split("\x1d")) {
        const cut = t.indexOf("\x1c");
        if (cut <= 0) continue;
        (trailers[t.slice(0, cut)] ??= []).push(t.slice(cut + 1));
      }
      const stats = { added: 0, removed: 0 };
      for (const line of numstat.split("\n")) {
        const m = /^(\d+|-)\t(\d+|-)\t/.exec(line);
        if (!m) continue;
        stats.added += m[1] === "-" ? 0 : Number(m[1]);
        stats.removed += m[2] === "-" ? 0 : Number(m[2]);
      }
      const source = trailers.Source?.[0] as VaultSource | undefined;
      return {
        change: trailers.Change?.[0] ?? sha,
        sha,
        at: new Date(at).toISOString(),
        author: parseAuthor(name, email),
        subject,
        // A commit without a known Source was made by hand in the vault, i.e. by the owner.
        source: source && SOURCES.has(source) ? source : "owner",
        trailers,
        stats,
      };
    });
}

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
  async write(req: VaultWriteRequest): Promise<VaultCommit | null> {
    if (!SOURCES.has(req.source)) throw new Error(`Bad source "${req.source}"`);
    const job: Job = {
      files: [{ path: checkPath(req.path), content: req.content }],
      author: req.author,
      source: req.source,
      subject: checkSubject(req.subject ?? defaultSubject(req.path, req.source)),
      trailers: trailerPairs(req.trailers),
      expect: req.expectedBlob === undefined ? [] : [{ path: req.path, blob: req.expectedBlob }],
    };
    authorLine(req.author);
    return this.enqueue(() => this.commitNow(job));
  }

  /** Blob sha of the file as it is on disk now, or null if there's no such file. */
  async blob(p: string): Promise<string | null> {
    checkPath(p);
    if (!existsSync(path.join(this.dir, ".git")) || !existsSync(path.join(this.dir, p))) return null;
    return (await this.git(["hash-object", "--", p])).stdout.trim();
  }

  /** Every commit that touched the file, newest first, with trailers parsed by git. */
  async history(p: string): Promise<FileHistory> {
    checkPath(p);
    if (!(await this.hasCommits())) return { path: p, blob: null, commits: [] };
    const out = await this.git(["log", "--no-renames", "--numstat", `--format=${LOG_FORMAT}`, "HEAD", "--", p]);
    return { path: p, blob: await this.blob(p), commits: parseLog(out.stdout) };
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

  private async hasCommits(): Promise<boolean> {
    if (!existsSync(path.join(this.dir, ".git"))) return false;
    return (await this.git(["rev-parse", "--verify", "-q", "HEAD"], { ok: [0, 1, 128] })).code === 0;
  }

  /** One job = one commit (G §2.3): check expectations, write each file atomically, commit, report. */
  private async commitNow(job: Job): Promise<VaultCommit | null> {
    await this.init();
    for (const e of job.expect) {
      const actual = await this.blob(e.path);
      if (actual !== e.blob) throw new VaultConflictError(e.path, e.blob, actual);
    }

    const paths = job.files.map((f) => f.path);
    const before = new Map<string, Buffer | null>();
    try {
      for (const f of job.files) {
        const abs = path.join(this.dir, f.path);
        before.set(f.path, existsSync(abs) ? await readFile(abs) : null);
        await mkdir(path.dirname(abs), { recursive: true });
        const tmp = `${abs}.${process.pid}.${Date.now().toString(36)}.tmp`;
        await writeFile(tmp, f.content);
        await rename(tmp, abs);
      }
      await this.git(["add", "--", ...paths]);
      const staged = await this.git(["diff", "--cached", "--quiet", "--", ...paths], { ok: [0, 1] });
      if (staged.code === 0) return null;

      const agents = [...new Set(paths.map(agentOf).filter((a): a is string => !!a))];
      const own = job.trailers.some(([k]) => k.toLowerCase() === "agent");
      const trailers: [string, string][] = [
        ["Change", changeId()],
        ["Vault-Schema", "1"],
        ["Source", job.source],
        ...(own ? [] : agents.map((a): [string, string] => ["Agent", a])),
        ...job.trailers,
      ];
      await this.git(
        [
          "commit", "-q", "--no-verify", "-F", "-", `--author=${authorLine(job.author)}`,
          ...trailers.flatMap(([k, v]) => ["--trailer", `${k}: ${v}`]),
          "--", ...paths,
        ],
        { input: `${job.subject}\n` },
      );
      const out = await this.git(["log", "-1", "--no-renames", "--numstat", `--format=${LOG_FORMAT}`, "HEAD", "--", ...paths]);
      return parseLog(out.stdout)[0];
    } catch (e) {
      // Put the working tree back as HEAD has it: agents read these files directly.
      await this.git(["reset", "-q", "--", ...paths], { ok: [0, 1, 128] }).catch(() => undefined);
      for (const [p, bytes] of before) {
        const abs = path.join(this.dir, p);
        if (bytes) await writeFile(abs, bytes);
        else await unlink(abs).catch(() => undefined);
      }
      throw e;
    }
  }
}

interface Job {
  files: { path: string; content: string }[];
  author: VaultAuthor;
  source: VaultSource;
  subject: string;
  trailers: [string, string][];
  expect: { path: string; blob: string | null }[];
}
