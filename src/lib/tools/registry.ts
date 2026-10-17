/*
 * The tool registry (docs/research/H-archetype-toolsets.md §3, §4): every tool an agent can be given and every way
 * it presents work. Archetypes list ids from here; the base set ("*") comes with every archetype.
 *
 * `status: "ready"` only for what runs in the repo today (deepagents file tools, the chart and project fences,
 * Markdown via Streamdown, and `research`, which the runtime registers behind the approval gate); everything else is
 * planned and is dropped by resolveToolset unless asked for.
 * Artifact paths are relative to .data/vault/. Each artifact type has exactly one `pane:` renderer; other views of
 * the same file (board, timeline, decisions) carry the artifact but draw in that type's pane.
 */
import { CANVAS_NOTE, CHARTS_NOTE, DOC_NOTE } from "./notes";
import type { ToolDef } from "./types";

const CANVAS = "projects/{pid}/work/canvas/{slug}.excalidraw";
const MOCKUP = "projects/{pid}/work/mockups/{slug}.html";
const PATCH = "projects/{pid}/work/patches/{slug}.diff";
const DOC = "projects/{pid}/work/docs/{slug}.md";
const SOURCES = "projects/{pid}/work/sources.json";
const TABLE = "projects/{pid}/work/tables/{slug}.csv";
const DAG = "projects/{pid}/state/dag.json";
const DAG_WRITERS = ["add_task", "update_task", "assign_task", "report"];
const EXCALIDRAW = "@excalidraw/excalidraw@0.18.1";

