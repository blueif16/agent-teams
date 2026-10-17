/*
 * Properties of applyCanvasOps over random op sequences (H §7 step 2). Ids come from a small pool so ops collide,
 * reference each other, and often reference something missing; fields are sometimes out of range or invalid.
 * Whatever the sequence, the file stays a valid Excalidraw scene: no dangling frameId, containerId, binding or
 * boundElements entry, unique ids, no tombstones, and every op answers ok or with a real error.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyCanvasOps, emptyCanvas, type CanvasDoc } from "./apply";
import { COLORS, SIZES } from "./ops";

type El = Record<string, unknown> & { id: string; type: string; frameId: string | null; boundElements: { id: string; type: string }[] | null };
type Binding = { elementId: string } | null;

/** Everything that would make Excalidraw repair or drop a reference on load. */
function problems(doc: CanvasDoc): string[] {
  const out: string[] = [];
  const els = doc.elements as unknown as El[];
  const byId = new Map<string, El>();
  for (const e of els) {
    if (byId.has(e.id)) out.push(`duplicate id ${e.id}`);
    byId.set(e.id, e);
  }
  for (const e of els) {
    if (e.isDeleted) out.push(`${e.id} is a tombstone`);
    if (e.frameId != null) {
      const f = byId.get(e.frameId);
      if (!f || f.type !== "frame") out.push(`${e.id}.frameId → ${e.frameId} is not a frame`);
      if (e.type === "frame") out.push(`frame ${e.id} sits in a frame`);
    }
    if (e.type === "text" && e.containerId != null) {
      const c = byId.get(e.containerId as string);
      if (!c) out.push(`${e.id}.containerId → missing ${String(e.containerId)}`);
      else {
        if (!c.boundElements?.some((b) => b.id === e.id && b.type === "text")) out.push(`${c.id} doesn't list its label ${e.id}`);
        if (c.frameId !== e.frameId) out.push(`label ${e.id} is in frame ${e.frameId}, its container in ${c.frameId}`);
      }
    }
    if (e.type === "arrow") {
      for (const end of ["startBinding", "endBinding"] as const) {
        const b = e[end] as Binding;
        if (!b) {
          out.push(`arrow ${e.id} lost its ${end}`);
          continue;
        }
        const t = byId.get(b.elementId);
        if (!t) out.push(`${e.id}.${end} → missing ${b.elementId}`);
        else if (!t.boundElements?.some((x) => x.id === e.id && x.type === "arrow")) out.push(`${t.id} doesn't list arrow ${e.id}`);
      }
    }
    const listed = e.boundElements ?? [];
    if (new Set(listed.map((b) => b.id)).size !== listed.length) out.push(`${e.id}.boundElements has a repeat`);
    if (listed.filter((b) => b.type === "text").length > 1) out.push(`${e.id} has two labels`);
    for (const b of listed) {
      const t = byId.get(b.id);
      if (!t) out.push(`${e.id}.boundElements → missing ${b.id}`);
      else if (b.type === "text" && (t.type !== "text" || t.containerId !== e.id)) out.push(`${e.id} lists ${b.id} as its label`);
      else if (
        b.type === "arrow" &&
        (t.type !== "arrow" || ((t.startBinding as Binding)?.elementId !== e.id && (t.endBinding as Binding)?.elementId !== e.id))
      )
        out.push(`${e.id} lists ${b.id} as an arrow bound to it`);
    }
  }
  return out;
}

const ID = fc.constantFrom("f1", "f2", "f3", "b1", "b2", "b3", "t1", "n1", "i1", "c1", "c2", "zz");
const XY = fc.integer({ min: -50, max: 900 });
const WH = fc.integer({ min: 1, max: 400 });
const FRAME_WH = fc.integer({ min: 40, max: 900 });
const LABEL = fc.constantFrom("Go", "Create your free account", "", "Ok");
const COLOR = fc.constantFrom(...COLORS);
const opt = { noNullPrototype: true } as const;

