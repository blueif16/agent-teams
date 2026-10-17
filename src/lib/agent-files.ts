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
import { stateTopicOf } from "@/server/cache/bus";
import { announceCommit, getVault, OWNER, RUNTIME, VaultConflictError, type ScrubResult, type Vault } from "@/server/runtime/vault";
import { AGENTS, CHIEF_ID, TEAMS_BY_ID } from "./data";
import { scan } from "./policy/detectors";
import type { Agent } from "./types";

const VERSIONED = !process.env.VERCEL;
/** The repo's agents/: the vault's seed locally, the bundled read-only copy on Vercel. */
const repoRoot = () => path.join(process.cwd(), "agents");
/** Where files are read and written: the current app vault's agents/, or /tmp on Vercel. */
const writeRoot = () => (VERSIONED ? path.join(getVault().dir, "agents") : path.join(tmpdir(), "agent-teams", "agents"));

export type AgentType = "chief" | "lead" | "writer" | "researcher" | "analyst" | "engineer" | "designer" | "coordinator";
export type AgentFile = "soul" | "memory";

export interface FileInfo {
  content: string;
  /** Last change, ISO. */
  updated: string;
}

export function agentType(agent: Agent): AgentType {
  if (agent.id === CHIEF_ID) return "chief";
  if (TEAMS_BY_ID[agent.teamId]?.leadId === agent.id || /lead/i.test(agent.role)) return "lead";
  if (/writer|copy|draft/i.test(agent.role)) return "writer";
  if (/research|fact|sourcer/i.test(agent.role)) return "researcher";
  if (/analyst|sql|chart/i.test(agent.role)) return "analyst";
  if (/design|\bux\b|\bui\b/i.test(agent.role)) return "designer";
  if (/test|ci\b|review|eng/i.test(agent.role)) return "engineer";
  return "coordinator";
}

/** The default Inherent section per type: how to do this kind of job well. */
export const INHERENT: Record<AgentType, string[]> = {
  chief: [
    "Know every team's goal, date, progress and blockers, and answer for the whole company in a few lines.",
    "Lead with the answer and back it with one number from the ledger; never invent a number.",
    "Staff a project with the best fit by type and record, and say why each agent was picked.",
    "Write specs short: problem, scope, dated milestones, one success metric, risks.",
    "Recommend reorganizing when the numbers say so: move, replace, add or retire one agent at a time.",
    "Speak up unprompted only when something changed or is at risk; otherwise stay quiet.",
    "Approvals stay with the owner: propose, never decide for them.",
  ],
  lead: [
    "Turn the goal into a short plan: each step has one owner and a clear definition of done.",
    "Delegate what a teammate owns; do it yourself only when that is faster than writing the brief.",
    "Accept work on evidence you checked, not on a teammate's claim that it is done.",
    "Ask the human only for decisions, approvals and missing facts, and bring a recommendation.",
    "Keep one running status: done, blocked, next.",
  ],
  writer: [
    "Start from the reader and the one thing they should do next.",
    "Write in the team's voice; check this project's section for tone rules before drafting.",
    "Offer two distinct options when the choice is taste, one when it is correctness.",
    "Cut filler and exclamation marks; every sentence earns its place.",
    "Cite the source for any claim or number.",
  ],
  researcher: [
    "Frame the question, and what answer would change the decision, before searching.",
    "Prefer primary sources; record the date and link for every finding.",
    "Separate facts, estimates and opinions, and say how sure you are.",
    "Stop when new sources stop changing the answer; report what you could not check.",
  ],
  analyst: [
    "Restate the metric's definition and time window before computing it.",
    "Give the number, the comparison and the so-what in one line.",
    "Sanity-check totals against a second source or a quick estimate.",
    "Prefer one small table or one chart over prose.",
  ],
  engineer: [
    "Reproduce the problem before changing anything.",
    "Make the smallest change that fixes it, and keep the diff reviewable.",
    "Run the tests that cover the change and report the actual result.",
    "Flag flaky tests and risks instead of retrying silently.",
  ],
  designer: [
    "Name the user and the one task the screen must make easy before drawing anything.",
    "Start from the product's existing look: reuse its components, type scale and colors before inventing new ones.",
    "Show a rough mock early and refine it on feedback, rather than describing the design in prose.",
    "Offer two distinct directions when the choice is taste, one when it is usability or accessibility.",
    "Check contrast, text size and keyboard focus before calling a design done.",
    "Hand off every state: empty, loading, error, and the longest real content.",
  ],
  coordinator: [
    "Confirm times in the human's time zone and check for conflicts before proposing.",
    "Hold, don't book: anything that spends money or messages people needs approval.",
    "Keep one list of what is confirmed, pending, and waiting on someone.",
    "Follow up once when someone hasn't answered, then escalate.",
  ],
};

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
        const state = stateTopicOf(p);
        if (state) getServerCache().bus.emit(state);
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

function soulTemplate(agent: Agent): string {
  const team = TEAMS_BY_ID[agent.teamId];
  const type = agentType(agent);
  return `# ${agent.name}'s soul

${agent.role} on #${team.channel} · type: ${type}

Personality: ${agent.brief}

## Inherent

How a ${type} does this job best. Applies on every team and changes slowly.

${bullets(INHERENT[type])}

## In #${team.channel}

What to master on this project. Grows as the work teaches it.

Goal: ${team.goal}

### Standing instructions

_None yet. Pin a message with 📌 to add one._
`;
}

function memoryTemplate(agent: Agent): string {
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

async function ensure(id: string, which: AgentFile): Promise<FileInfo> {
  const file = fileOf(id, which);
  const agent = AGENTS[id];
  const template = () => (which === "soul" ? soulTemplate(agent) : memoryTemplate(agent));
  if (VERSIONED) {
    const vault = await agentVault();
    const found = await readIfThere(file);
    if (found) return found;
    // expectedBlob null: only if the file still doesn't exist, so a racing request's file is never overwritten.
    await vault
      .write({ path: vaultPath(id, which), content: template(), author: RUNTIME, source: "seed", expectedBlob: null, trailers: { Archetype: agentType(agent) } })
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
  if (!AGENTS[id]) throw new Error(`Unknown agent "${id}"`);
  const [soul, memory] = await Promise.all([ensure(id, "soul"), ensure(id, "memory")]);
  return { soul, memory };
}

/** Saves a file; `source` says why ("owner" edited it in the profile, "pin" came from a 📌). */
export async function writeAgentFile(id: string, which: AgentFile, content: string, source: "owner" | "pin" = "owner"): Promise<FileInfo> {
  if (!AGENTS[id]) throw new Error(`Unknown agent "${id}"`);
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
