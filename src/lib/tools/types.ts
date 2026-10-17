/*
 * The tool registry: every tool an agent can use, and every way it presents work (docs/research/H-archetype-
 * toolsets.md §4). Each archetype carries a curated toolset of registry ids; agents inherit it with its renderers.
 *
 * Mechanisms: `call` is a tool() whose result goes back to the model; `fence` is a block in the reply the app draws
 * (stateless, streams: charts); `artifact` writes or shows a versioned file rendered as a work-pane tab (canvas,
 * doc, plan). Shared by the server (tools, prompt notes) and the client (fences, panes).
 */
import type { Archetype, Tier } from "../policy/types";

export type ArtifactType =
  // written by the agent's own tools
  | "canvas" | "mockup" | "doc" | "sources" | "table" | "diff"
  // derived from state files or code
  | "plan" | "dashboard" | "inbox" | "files" | "tests";

export type RendererId = "chart" | "mermaid" | "citations" | `pane:${ArtifactType}`;

export interface ToolDef {
  /** Registry id, e.g. "canvas_edit", "chart", "plan". */
  id: string;
  name: string;
  /** One line: the "what I can do" sheet and the launch card. */
  description: string;
  kind: "action" | "present";
  mechanism: "call" | "fence" | "artifact";
  tier: Tier;
  /** Curated sets it belongs to; "*" = the base set every archetype inherits. */
  archetypes: (Archetype | "*")[];
  status: "ready" | "planned";
  origin: "exists" | "adopt" | "build";
  /** LangChain tool() names this entry contributes ([] for fences and derived views). */
  calls: string[];
  /** fence: the info string after ``` (parser and renderer looked up by it). */
  fence?: string;
  /** present: the client component that draws it. */
  renderer?: RendererId;
  /**
   * artifact: the product and where it lives, relative to .data/vault/. writtenBy "self" = this entry's calls;
   * otherwise the tool ids (or "code") that write it.
   */
  artifact?: { type: ArtifactType; path: string; writtenBy: "self" | string[] };
  /** Prompt usage note: a module-level constant, never templated with runtime data (prefix caching). */
  note?: string;
  /** Pinned packages, e.g. ["@excalidraw/excalidraw@0.18.1"]. */
  deps?: string[];
}

/** What one agent ends up with: its tools in prompt order, their notes, and what was dropped and why. */
export interface ResolvedToolset {
  tools: ToolDef[];
  /** Notes of the present tools, in order, joined into the archetype's stable prompt section. */
  notes: string[];
  dropped: { id: string; reason: "needs_sandbox" | "not_approved" | "planned" | "unknown" }[];
}
