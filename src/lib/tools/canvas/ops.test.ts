/*
 * The canvas_edit op schema (docs/research/H-archetype-toolsets.md §2.3): 8 flat, closed ops; closed colors, sizes
 * and kinds; integer coordinates; model ids [a-z0-9_-]{1,24}; image src a project file; ≤ 40 ops per call.
 */
import { describe, expect, it } from "vitest";
import { CANVAS_NOTE } from "../notes";
import { CanvasEditSchema, CanvasOpSchema } from "./ops";

const ok = (op: unknown) => CanvasOpSchema.safeParse(op).success;
const why = (op: unknown) => {
  const r = CanvasOpSchema.safeParse(op);
  return r.success ? "" : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
};

const VALID = {
  frame: { op: "frame", id: "f1", name: "Signup A", w: 390, h: 844 },
  shape: { op: "shape", id: "b1", frame: "f1", kind: "rect", w: 342, h: 52, label: "Go", color: "blue", fill: true, link: "/work/mockups/m1" },
  text: { op: "text", id: "t1", frame: "f1", x: 24, y: 96, text: "Welcome", size: "xl", color: "gray" },
  note: { op: "note", id: "n1", near: "b1", text: "Thumb reach" },
  image: { op: "image", id: "i1", frame: "f1", src: "files/moodboard/ref-3.png", w: 200, h: 140 },
  connect: { op: "connect", id: "c1", from: "f1", to: "f2", label: "tap", style: "dashed" },
  update: { op: "update", id: "b1", x: 0, y: 640, w: 100, h: 40, frame: "f2", label: "Get started", color: "red", name: "x", text: "y" },
  delete: { op: "delete", ids: ["n1", "b1"] },
} as const;

describe("CanvasOpSchema", () => {
  it("accepts every example the canvas prompt note teaches", () => {
    const lines = CANVAS_NOTE.split("\n").filter((l) => l.startsWith("- {"));
    expect(lines).toHaveLength(8);
    for (const l of lines) expect(why(JSON.parse(l.slice(2))), l).toBe("");
  });

  it("accepts each of the 8 ops with all of its fields", () => {
    for (const [name, op] of Object.entries(VALID)) expect(why(op), name).toBe("");
  });

  it("rejects an unknown op", () => {
    expect(ok({ op: "group", id: "g1" })).toBe(false);
  });

  it("rejects a missing required field, naming it", () => {
    expect(why({ op: "shape", id: "b1", kind: "rect", w: 10 })).toMatch(/^h: /);
    expect(why({ op: "connect", id: "c1", from: "a" })).toMatch(/^to: /);
    expect(why({ op: "delete" })).toMatch(/^ids: /);
  });

  it("rejects keys outside the op's closed shape", () => {
    expect(why({ ...VALID.shape, width: 10 })).toMatch(/Unrecognized key.*width/);
    expect(ok({ ...VALID.frame, frame: "f0" })).toBe(false);
    expect(ok({ ...VALID.delete, id: "x" })).toBe(false);
  });

  it("closes the kinds, colors, sizes and styles", () => {
    expect(ok({ ...VALID.shape, kind: "rectangle" })).toBe(false);
    expect(ok({ ...VALID.shape, color: "pink" })).toBe(false);
    expect(ok({ ...VALID.text, size: "xxl" })).toBe(false);
    expect(ok({ ...VALID.connect, style: "dotted" })).toBe(false);
  });

  it("takes only short lowercase ids on create ops", () => {
    expect(ok({ ...VALID.frame, id: "F1" })).toBe(false);
    expect(ok({ ...VALID.frame, id: "a".repeat(25) })).toBe(false);
    expect(ok({ ...VALID.frame, id: "a".repeat(24) })).toBe(true);
    expect(ok({ ...VALID.frame, id: "f 1" })).toBe(false);
  });

  it("takes integer coordinates and sizes within range", () => {
    expect(ok({ ...VALID.text, x: 1.5 })).toBe(false);
    expect(ok({ ...VALID.text, x: 100_001 })).toBe(false);
    expect(ok({ ...VALID.text, x: -100_000 })).toBe(true);
    expect(ok({ ...VALID.shape, w: 0 })).toBe(false);
    expect(ok({ ...VALID.shape, w: 20_001 })).toBe(false);
  });

  it("takes only a project image file as an image src", () => {
    for (const src of ["https://x.com/a.png", "/etc/a.png", "files/../../a.png", "files/a.txt", "C:/a.png", "data:image/png;base64,AA"]) {
      expect(ok({ ...VALID.image, src }), src).toBe(false);
    }
    for (const src of ["files/a.png", "exports/onboarding-f1.svg", "files/canvas/x/ref_2.JPEG"]) expect(ok({ ...VALID.image, src }), src).toBe(true);
  });

  it("takes a web URL or an app path as a shape link", () => {
    expect(ok({ ...VALID.shape, link: "https://example.com/x" })).toBe(true);
    expect(ok({ ...VALID.shape, link: "javascript:alert(1)" })).toBe(false);
  });

  it("deletes between 1 and 40 ids at once", () => {
    expect(ok({ op: "delete", ids: [] })).toBe(false);
    expect(ok({ op: "delete", ids: Array.from({ length: 40 }, (_, i) => `e${i}`) })).toBe(true);
    expect(ok({ op: "delete", ids: Array.from({ length: 41 }, (_, i) => `e${i}`) })).toBe(false);
  });
});

describe("CanvasEditSchema", () => {
  const call = (ops: unknown[], extra: object = {}) => CanvasEditSchema.safeParse({ canvas: "onboarding", expectedRev: 3, ops, ...extra });

  it("takes 1 to 40 ops", () => {
    expect(call([]).success).toBe(false);
    expect(call(Array(40).fill(VALID.delete)).success).toBe(true);
    expect(call(Array(41).fill(VALID.delete)).success).toBe(false);
  });

  it("requires a whole, non-negative expectedRev and a canvas slug", () => {
    expect(call([VALID.delete], { expectedRev: -1 }).success).toBe(false);
    expect(call([VALID.delete], { expectedRev: 1.5 }).success).toBe(false);
    expect(call([VALID.delete], { canvas: "../x" }).success).toBe(false);
  });
});
