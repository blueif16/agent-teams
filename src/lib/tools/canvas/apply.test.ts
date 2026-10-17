/*
 * applyCanvasOps fixtures (docs/research/H-archetype-toolsets.md §2.3, §7 step 2). Expected fields come from
 * @excalidraw/excalidraw@0.18.1: _newElementBase defaults, FRAME_STYLE, newTextElement/newArrowElement/
 * newImageElement, bindTextToContainer, bindLinearElement and the open-color palette picks (stroke shade 8,
 * background shade 2). Text sizes use the documented server estimate: 0.55 em per character, line height 1.25,
 * labels wrapped to the container's bound-text width and centred, as Excalidraw's computeBoundTextPosition does.
 */
import { describe, expect, it } from "vitest";
import { applyCanvasOps, emptyCanvas, type CanvasDoc } from "./apply";

const NOW = 1_760_000_000_000;

/** A canvas driven call by call, as the vault writer would: rev advances when a call changes something. */
function canvas(start: CanvasDoc = emptyCanvas()) {
  let doc = start;
  let rev = 0;
  let n = 0;
  return {
    apply(ops: unknown[], over: { expectedRev?: number } = {}) {
      const r = applyCanvasOps(doc, ops, { rev, expectedRev: over.expectedRev ?? rev, now: NOW + rev * 1000, newId: () => `L${++n}`, by: "dana" });
      doc = r.doc;
      rev = r.rev;
      return r;
    },
    get doc() {
      return doc;
    },
    get rev() {
      return rev;
    },
    el(id: string) {
      return doc.elements.find((e) => e.id === id) as Record<string, unknown> | undefined;
    },
  };
}

/** 0.18.1 _newElementBase defaults, as written by our function at rev 1. */
const base = (over: Record<string, unknown>) => ({
  angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid",
  roughness: 1, opacity: 100, groupIds: [], frameId: null, index: null, roundness: null, seed: expect.any(Number), version: 1,
  versionNonce: expect.any(Number), isDeleted: false, boundElements: null, updated: NOW, link: null, locked: false,
  customData: { by: "dana", rev: 1 }, ...over,
});
const text = (over: Record<string, unknown>) =>
  base({ type: "text", fontFamily: 5, textAlign: "left", verticalAlign: "top", containerId: null, autoResize: true, lineHeight: 1.25, ...over });

const FRAME = { op: "frame", id: "f1", name: "Signup A", w: 390, h: 844 };

describe("emptyCanvas", () => {
  it("is a standard .excalidraw file with no elements", () => {
    expect(emptyCanvas()).toEqual({
      type: "excalidraw", version: 2, source: "agent-teams", elements: [],
      appState: { viewBackgroundColor: "#ffffff", gridSize: 20, gridStep: 5, gridModeEnabled: false }, files: {},
    });
  });
});

describe("frame", () => {
  it("writes an Excalidraw frame with FRAME_STYLE at the origin of an empty canvas", () => {
    const c = canvas();
    const r = c.apply([FRAME]);
    expect(r.results).toEqual([{ index: 0, op: "frame", id: "f1", ok: true, at: { frame: null, x: 0, y: 0 } }]);
    expect(r.rev).toBe(1);
    expect(c.doc.elements).toEqual([
      base({ id: "f1", type: "frame", x: 0, y: 0, width: 390, height: 844, strokeColor: "#bbb", roughness: 0, name: "Signup A" }),
    ]);
  });

  it("puts a frame without x/y 40px right of the last one", () => {
    const c = canvas();
    c.apply([FRAME, { op: "frame", id: "f2", name: "Signup B", w: 390, h: 844 }]);
    expect(c.el("f2")).toMatchObject({ x: 430, y: 0 });
  });

  it("keeps given x/y", () => {
    const c = canvas();
    c.apply([{ ...FRAME, x: -200, y: 50 }]);
    expect(c.el("f1")).toMatchObject({ x: -200, y: 50 });
  });
});

