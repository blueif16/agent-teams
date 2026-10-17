import { describe, expect, it } from "vitest";
import { agentType, INHERENT } from "@/lib/agent-files";
import type { Agent } from "@/lib/types";
import { ARCHETYPES, getArchetype } from "./archetypes";

/** The base set every archetype inherits (docs/research/H-archetype-toolsets.md §3); never listed per archetype. */
const BASE = ["ls", "read_file", "write_file", "edit_file", "glob", "grep", "web_search", "fetch_page", "report", "chart", "mermaid"];
/** H §3 curated sets: action ids in prompt order, then the archetype's panes. */
const CURATED: Record<string, string[]> = {
  designer: ["canvas_edit", "canvas_read", "canvas_export", "request_review", "write_mockup", "fetch_image", "canvas", "mockup"],
  engineer: ["propose_patch", "repo_read", "run_tests", "diff", "files", "tests"],
  researcher: ["research", "add_source", "doc_write", "sources", "doc", "citations"],
  analyst: ["describe", "answer", "write_table", "table"],
  writer: ["doc_write", "doc_suggest", "doc_comment", "doc_read", "doc"],
  lead: ["add_task", "update_task", "assign_task", "record_decision", "raise_item", "resolve_item", "find_skill", "search_skills", "plan", "board", "timeline", "decisions"],
  chief: ["project", "find_agent", "dispatch", "answer", "research", "find_skill", "search_skills", "plan", "dashboard", "inbox"],
};
const ids = ARCHETYPES.map((a) => a.id);
const has = (id: string, tool: string) => getArchetype(id as never)!.tools.includes(tool);

describe("archetype definitions", () => {
  it("defines exactly engineer, designer, researcher, analyst, writer, lead and chief, once each", () => {
    expect([...ids].sort()).toEqual(["analyst", "chief", "designer", "engineer", "lead", "researcher", "writer"]);
  });

  it("reuses the SOUL.md Inherent section of each existing type", () => {
    for (const id of ["engineer", "researcher", "analyst", "writer", "lead", "chief"] as const) {
      expect(getArchetype(id)!.inherent).toEqual(INHERENT[id]);
    }
  });

  it("gives the designer its own Inherent bullets, shared with its SOUL.md", () => {
    const designer = getArchetype("designer")!;
    expect(designer.inherent.length).toBeGreaterThanOrEqual(4);
    expect(INHERENT.designer).toEqual(designer.inherent);
    // Not a copy of another type's bullets.
    for (const other of ARCHETYPES.filter((a) => a.id !== "designer")) expect(designer.inherent).not.toEqual(other.inherent);
  });

  it("lists each archetype's curated registry ids from H §3, in prompt order", () => {
    for (const a of ARCHETYPES) expect(a.tools, a.id).toEqual(CURATED[a.id]);
  });

  it("never lists the base set (file tools, web_search, fetch_page, report, chart, mermaid): every archetype inherits it", () => {
    for (const a of ARCHETYPES) for (const tool of BASE) expect(a.tools, `${a.id} lists base tool ${tool}`).not.toContain(tool);
  });

  it("gives research to the researcher and the chief, answer to the analyst and the chief", () => {
    expect(ids.filter((id) => has(id, "research")).sort()).toEqual(["chief", "researcher"]);
    expect(ids.filter((id) => has(id, "answer")).sort()).toEqual(["analyst", "chief"]);
  });

  it("gives search_skills and find_skill to the orchestrators (lead and chief) only", () => {
    expect(ids.filter((id) => has(id, "search_skills")).sort()).toEqual(["chief", "lead"]);
    expect(ids.filter((id) => has(id, "find_skill")).sort()).toEqual(["chief", "lead"]);
  });

  it("never lists raw shell or delete tools (T7 is the registry's run_tests, filtered until a sandbox exists)", () => {
    for (const a of ARCHETYPES) {
      expect(a.tools).not.toContain("execute");
      expect(a.tools).not.toContain("delete");
    }
  });

  it("runs every archetype on the main tier, with a name, a summary and a qualifications vocabulary", () => {
    for (const a of ARCHETYPES) {
      expect(a.modelTier).toBe("main");
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.summary.length).toBeGreaterThan(0);
      expect(a.qualifications.length).toBeGreaterThanOrEqual(5);
      expect(new Set(a.qualifications).size, `${a.id} repeats a qualification`).toBe(a.qualifications.length);
      for (const q of a.qualifications) expect(q).toBe(q.toLowerCase());
    }
  });

  it("has no archetype for an unknown id", () => {
    expect(getArchetype("coordinator")).toBeUndefined();
  });
});

describe("agentType", () => {
  const agent = (role: string): Agent => ({
    id: "x",
    name: "X",
    role,
    teamId: "no-team",
    model: "m",
    look: { shape: "blob", color: "#000", accessory: "none" },
    brief: "",
  });

  it("classifies design roles as designer", () => {
    expect(agentType(agent("UX designer"))).toBe("designer");
    expect(agentType(agent("Brand design"))).toBe("designer");
  });

  it("keeps classifying the existing roles as before", () => {
    expect(agentType(agent("Copywriter"))).toBe("writer");
    expect(agentType(agent("Code reviewer"))).toBe("engineer");
    expect(agentType(agent("Scheduler"))).toBe("coordinator");
  });
});
