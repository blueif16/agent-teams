/*
 * State files in the vault (design §8b, G §8): `projects/<pid>/state/*` in the one vault repo. Reads come from the
 * vault's working tree, which the vault keeps equal to HEAD. Writes go through one per-project lock (read, check,
 * write never interleave for a project), and each state change is ONE `writeMany` commit. Every file in it carries
 * the blob sha the tools read, so an outside edit made in between rejects the whole commit and changes nothing.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { agentVault } from "@/lib/agent-files";
import type { TrailerInput, VaultAuthor, VaultCommit } from "@/lib/vault/types";
import { getVault, VaultConflictError, type Vault } from "@/server/runtime/vault";
import { parseCharter, parseDecisions, parseJournal, parseJson, parsePrefs } from "./format";
import { Dag, OpenItems, ProjectId, Roster, type ProjectState } from "./schema";

export const stateDir = (pid: string) => `projects/${pid}/state`;
export const statePath = (pid: string, file: string) => `${stateDir(pid)}/${file}`;
export const journalPath = (pid: string, window: number) => statePath(pid, `journal/${window}.md`);
/** Worker reports, under the project's shared files (F §9.1 `files/reports/<task>-<n>.md`). */
export const reportsDir = (pid: string) => `projects/${pid}/files/reports`;
export const reportPath = (pid: string, taskId: string, n: number) => `${reportsDir(pid)}/${taskId}-${String(n).padStart(2, "0")}.md`;

export const FILES = { dag: "dag.json", roster: "roster.json", open: "open.json", decisions: "decisions.md", prefs: "prefs.md", charter: "charter.md" } as const;

/** git's blob id for these bytes (`git hash-object`): the vault's expectedBlob for a file as we read it. */
export function gitBlob(content: string): string {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

interface Raw {
  content: string | null;
  /** Blob sha of what was read; null when the file doesn't exist. */
  blob: string | null;
}

export interface Snapshot {
  state: ProjectState;
  /** What each state file held when it was read, by vault path. */
  raw: Map<string, Raw>;
}

async function readRaw(vault: Vault, p: string): Promise<Raw> {
  try {
    const content = await readFile(path.join(vault.dir, p), "utf8");
    return { content, blob: gitBlob(content) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return { content: null, blob: null };
  }
}

async function numbered(vault: Vault, dir: string, pattern: RegExp): Promise<number[]> {
  try {
    const names = await readdir(path.join(vault.dir, dir));
    return names.flatMap((n) => {
      const m = pattern.exec(n);
      return m ? [Number(m[1])] : [];
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return [];
  }
}

/** Report numbers already filed for a task. */
export const reportNumbers = (vault: Vault, pid: string, taskId: string) => numbered(vault, reportsDir(pid), new RegExp(`^${taskId}-([0-9]+)\\.md$`));

/** Reads and validates every state file. Missing files are empty; a file that doesn't parse throws StateFileError. */
export async function loadSnapshot(vault: Vault, pid: string): Promise<Snapshot> {
  const windows = await numbered(vault, statePath(pid, "journal"), /^([1-9][0-9]*)\.md$/);
  const window = windows.length ? Math.max(...windows) : 1;
  const paths = [...Object.values(FILES).map((f) => statePath(pid, f)), journalPath(pid, window)];
  const raws = await Promise.all(paths.map((p) => readRaw(vault, p)));
  const raw = new Map(paths.map((p, i) => [p, raws[i]]));
  const text = (file: string) => raw.get(statePath(pid, file))!.content;

  const dagText = text(FILES.dag);
  const dag = dagText === null ? { pid, rev: 0, updatedAt: null, tasks: [] } : parseJson(statePath(pid, FILES.dag), dagText, Dag);
  if (dag.pid !== pid) throw new Error(`${statePath(pid, FILES.dag)} belongs to project ${dag.pid}`);
  const rosterText = text(FILES.roster);
  const roster = rosterText === null ? { rev: 0, updatedAt: null, members: [] } : parseJson(statePath(pid, FILES.roster), rosterText, Roster);
  const openText = text(FILES.open);
  const open = openText === null ? { rev: 0, updatedAt: null, items: [] } : parseJson(statePath(pid, FILES.open), openText, OpenItems);
  const decisionsText = text(FILES.decisions);
  const prefsText = text(FILES.prefs);
  const charterText = text(FILES.charter);
  const journalText = raw.get(journalPath(pid, window))!.content;
  const lines = journalText === null ? [] : parseJournal(journalText, journalPath(pid, window));

  const state: ProjectState = {
    pid,
    // Every write adds a journal line with its rev, and the JSON files record theirs, so the newest is the project's.
    // A new journal window must open with a line that carries the rev forward.
    rev: Math.max(dag.rev, roster.rev, open.rev, lines.at(-1)?.rev ?? 0),
    dag,
    roster,
    open,
    decisions: decisionsText === null ? [] : parseDecisions(decisionsText, statePath(pid, FILES.decisions)),
    prefs: prefsText === null ? [] : parsePrefs(prefsText, statePath(pid, FILES.prefs)),
    charter: charterText === null ? null : parseCharter(charterText, pid, statePath(pid, FILES.charter)),
    journal: { window, lines },
  };
  return { state, raw };
}

// ------------------------------------------------------------------------------------------------- lock

const locks = new Map<string, Promise<unknown>>();

/** Runs `fn` alone for this project in this vault: no other state read-check-write for it interleaves. */
export function withProject<T>(vault: Vault, pid: string, fn: () => Promise<T>): Promise<T> {
  const key = `${vault.dir}\0${pid}`;
  const next = (locks.get(key) ?? Promise.resolve()).then(fn);
  const settled = next.catch(() => undefined);
  locks.set(key, settled);
  void settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key);
  });
  return next;
}

/** The project's state as it is now, as one consistent snapshot (for the UI, the window opener and tests). */
export async function readState(projectId: string): Promise<ProjectState> {
  const pid = ProjectId.parse(projectId);
  const vault = getVault();
  return withProject(vault, pid, async () => (await loadSnapshot(vault, pid)).state);
}

// ----------------------------------------------------------------------------------------------- commit

/** Another writer changed a state file between our read and our commit; nothing was written. */
export class OutsideEditError extends Error {
  constructor(readonly path: string) {
    super(`${path} was changed outside the state tools while this write was being made; nothing was written`);
    this.name = "OutsideEditError";
  }
}

export interface Commit {
  files: { path: string; content: string }[];
  author: VaultAuthor;
  source: "tool" | "report";
  subject: string;
  trailers: TrailerInput;
}

/** The app vault, wired with the secret scrub and the cache hook (agent-files' agentVault). */
export const writerVault = (): Promise<Vault> => agentVault();

/**
 * One commit for the whole change. Each file's expected blob is what the snapshot read (null, "must not exist", for
 * a file it didn't read), so the vault rejects the commit if any of them moved underneath us.
 */
export async function commitFiles(vault: Vault, snap: Snapshot, c: Commit): Promise<VaultCommit | null> {
  try {
    return await vault.writeMany({
      files: c.files.map((f) => ({ ...f, expectedBlob: snap.raw.get(f.path)?.blob ?? null })),
      author: c.author,
      source: c.source,
      subject: c.subject,
      trailers: c.trailers,
    });
  } catch (e) {
    if (e instanceof VaultConflictError) throw new OutsideEditError(e.path);
    throw e;
  }
}
