/*
 * The server cache: one per process, kept on globalThis so dev-server module
 * reloads (and each route's own copy of this module) share it, as getLimiter() does.
 *   ledger  the performance ledger, read once and kept in memory
 *   files   agents' Markdown (SOUL.md, MEMORY.md, …), watched for outside edits
 *   skills  the skill library (skills/index.json and its vendored files), watched for imports
 *   bus     topics and version numbers for every change, for GET /api/events
 * Single owner, local-first: nothing here is per user.
 */
import { tmpdir } from "node:os";
import path from "node:path";
import { skillsDir, type Library } from "@/lib/skills/library";
import { Bus } from "./bus";
import { FileCache, type CachedFile } from "./files";
import { LedgerCache } from "./ledger";
import { SkillCache } from "./skills";

export interface ServerCache {
  bus: Bus;
  ledger: LedgerCache;
  files: FileCache;
  /** The library under `dir` (default: SKILLS_DIR, read per call, or skills/), watched from its first use. */
  skills(dir?: string): SkillCache;
  /** Stops the watchers (tests). */
  close(): void;
}

// On Vercel the disk is read-only except /tmp, so writes live there and last only as long as the instance.
const dataDir = () => (process.env.VERCEL ? path.join(tmpdir(), "agent-teams") : path.join(process.cwd(), ".data"));
// The same roots agent-files.ts reads and writes (ROOT and, on Vercel, WRITE_ROOT).
const agentRoots = () => [
  path.join(process.cwd(), "agents"),
  ...(process.env.VERCEL ? [path.join(tmpdir(), "agent-teams", "agents")] : []),
];

function createServerCache(): ServerCache {
  const bus = new Bus();
  const ledger = new LedgerCache(path.join(dataDir(), "ledger.jsonl"), bus);
  const files = new FileCache({ bus, roots: agentRoots() });
  const libraries = new Map<string, SkillCache>();
  const skills = (dir = skillsDir()) => {
    const key = path.resolve(dir);
    let lib = libraries.get(key);
    if (!lib) {
      libraries.set(key, (lib = new SkillCache({ bus, dir: key })));
      lib.watch();
    }
    return lib;
  };
  // Read the ledger and start watching now, so another writer's changes are seen before anyone asks.
  ledger.ready().catch((e) => console.warn("Couldn't read the ledger:", (e as Error).message));
  files.watch();
  skills();
  return {
    bus,
    ledger,
    files,
    skills,
    close: () => {
      ledger.close();
      files.close();
      for (const lib of libraries.values()) lib.close();
    },
  };
}

export function getServerCache(): ServerCache {
  const g = globalThis as { __agentTeamsCache?: ServerCache };
  return (g.__agentTeamsCache ??= createServerCache());
}

/** The skill library from memory, for the skills routes. */
export function skillLibrary(): Promise<Library> {
  return getServerCache().skills().library();
}

/** For the vault writer: drop a file it changed, so the next read comes from disk. */
export function invalidate(file: string): void {
  getServerCache().files.invalidate(file);
}

/** For the vault writer: hand over a file's new content so the next read needs no disk. */
export function set(file: string, content: string): CachedFile {
  return getServerCache().files.set(file, content);
}
