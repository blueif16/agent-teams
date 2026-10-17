/*
 * File zones and write scopes, judged end to end by the real decide() over the defaults plus the zone rules: what an
 * agent may read and write is whatever the engine says for that path, never a second check.
 */
import { describe, expect, it } from "vitest";
import type { AgentContext } from "@/lib/policy/capabilities";
import { DEFAULT_RULES } from "@/lib/policy/defaults";
import { decide, explain } from "@/lib/policy/engine";
import { readBack } from "@/lib/policy/readback";
import { ARCHETYPES } from "@/lib/policy/schema";
import type { Archetype, GrantRule, Outcome, Rule, ToolRule } from "@/lib/policy/types";
import { deliverableProblem, fileEvent, fileRulesFor, filesFor, scopeRules } from "@/lib/policy/zones";

const NOW = new Date("2026-10-17T12:00:00Z");
const PID = "acme";

const agentOf = (archetype: Archetype, agentId = `${archetype}1`): AgentContext => ({ agentId, archetype, projectId: PID });
const REX = agentOf("researcher", "rex");

interface Opts {
  deliverables?: string[];
  rules?: Rule[];
  grants?: GrantRule[];
}

function rulesFor(a: AgentContext, o: Opts = {}): Rule[] {
  const store = [...DEFAULT_RULES, ...(o.rules ?? [])];
  return [...store, ...fileRulesFor(a, store, o.deliverables ?? [], NOW)];
}

/** What decide() says for one file call. */
function effect(a: AgentContext, tool: string, args: Record<string, unknown>, o: Opts = {}): Outcome {
  return decide(fileEvent(a, tool, args), rulesFor(a, o), o.grants ?? [], NOW).effect;
}
const write = (a: AgentContext, path: string, o?: Opts) => effect(a, "write_file", { file_path: path }, o);
const edit = (a: AgentContext, path: string, o?: Opts) => effect(a, "edit_file", { file_path: path }, o);
const read = (a: AgentContext, path: string, o?: Opts) => effect(a, "read_file", { file_path: path }, o);

/** Whether a locked rule voted deny: the decision can't be loosened by anything the owner or a grant adds. */
function lockedDeny(a: AgentContext, tool: string, path: string, o: Opts = {}): boolean {
  const x = explain(fileEvent(a, tool, { file_path: path }), rulesFor(a, o), o.grants ?? [], NOW);
  return x.decision.effect === "deny" && x.contributions.some((c) => c.outcome === "deny" && c.locked);
}

const ownerAllow = (over: Partial<ToolRule>): ToolRule => ({
  id: "r_owner1",
  kind: "tool",
  scope: {},
  match: { tools: ["write_file", "edit_file"] },
  effect: "allow",
  createdBy: "nl-compiler",
  ...over,
});

describe("researcher write scope", () => {
  it("writes and edits /project/research.md and nothing else in the project", () => {
    expect([write(REX, "/project/research.md"), edit(REX, "/project/research.md")]).toEqual(["allow", "allow"]);
    for (const p of ["/project/notes.md", "/project/research/notes.md", "/project/docs/a.md", "/project/research.md.bak"]) {
      expect([p, write(REX, p), edit(REX, p)]).toEqual([p, "deny", "deny"]);
    }
  });

  it("can't reach its SOUL.md by climbing out of /project", () => {
    expect(write(REX, "/project/../home/SOUL.md")).toBe("deny");
    expect(edit(REX, "/project/../home/SOUL.md")).toBe("deny");
    expect(write(REX, "/project/research.md")).toBe("allow");
  });

  it("matches its report case-insensitively, as macOS resolves it, after dropping // and a trailing slash", () => {
    expect(write(REX, "/project/RESEARCH.md")).toBe("allow");
    expect(write(REX, "/project//Research.md/")).toBe("allow");
    expect(write(REX, "/project/RESEARCH2.md")).toBe("deny");
  });

  it("reads project files it can't write", () => {
    expect([read(REX, "/project/notes.md"), write(REX, "/project/notes.md")]).toEqual(["allow", "deny"]);
  });
});

describe("designer write scope", () => {
  it("writes /project/design/a.excalidraw but not /project/docs/x.md", () => {
    const bo = agentOf("designer", "bo");
    expect(write(bo, "/project/design/a.excalidraw")).toBe("allow");
    expect(write(bo, "/project/design/landing/hero.excalidraw")).toBe("allow");
    expect(write(bo, "/project/docs/x.md")).toBe("deny");
  });
});

