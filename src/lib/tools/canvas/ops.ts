/*
 * The canvas_edit op schema (docs/research/H-archetype-toolsets.md §2.3). Eight flat, closed ops with one `op`
 * discriminator and no nested unions, because cheap models do best with small closed schemas. Model ids are short
 * names (f1, b1) unique per canvas; coordinates are integers, relative to the frame when an item has one.
 * applyCanvasOps (./apply.ts) turns them into Excalidraw 0.18.1 elements; describe() strings are constants so the
 * tool schema stays byte-stable in the prompt prefix.
 */
import { z } from "zod";

export const MAX_OPS = 40;
export const COLORS = ["gray", "blue", "green", "yellow", "red", "violet"] as const;
export const SIZES = ["s", "m", "l", "xl"] as const;
export type Color = (typeof COLORS)[number];
export type Size = (typeof SIZES)[number];

/** Excalidraw's palette picks for each color: stroke = open-color shade 8, background = shade 2 (0.18.1). */
export const COLOR_PAIRS: Record<Color, { stroke: string; background: string }> = {
  gray: { stroke: "#343a40", background: "#e9ecef" },
  blue: { stroke: "#1971c2", background: "#a5d8ff" },
  green: { stroke: "#2f9e44", background: "#b2f2bb" },
  yellow: { stroke: "#f08c00", background: "#ffec99" },
  red: { stroke: "#e03131", background: "#ffc9c9" },
  violet: { stroke: "#6741d9", background: "#d0bfff" },
};
/** Font size in px per size name. */
export const FONT_SIZES: Record<Size, number> = { s: 16, m: 20, l: 28, xl: 36 };

const newId = z.string().regex(/^[a-z0-9_-]{1,24}$/, "ids are 1-24 of a-z 0-9 _ -").describe("Your short id, unique on this canvas");
const ref = z.string().min(1).max(64).describe("An id on this canvas");
const coord = z.number().int().min(-100_000).max(100_000);
const size = z.number().int().min(1).max(20_000);
const color = z.enum(COLORS);
const label = z.string().min(1).max(200);
const text = z.string().min(1).max(2000);
const name = z.string().min(1).max(80);
const link = z.string().max(500).regex(/^(https?:\/\/|\/)\S*$/, "a link is an https:// URL or an app path like /work/mockups/m1");
/** A project file: relative, no "..", no scheme, an image extension. */
const src = z
  .string()
  .max(300)
  .regex(/^(?![/\\])(?!.*\.\.)[\w./-]+\.(png|jpe?g|gif|webp|svg)$/i, "src is an image file in the project, like files/moodboard/ref-1.png");

const at = { x: coord.optional(), y: coord.optional() };

export const FrameOp = z.strictObject({ op: z.literal("frame"), id: newId, name, ...at, w: size, h: size });
export const ShapeOp = z.strictObject({
  op: z.literal("shape"), id: newId, frame: ref.optional(), kind: z.enum(["rect", "ellipse", "diamond"]), ...at, w: size, h: size,
  label: label.optional(), color: color.optional(), fill: z.boolean().optional(), link: link.optional(),
});
export const TextOp = z.strictObject({
  op: z.literal("text"), id: newId, frame: ref.optional(), ...at, text, size: z.enum(SIZES).optional(), color: color.optional(),
});
export const NoteOp = z.strictObject({ op: z.literal("note"), id: newId, text, near: ref.optional(), frame: ref.optional(), ...at });
export const ImageOp = z.strictObject({ op: z.literal("image"), id: newId, frame: ref.optional(), src, ...at, w: size, h: size });
export const ConnectOp = z.strictObject({
  op: z.literal("connect"), id: newId, from: ref, to: ref, label: label.optional(), style: z.enum(["arrow", "line", "dashed"]).optional(),
});
export const UpdateOp = z.strictObject({
  op: z.literal("update"), id: ref, ...at, w: size.optional(), h: size.optional(), frame: ref.optional(),
  label: z.string().max(200).optional().describe('New label; "" removes it'), text: text.optional(), color: color.optional(), name: name.optional(),
});
export const DeleteOp = z.strictObject({ op: z.literal("delete"), ids: z.array(ref).min(1).max(MAX_OPS) });

export const CanvasOpSchema = z.discriminatedUnion("op", [FrameOp, ShapeOp, TextOp, NoteOp, ImageOp, ConnectOp, UpdateOp, DeleteOp]);
export type CanvasOp = z.infer<typeof CanvasOpSchema>;

/** The model-facing canvas_edit arguments. */
export const CanvasEditSchema = z.strictObject({
  canvas: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/).describe("The canvas slug"),
  expectedRev: z.number().int().min(0).describe("The rev you last read; a newer canvas rejects the call"),
  ops: z.array(CanvasOpSchema).min(1).max(MAX_OPS),
});
export type CanvasEdit = z.infer<typeof CanvasEditSchema>;
