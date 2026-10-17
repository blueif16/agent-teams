/*
 * resolveToolset (H §5): base set first, then the archetype's ids in its order, then ≤ 3 approved extras;
 * T7 only with a sandbox, planned only on request, unknown ids reported. Notes follow tool order and depend only
 * on the archetype (and extras), never on a composition's skills, so the prompt prefix caches per archetype.
 */
import { describe, expect, it } from "vitest";
import type { ArchetypeDef, Composition } from "../skills/types";
import { CANVAS_NOTE, CHARTS_NOTE, DOC_NOTE } from "./notes";
import { resolveToolset } from "./resolve";

/** H §3 base table order. */
const BASE = ["file_tools", "web_search", "report", "chart", "markdown", "mermaid"];
const BASE_READY = ["file_tools", "chart", "markdown"];

const arch = (id: ArchetypeDef["id"], tools: string[]): ArchetypeDef => ({
  id, name: id, summary: `${id} archetype`, inherent: ["Works carefully."], tools, modelTier: "main", qualifications: [],
});
const DESIGNER = arch("designer", ["canvas_edit", "canvas_read", "canvas_export", "request_review", "write_mockup", "fetch_image", "canvas", "mockup"]);
const ENGINEER = arch("engineer", ["propose_patch", "repo_read", "run_tests", "diff", "files", "tests"]);
const WRITER = arch("writer", ["doc_write", "doc_suggest", "doc_comment", "doc_read", "doc"]);

const comp = (archetype: ArchetypeDef["id"], over: Partial<Composition> = {}): Composition => ({
  id: "c1", archetype, skills: [], role: "Role", qualifications: [], source: "orchestrator", createdAt: "2026-10-17", ...over,
});
const extras = (...ids: string[]) => ids.map((id) => ({ id, why: `needs ${id}` }));

const ALL = { sandbox: false, includePlanned: true };
const ids = (r: ReturnType<typeof resolveToolset>) => r.tools.map((t) => t.id);

describe("resolveToolset order", () => {
  it("puts the base set first, then the archetype's ids in its order", () => {
    expect(ids(resolveToolset(DESIGNER, undefined, ALL))).toEqual([...BASE, ...DESIGNER.tools]);
  });

  it("follows the archetype's order, not the registry's", () => {
    const reversed = arch("designer", [...DESIGNER.tools].reverse());
    expect(ids(resolveToolset(reversed, undefined, ALL))).toEqual([...BASE, ...reversed.tools]);
  });

  it("lists a base tool the archetype repeats once, in the base position", () => {
    const analyst = arch("analyst", ["describe", "chart", "table"]);
    expect(ids(resolveToolset(analyst, undefined, ALL))).toEqual([...BASE, "describe", "table"]);
  });
});

describe("resolveToolset filters", () => {
  it("drops planned tools by default and says so", () => {
    const r = resolveToolset(DESIGNER, undefined, { sandbox: false });
    expect(ids(r)).toEqual(BASE_READY);
    expect(r.dropped).toContainEqual({ id: "canvas_edit", reason: "planned" });
    expect(r.dropped).toContainEqual({ id: "web_search", reason: "planned" });
  });

  it("drops a T7 tool without a sandbox", () => {
    const r = resolveToolset(ENGINEER, undefined, ALL);
    expect(ids(r)).not.toContain("run_tests");
    expect(r.dropped).toContainEqual({ id: "run_tests", reason: "needs_sandbox" });
  });

  it("keeps a T7 tool, in place, with a sandbox", () => {
    const r = resolveToolset(ENGINEER, undefined, { sandbox: true, includePlanned: true });
    expect(ids(r)).toEqual([...BASE, ...ENGINEER.tools]);
    expect(r.dropped).toEqual([]);
  });

  it("reports unknown ids from the archetype and from extras", () => {
    const r = resolveToolset(arch("writer", ["doc_write", "nope"]), comp("writer", { extraTools: extras("ghost") }), ALL);
    expect(ids(r)).toEqual([...BASE, "doc_write"]);
    expect(r.dropped).toEqual([
      { id: "nope", reason: "unknown" },
      { id: "ghost", reason: "unknown" },
    ]);
  });
});

describe("resolveToolset extras", () => {
  it("adds up to three approved extras after the archetype's tools", () => {
    const r = resolveToolset(DESIGNER, comp("designer", { extraTools: extras("doc_read", "describe", "add_source") }), ALL);
    expect(ids(r)).toEqual([...BASE, ...DESIGNER.tools, "doc_read", "describe", "add_source"]);
    expect(r.dropped).toEqual([]);
  });

  it("drops a fourth extra as not approved", () => {
    const r = resolveToolset(DESIGNER, comp("designer", { extraTools: extras("doc_read", "describe", "add_source", "repo_read") }), ALL);
    expect(ids(r)).toEqual([...BASE, ...DESIGNER.tools, "doc_read", "describe", "add_source"]);
    expect(r.dropped).toEqual([{ id: "repo_read", reason: "not_approved" }]);
  });

  it("never adds a T7 extra without a sandbox", () => {
    const r = resolveToolset(WRITER, comp("writer", { extraTools: extras("run_tests") }), ALL);
    expect(ids(r)).not.toContain("run_tests");
    expect(r.dropped).toEqual([{ id: "run_tests", reason: "needs_sandbox" }]);
  });

  it("drops a planned extra by default", () => {
    const r = resolveToolset(WRITER, comp("writer", { extraTools: extras("canvas_read") }), { sandbox: false });
    expect(ids(r)).not.toContain("canvas_read");
    expect(r.dropped).toContainEqual({ id: "canvas_read", reason: "planned" });
  });

  it("keeps a ready extra by default", () => {
    const r = resolveToolset(WRITER, comp("writer", { extraTools: extras("project") }), { sandbox: false });
    expect(ids(r)).toEqual([...BASE_READY, "project"]);
  });
});

describe("resolveToolset notes", () => {
  it("returns the notes of the resolved tools in tool order", () => {
    expect(resolveToolset(DESIGNER, undefined, ALL).notes).toEqual([CHARTS_NOTE, CANVAS_NOTE]);
    expect(resolveToolset(WRITER, undefined, ALL).notes).toEqual([CHARTS_NOTE, DOC_NOTE]);
  });

  it("puts an extra's note after the archetype's notes", () => {
    const r = resolveToolset(WRITER, comp("writer", { extraTools: extras("canvas") }), ALL);
    expect(r.notes).toEqual([CHARTS_NOTE, DOC_NOTE, CANVAS_NOTE]);
  });

  it("leaves out the notes of dropped tools", () => {
    expect(resolveToolset(DESIGNER, undefined, { sandbox: false }).notes).toEqual([CHARTS_NOTE]);
  });

  it("gives two compositions of one archetype byte-identical notes and tools", () => {
    const a = resolveToolset(DESIGNER, comp("designer", { id: "c-a", skills: ["obra/brainstorming"], role: "Onboarding UX designer" }), ALL);
    const b = resolveToolset(DESIGNER, comp("designer", { id: "c-b", skills: ["anthropics/frontend-design", "x/y"], role: "Brand designer" }), ALL);
    expect(a.notes.join("\n\n")).toBe(b.notes.join("\n\n"));
    expect(a.tools).toEqual(b.tools);
    expect(a.notes.length).toBeGreaterThan(1);
  });
});
