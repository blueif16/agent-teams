/*
 * Where the plan graph draws each card: dagre, left to right, with milestones as compound clusters so a
 * milestone's tasks stay together and its soft background never runs under another milestone's cards.
 * Pure (no DOM), so it is tested as is and React Flow only paints the result.
 */
import dagre from "@dagrejs/dagre";
import type { PlanVM } from "./types";

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlanLayout {
  /** Top-left corners, the way React Flow positions nodes. */
  nodes: Box[];
  groups: (Box & { title: string })[];
  edges: { id: string; source: string; target: string }[];
  width: number;
  height: number;
}

/** A task card: status dot + one-line title, and a meta line with the owner's mascot. */
export const CARD = { width: 216, height: 66 } as const;
/** Space around the drawing, so fit-to-view never crops a ring or a shadow. */
const MARGIN = 12;

export function layoutPlan(plan: Pick<PlanVM, "tasks" | "milestones">): PlanLayout {
  const g = new dagre.graphlib.Graph({ compound: true });
  // nodesep also pads clusters: 36 leaves ~28 px above a milestone's first card for its label.
  g.setGraph({ rankdir: "LR", nodesep: 36, ranksep: 52, marginx: MARGIN, marginy: MARGIN });
  g.setDefaultEdgeLabel(() => ({}));

  const ids = new Set(plan.tasks.map((t) => t.id));
  const used = plan.milestones.filter((m) => plan.tasks.some((t) => t.milestone === m.id));
  for (const m of used) g.setNode(m.id, {});
  for (const t of plan.tasks) {
    g.setNode(t.id, { width: CARD.width, height: CARD.height });
    if (t.milestone && used.some((m) => m.id === t.milestone)) g.setParent(t.id, t.milestone);
  }
  const edges: PlanLayout["edges"] = [];
  for (const t of plan.tasks) {
    for (const d of t.deps) {
      if (!ids.has(d)) continue; // a dep on a milestone or a pruned task: nothing to draw it from
      g.setEdge(d, t.id);
      edges.push({ id: `${d}->${t.id}`, source: d, target: t.id });
    }
  }

  dagre.layout(g);

  // dagre gives centres; React Flow wants top-left corners.
  const corner = (id: string): Box => {
    const n = g.node(id);
    return { id, x: n.x - n.width / 2, y: n.y - n.height / 2, width: n.width, height: n.height };
  };
  const graph = g.graph();
  return {
    nodes: plan.tasks.map((t) => corner(t.id)),
    groups: used.map((m) => ({ ...corner(m.id), title: m.title })),
    edges,
    width: graph.width ?? 0,
    height: graph.height ?? 0,
  };
}
