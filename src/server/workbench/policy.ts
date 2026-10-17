/*
 * The workbench's rules, pure: what a sandboxed command may read, write and reach, and its limits.
 *
 * srt (@anthropic-ai/sandbox-runtime) enforces them: reads are allowed except denyRead, writes are denied except
 * allowWrite (minus denyWrite), and the network is denied except allowedDomains. A host no rule decides goes to the
 * server's ask callback.
 */
import path from "node:path";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";

export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 600_000;
/** Bytes of combined stdout+stderr a call returns; the rest is dropped behind a marker. */
export const OUTPUT_CAP = 32 * 1024;

/** One srt event (seatbelt deny line or proxy deny), or a host the ask callback refused. */
export type Violation = { line: string } | { host: string; port?: number };
export type BashResult = { output: string; exitCode: number; violations: Violation[] };

export type SandboxConfigInput = {
  /** Real absolute path: the one directory commands may write. */
  workspace: string;
  /** Real absolute path: this run's temp dir, the child's TMPDIR. */
  tmpDir: string;
  /** Checkouts whose secrets stay hidden: the code's own and, from a git worktree, the main checkout. */
  repoRoots: string[];
  home: string;
  allowedDomains?: string[];
  extraDenyRead?: string[];
};

const HOME_SECRETS = [".ssh", ".aws", ".config", "Library/Keychains"];
// `*.db*` covers SQLite's -wal and -shm files, which hold the same rows as the .db.
const REPO_SECRETS = [".env*", ".data/vault", ".data/policy", ".data/*.db*", ".data/ledger.jsonl"];
// srt keeps these writable even when unlisted (its own TMPDIR and two home log dirs); denyWrite wins over
// allowWrite, so closing them leaves the workspace and tmpDir as the only writable trees.
const SRT_DEFAULT_WRITES = ["/tmp/claude", "/private/tmp/claude"];
const SRT_DEFAULT_HOME_WRITES = [".npm/_logs", ".claude/debug"];

export function sandboxConfig({
  workspace,
  tmpDir,
  repoRoots,
  home,
  allowedDomains = [],
  extraDenyRead = [],
}: SandboxConfigInput): SandboxRuntimeConfig {
  return {
    network: { allowedDomains: [...allowedDomains], deniedDomains: [] },
    filesystem: {
      denyRead: [
        ...HOME_SECRETS.map((p) => path.join(home, p)),
        ...repoRoots.flatMap((root) => REPO_SECRETS.map((p) => path.join(root, p))),
        ...extraDenyRead,
      ],
      allowWrite: [workspace, tmpDir],
      denyWrite: [...SRT_DEFAULT_WRITES, ...SRT_DEFAULT_HOME_WRITES.map((p) => path.join(home, p))],
    },
  };
}
