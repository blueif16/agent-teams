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
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DiffHunk, DiffSegment, FileDiff, FileHistory, VaultAuthor, VaultCommit, VaultSource, VaultWriteManyRequest, VaultWriteRequest } from "@/lib/vault/types";
import { getServerCache } from "@/server/cache";
import { TOPICS } from "@/server/cache/bus";

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

  /**
   * Writes several files and commits them together. Every expected blob is checked before any file is touched, so
   * one stale file rejects the whole write. Resolves to the commit, or null when nothing changed.
   */
  async writeMany(req: VaultWriteManyRequest): Promise<VaultCommit | null> {
    if (!SOURCES.has(req.source)) throw new Error(`Bad source "${req.source}"`);
    if (!req.files.length) throw new Error("writeMany needs at least one file");
    const files = req.files.map((f) => ({ path: checkPath(f.path), content: f.content }));
    if (new Set(files.map((f) => f.path)).size !== files.length) throw new Error("writeMany got the same path twice");
    const job: Job = {
      files,
      author: req.author,
      source: req.source,
      subject: checkSubject(req.subject ?? defaultSubject(files[0].path, req.source)),
      trailers: trailerPairs(req.trailers),
      expect: req.files.flatMap((f) => (f.expectedBlob === undefined ? [] : [{ path: f.path, blob: f.expectedBlob }])),
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

  /** Word diff of the file between two changes; `from` null diffs against "no file yet". */
  async diff(p: string, from: string | null, to: string): Promise<FileDiff> {
    checkPath(p);
    const toSha = await this.resolve(p, to);
    const fromSha = from ? await this.resolve(p, from) : await this.emptyTree();
    const out = await this.git([
      "diff", "--no-color", "--no-ext-diff", "--no-renames", "--word-diff=porcelain", "-U3", fromSha, toSha, "--", p,
    ]);
    const hunks = parseWordDiff(out.stdout);
    const words = (op: DiffSegment["op"]) =>
      hunks.flatMap((h) => h.lines.flat()).reduce((n, s) => n + (s.op === op ? (s.text.match(/\S+/g)?.length ?? 0) : 0), 0);
    return { path: p, from, to, hunks, stats: { added: words("add"), removed: words("del") } };
  }

  /** The file's exact content at a change (or sha), or at HEAD; null if it didn't exist there. */
  async show(p: string, at?: string): Promise<string | null> {
    checkPath(p);
    if (!(await this.hasCommits())) {
      if (at) throw new VaultNotFoundError(`No change ${at} for ${p}`);
      return null;
    }
    const sha = at ? await this.resolve(p, at) : "HEAD";
    const out = await this.git(["cat-file", "blob", `${sha}:${p}`], { ok: [0, 128] });
    return out.code === 0 ? out.stdout : null;
  }

  /** Puts the file back as it was at `change`, as a new commit with `Restores:`; nothing is reset. */
  async restore(p: string, change: string, author: VaultAuthor = OWNER): Promise<VaultCommit | null> {
    checkPath(p);
    const target = (await this.history(p)).commits.find((c) => c.change === change || c.sha === change);
    if (!target) throw new VaultNotFoundError(`No change ${change} for ${p}`);
    const content = await this.show(p, target.sha);
    if (content === null) throw new VaultNotFoundError(`${p} didn't exist at ${change}`);
    const when = `${target.at.slice(0, 10)} ${target.at.slice(11, 16)} UTC`;
    return this.write({
      path: p,
      content,
      author,
      source: "restore",
      subject: `${typeOf(p)}(${agentOf(p) ?? "vault"}): restore ${path.posix.basename(p)} to the version of ${when}`,
      trailers: { Restores: target.change },
    });
  }

  /**
   * One seed commit of every file under an app-style agents folder (`<src>/<id>/**`), at
   * `agents/<id>/**`. Files the vault already has are left alone, so running it again is a no-op.
   */
  async importFrom(src: string): Promise<VaultCommit | null> {
    const root = path.resolve(src);
    const found: { path: string; abs: string }[] = [];
    for (const e of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (!e.isFile()) continue;
      const abs = path.join(e.parentPath, e.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (!rel.includes("/") || rel.split("/").some((seg) => seg.startsWith("."))) continue;
      found.push({ path: checkPath(`agents/${rel}`), abs });
    }
    found.sort((a, b) => (a.path < b.path ? -1 : 1));
    return this.enqueue(async () => {
      const fresh = found.filter((f) => !existsSync(path.join(this.dir, f.path)));
      if (!fresh.length) return null;
      const agents = [...new Set(fresh.map((f) => agentOf(f.path)))];
      const n = fresh.length;
      return this.commitNow({
        files: await Promise.all(fresh.map(async (f) => ({ path: f.path, content: await readFile(f.abs, "utf8") }))),
        author: RUNTIME,
        source: "seed",
        subject: `agent(${agents.length === 1 ? agents[0] : "*"}): import ${n} existing file${n === 1 ? "" : "s"} as the seed`,
        trailers: [],
        expect: [],
      });
    });
  }

  /** Plug hooks in after construction: the detector pack's scrub, the cache's onCommit. */
  configure(hooks: { scrub?: Scrub; onCommit?: CommitHook }): void {
    if ("scrub" in hooks) this.scrub = hooks.scrub;
    if ("onCommit" in hooks) this.onCommit = hooks.onCommit;
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

  /** A change id (or a commit sha) in this file's history → its sha. */
  private async resolve(p: string, ref: string): Promise<string> {
    const missing = () => new VaultNotFoundError(`No change ${ref} for ${p}`);
    if (!/^(c_[0-9A-HJKMNP-TV-Z]{26}|[0-9a-f]{7,40})$/.test(ref) || !(await this.hasCommits())) throw missing();
    const out = await this.git(["log", "--format=%H%x1f%(trailers:key=Change,valueonly,separator=)", "HEAD", "--", p]);
    for (const line of out.stdout.split("\n")) {
      const [sha, change] = line.split("\x1f");
      if (sha && (change === ref || sha.startsWith(ref))) return sha;
    }
    throw missing();
  }

  private emptyTreeSha?: string;
  private async emptyTree(): Promise<string> {
    return (this.emptyTreeSha ??= (await this.git(["hash-object", "-t", "tree", "--stdin"], { input: "" })).stdout.trim());
  }

  private async clean(text: string): Promise<ScrubResult> {
    if (!this.scrub) return { text, redacted: 0 };
    const out = await this.scrub(text);
    return typeof out === "string" ? { text: out, redacted: 0 } : out;
  }

  /** One job = one commit (G §2.3): check expectations, scrub, write each file atomically, commit, report. */
  private async commitNow(raw: Job): Promise<VaultCommit | null> {
    await this.init();
    for (const e of raw.expect) {
      const actual = await this.blob(e.path);
      if (actual !== e.blob) throw new VaultConflictError(e.path, e.blob, actual);
    }

    // Scrub before anything touches disk: file bodies, the subject and every trailer value (G §6).
    let redacted = 0;
    const scrub = async (s: string) => {
      const out = await this.clean(s);
      redacted += out.redacted;
      return out.text;
    };
    const files: Job["files"] = [];
    for (const f of raw.files) files.push({ path: f.path, content: await scrub(f.content) });
    const subject = checkSubject(await scrub(raw.subject));
    const scrubbed: [string, string][] = [];
    for (const [k, v] of raw.trailers) {
      const value = (await scrub(v)).trim();
      if (!value || CONTROL.test(value)) throw new Error(`Bad value for trailer ${k} after scrubbing`);
      scrubbed.push([k, value]);
    }
    if (redacted > 0) scrubbed.push(["Redacted", String(redacted)]);
    const job: Job = { ...raw, files, subject, trailers: scrubbed };

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

    const out = await this.git(["log", "-1", "--no-renames", "--numstat", `--format=${LOG_FORMAT}`, "HEAD", "--", ...paths]);
    const commit = parseLog(out.stdout)[0];
    // Still inside the queue, so the cache sees commits in order; a failing hook never undoes a commit.
    for (const f of job.files) {
      try {
        await this.onCommit?.(f.path, f.content, commit);
      } catch (e) {
        console.error(`[vault] onCommit failed for ${f.path} at ${commit.change}:`, e);
      }
    }
    return commit;
  }
}

/** Parses `git diff --word-diff=porcelain` for one file into hunks of lines of segments. */
function parseWordDiff(out: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let hunk: DiffHunk | null = null;
  let line: DiffSegment[] = [];
  for (const raw of out.split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (m) {
      if (hunk && line.length) hunk.lines.push(line);
      hunk = { oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4], lines: [] };
      hunks.push(hunk);
      line = [];
      continue;
    }
    if (!hunk) continue; // the diff --git / index / ---/+++ header
    if (raw === "~") {
      hunk.lines.push(line);
      line = [];
      continue;
    }
    const op = raw[0] === " " ? "same" : raw[0] === "+" ? "add" : raw[0] === "-" ? "del" : null;
    if (op) line.push({ op, text: raw.slice(1) });
  }
  if (hunk && line.length) hunk.lines.push(line);
  // git marks an added or removed blank line with a bare "~"; when a hunk has only one side, we know which.
  for (const h of hunks) {
    const only = h.oldLines === 0 ? "add" : h.newLines === 0 ? "del" : null;
    if (only) h.lines = h.lines.map((l) => (l.length ? l : [{ op: only, text: "" }]));
  }
  return hunks;
}

// The process's vault, kept on globalThis so dev reloads don't start a second queue on the same repo.
const G = globalThis as { __agentTeamsVault?: Vault };

/**
 * The app vault's onCommit: announce `files:agent:<id>` on the server cache's bus, so every open view of
 * that agent's files (Identity, History) revalidates through the client cache. Compose it with your own
 * hook rather than replacing it.
 */
export const announceCommit: CommitHook = (p) => {
  const agent = agentOf(p);
  if (agent) getServerCache().bus.emit(TOPICS.files(agent));
};

/** The app's vault: `$VAULT_DIR`, else `.data/vault`. Every route and writer shares it. */
export function getVault(): Vault {
  return (G.__agentTeamsVault ??= new Vault({ dir: process.env.VAULT_DIR || undefined, onCommit: announceCommit }));
}

/** Replace the app's vault (boot wiring with hooks, or a temp vault in tests); null resets to the default. */
export function setVault(vault: Vault | null): void {
  G.__agentTeamsVault = vault ?? undefined;
}

interface Job {
  files: { path: string; content: string }[];
  author: VaultAuthor;
  source: VaultSource;
  subject: string;
  trailers: [string, string][];
  expect: { path: string; blob: string | null }[];
}