describe("shape", () => {
  it("writes a rectangle with frame-relative coordinates, the color pair and a centred bound label", () => {
    const c = canvas();
    const r = c.apply([
      { ...FRAME, x: 100, y: 50 },
      { op: "shape", id: "b1", frame: "f1", kind: "rect", x: 24, y: 700, w: 342, h: 52, label: "Create account", color: "blue" },
    ]);
    expect(r.results[1]).toEqual({ index: 1, op: "shape", id: "b1", ok: true, at: { frame: "f1", x: 24, y: 700 } });
    expect(c.el("b1")).toEqual(
      base({
        id: "b1", type: "rectangle", x: 124, y: 750, width: 342, height: 52, strokeColor: "#1971c2", backgroundColor: "#a5d8ff",
        frameId: "f1", roundness: { type: 3 }, boundElements: [{ type: "text", id: "L1" }],
      }),
    );
    // 14 chars × 20px × 0.55 = 154 wide, 25 high, centred on (124 + 171, 750 + 26).
    expect(c.el("L1")).toEqual(
      text({
        id: "L1", x: 218, y: 764, width: 154, height: 25, strokeColor: "#1971c2", frameId: "f1", fontSize: 20, text: "Create account",
        originalText: "Create account", textAlign: "center", verticalAlign: "middle", containerId: "b1",
      }),
    );
    expect(c.doc.elements.map((e) => e.id)).toEqual(["f1", "b1", "L1"]);
  });

  it("writes ellipses and diamonds with proportional roundness, outline only unless filled", () => {
    const c = canvas();
    c.apply([
      { op: "shape", id: "e1", kind: "ellipse", x: 0, y: 0, w: 80, h: 40 },
      { op: "shape", id: "d1", kind: "diamond", x: 100, y: 0, w: 80, h: 40, color: "red", fill: false },
      { op: "shape", id: "r1", kind: "rect", x: 200, y: 0, w: 80, h: 40, fill: true, link: "/work/mockups/m1" },
    ]);
    expect(c.el("e1")).toEqual(base({ id: "e1", type: "ellipse", x: 0, y: 0, width: 80, height: 40, roundness: { type: 2 } }));
    expect(c.el("d1")).toMatchObject({ type: "diamond", roundness: { type: 2 }, strokeColor: "#e03131", backgroundColor: "transparent" });
    expect(c.el("r1")).toMatchObject({ strokeColor: "#1e1e1e", backgroundColor: "#e9ecef", link: "/work/mockups/m1" });
  });

  it("places items without x/y in the next free cell, row by row with a 24px gutter", () => {
    const c = canvas();
    const sq = (id: string) => ({ op: "shape", id, frame: "f1", kind: "rect", w: 100, h: 100 });
    const r = c.apply([FRAME, sq("a"), sq("b"), sq("c")]);
    expect(r.results.slice(1).map((x) => x.at)).toEqual([
      { frame: "f1", x: 24, y: 24 },
      { frame: "f1", x: 148, y: 24 },
      { frame: "f1", x: 24, y: 148 },
    ]);
    expect(c.el("c")).toMatchObject({ x: 24, y: 148 });
  });

  it("wraps a long label to the container's text width", () => {
    const c = canvas();
    c.apply([{ op: "shape", id: "b1", kind: "rect", x: 0, y: 0, w: 120, h: 80, label: "Create your free account" }]);
    // 110px of text at 11px a char: 10 chars a line.
    expect(c.el("L1")).toMatchObject({ text: "Create\nyour free\naccount", originalText: "Create your free account", width: 99, height: 75 });
  });
});

describe("text", () => {
  it("writes a free text element sized from its text", () => {
    const c = canvas();
    c.apply([FRAME, { op: "text", id: "t1", frame: "f1", x: 24, y: 96, text: "Welcome", size: "xl" }]);
    expect(c.el("t1")).toEqual(
      text({ id: "t1", x: 24, y: 96, width: 139, height: 45, frameId: "f1", fontSize: 36, text: "Welcome", originalText: "Welcome" }),
    );
  });

  it("uses 20px by default, the stroke color of its color, and one line per newline", () => {
    const c = canvas();
    c.apply([{ op: "text", id: "t1", x: 0, y: 0, text: "Hi\nthere", color: "red" }]);
    expect(c.el("t1")).toMatchObject({ fontSize: 20, strokeColor: "#e03131", width: 55, height: 50 });
  });
});

