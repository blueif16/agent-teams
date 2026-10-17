/*
 * The server cache: one per process, kept on globalThis so dev-server module
 * reloads (and each route's own copy of this module) share it, as getLimiter() does.
 *   ledger  the performance ledger, read once and kept in memory
 *   bus     topics and version numbers for every change, for GET /api/events
 * Single owner, local-first: nothing here is per user.
 */
import { tmpdir } from "node:os";
import path from "node:path";
import { Bus } from "./bus";
import { LedgerCache } from "./ledger";

export interface ServerCache {
  bus: Bus;
  ledger: LedgerCache;
  /** Stops the watchers (tests). */
  close(): void;
}

// On Vercel the disk is read-only except /tmp, so the ledger lives there and lasts only as long as the instance.
const dataDir = () => (process.env.VERCEL ? path.join(tmpdir(), "agent-teams") : path.join(process.cwd(), ".data"));

function createServerCache(): ServerCache {
  const bus = new Bus();
  const ledger = new LedgerCache(path.join(dataDir(), "ledger.jsonl"), bus);
  // Read the ledger and start watching it now, so another writer's lines are seen before anyone asks.
  ledger.ready().catch((e) => console.warn("Couldn't read the ledger:", (e as Error).message));
  return {
    bus,
    ledger,
    close: () => ledger.close(),
  };
}

export function getServerCache(): ServerCache {
  const g = globalThis as { __agentTeamsCache?: ServerCache };
  return (g.__agentTeamsCache ??= createServerCache());
}
