/*
 * Each agent's SOUL.md and MEMORY.md, after Muse's home files.
 *
 * SOUL.md is how the agent should work: an Inherent section (how its type of
 * agent does the job best; changes slowly) and a section for its project
 * (techniques to master there, plus 📌 standing instructions).
 * MEMORY.md is what it has learned by doing: work done, mistakes, and the
 * approaches that worked.
 *
 * Server only. Locally the files live in the vault (.data/vault/agents/<id>/,
 * design §8b): every change is a commit with its source (seed, owner, pin), and
 * secrets are scrubbed before anything reaches git. The repo's agents/ folder
 * only seeds the vault once; missing files are created from templates.
 * On Vercel the disk is read-only, so edits go to /tmp, unversioned, and last
 * only as long as the instance.
 * Reads and writes go through the server cache, so a file is read from disk
 * once and every save announces files:agent:<id>.
 */
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getServerCache, set as setCached } from "@/server/cache";
import { announceCommit, getVault, OWNER, RUNTIME, VaultConflictError, type ScrubResult, type Vault } from "@/server/runtime/vault";
import { agentType, getAgent, type DirectoryAgent } from "@/server/directory";
import { scan } from "./policy/detectors";
import { INHERENT, type AgentType } from "./inherent";

export { agentType, INHERENT, type AgentType };

const VERSIONED = !process.env.VERCEL;
/** The repo's agents/: the vault's seed locally, the bundled read-only copy on Vercel. */
const repoRoot = () => path.join(process.cwd(), "agents");
/** Where files are read and written: the current app vault's agents/, or /tmp on Vercel. */
const writeRoot = () => (VERSIONED ? path.join(getVault().dir, "agents") : path.join(tmpdir(), "agent-teams", "agents"));

export type AgentFile = "soul" | "memory";

export interface FileInfo {
  content: string;
  /** Last change, ISO. */
  updated: string;
}



const today = () => new Date().toISOString().slice(0, 10);
const bullets = (lines: string[]) => lines.map((l) => `- ${l}`).join("\n");
const fileName = (which: AgentFile) => (which === "soul" ? "SOUL.md" : "MEMORY.md");
const fileOf = (id: string, which: AgentFile, root = writeRoot()) => path.join(root, id, fileName(which));
const vaultPath = (id: string, which: AgentFile) => `agents/${id}/${fileName(which)}`;

/** Secrets (labels secret.*) in a file body become placeholders; PII stays, the owner wrote it on purpose. */
async function scrubSecrets(text: string): Promise<ScrubResult> {
  const spans = (await scan(text)).filter((s) => s.label.startsWith("secret.")).sort((a, b) => b.start - a.start);
  let out = text;
  for (const s of spans) out = `${out.slice(0, s.start)}[redacted ${s.label}]${out.slice(s.end)}`;
  return { text: out, redacted: spans.length };
}

let wired: { vault: Vault; ready: Promise<Vault> } | null = null;

/**
 * The app vault, ready for agent files: the secret scrub and the cache hook plugged in, and the repo's agents/
 * imported once (a no-op when the vault already has them). Every writer and the history routes go through this.
 * Wired again whenever the app's vault is replaced (setVault).
 */
export function agentVault(): Promise<Vault> {
  const vault = getVault();
  if (wired?.vault === vault) return wired.ready;
  const ready = (async () => {
    vault.configure({
      scrub: scrubSecrets,
      // Cache first, then announce, so a view that revalidates on the topic reads the committed content.
      onCommit: (p, content, commit) => {
        setCached(path.join(vault.dir, p), content);
        return announceCommit(p, content, commit);
      },
    });
    if (existsSync(repoRoot())) await vault.importFrom(repoRoot());
    return vault;
  })().catch((e) => {
    if (wired?.vault === vault) wired = null;
    throw e;
  });
  wired = { vault, ready };
  return ready;
}

/** Where the agent works, as its SOUL.md names it: `#channel`, or the project's name for a DM. */
const placeOf = (agent: DirectoryAgent) => (agent.home.channel ? `#${agent.home.channel}` : `"${agent.home.name}"`);