describe("note", () => {
  it("writes a yellow sticky with bound text, placed right of the item it is near", () => {
    const c = canvas();
    const r = c.apply([
      FRAME,
      { op: "shape", id: "b1", frame: "f1", kind: "rect", x: 24, y: 24, w: 100, h: 52 },
      { op: "note", id: "n1", near: "b1", text: "Primary CTA within thumb reach" },
    ]);
    expect(r.results[2]).toMatchObject({ ok: true, at: { frame: "f1", x: 148, y: 24 } });
    expect(c.el("n1")).toEqual(
      base({
        id: "n1", type: "rectangle", x: 148, y: 24, width: 200, height: 60, strokeColor: "#f08c00", backgroundColor: "#ffec99",
        frameId: "f1", roundness: { type: 3 }, boundElements: [{ type: "text", id: "L1" }], customData: { by: "dana", rev: 1, kind: "note" },
      }),
    );
    expect(c.el("L1")).toEqual(
      text({
        id: "L1", x: 153, y: 29, width: 159, height: 40, frameId: "f1", fontSize: 16, text: "Primary CTA within\nthumb reach",
        originalText: "Primary CTA within thumb reach", containerId: "n1",
      }),
    );
  });

  it("goes below the item when there is no room to its right", () => {
    const c = canvas();
    c.apply([FRAME, { op: "shape", id: "b1", frame: "f1", kind: "rect", x: 24, y: 24, w: 342, h: 52 }, { op: "note", id: "n1", near: "b1", text: "Why" }]);
    expect(c.el("n1")).toMatchObject({ x: 24, y: 100, frameId: "f1" });
  });

  it("refuses a frame other than the near item's", () => {
    const c = canvas();
    const r = c.apply([
      FRAME, { op: "frame", id: "f2", name: "B", w: 390, h: 844 },
      { op: "shape", id: "b1", frame: "f1", kind: "rect", x: 24, y: 24, w: 100, h: 52 },
      { op: "note", id: "n1", near: "b1", frame: "f2", text: "Why" },
    ]);
    expect(r.results[3]).toMatchObject({ ok: false, error: expect.stringMatching(/b1 is in frame f1, not f2/) });
  });
});

describe("image", () => {
  it("writes an image element whose file stays in the project, rehydrated by the pane", () => {
    const c = canvas();
    c.apply([{ ...FRAME, x: 10, y: 20 }, { op: "image", id: "i1", frame: "f1", src: "files/moodboard/ref-3.png", w: 200, h: 140 }]);
    expect(c.el("i1")).toEqual(
      base({
        id: "i1", type: "image", x: 34, y: 44, width: 200, height: 140, strokeColor: "transparent", frameId: "f1",
        fileId: "files/moodboard/ref-3.png", status: "saved", scale: [1, 1], crop: null,
        customData: { by: "dana", rev: 1, src: "files/moodboard/ref-3.png" },
      }),
    );
    expect(c.doc.files).toEqual({});
  });
});

