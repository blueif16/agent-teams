import { describe, expect, it } from "vitest";
import { planFixture } from "./fixture";
import { layoutPlan, type Box } from "./layout";

/*
 * The plan graph's layout (dagre, left to right): nothing drawn on top of anything else, milestones as
 * backgrounds that hold exactly their own tasks, and every dependency pointing right.
 */
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Box, outer: Box) => a.x >= outer.x && a.y >= outer.y && a.x + a.width <= outer.x + outer.width && a.y + a.height <= outer.y + outer.height;

describe("layoutPlan", () => {
  const plan = planFixture();
  const out = layoutPlan(plan);
  const byId = new Map(out.nodes.map((n) => [n.id, n]));

  it("places every task once, and no two task cards overlap", () => {
    expect(out.nodes.map((n) => n.id).sort()).toEqual(plan.tasks.map((t) => t.id).sort());
    for (const a of out.nodes) for (const b of out.nodes) if (a !== b) expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
  });

  it("draws each milestone as a background holding exactly its own tasks, and milestones never overlap", () => {
    expect(out.groups.map((g) => g.id)).toEqual(["m1", "m2"]);
    for (const g of out.groups) {
      for (const t of plan.tasks) {
        const n = byId.get(t.id)!;
        if (t.milestone === g.id) expect(inside(n, g), `${t.id} inside ${g.id}`).toBe(true);
        else expect(overlaps(n, g), `${t.id} drawn over ${g.id}`).toBe(false);
      }
    }
    const [m1, m2] = out.groups;
    expect(overlaps(m1, m2)).toBe(false);
  });

  it("leaves room above a milestone's first card for its label", () => {
    expect(out.groups).toHaveLength(2);
    for (const g of out.groups) {
      const top = Math.min(...plan.tasks.filter((t) => t.milestone === g.id).map((t) => byId.get(t.id)!.y));
      expect(top - g.y, g.id).toBeGreaterThanOrEqual(24);
    }
  });

  it("draws one edge per dependency, each pointing left to right", () => {
    const expected = plan.tasks.flatMap((t) => t.deps.map((d) => `${d}->${t.id}`)).sort();
    expect(out.edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual(expected);
    for (const e of out.edges) {
      const s = byId.get(e.source)!;
      const t = byId.get(e.target)!;
      expect(s.x + s.width, `${e.source} → ${e.target}`).toBeLessThan(t.x);
    }
  });

  it("skips a dependency on a task the plan doesn't have instead of inventing a node", () => {
    const p = planFixture();
    p.tasks[0] = { ...p.tasks[0], deps: ["t99"] };
    const l = layoutPlan(p);
    expect(l.nodes.map((n) => n.id)).toContain("t1");
    expect(l.nodes.map((n) => n.id)).not.toContain("t99");
    expect(l.edges.some((e) => e.source === "t99")).toBe(false);
  });

  it("fits the whole drawing inside its reported size", () => {
    expect(out.nodes.length + out.groups.length).toBe(14);
    for (const b of [...out.nodes, ...out.groups]) expect(inside(b, { x: 0, y: 0, width: out.width, height: out.height }), b.id).toBe(true);
  });
});
