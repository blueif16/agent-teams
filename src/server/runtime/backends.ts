/*
 * What a worker's file tools see (research D §2), one CompositeBackend per agent × project:
 *   /home/                  the vault's agents/<id> (SOUL.md, MEMORY.md), read-only
 *   /project/               <DATA_DIR>/projects/<projectId>/files, the project's shared folder
 *   /skills/                the skill library (SKILLS_DIR, else skills/), read-only
 *   /conversation_history/  <DATA_DIR>/history/<agentId>/<projectId>, where summarization offloads old messages
 *   anything else           scratch in graph state, per thread
 *
 * /home/ is read-only at the backend, not by a permission rule, so no tool, sub-agent or middleware can write
 * the vault's working tree behind its back: SOUL.md and MEMORY.md change only through vault commits (owner
 * edits, 📌, dreams). Server only.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  type BackendProtocolV2,
  CompositeBackend,
  type DeleteResult,
  type EditResult,
  FilesystemBackend,
  StateBackend,
  type WriteResult,
} from "deepagents";
import { skillsDir } from "@/lib/skills/library";
import { dataDir } from "../paths";
import { getVault } from "./vault";

/** A backend that reads through to `inner` and refuses every write, edit and delete with an error the model sees. */
export class ReadOnlyBackend implements BackendProtocolV2 {
  constructor(
    private readonly inner: BackendProtocolV2,
    private readonly why: string,
  ) {}

  private refuse(p: string): { error: string } {
    return { error: `${p} is read-only: ${this.why}` };
  }

  ls(p: string) {
    return this.inner.ls(p);
  }
  read(p: string, offset?: number, limit?: number) {
    return this.inner.read(p, offset, limit);
  }
  readRaw(p: string) {
    return this.inner.readRaw(p);
  }
  grep(pattern: string, p?: string | null, glob?: string | null, maxCount?: number | null) {
    return this.inner.grep(pattern, p, glob, maxCount);
  }
  glob(pattern: string, p?: string) {
    return this.inner.glob(pattern, p);
  }
  write(p: string): WriteResult {
    return this.refuse(p);
  }
  edit(p: string): EditResult {
    return this.refuse(p);
  }
  delete(p: string): DeleteResult {
    return this.refuse(p);
  }
}

const HOME_WHY = "SOUL.md and MEMORY.md change only through the owner (and 📌); put your work under /project/.";
const SKILLS_WHY = "the skill library is shared and vetted.";

/** A writable folder, created if missing. */
const folder = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  return new FilesystemBackend({ rootDir: dir, virtualMode: true });
};

/** Route paths, longest prefix first (D §2). The leading path segment is stripped before the routed backend sees it. */
export function workerBackend(agentId: string, projectId: string): CompositeBackend {
  const data = dataDir();
  return new CompositeBackend(new StateBackend(), {
    "/home/": new ReadOnlyBackend(new FilesystemBackend({ rootDir: path.join(getVault().dir, "agents", agentId), virtualMode: true }), HOME_WHY),
    "/project/": folder(path.join(data, "projects", projectId, "files")),
    "/skills/": new ReadOnlyBackend(new FilesystemBackend({ rootDir: skillsDir(), virtualMode: true }), SKILLS_WHY),
    "/conversation_history/": folder(path.join(data, "history", agentId, projectId)),
  });
}