describe("connect", () => {
  it("writes an arrow bound at both ends, listed in each end's boundElements, with a label", () => {
    const c = canvas();
    c.apply([FRAME, { op: "frame", id: "f2", name: "Signup B", w: 390, h: 844 }]);
    const r = c.apply([{ op: "connect", id: "c1", from: "f1", to: "f2", label: "tap Create" }]);
    expect(r.results).toEqual([{ index: 0, op: "connect", id: "c1", ok: true }]);
    const at2 = { updated: NOW + 1000, customData: { by: "dana", rev: 2 } };
    // Centres (195,422) → (625,422); leaves f1's edge at x 390 and enters f2's at 430, 8px gap each side.
    expect(c.el("c1")).toEqual(
      base({
        id: "c1", type: "arrow", x: 398, y: 422, width: 24, height: 0, roundness: { type: 2 }, boundElements: [{ type: "text", id: "L1" }],
        points: [[0, 0], [24, 0]], lastCommittedPoint: null, startBinding: { elementId: "f1", focus: 0, gap: 8 },
        endBinding: { elementId: "f2", focus: 0, gap: 8 }, startArrowhead: null, endArrowhead: "arrow", elbowed: false, ...at2,
      }),
    );
    expect(c.el("f1")).toMatchObject({ boundElements: [{ id: "c1", type: "arrow" }], version: 2, ...at2 });
    expect(c.el("f2")).toMatchObject({ boundElements: [{ id: "c1", type: "arrow" }], version: 2 });
    // 10 chars × 16px × 0.55 = 88 wide, centred on the arrow's midpoint (410,422).
    expect(c.el("L1")).toEqual(
      text({
        id: "L1", x: 366, y: 412, width: 88, height: 20, fontSize: 16, text: "tap Create", originalText: "tap Create",
        textAlign: "center", verticalAlign: "middle", containerId: "c1", ...at2,
      }),
    );
  });

  it("runs a diagonal arrow between box edges and keeps it in a shared frame", () => {
    const c = canvas();
    c.apply([
      { ...FRAME, w: 600, h: 600 },
      { op: "shape", id: "a", frame: "f1", kind: "rect", x: 0, y: 0, w: 100, h: 100 },
      { op: "shape", id: "b", frame: "f1", kind: "rect", x: 200, y: 200, w: 100, h: 100 },
      { op: "connect", id: "c1", from: "a", to: "b", style: "dashed" },
    ]);
    expect(c.el("c1")).toMatchObject({ x: 106, y: 106, width: 88, height: 88, points: [[0, 0], [88, 88]], frameId: "f1", strokeStyle: "dashed", endArrowhead: "arrow" });
  });

  it("draws a line style with no arrowhead", () => {
    const c = canvas();
    c.apply([
      { op: "shape", id: "a", kind: "rect", x: 0, y: 0, w: 10, h: 10 },
      { op: "shape", id: "b", kind: "rect", x: 100, y: 0, w: 10, h: 10 },
      { op: "connect", id: "c1", from: "a", to: "b", style: "line" },
    ]);
    expect(c.el("c1")).toMatchObject({ endArrowhead: null, startArrowhead: null, strokeStyle: "solid", frameId: null });
  });

  it("errors on a missing end and still applies the other ops", () => {
    const c = canvas();
    const r = c.apply([FRAME, { op: "connect", id: "c1", from: "f1", to: "f9" }, { op: "text", id: "t1", frame: "f1", text: "Hi" }]);
    expect(r.results.map((x) => x.ok)).toEqual([true, false, true]);
    expect(r.results[1].error).toMatch(/f9 doesn't exist/);
    expect(c.el("c1")).toBeUndefined();
    expect(c.el("f1")).toMatchObject({ boundElements: null });
    expect(c.el("t1")).toBeDefined();
    expect(r.rev).toBe(1);
  });

  it("refuses to connect an element to itself or to a connector", () => {
    const c = canvas();
    c.apply([FRAME, { op: "frame", id: "f2", name: "B", w: 10, h: 10 }, { op: "connect", id: "c1", from: "f1", to: "f2" }]);
    const r = c.apply([{ op: "connect", id: "c2", from: "f1", to: "f1" }, { op: "connect", id: "c3", from: "c1", to: "f2" }]);
    expect(r.results[0].error).toMatch(/two different elements/);
    expect(r.results[1].error).toMatch(/c1 is a connector/);
  });
});

describe("update", () => {
  function screen() {
    const c = canvas();
    c.apply([
      FRAME,
      { op: "frame", id: "f2", name: "Signup B", w: 390, h: 844 },
      { op: "shape", id: "b1", frame: "f1", kind: "rect", x: 24, y: 700, w: 342, h: 52, label: "Create account", color: "blue" },
      { op: "shape", id: "b2", frame: "f1", kind: "rect", x: 24, y: 24, w: 100, h: 100 },
      { op: "connect", id: "c1", from: "b2", to: "b1" },
    ]);
    return c;
  }

  it("moves an item, relabels it and bumps version, nonce, updated and rev; the seed stays", () => {
    const c = screen();
    const before = c.el("b1")!;
    const r = c.apply([{ op: "update", id: "b1", y: 640, label: "Get started" }]);
    expect(r.results).toEqual([{ index: 0, op: "update", id: "b1", ok: true, at: { frame: "f1", x: 24, y: 640 } }]);
    const after = c.el("b1")!;
    expect(after).toMatchObject({ x: 24, y: 640, version: 3, seed: before.seed, updated: NOW + 1000, customData: { by: "dana", rev: 2 } });
    expect(after.versionNonce).not.toBe(before.versionNonce);
    // "Get started": 11 × 11 = 121 wide, centred on (195, 666).
    expect(c.el("L1")).toMatchObject({ text: "Get started", originalText: "Get started", x: 135, y: 654, width: 121, version: 2 });
  });

  it("re-routes arrows bound to a moved item", () => {
    const c = screen();
    const before = c.el("c1")!;
    c.apply([{ op: "update", id: "b1", y: 300 }]);
    // b2 centre (74,74) → b1 centre (195,326): the arrow's end now stops above y 326.
    const after = c.el("c1")!;
    expect(after.points).not.toEqual(before.points);
    const pts = after.points as [number, number][];
    expect((after.y as number) + pts[1][1]).toBeLessThan(300);
    expect(after.version).toBe((before.version as number) + 1);
  });

  it("moves a frame's children and their labels with it", () => {
    const c = screen();
    c.apply([{ op: "update", id: "f1", x: 1000, y: 10 }]);
    expect(c.el("f1")).toMatchObject({ x: 1000, y: 10 });
    expect(c.el("b1")).toMatchObject({ x: 1024, y: 710 });
    expect(c.el("L1")).toMatchObject({ x: 1118, y: 724 });
  });

  it("moves an item to another frame, into the next free cell when x/y are left out", () => {
    const c = screen();
    const r = c.apply([{ op: "update", id: "b1", frame: "f2" }]);
    expect(r.results[0].at).toEqual({ frame: "f2", x: 24, y: 24 });
    expect(c.el("b1")).toMatchObject({ frameId: "f2", x: 454, y: 24 });
    expect(c.el("L1")).toMatchObject({ frameId: "f2" });
    expect(c.el("c1")).toMatchObject({ frameId: null });
  });

  it('removes a label with label ""', () => {
    const c = screen();
    c.apply([{ op: "update", id: "b1", label: "" }]);
    expect(c.el("L1")).toBeUndefined();
    expect(c.el("b1")!.boundElements).toEqual([{ id: "c1", type: "arrow" }]);
  });

  it("recolors a shape with its color pair", () => {
    const c = screen();
    c.apply([{ op: "update", id: "b1", color: "green" }]);
    expect(c.el("b1")).toMatchObject({ strokeColor: "#2f9e44", backgroundColor: "#b2f2bb" });
  });

  it("refuses fields the element doesn't take, an unknown id, and an empty change", () => {
    const c = screen();
    const r = c.apply([
      { op: "update", id: "f1", label: "x" },
      { op: "update", id: "zz", x: 1 },
      { op: "update", id: "b1" },
      { op: "update", id: "f1", frame: "f2" },
      { op: "update", id: "L1", text: "x" },
    ]);
    expect(r.results.map((x) => x.error)).toEqual([
      expect.stringMatching(/f1 is a frame; it takes x, y, w, h and name/),
      expect.stringMatching(/no element zz/),
      expect.stringMatching(/changes nothing/),
      expect.stringMatching(/frames can't go inside frames/),
      expect.stringMatching(/L1 is the label of b1/),
    ]);
    expect(r.rev).toBe(1);
  });
});

describe("delete", () => {
  it("removes the element, its label, and the arrows bound to it with their labels", () => {
    const c = canvas();
    c.apply([
      { op: "shape", id: "b1", kind: "rect", x: 0, y: 0, w: 100, h: 50, label: "One" },
      { op: "shape", id: "b2", kind: "rect", x: 300, y: 0, w: 100, h: 50 },
      { op: "connect", id: "c1", from: "b1", to: "b2", label: "next" },
    ]);
    const r = c.apply([{ op: "delete", ids: ["b1"] }]);
    expect(r.results).toEqual([{ index: 0, op: "delete", ok: true, deleted: ["b1", "L1", "c1", "L2"] }]);
    expect(c.doc.elements.map((e) => e.id)).toEqual(["b2"]);
    expect(c.el("b2")).toMatchObject({ boundElements: null, version: 3 });
  });

  it("releases a frame's children onto the canvas, as Excalidraw 0.18.1 does", () => {
    const c = canvas();
    c.apply([FRAME, { op: "shape", id: "b1", frame: "f1", kind: "rect", x: 24, y: 24, w: 100, h: 50, label: "Go" }]);
    const r = c.apply([{ op: "delete", ids: ["f1"] }]);
    expect(r.results[0]).toMatchObject({ ok: true, deleted: ["f1"], released: ["b1"] });
    expect(c.el("b1")).toMatchObject({ frameId: null, x: 24, y: 24 });
    expect(c.el("L1")).toMatchObject({ frameId: null });
  });

  it("deletes nothing when an id is unknown", () => {
    const c = canvas();
    c.apply([FRAME]);
    const r = c.apply([{ op: "delete", ids: ["f1", "n9", "x2"] }]);
    expect(r.results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/no element n9, x2/) });
    expect(c.el("f1")).toBeDefined();
  });
});

