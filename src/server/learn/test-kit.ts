/*
 * Test kit for the learning step: one tiny seeded project (a PM and a copywriter, their memory and skill copies, a
 * charter that quotes the client's price, a shared library copy that must never change, ledger rows of this project
 * and of another one), the run feedback that goes with it, and git read back with the CLI. Call seedProject() after
 * tempEnv(). Imported by tests only.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { agentVault, memoryTemplate } from "@/lib/agent-files";
import { record, type CallEvent } from "@/lib/ledger";
import { MODELS } from "@/lib/models";
import type { Archetype } from "@/lib/policy/types";
import type { Composition } from "@/lib/skills/types";
import { getRuntimeDb } from "@/server/runtime/db";
import { RUNTIME } from "@/server/runtime/vault";
import type { RunFeedback } from "./types";

export const PID = "p_launch01";

export const CHARTER = `# Launch kit

Goal: Launch the Pro plan to field sales teams
Due: 2026-11-01
Success metric: 40 demo requests in the first week
Budget: $2

## Scope

Must:
- a pricing section that quotes $49/month per seat
- a landing page and a launch email

Won't:
- paid ads

## Roles

- PM: Pam (lead) Skills: acme/project-planning.
- Copywriter: Wren (writer) Skills: acme/copywriting.
`;

export const SKILL = (name: string, body: string) => `---\nname: ${name}\ndescription: ${body}\n---\n\n# ${name}\n\n- ${body}.\n`;

export const FEEDBACK: RunFeedback = {
  runId: "run-1",
  scenarioId: "launch-kit",
  trial: 1,
  failed: [
    {
      itemId: "prices_supported",
      label: "every price in the copy is in the pricing table",
      deliverable: "landing-copy",
      agentId: "wren",
      version: 2,
      evidence: [{ seq: 41, note: "the hero quotes a discount the table doesn't have" }],
    },
  ],
  orders: [{ order: "redo", agentId: "wren", deliverable: "landing-copy", note: "the hero has a number that isn't in the facts", seq: 40 }],
  slow: [{ phase: "work", ms: 600_000, prevMs: 400_000 }],
};

const comp = (archetype: Archetype, role: string, skills: string[]): Composition => ({
  id: `c-${role}`,
  archetype,
  skills,
  role,
  qualifications: [],
  source: "orchestrator",
  createdAt: "2026-10-17T10:00:00.000Z",
});

const call = (agent: string, cost: number, team = PID): CallEvent => ({
  t: "call",
  kind: "run",
  at: "2026-10-17T11:00:00.000Z",
  team,
  agent,
  model: MODELS.main,
  asked: MODELS.main,
  input: 1000,
  cached: 500,
  output: 200,
  ms: 1500,
  cost,
  ok: true,
  thread: `a:${agent}:p:${team}`,
  run: "r-1",
});

/** Seeds the project in the current DATA_DIR; resolves to the vault's directory. */
export async function seedProject(): Promise<string> {
  const db = getRuntimeDb();
  const vault = await agentVault();
  db.agents.create({ id: "pam", name: "Pam", archetype: "lead", config: { composition: comp("lead", "PM", ["acme/project-planning"]) } });
  db.agents.create({ id: "wren", name: "Wren", archetype: "writer", config: { composition: comp("writer", "Copywriter", ["acme/copywriting"]) } });
  db.projects.create({ id: PID, kind: "team", channel: "launch-kit", name: "Launch kit", goal: "Launch the Pro plan", status: "active", leadAgentId: "pam", specMd: CHARTER, budgetUsd: 2 });
  db.members.add({ projectId: PID, agentId: "pam", role: "PM" });
  db.members.add({ projectId: PID, agentId: "wren", role: "Copywriter" });
  const memory = memoryTemplate({ name: "Wren" }).replace("_None recorded yet._", "- Asked the PM for the facts sheet before drafting (observed)");
  await vault.writeMany({
    files: [
      { path: "agents/pam/MEMORY.md", content: memoryTemplate({ name: "Pam" }) },
      { path: "agents/wren/MEMORY.md", content: memory },
      { path: "agents/pam/skills/project-planning/SKILL.md", content: SKILL("project-planning", "Break the goal into tasks with owners") },
      { path: "agents/wren/skills/copywriting/SKILL.md", content: SKILL("copywriting", "Write benefit-led copy") },
      { path: "skills/writer/copywriting/SKILL.md", content: SKILL("copywriting", "The shared library copy") },
      { path: `projects/${PID}/state/charter.md`, content: CHARTER },
    ],
    author: RUNTIME,
    source: "seed",
    subject: "agent(*): seed the test project",
  });
  for (const row of [call("pam", 0.004), call("wren", 0.0083), call("pam", 1, "p_other")]) await record(row);
  return vault.dir;
}

const GIT = process.platform === "darwin" ? execFileSync("xcrun", ["--find", "git"], { encoding: "utf8" }).trim() : "git";
const GIT_ENV: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
  NODE_ENV: process.env.NODE_ENV,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

export interface GitCommit {
  sha: string;
  subject: string;
  trailers: Record<string, string[]>;
  files: string[];
}

/** The vault read with git itself, so a test can't pass by trusting the close's own summary. */
export function vaultReader(dir: string) {
  const git = (...args: string[]) => execFileSync(GIT, args, { cwd: dir, env: GIT_ENV, encoding: "utf8" });
  return {
    head: () => git("rev-parse", "HEAD").trim(),
    /** Commits after `since` (a sha), oldest first. */
    commitsSince(since: string): GitCommit[] {
      const out = git("log", "--reverse", "--name-only", "--format=%x1e%H%x1f%s%x1f%(trailers:only,unfold,separator=%x1d,key_value_separator=%x1c)%x1f", `${since}..HEAD`);
      return out
        .split("\x1e")
        .filter((c) => c.trim())
        .map((c) => {
          const [sha, subject, raw, names = ""] = c.split("\x1f");
          const trailers: Record<string, string[]> = {};
          for (const t of raw.split("\x1d")) {
            const cut = t.indexOf("\x1c");
            if (cut > 0) (trailers[t.slice(0, cut)] ??= []).push(t.slice(cut + 1));
          }
          return { sha, subject, trailers, files: names.split("\n").filter(Boolean) };
        });
    },
    file: (p: string) => readFile(path.join(dir, p), "utf8"),
  };
}
