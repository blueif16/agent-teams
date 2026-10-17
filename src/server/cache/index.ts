/*
 * The server cache: one per process, kept on globalThis so dev-server module
 * reloads (and each route's own copy of this module) share it, as getLimiter() does.
 *   ledger  the performance ledger, read once and kept in memory
 *   files   agents' Markdown (SOUL.md, MEMORY.md, …), watched for outside edits
 *   bus     topics and version numbers for every change, for GET /api/events
 * Single owner, local-first: nothing here is per user.
 */
import { tmpdir } from "node:os";
import path from "node:path";
import { Bus } from "./bus";
import { FileCache, type CachedFile } from "./files";
import { LedgerCache } from "./ledger";

export interface ServerCache {
  bus: Bus;
  ledger: LedgerCache;
  files: FileCache;
  /** Stops the watchers (tests). */
  close(): void;
}

// On Vercel the disk is read-only except /tmp, so writes live there and last only as long as the instance.
const dataDir = () => (process.env.VERCEL ? path.join(tmpdir(), "agent-teams") : path.join(process.cwd(), ".data"));
// The same roots agent-files.ts reads and writes: locally the vault's agents/ (getVault's dir: $VAULT_DIR, else
// .data/vault); on Vercel the bundled agents/ and its /tmp copy.
const agentRoots = () =>
  process.env.VERCEL
    ? [path.join(process.cwd(), "agents"), path.join(tmpdir(), "agent-teams", "agents")]
    : [path.resolve(process.env.VAULT_DIR || path.join(dataDir(), "vault"), "agents")];

function createServerCache(): ServerCache {
  const bus = new Bus();
  const ledger = new LedgerCache(path.join(dataDir(), "ledger.jsonl"), bus);
  const files = new FileCache({ bus, roots: agentRoots() });
  // Read the ledger and start watching now, so another writer's changes are seen before anyone asks.
  ledger.ready().catch((e) => console.warn("Couldn't read the ledger:", (e as Error).message));
  files.watch();
  return {
    bus,
    ledger,
    files,
    close: () => {
      ledger.close();
      files.close();
    },
  };
}

export function getServerCache(): ServerCache {
  const g = globalThis as { __agentTeamsCache?: ServerCache };
  return (g.__agentTeamsCache ??= createServerCache());
}

/** For the vault writer: drop a file it changed, so the next read comes from disk. */
export function invalidate(file: string): void {
  getServerCache().files.invalidate(file);
}

/** For the vault writer: hand over a file's new content so the next read needs no disk. */
export function set(file: string, content: string): CachedFile {
  return getServerCache().files.set(file, content);
}