describe("errors", () => {
  it("names the element that already holds a reused id", () => {
    const c = canvas();
    const r = c.apply([FRAME, { op: "shape", id: "b1", frame: "f1", kind: "rect", w: 10, h: 10, label: "Go" }, { op: "text", id: "b1", text: "x" }]);
    expect(r.results[2].error).toMatch(/b1 is taken by the rectangle "Go" in frame f1/);
  });

  it("errors on a frame that doesn't exist or isn't a frame", () => {
    const c = canvas();
    const r = c.apply([
      { op: "shape", id: "b1", kind: "rect", x: 0, y: 0, w: 10, h: 10 },
      { op: "text", id: "t1", frame: "f9", text: "x" },
      { op: "text", id: "t2", frame: "b1", text: "x" },
    ]);
    expect(r.results[1].error).toMatch(/frame f9 doesn't exist/);
    expect(r.results[2].error).toMatch(/b1 is a rectangle, not a frame/);
  });

  it("errors when an item doesn't fit inside its frame", () => {
    const c = canvas();
    const r = c.apply([FRAME, { op: "shape", id: "b1", frame: "f1", kind: "rect", x: 300, y: 0, w: 200, h: 10 }]);
    expect(r.results[1].error).toMatch(/b1 at 300,0 size 200x10 is outside frame f1 \(390x844\)/);
  });

  it("errors when a frame has no free cell left", () => {
    const c = canvas();
    const r = c.apply([{ ...FRAME, w: 100, h: 100 }, { op: "shape", id: "b1", frame: "f1", kind: "rect", w: 80, h: 80 }]);
    expect(r.results[1].error).toMatch(/no free spot in frame f1 for 80x80/);
  });

  it("returns schema errors per op and applies the rest", () => {
    const c = canvas();
    const r = c.apply([{ op: "shape", id: "b1", kind: "rect", w: 10 }, FRAME, { op: "paint" }]);
    expect(r.results.map((x) => x.ok)).toEqual([false, true, false]);
    expect(r.results[0].error).toMatch(/shape b1: h: /);
    expect(r.results[2].error).toMatch(/op/);
  });

  it("leaves the rev alone when no op applied", () => {
    const c = canvas();
    const r = c.apply([{ op: "delete", ids: ["nope"] }]);
    expect(r.rev).toBe(0);
    expect(r.doc).toEqual(emptyCanvas());
  });
});

describe("the whole call", () => {
  it("rejects a stale expectedRev without touching the canvas", () => {
    const c = canvas();
    c.apply([FRAME]);
    const before = structuredClone(c.doc);
    const r = c.apply([{ op: "delete", ids: ["f1"] }], { expectedRev: 0 });
    expect(r.error).toMatch(/the canvas changed since you read it: it is at rev 1, you sent expectedRev 0/);
    expect(r.results).toEqual([]);
    expect(r.rev).toBe(1);
    expect(r.doc).toEqual(before);
  });

  it("rejects more than 40 ops", () => {
    const r = canvas().apply(Array.from({ length: 41 }, (_, i) => ({ op: "text", id: `t${i}`, x: 0, y: i * 30, text: "x" })));
    expect(r.error).toMatch(/1 to 40 ops/);
    expect(r.results).toEqual([]);
    expect(r.doc.elements).toEqual([]);
  });

  it("never mutates the document it is given", () => {
    const c = canvas();
    c.apply([FRAME, { op: "shape", id: "b1", frame: "f1", kind: "rect", w: 10, h: 10, label: "Go" }]);
    const given = c.doc;
    const snapshot = structuredClone(given);
    applyCanvasOps(given, [{ op: "update", id: "f1", x: 500 }, { op: "delete", ids: ["b1"] }], { rev: 1, expectedRev: 1, now: NOW, newId: () => "Z1", by: "x" });
    expect(given).toEqual(snapshot);
  });
});