describe("each archetype's default write scope", () => {
  const inside: Record<Archetype, string | null> = {
    researcher: "/project/research.md",
    writer: "/project/docs/launch/post.md",
    designer: "/project/design/a.excalidraw",
    analyst: "/project/data/q3.csv",
    engineer: "/project/code/src/app.ts",
    lead: "/project/briefs/kickoff.md",
    chief: null,
    coordinator: null,
  };
  const all = Object.values(inside).filter((p): p is string => p !== null);

  for (const archetype of ARCHETYPES) {
    it(`${archetype} writes its own folder only, and scratch`, () => {
      const a = agentOf(archetype);
      const own = inside[archetype];
      for (const p of all) expect([p, write(a, p)]).toEqual([p, p === own ? "allow" : "deny"]);
      expect(write(a, "/project/x.md")).toBe("deny");
      expect(write(a, "/scratch/draft.md")).toBe("allow");
    });
  }
});

describe("path normalisation", () => {
  const kim = agentOf("writer", "kim");

  it("resolves .. before matching, so a writer can't climb from docs/ into /home or code/", () => {
    expect(write(kim, "/project/docs/../../home/SOUL.md")).toBe("deny");
    expect(write(kim, "/project/docs/../../skills/x/SKILL.md")).toBe("deny");
    expect(write(kim, "/project/docs/../code/x.ts")).toBe("deny");
    expect(write(kim, "/project/docs/./a/../b.md")).toBe("allow");
  });

  it("folds case and drops trailing slashes, so secrets can't hide as .ENV or .env/", () => {
    expect(write(kim, "/project/docs/.ENV")).toBe("deny");
    expect(write(kim, "/project/docs/.env/")).toBe("deny");
    expect(write(kim, "/project/docs/.Git/config")).toBe("deny");
    expect(write(kim, "/project/docs/env.md")).toBe("allow");
  });

  it("forbids a path that climbs above the root or isn't absolute", () => {
    expect(write(REX, "/../project/research.md")).toBe("deny");
    expect(write(REX, "research.md")).toBe("deny");
    expect(read(REX, "/../../etc/passwd")).toBe("deny");
    expect(read(REX, "/project/../../etc/passwd")).toBe("deny");
  });

  it("judges every path the call names, and a call that names none", () => {
    expect(effect(REX, "write_file", { path: "/project/research.md", file_path: "/project/notes.md" })).toBe("deny");
    expect(effect(REX, "write_file", { file_path: "/project/research.md", path: "/home/SOUL.md" })).toBe("deny");
    expect(effect(REX, "write_file", { path: "/project/research.md" })).toBe("allow");
    expect(effect(REX, "write_file", { content: "x" })).toBe("deny");
  });
});

describe("protected and forbidden zones", () => {
  const PROTECTED = ["/home/SOUL.md", "/home/MEMORY.md", "/home/notes.md", "/skills/research/SKILL.md", "/project/state/dag.json", "/state/decisions.md", "/conversation_history/t1.md"];
  // Several sit inside some archetype's own folder (code/, data/, design/), so the scope alone wouldn't stop them.
  const FORBIDDEN = ["/project/.env", "/project/code/.env.local", "/project/code/.git/config", "/project/data/runtime.db", "/project/design/.ssh/id_rsa", "/etc/passwd", "/Users/tk/.zshrc"];

  for (const archetype of ARCHETYPES) {
    it(`${archetype}: every protected path is write-denied by a locked rule, and stays readable`, () => {
      const a = agentOf(archetype);
      for (const p of PROTECTED) {
        for (const tool of ["write_file", "edit_file", "delete_file"]) expect([p, tool, lockedDeny(a, tool, p)]).toEqual([p, tool, true]);
        expect([p, read(a, p)]).toEqual([p, "allow"]);
      }
    });

    it(`${archetype}: every forbidden path is read- and write-denied by a locked rule`, () => {
      const a = agentOf(archetype);
      for (const p of FORBIDDEN) for (const tool of ["read_file", "write_file", "edit_file"]) expect([p, tool, lockedDeny(a, tool, p)]).toEqual([p, tool, true]);
      expect([effect(a, "ls", { path: "/project/code/.git" }), effect(a, "grep", { pattern: "KEY", path: "/project/.env" })]).toEqual(["deny", "deny"]);
    });
  }

  it("no owner allow, grant or deliverable relaxes them", () => {
    const o: Opts = {
      rules: [ownerAllow({ scope: { agents: ["rex"] }, args: [{ path: "path", op: "path_glob", value: ["/home/**", "/project/state/**", "**/.env"] }] }), ownerAllow({ id: "r_owner2", match: { tools: ["*"] } })],
      grants: [{ id: "r_grant1", kind: "grant", scope: {}, tool: "write_file", grantScope: "always", createdBy: "approval" }],
      deliverables: ["/home/SOUL.md", "/project/state/dag.json", "/project/.env"],
    };
    for (const p of ["/home/SOUL.md", "/project/state/dag.json", "/project/.env"]) expect([p, lockedDeny(REX, "write_file", p, o)]).toEqual([p, true]);
    expect(lockedDeny(REX, "read_file", "/project/.env", o)).toBe(true);
  });

  it("lists, globs and greps the shared folders, but not outside them", () => {
    expect(effect(REX, "ls", { path: "/project/" })).toBe("allow");
    expect(effect(REX, "ls", { path: "/" })).toBe("allow");
    expect(effect(REX, "glob", { pattern: "**/*.md" })).toBe("allow");
    expect(effect(REX, "ls", { path: "/etc" })).toBe("deny");
  });
});