/** SOUL.md from the agent's archetype (its Inherent section) and its current project. */
export function soulTemplate(agent: DirectoryAgent): string {
  const type = agent.archetype;
  const place = placeOf(agent);
  const qualified = agent.qualifications.length ? `\nQualifications for this role: ${agent.qualifications.join(", ")}.\n` : "";
  return `# ${agent.name}'s soul

${agent.role} on ${place} · type: ${type}

Personality: ${agent.brief}

## Inherent

How a ${type} does this job best. Applies on every team and changes slowly.

${bullets(INHERENT[type])}

## In ${place}

What to master on this project. Grows as the work teaches it.

Goal: ${agent.home.goal}
${qualified}
### Standing instructions

_None yet. Pin a message with 📌 to add one._
`;
}

export function memoryTemplate(agent: Pick<DirectoryAgent, "name">): string {
  return `# ${agent.name}'s memory

What ${agent.name} has done, what went wrong, and what works. Newest first.

## Done

_Nothing yet._

## Mistakes

_None recorded yet._

## Best approaches

_None recorded yet._
`;
}

async function readInfo(file: string): Promise<FileInfo> {
  const { content, updated } = await getServerCache().files.read(file);
  // Vercel stamps bundled files with a fixed 2018 date; the build time is the honest bound.
  const bundled = !VERSIONED && file.startsWith(repoRoot());
  return { content, updated: (bundled && process.env.AGENTS_BUILT_AT) || updated };
}

async function readIfThere(file: string): Promise<FileInfo | null> {
  try {
    return await readInfo(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return null;
  }
}

async function ensure(agent: DirectoryAgent, which: AgentFile): Promise<FileInfo> {
  const { id } = agent;
  const file = fileOf(id, which);
  const template = () => (which === "soul" ? soulTemplate(agent) : memoryTemplate(agent));
  if (VERSIONED) {
    const vault = await agentVault();
    const found = await readIfThere(file);
    if (found) return found;
    // expectedBlob null: only if the file still doesn't exist, so a racing request's file is never overwritten.
    await vault
      .write({ path: vaultPath(id, which), content: template(), author: RUNTIME, source: "seed", expectedBlob: null, trailers: { Archetype: agent.archetype } })
      .catch((e) => {
        if (!(e instanceof VaultConflictError)) throw e;
      });
    return readInfo(file);
  }
  const found = (await readIfThere(file)) ?? (await readIfThere(fileOf(id, which, repoRoot())));
  if (found) return found;
  // Exclusive: never overwrites a file another request created first.
  await getServerCache()
    .files.write(file, template(), { exclusive: true })
    .catch((e) => {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    });
  return readInfo(file);
}

export async function readAgentFiles(id: string): Promise<{ soul: FileInfo; memory: FileInfo }> {
  const agent = getAgent(id);
  if (!agent) throw new Error(`Unknown agent "${id}"`);
  const [soul, memory] = await Promise.all([ensure(agent, "soul"), ensure(agent, "memory")]);
  return { soul, memory };
}

/** Saves a file; `source` says why ("owner" edited it in the profile, "pin" came from a 📌). */
export async function writeAgentFile(id: string, which: AgentFile, content: string, source: "owner" | "pin" = "owner"): Promise<FileInfo> {
  if (!getAgent(id)) throw new Error(`Unknown agent "${id}"`);
  const file = fileOf(id, which);
  const body = content.endsWith("\n") ? content : `${content}\n`;
  if (VERSIONED) await (await agentVault()).write({ path: vaultPath(id, which), content: body, author: OWNER, source });
  else await getServerCache().files.write(file, body);
  return readInfo(file);
}

/** 📌 adds a standing instruction to the project section of the agent's soul. */
export async function addStandingInstruction(id: string, text: string): Promise<void> {
  const { soul } = await readAgentFiles(id);
  const line = `- ${today()} · ${text.replace(/\s+/g, " ").trim()}`;
  const marker = "### Standing instructions";
  const at = soul.content.indexOf(marker);
  let content: string;
  if (at === -1) {
    content = `${soul.content.trimEnd()}\n\n${marker}\n\n${line}\n`;
  } else {
    // Newest first, right under the heading; the placeholder goes away.
    const head = soul.content.slice(0, at + marker.length);
    const rest = soul.content.slice(at + marker.length).replace(/^\n+/, "").replace(/^_None yet\.[^\n]*\n?/, "");
    content = `${head}\n\n${line}\n${rest}`;
  }
  await writeAgentFile(id, "soul", content, "pin");
}
