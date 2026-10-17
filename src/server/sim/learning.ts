/*
 * What the company learned between two runs, read straight from the vault's git history (design §7): the memory,
 * soul, skill and composition files that changed from one run's start snapshot to the next, with how many commits,
 * from which sources (dream, pin, tool…) and how many lines. Project files (deliverables) are not learning and are
 * left out. learnedText returns the added lines of those same files, for the leak check (facts_in_learning).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FileChange } from "@/lib/sim/types";
import type { VaultSource } from "@/lib/vault/types";

const run = promisify(execFile);
const git = async (dir: string, args: string[]) => (await run("git", ["-C", dir, ...args], { maxBuffer: 32 * 1024 * 1024 })).stdout;

/** Which kind of learning a vault path holds; "other" is not learning (project files, the README). */
export function areaOf(p: string): FileChange["area"] {
  if (/^agents\/[^/]+\/MEMORY\.md$/.test(p)) return "memory";
  if (/^agents\/[^/]+\/SOUL\.md$/.test(p)) return "soul";
  if (/(^|\/)skills\//.test(p)) return "skill";
  if (/(^|\/)compositions?\//.test(p) || /composition/i.test(p)) return "composition";
  return "other";
}

const agentOf = (p: string) => /^agents\/([^/]+)\//.exec(p)?.[1];

export async function changesBetween(dir: string, from: string, to: string): Promise<FileChange[]> {
  if (from === to) return [];
  const out = await git(dir, [
    "log",
    "--no-renames",
    "--numstat",
    "--format=%x1e%(trailers:key=Source,valueonly,separator=%x2C)%x1f%(trailers:key=Agent,valueonly,separator=%x2C)",
    `${from}..${to}`,
  ]);
  const byPath = new Map<string, FileChange>();
  for (const record of out.split("\x1e").slice(1)) {
    const [head, ...lines] = record.split("\n");
    const [source = "", agent = ""] = head.split("\x1f");
    for (const line of lines) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m) continue;
      const p = m[3];
      const area = areaOf(p);
      if (area === "other") continue;
      const c = byPath.get(p) ?? { path: p, area, agentId: agentOf(p) ?? (agent.trim() || undefined), commits: 0, sources: [], added: 0, removed: 0 };
      c.commits += 1;
      c.added += m[1] === "-" ? 0 : Number(m[1]);
      c.removed += m[2] === "-" ? 0 : Number(m[2]);
      const s = source.trim() as VaultSource;
      if (s && !c.sources.includes(s)) c.sources.push(s);
      byPath.set(p, c);
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function learnedText(dir: string, from: string, to: string): Promise<string> {
  if (from === to) return "";
  const diff = await git(dir, ["diff", "--no-renames", "--unified=0", from, to]);
  const added: string[] = [];
  let learning = false;
  for (const line of diff.split("\n")) {
    const file = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (file) learning = areaOf(file[1]) !== "other";
    else if (learning && line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
  }
  return added.join("\n");
}