describe("deliverables", () => {
  it("a PM task deliverable widens exactly one path for one agent", () => {
    const o = { deliverables: ["/project/research/competitors.md"] };
    expect(write(REX, "/project/research/competitors.md", o)).toBe("allow");
    expect(write(REX, "/project/research/other.md", o)).toBe("deny");
    expect(write(REX, "/project/research.md", o)).toBe("allow");
    expect(write(agentOf("researcher", "pia"), "/project/research/competitors.md")).toBe("deny");
  });

  it("a deliverable can't be the whole shared folder, or sit outside /project", () => {
    for (const d of ["/project/**", "/project/*", "**", "/home/notes.md", "/scratch2/x.md", "/project/../home/x.md"]) {
      expect([d, deliverableProblem(d)]).toEqual([d, expect.any(String)]);
    }
    expect(deliverableProblem("/project/research/competitors.md")).toBeNull();
    const o = { deliverables: ["/project/**", "/home/notes.md"] };
    expect([write(REX, "/project/notes.md", o), write(REX, "/home/notes.md", o)]).toEqual(["deny", "deny"]);
  });

  it("an owner's allow on one path widens that agent's scope to it, and only it", () => {
    const bo = agentOf("designer", "bo");
    const o = { rules: [ownerAllow({ scope: { agents: ["bo"] }, args: [{ path: "path", op: "path_glob", value: "/project/docs/landing-copy.md" }] })] };
    expect(write(bo, "/project/docs/landing-copy.md", o)).toBe("allow");
    expect(write(bo, "/project/docs/other.md", o)).toBe("deny");
    expect(write(agentOf("writer", "kim"), "/project/code/x.ts", o)).toBe("deny");
  });
});

describe("read-back", () => {
  it("every generated rule, for every archetype, has a reason and a plain sentence that names its paths", () => {
    for (const archetype of ARCHETYPES) {
      const rules = scopeRules(`${archetype}1`, archetype, PID, ["/project/briefs/extra.md"]);
      expect(rules.length).toBeGreaterThan(5);
      for (const r of rules) {
        expect(r.reason, r.id).toMatch(/^[A-Z].{8,158}[.]$/);
        const sentence = readBack(r);
        expect(sentence, r.id).toMatch(/^[A-Z].*\.$/);
        for (const c of r.args ?? []) for (const v of [c.value].flat() as string[]) expect(sentence, r.id).toContain(v);
      }
    }
  });
});

describe("filesFor: the Files section", () => {
  const row = (rows: ReturnType<typeof filesFor>, id: string) => rows.find((r) => r.id === id);

  it("shows a researcher its report, read-only project files, and locked zones in plain words", () => {
    const rows = filesFor(REX, DEFAULT_RULES, [], NOW);
    expect(rows[0]).toMatchObject({ label: "Its report (research.md)", severity: "deliverable", access: "edit" });
    expect(row(rows, "project")).toMatchObject({ label: "Project files", access: "read", locked: false });
    expect(row(rows, "scratch")).toMatchObject({ access: "edit" });
    for (const id of ["home", "skills", "state", "history"]) expect([id, row(rows, id)?.access, row(rows, id)?.locked]).toEqual([id, "protected", true]);
    expect(row(rows, "state")?.label).toBe("Team plan & decisions");
    for (const id of ["secrets", "stores", "outside"]) expect([id, row(rows, id)?.access]).toEqual([id, "never"]);
    expect(row(rows, "secrets")?.label).toBe("Secrets & settings");
    for (const r of rows) expect(r.reason, r.id).toMatch(/^[A-Z].+\.$/);
  });

  it("follows the owner's rules and the PM's deliverables", () => {
    const deny = { ...ownerAllow({ scope: { agents: ["rex"] }, args: [{ path: "path", op: "path_glob", value: "/project/research.md" }] }), effect: "deny" as const };
    expect(filesFor(REX, [...DEFAULT_RULES, deny], [], NOW)[0]).toMatchObject({ access: "read" });
    const withTask = filesFor(REX, DEFAULT_RULES, ["/project/research/competitors.md"], NOW);
    expect(withTask.filter((r) => r.severity === "deliverable").map((r) => [r.label, r.access])).toEqual([
      ["Its report (research.md)", "edit"],
      ["Task deliverable (research/competitors.md)", "edit"],
    ]);
  });

  it("gives the chief no deliverable row and nothing to edit in the project", () => {
    const rows = filesFor(agentOf("chief", "mira"), DEFAULT_RULES, [], NOW);
    expect(rows.filter((r) => r.severity === "deliverable")).toEqual([]);
    expect(row(rows, "project")?.access).toBe("read");
  });
});