const OP = fc.oneof(
  fc.record({ op: fc.constant("frame"), id: ID, name: fc.constant("F"), x: XY, y: XY, w: FRAME_WH, h: FRAME_WH }, { ...opt, requiredKeys: ["op", "id", "name", "w", "h"] }),
  fc.record(
    { op: fc.constant("shape"), id: ID, frame: ID, kind: fc.constantFrom("rect", "ellipse", "diamond"), x: XY, y: XY, w: WH, h: WH, label: LABEL, color: COLOR, fill: fc.boolean() },
    { ...opt, requiredKeys: ["op", "id", "kind", "w", "h"] },
  ),
  fc.record({ op: fc.constant("text"), id: ID, frame: ID, x: XY, y: XY, text: LABEL, size: fc.constantFrom(...SIZES), color: COLOR }, { ...opt, requiredKeys: ["op", "id", "text"] }),
  fc.record({ op: fc.constant("note"), id: ID, near: ID, frame: ID, x: XY, y: XY, text: LABEL }, { ...opt, requiredKeys: ["op", "id", "text"] }),
  fc.record(
    { op: fc.constant("image"), id: ID, frame: ID, src: fc.constantFrom("files/a.png", "https://x.com/a.png"), x: XY, y: XY, w: WH, h: WH },
    { ...opt, requiredKeys: ["op", "id", "src", "w", "h"] },
  ),
  fc.record({ op: fc.constant("connect"), id: ID, from: ID, to: ID, label: LABEL, style: fc.constantFrom("arrow", "line", "dashed") }, { ...opt, requiredKeys: ["op", "id", "from", "to"] }),
  fc.record(
    { op: fc.constant("update"), id: ID, x: XY, y: XY, w: WH, h: WH, frame: ID, label: LABEL, text: LABEL, color: COLOR, name: fc.constant("G") },
    { ...opt, requiredKeys: ["op", "id"] },
  ),
  fc.record({ op: fc.constant("delete"), ids: fc.array(ID, { minLength: 1, maxLength: 3 }) }, { ...opt, requiredKeys: ["op", "ids"] }),
);
/** Calls of 1–12 ops; about one in ten carries a stale expectedRev. */
const CALLS = fc.array(fc.record({ ops: fc.array(OP, { minLength: 1, maxLength: 12 }), stale: fc.integer({ min: 0, max: 9 }).map((n) => n === 0) }), {
  minLength: 1,
  maxLength: 6,
});

/*
 * A second, mostly-valid generator: ids drawn from the right pool for each role and update fields that fit the
 * element, so most ops succeed and the scene grows (frames full of labelled shapes, notes, arrows) before moves,
 * reparents, relabels and deletes hit it.
 */
const F = fc.constantFrom("f1", "f2", "f3");
const I = fc.constantFrom("b1", "b2", "b3", "b4", "t1", "n1", "i1");
const C = fc.constantFrom("c1", "c2", "c3");
const END = fc.oneof({ weight: 4, arbitrary: I }, { weight: 1, arbitrary: F });
const SMALL = fc.integer({ min: 0, max: 220 });
const XY_BOTH = fc.option(fc.record({ x: SMALL, y: SMALL }), { freq: 2 });
const WORDS = fc.constantFrom("Go", "Create your free account", "Ok", "A rather long label that wraps over lines");
const IN_FRAME = fc.option(F, { freq: 4 });
const withXY = <T extends object>(arb: fc.Arbitrary<T>) =>
  fc.tuple(arb, XY_BOTH).map(([o, xy]) => ({ ...o, ...(xy ?? {}) }));
const drop = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

