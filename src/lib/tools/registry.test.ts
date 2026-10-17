/*
 * Load-time checks on the tool registry (docs/research/H-archetype-toolsets.md §3, §4, §7 step 1).
 * The expected sets below are copied from H §3, not from the registry, so a typo or a dropped tool goes red.
 */
import { readFileSync } from "node:fs";
import { createFilesystemMiddleware } from "deepagents";
import { describe, expect, it } from "vitest";
import { CHART_FENCE } from "../charts";
import { PROJECT_FENCE } from "../project";
import type { Archetype } from "../policy/types";
import { getTool, REGISTRY } from "./registry";
import type { ArtifactType } from "./types";

const ARCHETYPES: Archetype[] = ["chief", "lead", "writer", "researcher", "analyst", "engineer", "designer", "coordinator"];
const ARTIFACT_TYPES: ArtifactType[] = ["canvas", "mockup", "doc", "sources", "table", "diff", "plan", "dashboard", "inbox", "files", "tests"];

/** H §3: the base set and each archetype's curated set (A and P rows). */
const H_SETS: Record<Archetype | "*", string[]> = {
  "*": ["file_tools", "web_search", "report", "chart", "markdown", "mermaid"],
  designer: ["canvas_edit", "canvas_read", "canvas_export", "request_review", "write_mockup", "fetch_image", "canvas", "mockup"],
  engineer: ["propose_patch", "repo_read", "run_tests", "diff", "files", "tests"],
  researcher: ["research", "add_source", "doc_write", "sources", "doc", "citations"],
  analyst: ["describe", "answer", "write_table", "table"],
  writer: ["doc_write", "doc_suggest", "doc_comment", "doc_read", "doc"],
  lead: ["add_task", "update_task", "assign_task", "record_decision", "raise_item", "resolve_item", "find_skill", "plan", "board", "timeline", "decisions"],
  chief: ["project", "find_agent", "dispatch", "answer", "research", "plan", "dashboard", "inbox"],
  coordinator: ["assign_task", "plan", "board"],
};

/** H §3 "EXISTS" rows: the only entries that are ready today. */
const H_READY = ["file_tools", "chart", "markdown", "project"];

/** H §3 tiers that are not T0/T1 (everything else is T0 for present entries, T1 for writes, T0 for reads). */
const H_TIERS: Record<string, string> = {
  web_search: "T3", fetch_image: "T3", research: "T3", answer: "T3", find_skill: "T3", run_tests: "T7",
  file_tools: "T1", report: "T1", canvas_edit: "T1", canvas_read: "T0", canvas_export: "T1", request_review: "T1",
  write_mockup: "T1", propose_patch: "T1", repo_read: "T0", add_source: "T1", doc_write: "T1", describe: "T0",
  write_table: "T1", doc_suggest: "T1", doc_comment: "T1", doc_read: "T0", add_task: "T1", update_task: "T1",
  assign_task: "T1", record_decision: "T1", raise_item: "T1", resolve_item: "T1", project: "T1", find_agent: "T0",
  dispatch: "T1",
};