export const REGISTRY: readonly ToolDef[] = [
  // ── Base set: every archetype inherits these, ahead of its curated set.
  {
    id: "file_tools", name: "Project files", description: "Lists, reads, writes, edits and searches the project's files.",
    kind: "action", mechanism: "call", tier: "T1", archetypes: ["*"], status: "ready", origin: "exists",
    calls: ["ls", "read_file", "write_file", "edit_file", "glob", "grep"],
  },
  {
    id: "web_search", name: "Web search", description: "Searches the web and fetches pages (You.com).",
    kind: "action", mechanism: "call", tier: "T3", archetypes: ["*"], status: "planned", origin: "adopt",
    calls: ["web_search", "fetch_page"],
  },
  {
    id: "report", name: "Report", description: "Tells the lead a task is done, with the evidence.",
    kind: "action", mechanism: "call", tier: "T1", archetypes: ["*"], status: "planned", origin: "build",
    calls: ["report"],
  },
  {
    id: "chart", name: "Chart", description: "Draws one of six chart templates inline.",
    kind: "present", mechanism: "fence", tier: "T0", archetypes: ["*"], status: "ready", origin: "exists",
    calls: [], fence: "chart", renderer: "chart", note: CHARTS_NOTE,
  },
  {
    id: "markdown", name: "Tables and code", description: "Markdown tables and code blocks in replies.",
    kind: "present", mechanism: "fence", tier: "T0", archetypes: ["*"], status: "ready", origin: "exists",
    calls: [],
  },
  {
    id: "mermaid", name: "Diagram", description: "Flowcharts and sequence diagrams drawn from Mermaid inline.",
    kind: "present", mechanism: "fence", tier: "T0", archetypes: ["*"], status: "planned", origin: "adopt",
    calls: [], fence: "mermaid", renderer: "mermaid", deps: ["@streamdown/mermaid@1.0.3"],
  },

  // ── designer
  {
    id: "canvas_edit", name: "Edit canvas", description: "Adds and changes frames, shapes, text, notes, images and links.",
    kind: "action", mechanism: "artifact", tier: "T1", archetypes: ["designer"], status: "planned", origin: "build",
    calls: ["canvas_edit"], artifact: { type: "canvas", path: CANVAS, writtenBy: "self" }, deps: [EXCALIDRAW],
  },
  {
    id: "canvas_read", name: "Read canvas", description: "Reads a canvas as a short digest of frames, elements and comments.",
    kind: "action", mechanism: "call", tier: "T0", archetypes: ["designer"], status: "planned", origin: "build",
    calls: ["canvas_read"],
  },
  {
    id: "canvas_export", name: "Export frame", description: "Exports a frame as PNG or SVG into the project's files.",
    kind: "action", mechanism: "call", tier: "T1", archetypes: ["designer"], status: "planned", origin: "build",
    calls: ["canvas_export"],
  },
  {
    id: "request_review", name: "Request review", description: "Asks the owner to review one frame, with a question.",
    kind: "action", mechanism: "call", tier: "T1", archetypes: ["designer"], status: "planned", origin: "build",
    calls: ["request_review"],
  },
  {
    id: "write_mockup", name: "Write mockup", description: "Writes a single-file HTML prototype, linked from a frame.",
    kind: "action", mechanism: "artifact", tier: "T1", archetypes: ["designer"], status: "planned", origin: "build",
    calls: ["write_mockup"], artifact: { type: "mockup", path: MOCKUP, writtenBy: "self" },
  },
  {
    id: "fetch_image", name: "Fetch image", description: "Saves a reference image from the web into the project's files.",
    kind: "action", mechanism: "call", tier: "T3", archetypes: ["designer"], status: "planned", origin: "build",
    calls: ["fetch_image"],
  },
  {
    id: "canvas", name: "Canvas", description: "An infinite canvas with frames as artboards to edit, comment, approve and export.",
    kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["designer"], status: "planned", origin: "adopt",
    calls: [], renderer: "pane:canvas", artifact: { type: "canvas", path: CANVAS, writtenBy: ["canvas_edit"] },
    note: CANVAS_NOTE, deps: [EXCALIDRAW],
  },
  {
    id: "mockup", name: "Mockup", description: "A sandboxed HTML prototype at mobile and desktop widths.",
    kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["designer"], status: "planned", origin: "build",
    calls: [], renderer: "pane:mockup", artifact: { type: "mockup", path: MOCKUP, writtenBy: ["write_mockup"] },
  },

  // ── engineer
  {
    id: "propose_patch", name: "Propose patch", description: "Snapshots its edits as a diff for review.",
    kind: "action", mechanism: "artifact", tier: "T1", archetypes: ["engineer"], status: "planned", origin: "build",
    calls: ["propose_patch"], artifact: { type: "diff", path: PATCH, writtenBy: "self" },
  },
  {
    id: "repo_read", name: "Read repo", description: "Git status, diff, log and blame, without a shell.",
    kind: "action", mechanism: "call", tier: "T0", archetypes: ["engineer"], status: "planned", origin: "build",
    calls: ["repo_read"],
  },
  {
    id: "run_tests", name: "Run tests", description: "Runs the test suite in a sandbox.",
    kind: "action", mechanism: "call", tier: "T7", archetypes: ["engineer"], status: "planned", origin: "build",
    calls: ["run_tests"],
  },
  {
    id: "diff", name: "Diff", description: "Split or unified review of a patch, to approve and apply.",
    kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["engineer"], status: "planned", origin: "adopt",
    calls: [], renderer: "pane:diff", artifact: { type: "diff", path: PATCH, writtenBy: ["propose_patch"] },
    deps: ["@git-diff-view/react@0.1.8"],
  },
  {
    id: "files", name: "Files", description: "The project's file tree, with changed files marked.",
    kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["engineer"], status: "planned", origin: "build",
    calls: [], renderer: "pane:files", artifact: { type: "files", path: "projects/{pid}/files/", writtenBy: ["file_tools", "code"] },
  },
  {
    id: "tests", name: "Tests", description: "Pass or fail per test from the last run, linked to the patch.",
    kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["engineer"], status: "planned", origin: "build",
    calls: [], renderer: "pane:tests", artifact: { type: "tests", path: "projects/{pid}/state/tests.json", writtenBy: ["run_tests"] },
  },

  // ── researcher (shares doc_write and the doc pane with the writer)
  {
    id: "research", name: "Research", description: "Cited multi-source answers (You.com Research).",
    kind: "action", mechanism: "call", tier: "T3", archetypes: ["researcher", "chief"], status: "ready", origin: "adopt",
    calls: ["research"],
  },
  {
    id: "add_source", name: "Add source", description: "Records a source: url, title, date, quote and the claims it backs.",
    kind: "action", mechanism: "artifact", tier: "T1", archetypes: ["researcher"], status: "planned", origin: "build",
    calls: ["add_source"], artifact: { type: "sources", path: SOURCES, writtenBy: "self" },
  },
  {
    id: "doc_write", name: "Write doc", description: "Creates or rewrites a Markdown document.",
    kind: "action", mechanism: "artifact", tier: "T1", archetypes: ["researcher", "writer"], status: "planned", origin: "build",
    calls: ["doc_write"], artifact: { type: "doc", path: DOC, writtenBy: "self" },
  },
  {
    id: "sources", name: "Sources", description: "Every source with its domain, date, quote and the claims citing it.",
    kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["researcher"], status: "planned", origin: "build",
    calls: [], renderer: "pane:sources", artifact: { type: "sources", path: SOURCES, writtenBy: ["add_source"] },
  },
  {
    id: "doc", name: "Doc", description: "A document to read, edit, comment on and accept or reject suggestions in.",
    kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["researcher", "writer"], status: "planned", origin: "build",
    calls: [], renderer: "pane:doc", artifact: { type: "doc", path: DOC, writtenBy: ["doc_write", "doc_suggest", "doc_comment"] },
    note: DOC_NOTE, deps: ["diff@9.0.0"],
  },
  {
    id: "citations", name: "Citations", description: "[S1]-style markers drawn as source chips; unknown ones show red.",
    kind: "present", mechanism: "fence", tier: "T0", archetypes: ["researcher"], status: "planned", origin: "build",
    calls: [], renderer: "citations",
  },

  // ── analyst (its chart is the base set's)
  {
    id: "describe", name: "Describe data", description: "Counts, sums, means, medians and percentiles over CSV or JSON, by group.",
    kind: "action", mechanism: "call", tier: "T0", archetypes: ["analyst"], status: "planned", origin: "build",
    calls: ["describe"],
  },
  {
    id: "answer", name: "Answer", description: "A one-pass cited answer from the web (You.com).",
    kind: "action", mechanism: "call", tier: "T3", archetypes: ["analyst", "chief"], status: "planned", origin: "adopt",
    calls: ["answer"],
  },
  {
    id: "write_table", name: "Write table", description: "Writes results too big for a Markdown table.",
    kind: "action", mechanism: "artifact", tier: "T1", archetypes: ["analyst"], status: "planned", origin: "build",
    calls: ["write_table"], artifact: { type: "table", path: TABLE, writtenBy: "self" },
  },
  {
    id: "table", name: "Table", description: "Sort, filter and total a table; chart a selection.",
    kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["analyst"], status: "planned", origin: "adopt",
    calls: [], renderer: "pane:table", artifact: { type: "table", path: TABLE, writtenBy: ["write_table"] },
    deps: ["@tanstack/react-table@9.3.1"],
  },

  // ── writer
  {
    id: "doc_suggest", name: "Suggest edits", description: "Proposes tracked changes to a doc, each with a reason.",
    kind: "action", mechanism: "artifact", tier: "T1", archetypes: ["writer"], status: "planned", origin: "build",
    calls: ["doc_suggest"], artifact: { type: "doc", path: DOC, writtenBy: "self" },
  },
  {
    id: "doc_comment", name: "Comment on doc", description: "Adds margin comments anchored to exact passages.",
    kind: "action", mechanism: "artifact", tier: "T1", archetypes: ["writer"], status: "planned", origin: "build",
    calls: ["doc_comment"], artifact: { type: "doc", path: DOC, writtenBy: "self" },
  },
  {
    id: "doc_read", name: "Read doc", description: "Reads a doc with open suggestions, comments and owner edits marked.",
    kind: "action", mechanism: "call", tier: "T0", archetypes: ["writer"], status: "planned", origin: "build",
    calls: ["doc_read"],
  },

  // ── lead (the coordinator gets assignment and the read-only plan views)
  {
    id: "add_task", name: "Add task", description: "Adds a task to the plan with its owner and dependencies.",
    kind: "action", mechanism: "call", tier: "T1", archetypes: ["lead"], status: "planned", origin: "build",
    calls: ["add_task"],
  },
  {
    id: "update_task", name: "Update task", description: "Changes a task's status, dates or dependencies.",
    kind: "action", mechanism: "call", tier: "T1", archetypes: ["lead"], status: "planned", origin: "build",
    calls: ["update_task"],
  },
  {
    id: "assign_task", name: "Assign task", description: "Gives a task to a team member.",
    kind: "action", mechanism: "call", tier: "T1", archetypes: ["lead", "coordinator"], status: "planned", origin: "build",
    calls: ["assign_task"],
  },
  {
    id: "record_decision", name: "Record decision", description: "Logs a decision and why, for the owner to audit.",
    kind: "action", mechanism: "call", tier: "T1", archetypes: ["lead"], status: "planned", origin: "build",
    calls: ["record_decision"],
  },
  {
    id: "raise_item", name: "Raise item", description: "Raises a risk or a question for the owner as a card.",
    kind: "action", mechanism: "call", tier: "T1", archetypes: ["lead"], status: "planned", origin: "build",
    calls: ["raise_item"],
  },
  {
    id: "resolve_item", name: "Resolve item", description: "Closes a risk or question with its outcome.",
    kind: "action", mechanism: "call", tier: "T1", archetypes: ["lead"], status: "planned", origin: "build",
    calls: ["resolve_item"],
  },
  {
    id: "find_skill", name: "Find skill", description: "Searches the skill library to staff a role; a miss searches the web.",
    kind: "action", mechanism: "call", tier: "T3", archetypes: ["lead", "chief"], status: "planned", origin: "build",
    calls: ["find_skill"],
  },
  {
    id: "search_skills", name: "Search skills", description: "Ranks the local skill library for a need; no network, no cost.",
    kind: "action", mechanism: "call", tier: "T0", archetypes: ["lead", "chief"], status: "planned", origin: "build",
    calls: ["search_skills"],
  },
  {
    // Built: src/components/state/PlanView.tsx, in the team panel and full size in the workspace.
    id: "plan", name: "Plan", description: "The project's task graph with owners, status and blockers.",
    kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["lead", "coordinator", "chief"], status: "ready",
    origin: "exists", calls: [], renderer: "pane:plan", artifact: { type: "plan", path: DAG, writtenBy: DAG_WRITERS },
    deps: ["@xyflow/react@12.12.0", "@dagrejs/dagre@3.1.1"],
  },
  {
    id: "board", name: "Board", description: "The plan as a kanban by status.",
    kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["lead", "coordinator"], status: "planned",
    origin: "build", calls: [], artifact: { type: "plan", path: DAG, writtenBy: DAG_WRITERS },
  },
  {
    id: "timeline", name: "Timeline", description: "The plan's milestones as dated lanes.",
    kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["lead"], status: "planned", origin: "build",
    calls: [], artifact: { type: "plan", path: DAG, writtenBy: DAG_WRITERS },
  },
  {
    id: "decisions", name: "Decisions", description: "What was decided, why, and who approved it.",
    kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["lead"], status: "planned", origin: "build",
    calls: [], artifact: { type: "doc", path: "projects/{pid}/state/decisions.md", writtenBy: ["record_decision"] },
  },

  // ── chief (Mira)
  {
    id: "project", name: "Project proposal", description: "Proposes a project and its team as a card the owner launches.",
    kind: "action", mechanism: "fence", tier: "T1", archetypes: ["chief"], status: "ready", origin: "exists",
    calls: [], fence: "project",
  },
  {
    id: "find_agent", name: "Find agent", description: "Finds a past agent to rehire before creating a new one.",
    kind: "action", mechanism: "call", tier: "T0", archetypes: ["chief"], status: "planned", origin: "build",
    calls: ["find_agent"],
  },
  {
    id: "dispatch", name: "Dispatch", description: "Hands work to a team and ends the turn.",
    kind: "action", mechanism: "call", tier: "T1", archetypes: ["chief"], status: "planned", origin: "build",
    calls: ["dispatch"],
  },
  {
    id: "dashboard", name: "Dashboard", description: "Per project: progress, budget burn, blockers, waiting on the owner.",
    kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["chief"], status: "planned", origin: "build",
    calls: [], renderer: "pane:dashboard", artifact: { type: "dashboard", path: "company/index.json", writtenBy: ["code"] },
  },
  {
    id: "inbox", name: "Inbox", description: "Everything that needs the owner, in one list.",
    kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["chief"], status: "planned", origin: "build",
    calls: [], renderer: "pane:inbox",
    artifact: { type: "inbox", path: "projects/{pid}/state/open.json", writtenBy: ["raise_item", "resolve_item", "request_review"] },
  },
];

const BY_ID = new Map(REGISTRY.map((d) => [d.id, d]));

export const getTool = (id: string): ToolDef | undefined => BY_ID.get(id);
