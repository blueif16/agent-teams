/*
 * What the company learned between two snapshots, read from a real git repo shaped like the vault: commits with
 * Source and Agent trailers touching memory, soul, skill and composition files.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { changesBetween, learnedText } from "./learning";

let dir: string;
const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

function commit(files: Record<string, string>, subject: string, trailers: Record<string, string>) {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), text);
  }
  git("add", "-A");
  const body = Object.entries(trailers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", subject, "-m", body);
  return git("rev-parse", "HEAD");
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sim-learning-"));
  git("init", "-q");
});

describe("changesBetween", () => {
  it("lists each changed file once, with its area, agent, commit count, sources and line counts", async () => {
    const base = commit({ "agents/w1/MEMORY.md": "# Memory\n" }, "seed", { Source: "seed", Agent: "w1" });
    commit({ "agents/w1/MEMORY.md": "# Memory\n- Tag every number.\n" }, "dream", { Source: "dream", Agent: "w1" });
    commit({ "agents/w1/MEMORY.md": "# Memory\n- Tag every number.\n- Quote prices verbatim.\n" }, "dream", { Source: "dream", Agent: "w1" });
    const head = commit({ "agents/w1/skills/copywriting/SKILL.md": "# Copy\n\nCite facts.\n" }, "tune", { Source: "tool", Agent: "w1" });

    const changes = await changesBetween(dir, base, head);
    const memory = changes.find((c) => c.path === "agents/w1/MEMORY.md");
    expect(memory).toMatchObject({ area: "memory", agentId: "w1", commits: 2, sources: ["dream"], added: 2, removed: 0 });
    expect(changes.find((c) => c.path.endsWith("SKILL.md"))).toMatchObject({ area: "skill", agentId: "w1", commits: 1, added: 3 });
    expect(changes).toHaveLength(2);
  });

  it("files a SOUL edit and a composition note under their own areas", async () => {
    const base = commit({ "README.md": "vault\n" }, "init", { Source: "seed" });
    const head = commit(
      { "agents/w1/SOUL.md": "## Standing\n- Plain words.\n", "company/compositions/market-report.md": "PM + 3\n" },
      "pin and note",
      { Source: "pin" },
    );
    const areas = Object.fromEntries((await changesBetween(dir, base, head)).map((c) => [c.path, c.area]));
    expect(areas).toEqual({ "agents/w1/SOUL.md": "soul", "company/compositions/market-report.md": "composition" });
  });

  it("is empty when nothing changed between the snapshots", async () => {
    const base = commit({ "README.md": "vault\n" }, "init", { Source: "seed" });
    expect(await changesBetween(dir, base, base)).toEqual([]);
  });
});

describe("learnedText", () => {
  it("returns only the added lines of learning files, for the leak check", async () => {
    const base = commit({ "agents/w1/MEMORY.md": "- old line\n", "projects/p1/memo.md": "Tern should charge $24\n" }, "seed", { Source: "seed" });
    const head = commit(
      { "agents/w1/MEMORY.md": "- old line\n- Tern liked short memos.\n", "projects/p1/memo.md": "Tern should charge $19\n" },
      "dream",
      { Source: "dream" },
    );
    const text = await learnedText(dir, base, head);
    expect(text).toContain("Tern liked short memos.");
    expect(text).not.toContain("old line");
    expect(text).not.toContain("$19");
  });
});