/** What exists in the repo right now: the deepagents file tools, and the two fences with parsers. */
const RUNTIME_CALLS = new Set<string>((createFilesystemMiddleware().tools ?? []).map((t) => t.name));
const REPO_FENCES = new Set([CHART_FENCE, PROJECT_FENCE].map((f) => f.replace(/^```/, "")));
const MARKDOWN_TSX = readFileSync(new URL("../../components/Markdown.tsx", import.meta.url), "utf8");
const PACKAGE_DEPS = Object.keys(
  (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> })
    .dependencies,
);
const pkgName = (pin: string) => pin.slice(0, pin.lastIndexOf("@"));

const dupes = (xs: string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];

describe("registry: H §4 load-time checks", () => {
  it("has no two entries with the same id", () => {
    expect(dupes(REGISTRY.map((d) => d.id))).toEqual([]);
  });

  it("has no tool() name contributed by two entries", () => {
    expect(dupes(REGISTRY.flatMap((d) => d.calls))).toEqual([]);
  });

  it("has no fence info string claimed by two entries", () => {
    expect(dupes(REGISTRY.flatMap((d) => (d.fence ? [d.fence] : [])))).toEqual([]);
  });

  it("gives every artifact type exactly one pane: renderer", () => {
    const panes = Object.fromEntries(
      ARTIFACT_TYPES.map((t) => [t, REGISTRY.filter((d) => d.renderer === `pane:${t}`).map((d) => d.id)]),
    );
    for (const t of ARTIFACT_TYPES) expect(panes[t], `pane:${t}`).toHaveLength(1);
    const used = new Set(REGISTRY.flatMap((d) => (d.artifact ? [d.artifact.type] : [])));
    expect([...used].sort()).toEqual([...ARTIFACT_TYPES].sort());
  });

  it("draws each pane: renderer over an artifact of that type", () => {
    for (const d of REGISTRY.filter((x) => x.renderer?.startsWith("pane:"))) {
      expect(`pane:${d.artifact?.type}`, d.id).toBe(d.renderer);
    }
  });

  it("names only registry ids or code as artifact writers", () => {
    const ids = new Set(REGISTRY.map((d) => d.id));
    for (const d of REGISTRY) {
      const w = d.artifact?.writtenBy;
      if (!w || w === "self") continue;
      for (const writer of w) expect(writer === "code" || ids.has(writer), `${d.id} ← ${writer}`).toBe(true);
    }
  });

  it("keeps artifact paths relative to .data/vault/ under a project (the company dashboard aside, H §3)", () => {
    for (const d of REGISTRY.filter((x) => x.artifact && x.id !== "dashboard")) {
      expect(d.artifact!.path, d.id).toMatch(/^projects\/\{pid\}\/(?!.*\.\.)\S+$/);
    }
    expect(getTool("dashboard")?.artifact?.path).toBe("company/index.json");
  });

  it("marks ready exactly the entries that exist in the repo now", () => {
    expect(REGISTRY.filter((d) => d.status === "ready").map((d) => d.id).sort()).toEqual([...H_READY].sort());
    for (const d of REGISTRY.filter((x) => x.status === "ready")) expect(d.origin, d.id).toBe("exists");
  });

  it("backs every ready entry with real calls, fences or components", () => {
    for (const d of REGISTRY.filter((x) => x.status === "ready")) {
      for (const c of d.calls) expect(RUNTIME_CALLS.has(c), `${d.id}: tool ${c}`).toBe(true);
      if (d.fence) expect(REPO_FENCES.has(d.fence), `${d.id}: fence ${d.fence}`).toBe(true);
      if (!d.calls.length && !d.fence) {
        // Markdown tables and code blocks: Streamdown with the code plugin.
        expect(d.id).toBe("markdown");
        expect(MARKDOWN_TSX).toContain('from "streamdown"');
        expect(MARKDOWN_TSX).toContain('from "@streamdown/code"');
      }
    }
  });

  it("backs no planned entry with code that already exists", () => {
    for (const d of REGISTRY.filter((x) => x.status === "planned")) {
      for (const c of d.calls) expect(RUNTIME_CALLS.has(c), `${d.id}: tool ${c} exists`).toBe(false);
      if (d.fence) expect(REPO_FENCES.has(d.fence), `${d.id}: fence ${d.fence} exists`).toBe(false);
      for (const pin of d.deps ?? []) expect(PACKAGE_DEPS, `${d.id}: ${pin} installed`).not.toContain(pkgName(pin));
    }
    expect(MARKDOWN_TSX).not.toContain("@streamdown/mermaid");
  });
});

describe("registry: H §3 contents", () => {
  it("holds the base set and every archetype's curated set", () => {
    for (const [arch, ids] of Object.entries(H_SETS)) {
      const have = REGISTRY.filter((d) => d.archetypes.includes(arch as Archetype | "*")).map((d) => d.id);
      expect(have.sort(), arch).toEqual([...ids].sort());
    }
  });

  it("gives every archetype's curated set at least one action and one present entry", () => {
    for (const a of ARCHETYPES) {
      const set = REGISTRY.filter((d) => d.archetypes.includes(a));
      expect(set.some((d) => d.kind === "action"), `${a} action`).toBe(true);
      expect(set.some((d) => d.kind === "present"), `${a} present`).toBe(true);
    }
  });

  it("uses H's tiers, with every present entry at T0 and only run_tests at T7", () => {
    for (const d of REGISTRY) {
      if (d.kind === "present") expect(d.tier, d.id).toBe("T0");
      else expect(d.tier, d.id).toBe(H_TIERS[d.id]);
    }
    expect(REGISTRY.filter((d) => d.tier === "T7").map((d) => d.id)).toEqual(["run_tests"]);
  });

  it("keeps kind, mechanism and calls consistent", () => {
    for (const d of REGISTRY) {
      if (d.mechanism === "call") expect(d.calls.length, d.id).toBeGreaterThan(0);
      if (d.mechanism === "fence" || d.kind === "present") expect(d.calls, d.id).toEqual([]);
      if (d.kind === "action" && d.mechanism === "artifact") expect(d.artifact?.writtenBy, d.id).toBe("self");
      if (d.renderer) expect(d.kind, d.id).toBe("present");
      if (d.note) expect(d.kind, `${d.id} note`).toBe("present");
    }
  });

  it("pins the packages H names", () => {
    const deps = (id: string) => getTool(id)?.deps;
    expect(deps("canvas")).toEqual(["@excalidraw/excalidraw@0.18.1"]);
    expect(deps("canvas_edit")).toEqual(["@excalidraw/excalidraw@0.18.1"]);
    expect(deps("mermaid")).toEqual(["@streamdown/mermaid@1.0.3"]);
    expect(deps("diff")).toEqual(["@git-diff-view/react@0.1.8"]);
    expect(deps("table")).toEqual(["@tanstack/react-table@9.3.1"]);
    expect(deps("doc")).toEqual(["diff@9.0.0"]);
    expect(deps("plan")).toEqual(["@xyflow/react@12.12.0", "@dagrejs/dagre@3.1.1"]);
  });

  it("stores the canvas where H §2.4 puts it, written by canvas_edit", () => {
    expect(getTool("canvas_edit")?.artifact).toEqual({
      type: "canvas",
      path: "projects/{pid}/work/canvas/{slug}.excalidraw",
      writtenBy: "self",
    });
    expect(getTool("canvas")?.artifact).toEqual({
      type: "canvas",
      path: "projects/{pid}/work/canvas/{slug}.excalidraw",
      writtenBy: ["canvas_edit"],
    });
    expect(getTool("plan")?.artifact?.path).toBe("projects/{pid}/state/dag.json");
  });

  it("teaches the chart fence with the existing CHARTS_NOTE", async () => {
    const { CHARTS_NOTE } = await import("../charts");
    expect(getTool("chart")).toMatchObject({ fence: "chart", renderer: "chart", note: CHARTS_NOTE, status: "ready" });
  });

  it("looks tools up by id and returns undefined for unknown ids", () => {
    expect(getTool("canvas_edit")?.calls).toEqual(["canvas_edit"]);
    expect(getTool("nope")).toBeUndefined();
  });
});
