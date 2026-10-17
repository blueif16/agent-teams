import { describe, expect, it } from "vitest";
import { agentType, INHERENT } from "@/lib/agent-files";
import type { Agent } from "@/lib/types";
import { ARCHETYPES, getArchetype } from "./archetypes";

const FILE_TOOLS = ["ls", "read_file", "write_file", "edit_file", "glob", "grep"];
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

  it("gives every archetype web_search, fetch_page and the file tools", () => {
    for (const a of ARCHETYPES) {
      for (const tool of ["web_search", "fetch_page", ...FILE_TOOLS]) expect(a.tools, `${a.id} lacks ${tool}`).toContain(tool);
    }
  });

  it("gives research to the researcher only", () => {
    expect(ids.filter((id) => has(id, "research"))).toEqual(["researcher"]);
  });

  it("gives answer and chart to the analyst and the chief only", () => {
    expect(ids.filter((id) => has(id, "answer")).sort()).toEqual(["analyst", "chief"]);
    expect(ids.filter((id) => has(id, "chart")).sort()).toEqual(["analyst", "chief"]);
  });

  it("gives search_skills and find_skill to the orchestrators (lead and chief) only", () => {
    expect(ids.filter((id) => has(id, "search_skills")).sort()).toEqual(["chief", "lead"]);
    expect(ids.filter((id) => has(id, "find_skill")).sort()).toEqual(["chief", "lead"]);
  });

  it("never gives shell or delete tools by default (tier T7 stays off without a sandbox)", () => {
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