const VALID_OP = fc.oneof(
  { weight: 2, arbitrary: withXY(fc.record({ op: fc.constant("frame"), id: F, name: fc.constant("Screen"), w: fc.integer({ min: 300, max: 900 }), h: fc.integer({ min: 300, max: 900 }) })) },
  {
    weight: 4,
    arbitrary: withXY(
      fc.record({ op: fc.constant("shape"), id: I, frame: IN_FRAME, kind: fc.constantFrom("rect", "ellipse", "diamond"), w: fc.integer({ min: 20, max: 150 }), h: fc.integer({ min: 20, max: 120 }), label: fc.option(WORDS), color: fc.option(COLOR) }),
    ).map(drop),
  },
  { weight: 1, arbitrary: withXY(fc.record({ op: fc.constant("text"), id: I, frame: IN_FRAME, text: WORDS, size: fc.constantFrom(...SIZES) })).map(drop) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant("note"), id: I, near: END, text: WORDS }) },
  { weight: 1, arbitrary: withXY(fc.record({ op: fc.constant("image"), id: I, frame: IN_FRAME, src: fc.constant("files/moodboard/a.png"), w: fc.integer({ min: 20, max: 150 }), h: fc.integer({ min: 20, max: 150 }) })).map(drop) },
  { weight: 3, arbitrary: fc.record({ op: fc.constant("connect"), id: C, from: END, to: END, label: fc.option(WORDS), style: fc.constantFrom("arrow", "line", "dashed") }).map(drop) },
  {
    weight: 4,
    arbitrary: fc.oneof(
      fc.record({ op: fc.constant("update"), id: fc.oneof(I, F), x: SMALL, y: SMALL }),
      fc.record({ op: fc.constant("update"), id: I, frame: F }),
      fc.record({ op: fc.constant("update"), id: fc.oneof(I, C), label: fc.oneof(WORDS, fc.constant("")) }),
      fc.record({ op: fc.constant("update"), id: I, w: fc.integer({ min: 20, max: 150 }), h: fc.integer({ min: 20, max: 150 }) }),
      fc.record({ op: fc.constant("update"), id: I, text: WORDS }),
      fc.record({ op: fc.constant("update"), id: F, w: fc.integer({ min: 100, max: 900 }), h: fc.integer({ min: 100, max: 900 }) }),
    ),
  },
  { weight: 2, arbitrary: fc.record({ op: fc.constant("delete"), ids: fc.array(fc.oneof(I, F, C), { minLength: 1, maxLength: 2 }) }) },
);

describe("applyCanvasOps properties", () => {
  it("keeps a busy, mostly-valid canvas free of dangling references through moves, reparents, relabels and deletes", () => {
    fc.assert(
      fc.property(fc.array(fc.array(VALID_OP, { minLength: 1, maxLength: 15 }), { minLength: 1, maxLength: 8 }), (calls) => {
        let doc = emptyCanvas();
        let rev = 0;
        let n = 0;
        for (const ops of calls) {
          const r = applyCanvasOps(doc, ops, { rev, expectedRev: rev, now: 1000 + rev, newId: () => `L${++n}`, by: "p" });
          expect(problems(r.doc)).toEqual([]);
          for (const x of r.results) expect(x.ok || (typeof x.error === "string" && x.error.length > 8), JSON.stringify(x)).toBe(true);
          doc = r.doc;
          rev = r.rev;
        }
      }),
      { numRuns: 500 },
    );
  });

  it("never leaves a dangling reference or a repeated id, whatever the ops", () => {
    fc.assert(
      fc.property(CALLS, (calls) => {
        let doc = emptyCanvas();
        let rev = 0;
        let n = 0;
        for (const { ops, stale } of calls) {
          const r = applyCanvasOps(doc, ops, { rev, expectedRev: stale ? rev + 1 : rev, now: 1000 + rev, newId: () => `L${++n}`, by: "p" });
          expect(problems(r.doc)).toEqual([]);
          if (stale) {
            expect(r.results).toEqual([]);
            expect(r.doc).toEqual(doc);
          } else {
            expect(r.results).toHaveLength(ops.length);
            for (const x of r.results) expect(x.ok || (typeof x.error === "string" && x.error.length > 8), JSON.stringify(x)).toBe(true);
            expect(r.rev).toBe(r.results.some((x) => x.ok) ? rev + 1 : rev);
          }
          doc = r.doc;
          rev = r.rev;
        }
      }),
      { numRuns: 500 },
    );
  });
});
