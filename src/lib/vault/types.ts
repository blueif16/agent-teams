/*
 * Shapes of the vault: the git repo under every agent-facing file (G §2–§3).
 * Shared by the server writer (src/server/runtime/vault.ts), the routes and
 * the History view, so nothing here touches the server.
 */

/** The versioned files of an agent, by the name the routes use. */
export const AGENT_FILES = { soul: "SOUL.md", memory: "MEMORY.md", notes: "notes.md" } as const;
export type AgentFileName = keyof typeof AGENT_FILES;

export const isAgentFileName = (name: string): name is AgentFileName => Object.hasOwn(AGENT_FILES, name);

/** Vault-relative path of an agent file, e.g. `agents/mira/SOUL.md`. */
export const agentFilePath = (agentId: string, name: AgentFileName) => `agents/${agentId}/${AGENT_FILES[name]}`;

/** Who made a change. Agents are `<id>@agents.agent-teams.local`, the owner `owner@agent-teams.local`. */
export interface VaultAuthor {
  kind: "owner" | "agent" | "system";
  id: string;
  name: string;
}

/** Why a change happened; written as the `Source:` trailer on every commit. */
export type VaultSource = "seed" | "owner" | "pin" | "dream" | "tool" | "report" | "inherit" | "restore";

/**
 * Trailer keys from G §3. Callers may add others (e.g. `Archetype`), but `Change`, `Vault-Schema` and
 * `Source` are written by the vault itself.
 */
export type TrailerKey =
  | "Change"
  | "Vault-Schema"
  | "Source"
  | "Agent"
  | "Project"
  | "Run"
  | "Dream"
  | "Tool"
  | "Task"
  | "Rev"
  | "Op"
  | "Evidence"
  | "Seeded-From"
  | "Derived-From"
  | "Held-Back"
  | "Skill"
  | "Supersedes"
  | "Approved-By"
  | "Restores"
  | "Reverts"
  | "Labels"
  | "Redacted"
  | "Archetype";

/** Parsed trailers: keys can repeat, so every key maps to its values in commit order. */
export type VaultTrailers = Record<string, string[]>;

/** Trailers a writer passes: one value or several per key. */
export type TrailerInput = Partial<Record<TrailerKey, string | string[]>> & Record<string, string | string[] | undefined>;

/** One commit, as seen from one file's history. */
export interface VaultCommit {
  /** Stable change id (`Change:` trailer, `c_<ulid>`); every cross-reference uses it, never a sha. */
  change: string;
  sha: string;
  /** Author time, ISO in UTC. */
  at: string;
  author: VaultAuthor;
  /** Written by code from a template (`<type>(<scope>): <summary>`), never by a model. */
  subject: string;
  source: VaultSource;
  trailers: VaultTrailers;
  /** Lines added and removed in the file this history is for (the whole commit for multi-file writes). */
  stats: { added: number; removed: number };
}

export interface FileHistory {
  /** Vault-relative path, e.g. `agents/mira/SOUL.md`. */
  path: string;
  /** Blob sha of the file now, or null if it doesn't exist; pass it back as `expectedBlob`. */
  blob: string | null;
  /** Newest first. The last one is the file's origin. */
  commits: VaultCommit[];
}

/** One run of text in a word diff. */
export interface DiffSegment {
  op: "same" | "add" | "del";
  text: string;
}

/** A hunk of a word diff: each line is a list of segments (an empty list is a blank line). */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffSegment[][];
}

export interface FileDiff {
  path: string;
  /** Change id of the older side, or null for "the file didn't exist yet". */
  from: string | null;
  to: string;
  hunks: DiffHunk[];
  /** Words added and removed. */
  stats: { added: number; removed: number };
}

export interface VaultWriteRequest {
  /** Vault-relative path, e.g. `agents/mira/MEMORY.md`. */
  path: string;
  content: string;
  author: VaultAuthor;
  source: VaultSource;
  /** Code-written subject; omitted, the vault writes one from the source and path. */
  subject?: string;
  trailers?: TrailerInput;
  /**
   * Optimistic concurrency: the blob sha the writer read (null = "the file must not exist yet").
   * A stale value rejects the write with VaultConflictError and leaves the file as it is.
   */
  expectedBlob?: string | null;
}
