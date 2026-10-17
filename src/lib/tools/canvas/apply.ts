/*
 * applyCanvasOps: canvas_edit's ops → a standard .excalidraw document (docs/research/H-archetype-toolsets.md §2.3).
 * Pure and server-side: agents edit with the pane closed, so we write full Excalidraw 0.18.1 elements ourselves
 * (not the browser-only skeleton converter) with estimated text sizes; the pane's restore({ refreshDimensions })
 * fixes the metrics on load.
 *
 * Element fields follow the 0.18.1 package (element/types.d.ts and its constructors): _newElementBase defaults,
 * FRAME_STYLE, bound text as bindTextToContainer writes it, arrows bound as bindLinearElement writes them. Two
 * places follow the package over H: deleting removes elements from the file (serializeAsJSON never writes
 * isDeleted ones), and deleting a frame releases its children onto the canvas (actionDeleteSelected).
 *
 * Each op applies on its own: a failing op changes nothing and gets a real error, the rest of the call still applies.
 * A stale expectedRev rejects the whole call.
 */
import { CanvasOpSchema, COLOR_PAIRS, FONT_SIZES, MAX_OPS, type CanvasOp } from "./ops";

// ── The Excalidraw 0.18.1 element format (type aliases, so they read as plain JSON records).

export type BoundRef = { id: string; type: "arrow" | "text" };
export type PointBinding = { elementId: string; focus: number; gap: number };
type Base = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: "hachure" | "cross-hatch" | "solid" | "zigzag";
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  roughness: number;
  opacity: number;
  groupIds: string[];
  frameId: string | null;
  index: string | null;
  roundness: { type: 1 | 2 | 3; value?: number } | null;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  boundElements: BoundRef[] | null;
  updated: number;
  link: string | null;
  locked: boolean;
  customData?: Record<string, unknown>;
};
export type FrameElement = Base & { type: "frame"; name: string | null };
export type ShapeElement = Base & { type: "rectangle" | "ellipse" | "diamond" };
export type TextElement = Base & {
  type: "text";
  fontSize: number;
  fontFamily: number;
  text: string;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  containerId: string | null;
  originalText: string;
  autoResize: boolean;
  lineHeight: number;
};
export type ImageElement = Base & {
  type: "image";
  fileId: string | null;
  status: "pending" | "saved" | "error";
  scale: [number, number];
  crop: { x: number; y: number; width: number; height: number; naturalWidth: number; naturalHeight: number } | null;
};
export type ArrowElement = Base & {
  type: "arrow";
  points: [number, number][];
  lastCommittedPoint: [number, number] | null;
  startBinding: PointBinding | null;
  endBinding: PointBinding | null;
  startArrowhead: string | null;
  endArrowhead: string | null;
  elbowed: boolean;
};
/** What the owner can draw that ops never create; kept and moved, never rewritten. */
export type OtherElement = Base & { type: "line" | "freedraw" | "embeddable" | "iframe" | "magicframe" } & Record<string, unknown>;
export type CanvasElement = FrameElement | ShapeElement | TextElement | ImageElement | ArrowElement | OtherElement;

/** A .excalidraw file (ExportedDataState). */
export interface CanvasDoc {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: CanvasElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export interface ApplyOptions {
  /** The canvas's current rev (vault commits on the file). */
  rev: number;
  /** The rev the model last read; any other value rejects the call. */
  expectedRev: number;
  /** Epoch ms written to `updated`. */
  now: number;
  /** Ids for elements the model doesn't name (labels). */
  newId: () => string;
  /** The agent id written to customData.by. */
  by: string;
}

export interface OpResult {
  index: number;
  op: string;
  id?: string;
  ok: boolean;
  error?: string;
  /** Where the item ended up, relative to its frame (absolute when frame is null). */
  at?: { frame: string | null; x: number; y: number };
  /** Every element removed, cascades included, in document order. */
  deleted?: string[];
  /** Items that left a deleted frame and stay on the canvas. */
  released?: string[];
}

export interface ApplyResult {
  doc: CanvasDoc;
  /** rev + 1 when any op applied, else rev. */
  rev: number;
  results: OpResult[];
  /** Set when the whole call was rejected (stale rev, op count); results is then empty. */
  error?: string;
}

export const emptyCanvas = (): CanvasDoc => ({
  type: "excalidraw",
  version: 2,
  source: "agent-teams",
  elements: [],
  appState: { viewBackgroundColor: "#ffffff", gridSize: 20, gridStep: 5, gridModeEnabled: false },
  files: {},
});

// ── Constants from 0.18.1 and our layout rules.

const BLACK = "#1e1e1e";
const FONT_FAMILY_EXCALIFONT = 5;
const LINE_HEIGHT = 1.25;
const BOUND_TEXT_PADDING = 5;
/** Server-side text estimate: 0.55 em per character (×100 to keep integer math exact). */
const CHAR_EM_100 = 55;
const GUTTER = 24;
const FRAME_GAP = 40;
const ARROW_GAP = 8;
const NOTE_W = 200;
const NOTE_MIN_H = 60;
const LABEL_SIZE = { shape: 20, note: 16, arrow: 16 };

class OpError extends Error {}
const fail = (message: string): never => {
  throw new OpError(message);
};

type Box = { x: number; y: number; w: number; h: number };
type Kind = "frame" | "shape" | "note" | "text" | "image" | "connector" | "other";

const UPDATE_FIELDS = ["x", "y", "w", "h", "frame", "label", "text", "color", "name"] as const;
const TAKES: Record<Kind, readonly (typeof UPDATE_FIELDS)[number][]> = {
  frame: ["x", "y", "w", "h", "name"],
  shape: ["x", "y", "w", "h", "frame", "label", "color"],
  note: ["x", "y", "frame", "text"],
  text: ["x", "y", "frame", "text", "color"],
  image: ["x", "y", "w", "h", "frame"],
  connector: ["label"],
  other: ["x", "y", "frame"],
};
const BINDABLE = new Set(["rectangle", "ellipse", "diamond", "text", "image", "frame", "embeddable", "iframe", "magicframe"]);

/** FNV-1a: deterministic seeds and nonces, so the function stays pure. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0) & 0x7fffffff;
}

const list = (xs: readonly string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const article = (w: string) => (/^[aeiou]/.test(w) ? `an ${w}` : `a ${w}`);
const clip = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);

function measure(text: string, fontSize: number) {
  const lines = text.split("\n");
  const longest = Math.max(...lines.map((l) => l.length));
  return { w: Math.ceil((longest * fontSize * CHAR_EM_100) / 100), h: lines.length * fontSize * LINE_HEIGHT };
}

/** Greedy word wrap at the estimated characters per line; words longer than a line are split. */
function wrap(text: string, maxWidth: number, fontSize: number): string {
  const max = Math.max(1, Math.floor((maxWidth * 100) / (fontSize * CHAR_EM_100)));
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (let word of para.split(" ")) {
      while (word.length > max) {
        if (line) out.push(line);
        line = "";
        out.push(word.slice(0, max));
        word = word.slice(max);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= max) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One op's working copy of the scene. */
class Scene {
  els: CanvasElement[];
  private byId: Map<string, CanvasElement>;
  private touched = new Set<string>();
  private created = new Set<string>();

  constructor(
    els: CanvasElement[],
    private opts: ApplyOptions,
    private rev: number,
  ) {
    this.els = els;
    this.byId = new Map(els.map((e) => [e.id, e]));
  }

  get(id: string): CanvasElement | undefined {
    return this.byId.get(id);
  }

  /** Model ids are free unless a live element holds them. */
  claim(id: string) {
    const e = this.get(id);
    if (e) fail(`id ${id} is taken by ${this.describe(e)}; pick another id or update ${id}`);
  }

  genId(): string {
    for (let i = 0; i < 100; i++) {
      const id = this.opts.newId();
      if (!this.byId.has(id)) return id;
    }
    throw new Error("newId kept returning ids already on the canvas");
  }

  base(id: string, box: Box, frameId: string | null): Base {
    return {
      id, x: box.x, y: box.y, width: box.w, height: box.h, angle: 0, strokeColor: BLACK, backgroundColor: "transparent",
      fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId, index: null,
      roundness: null, seed: hash(`seed:${id}`), version: 1, versionNonce: hash(`${id}:1:${this.rev}:${this.opts.now}`),
      isDeleted: false, boundElements: null, updated: this.opts.now, link: null, locked: false,
      customData: { by: this.opts.by, rev: this.rev },
    };
  }

  insert(e: CanvasElement, after?: CanvasElement) {
    const at = after ? this.els.indexOf(after) + 1 : this.els.length;
    this.els.splice(at, 0, e);
    this.byId.set(e.id, e);
    this.created.add(e.id);
  }

  /** Apply a patch; the element counts as changed only if a value actually differs. */
  set<T extends CanvasElement>(e: T, patch: Partial<T>) {
    for (const [k, v] of Object.entries(patch)) {
      const key = k as keyof T;
      if (same(e[key], v)) continue;
      e[key] = v as T[keyof T];
      this.touched.add(e.id);
    }
  }

  remove(ids: Set<string>) {
    this.els = this.els.filter((e) => !ids.has(e.id));
    for (const id of ids) this.byId.delete(id);
    for (const e of this.els) {
      const kept = (e.boundElements ?? []).filter((b) => !ids.has(b.id));
      if (kept.length !== (e.boundElements ?? []).length) this.set(e, { boundElements: kept.length ? kept : null });
    }
  }

  /** Bump version, nonce, updated and customData on every element this op changed (Excalidraw's mutateElement). */
  finish() {
    for (const id of this.touched) {
      const e = this.get(id);
      if (!e || this.created.has(id)) continue;
      e.version += 1;
      e.versionNonce = hash(`${id}:${e.version}:${this.rev}:${this.opts.now}`);
      e.updated = this.opts.now;
      e.customData = { ...e.customData, by: this.opts.by, rev: this.rev };
    }
  }

  // ── Reading the scene

  kind(e: CanvasElement): Kind {
    if (e.type === "frame") return "frame";
    if (e.type === "rectangle" && e.customData?.kind === "note") return "note";
    if (e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond") return "shape";
    if (e.type === "text") return "text";
    if (e.type === "image") return "image";
    if (e.type === "arrow") return "connector";
    return "other";
  }

  kindName(e: CanvasElement): string {
    const k = this.kind(e);
    return k === "shape" || k === "other" ? e.type : k;
  }

  labelOf(e: CanvasElement): TextElement | undefined {
    const ref = e.boundElements?.find((b) => b.type === "text");
    const t = ref && this.get(ref.id);
    return t?.type === "text" ? t : undefined;
  }

  describe(e: CanvasElement): string {
    if (e.type === "text" && e.containerId) return `the label of ${e.containerId}`;
    const words = e.type === "frame" ? e.name : e.type === "text" ? e.originalText : this.labelOf(e)?.originalText;
    return `the ${this.kindName(e)}${words ? ` "${clip(words)}"` : ""}${e.frameId ? ` in frame ${e.frameId}` : ""}`;
  }

  isLabel(e: CanvasElement): e is TextElement {
    return e.type === "text" && e.containerId != null;
  }

  frameOf(e: CanvasElement): FrameElement | null {
    const f = e.frameId ? this.get(e.frameId) : undefined;
    return f?.type === "frame" ? f : null;
  }

  resolveFrame(ref: string | undefined): FrameElement | null {
    if (ref === undefined) return null;
    const f = this.get(ref) ?? fail(`frame ${ref} doesn't exist`);
    return f.type === "frame" ? f : fail(`${ref} is ${article(this.kindName(f))}, not a frame`);
  }

  arrowsTo(id: string): ArrowElement[] {
    return this.els.filter((e): e is ArrowElement => e.type === "arrow" && (e.startBinding?.elementId === id || e.endBinding?.elementId === id));
  }

  box(e: CanvasElement): Box {
    return { x: e.x, y: e.y, w: e.width, h: e.height };
  }

  /** Items that take up room in a frame (or on the open canvas): not labels, not connectors. */
  obstacles(frameId: string | null, except?: string): Box[] {
    return this.els.filter((e) => e.frameId === frameId && e.id !== except && !this.isLabel(e) && e.type !== "arrow").map((e) => this.box(e));
  }

  // ── Placement

  /** The next free cell in a frame, row by row with a gutter; relative to the frame. */
  freeCell(f: FrameElement, w: number, h: number, except?: string, prefer: { x: number; y: number }[] = []) {
    const obs = this.obstacles(f.id, except).map((o) => ({ ...o, x: o.x - f.x, y: o.y - f.y }));
    const cells = [{ x: GUTTER, y: GUTTER }, ...obs.flatMap((o) => [
      { x: o.x + o.w + GUTTER, y: o.y },
      { x: GUTTER, y: o.y + o.h + GUTTER },
      { x: o.x, y: o.y + o.h + GUTTER },
    ])].sort((a, b) => a.y - b.y || a.x - b.x);
    const fits = (c: { x: number; y: number }) =>
      c.x >= GUTTER && c.y >= GUTTER && c.x + w <= f.width - GUTTER && c.y + h <= f.height - GUTTER && !obs.some((o) => clash(c, w, h, o));
    return [...prefer, ...cells].find(fits) ?? null;
  }

  /** On the open canvas: the first preferred spot that clashes with nothing, else below everything. */
  rootSpot(w: number, h: number, except?: string, prefer: { x: number; y: number }[] = []) {
    const obs = this.obstacles(null, except);
    const free = prefer.find((c) => !obs.some((o) => clash(c, w, h, o)));
    if (free) return free;
    if (!obs.length) return { x: 0, y: 0 };
    return { x: Math.min(...obs.map((o) => o.x)), y: Math.max(...obs.map((o) => o.y + o.h)) + FRAME_GAP };
  }

  framePos() {
    const top = this.obstacles(null);
    const frames = this.els.filter((e) => e.type === "frame");
    return {
      x: top.length ? Math.max(...top.map((o) => o.x + o.w)) + FRAME_GAP : 0,
      y: frames.length ? Math.min(...frames.map((f) => f.y)) : 0,
    };
  }

  /** Where a box item goes: given x/y (checked against its frame) or the next free spot. Returns absolute coords. */
  place(id: string, frame: FrameElement | null, w: number, h: number, given: { x?: number; y?: number }, opts: { anchorOnly?: boolean; except?: string; prefer?: { x: number; y: number }[] } = {}) {
    if ((given.x === undefined) !== (given.y === undefined)) fail(`give ${id} both x and y, or neither`);
    if (given.x !== undefined && given.y !== undefined) {
      const at = { x: given.x, y: given.y };
      if (frame) this.checkInside(id, frame, at, w, h, opts.anchorOnly);
      return frame ? { x: frame.x + at.x, y: frame.y + at.y } : at;
    }
    if (!frame) return this.rootSpot(w, h, opts.except, opts.prefer);
    const cell = this.freeCell(frame, w, h, opts.except, opts.prefer) ?? fail(`no free spot in frame ${frame.id} for ${w}x${h}; give x and y or make the frame bigger`);
    return { x: frame.x + cell.x, y: frame.y + cell.y };
  }

  checkInside(id: string, f: FrameElement, at: { x: number; y: number }, w: number, h: number, anchorOnly = false) {
    const inside = anchorOnly
      ? at.x >= 0 && at.y >= 0 && at.x < f.width && at.y < f.height
      : at.x >= 0 && at.y >= 0 && at.x + w <= f.width && at.y + h <= f.height;
    if (!inside) fail(`${id} at ${at.x},${at.y}${anchorOnly ? "" : ` size ${w}x${h}`} is outside frame ${f.id} (${f.width}x${f.height})`);
  }

  rel(e: CanvasElement) {
    const f = this.frameOf(e);
    return { frame: f?.id ?? null, x: e.x - (f?.x ?? 0), y: e.y - (f?.y ?? 0) };
  }

  // ── Labels and connectors

  addLabel(container: CanvasElement, raw: string) {
    const label: TextElement = {
      ...this.base(this.genId(), { x: container.x, y: container.y, w: 0, h: 0 }, container.frameId),
      type: "text", fontSize: this.labelSize(container), fontFamily: FONT_FAMILY_EXCALIFONT, text: raw,
      textAlign: this.kind(container) === "note" ? "left" : "center", verticalAlign: this.kind(container) === "note" ? "top" : "middle",
      containerId: container.id, originalText: raw, autoResize: true, lineHeight: LINE_HEIGHT,
      strokeColor: this.kind(container) === "note" ? BLACK : container.strokeColor,
    };
    this.insert(label, container);
    this.set(container, { boundElements: [...(container.boundElements ?? []), { type: "text", id: label.id }] });
    this.layoutLabel(container);
  }

  setLabel(container: CanvasElement, raw: string) {
    const label = this.labelOf(container);
    if (!raw) {
      if (label) this.remove(new Set([label.id]));
    } else if (label) {
      this.set(label, { originalText: raw });
      this.layoutLabel(container);
    } else this.addLabel(container, raw);
  }

  labelSize(container: CanvasElement) {
    const k = this.kind(container);
    return k === "note" ? LABEL_SIZE.note : k === "connector" ? LABEL_SIZE.arrow : LABEL_SIZE.shape;
  }

  /** Wrap, size and place a container's label as Excalidraw's redrawTextBoundingBox would; notes grow to fit. */
  layoutLabel(container: CanvasElement) {
    const label = this.labelOf(container);
    if (!label) return;
    const fs = label.fontSize;
    const w = container.width;
    const maxW =
      container.type === "arrow" ? Math.max(0.7 * w, fs * 11)
      : container.type === "ellipse" ? Math.round((w / 2) * Math.SQRT2) - BOUND_TEXT_PADDING * 2
      : container.type === "diamond" ? Math.round(w / 2) - BOUND_TEXT_PADDING * 2
      : w - BOUND_TEXT_PADDING * 2;
    const text = wrap(label.originalText, Math.max(1, maxW), fs);
    const size = measure(text, fs);
    if (this.kind(container) === "note") {
      this.set(container, { height: Math.max(NOTE_MIN_H, size.h + BOUND_TEXT_PADDING * 2) });
      this.set(label, { text, width: size.w, height: size.h, x: container.x + BOUND_TEXT_PADDING, y: container.y + BOUND_TEXT_PADDING, frameId: container.frameId });
      return;
    }
    const [cx, cy] =
      container.type === "arrow"
        ? [container.x + container.points[1][0] / 2, container.y + container.points[1][1] / 2]
        : [container.x + container.width / 2, container.y + container.height / 2];
    this.set(label, { text, width: size.w, height: size.h, x: Math.round(cx - size.w / 2), y: Math.round(cy - size.h / 2), frameId: container.frameId });
  }

  /** Straight arrow from the edge of one end to the edge of the other, centre to centre, gap on both sides. */
  route(a: ArrowElement) {
    const from = this.get(a.startBinding!.elementId)!;
    const to = this.get(a.endBinding!.elementId)!;
    const A = this.box(from);
    const B = this.box(to);
    const ca = [A.x + A.w / 2, A.y + A.h / 2];
    const cb = [B.x + B.w / 2, B.y + B.h / 2];
    const dx = cb[0] - ca[0];
    const dy = cb[1] - ca[1];
    const len = Math.hypot(dx, dy);
    let s = ca;
    let e = cb;
    if (len > 0) {
      const ux = dx / len;
      const uy = dy / len;
      const edge = (b: Box, c: number[], sx: number, sy: number) => {
        const t = Math.min(sx ? b.w / 2 / Math.abs(sx) : Infinity, sy ? b.h / 2 / Math.abs(sy) : Infinity) + ARROW_GAP;
        return [c[0] + sx * t, c[1] + sy * t];
      };
      const s2 = edge(A, ca, ux, uy);
      const e2 = edge(B, cb, -ux, -uy);
      if ((e2[0] - s2[0]) * dx + (e2[1] - s2[1]) * dy > 0) [s, e] = [s2, e2];
    }
    const [sx, sy, ex, ey] = [s[0], s[1], e[0], e[1]].map(Math.round);
    this.set(a, {
      x: sx, y: sy, width: Math.abs(ex - sx), height: Math.abs(ey - sy), points: [[0, 0], [ex - sx, ey - sy]],
      frameId: from.frameId === to.frameId ? from.frameId : null,
    });
    this.layoutLabel(a);
  }

  /** After an element moved or changed size: its label and every arrow bound to it follow. */
  follow(e: CanvasElement) {
    this.layoutLabel(e);
    for (const a of this.arrowsTo(e.id)) this.route(a);
  }

  bindable(ref: string, side: "from" | "to"): CanvasElement {
    const e = this.get(ref) ?? fail(`${side} ${ref} doesn't exist`);
    if (this.isLabel(e)) fail(`${ref} is the label of ${e.containerId}; connect ${e.containerId}`);
    if (e.type === "arrow") fail(`${ref} is a connector; connect items or frames`);
    if (!BINDABLE.has(e.type)) fail(`${ref} is ${article(e.type)}; connect items or frames`);
    return e;
  }
}

function clash(c: { x: number; y: number }, w: number, h: number, o: Box) {
  return c.x < o.x + o.w + GUTTER && o.x < c.x + w + GUTTER && c.y < o.y + o.h + GUTTER && o.y < c.y + h + GUTTER;
}

type Done = Pick<OpResult, "at" | "deleted" | "released">;
type Handler<K extends CanvasOp["op"]> = (s: Scene, op: Extract<CanvasOp, { op: K }>) => Done;

const HANDLERS: { [K in CanvasOp["op"]]: Handler<K> } = {
  frame(s, op) {
    s.claim(op.id);
    if ((op.x === undefined) !== (op.y === undefined)) fail(`give ${op.id} both x and y, or neither`);
    const at = op.x !== undefined && op.y !== undefined ? { x: op.x, y: op.y } : s.framePos();
    s.insert({
      ...s.base(op.id, { ...at, w: op.w, h: op.h }, null),
      type: "frame", name: op.name, strokeColor: "#bbb", roughness: 0,
    });
    return { at: { frame: null, ...at } };
  },

  shape(s, op) {
    s.claim(op.id);
    const frame = s.resolveFrame(op.frame);
    const at = s.place(op.id, frame, op.w, op.h, op);
    const pair = op.color ? COLOR_PAIRS[op.color] : null;
    const fill = op.fill ?? op.color !== undefined;
    const el: ShapeElement = {
      ...s.base(op.id, { ...at, w: op.w, h: op.h }, frame?.id ?? null),
      type: op.kind === "rect" ? "rectangle" : op.kind,
      strokeColor: pair?.stroke ?? BLACK,
      backgroundColor: fill ? (pair ?? COLOR_PAIRS.gray).background : "transparent",
      roundness: { type: op.kind === "rect" ? 3 : 2 },
      link: op.link ?? null,
    };
    s.insert(el);
    if (op.label) s.addLabel(el, op.label);
    return { at: s.rel(el) };
  },

  text(s, op) {
    s.claim(op.id);
    const frame = s.resolveFrame(op.frame);
    const fontSize = FONT_SIZES[op.size ?? "m"];
    const size = measure(op.text, fontSize);
    const at = s.place(op.id, frame, size.w, size.h, op, { anchorOnly: true });
    const el: TextElement = {
      ...s.base(op.id, { ...at, ...size }, frame?.id ?? null),
      type: "text", fontSize, fontFamily: FONT_FAMILY_EXCALIFONT, text: op.text, textAlign: "left", verticalAlign: "top",
      containerId: null, originalText: op.text, autoResize: true, lineHeight: LINE_HEIGHT,
      strokeColor: op.color ? COLOR_PAIRS[op.color].stroke : BLACK,
    };
    s.insert(el);
    return { at: s.rel(el) };
  },

  note(s, op) {
    s.claim(op.id);
    const near = op.near === undefined ? undefined : (s.get(op.near) ?? fail(`no element ${op.near} to put the note near`));
    if (near && s.isLabel(near)) fail(`${near.id} is the label of ${near.containerId}; put the note near ${near.containerId}`);
    if (near?.type === "arrow") fail(`${near.id} is a connector; put the note near an item or frame`);
    let frame: FrameElement | null;
    if (op.frame !== undefined) {
      frame = s.resolveFrame(op.frame);
      if (near && near.type !== "frame" && near.frameId !== op.frame)
        fail(near.frameId ? `${near.id} is in frame ${near.frameId}, not ${op.frame}` : `${near.id} is on the open canvas, not in ${op.frame}`);
      if (near?.type === "frame" && near.id !== op.frame) fail(`${near.id} is a frame; put the note in it or near it, not in ${op.frame}`);
    } else frame = near && near.type !== "frame" ? s.frameOf(near) : null;
    const h = Math.max(NOTE_MIN_H, measure(wrap(op.text, NOTE_W - BOUND_TEXT_PADDING * 2, LABEL_SIZE.note), LABEL_SIZE.note).h + BOUND_TEXT_PADDING * 2);
    // Beside the near item: right, below, left, above (relative to the note's frame).
    let prefer: { x: number; y: number }[] = [];
    if (near && !(frame && near.id === frame.id)) {
      const o = { ...s.box(near), x: near.x - (frame?.x ?? 0), y: near.y - (frame?.y ?? 0) };
      prefer = [
        { x: o.x + o.w + GUTTER, y: o.y },
        { x: o.x, y: o.y + o.h + GUTTER },
        { x: o.x - GUTTER - NOTE_W, y: o.y },
        { x: o.x, y: o.y - GUTTER - h },
      ];
    }
    const at = s.place(op.id, frame, NOTE_W, h, op, { prefer });
    const el: ShapeElement = {
      ...s.base(op.id, { ...at, w: NOTE_W, h }, frame?.id ?? null),
      type: "rectangle", strokeColor: COLOR_PAIRS.yellow.stroke, backgroundColor: COLOR_PAIRS.yellow.background, roundness: { type: 3 },
    };
    el.customData = { ...el.customData, kind: "note" };
    s.insert(el);
    s.addLabel(el, op.text);
    return { at: s.rel(el) };
  },

  image(s, op) {
    s.claim(op.id);
    const frame = s.resolveFrame(op.frame);
    const at = s.place(op.id, frame, op.w, op.h, op);
    const el: ImageElement = {
      ...s.base(op.id, { ...at, w: op.w, h: op.h }, frame?.id ?? null),
      type: "image", strokeColor: "transparent", fileId: op.src, status: "saved", scale: [1, 1], crop: null,
    };
    el.customData = { ...el.customData, src: op.src };
    s.insert(el);
    return { at: s.rel(el) };
  },

  connect(s, op) {
    s.claim(op.id);
    if (op.from === op.to) fail("connect needs two different elements");
    const from = s.bindable(op.from, "from");
    const to = s.bindable(op.to, "to");
    const arrow: ArrowElement = {
      ...s.base(op.id, { x: from.x, y: from.y, w: 0, h: 0 }, null),
      type: "arrow", roundness: { type: 2 }, strokeStyle: op.style === "dashed" ? "dashed" : "solid",
      points: [[0, 0], [0, 0]], lastCommittedPoint: null,
      startBinding: { elementId: from.id, focus: 0, gap: ARROW_GAP }, endBinding: { elementId: to.id, focus: 0, gap: ARROW_GAP },
      startArrowhead: null, endArrowhead: op.style === "line" ? null : "arrow", elbowed: false,
    };
    s.insert(arrow);
    for (const end of [from, to]) s.set(end, { boundElements: [...(end.boundElements ?? []), { id: arrow.id, type: "arrow" }] });
    s.route(arrow);
    if (op.label) s.addLabel(arrow, op.label);
    return {};
  },

  update(s, op) {
    const el = s.get(op.id) ?? fail(`update: no element ${op.id}`);
    if (s.isLabel(el)) fail(`${el.id} is the label of ${el.containerId}; update ${el.containerId}`);
    const fields = UPDATE_FIELDS.filter((f) => op[f] !== undefined);
    if (!fields.length) fail(`update ${op.id} changes nothing`);
    const kind = s.kind(el);
    if (kind === "frame" && op.frame !== undefined) fail("frames can't go inside frames");
    if (fields.some((f) => !TAKES[kind].includes(f))) fail(`${el.id} is ${article(s.kindName(el))}; it takes ${list(TAKES[kind])}`);

    if (el.type === "arrow") {
      s.setLabel(el, op.label!);
      return {};
    }
    if (el.type === "frame") {
      const dx = (op.x ?? el.x) - el.x;
      const dy = (op.y ?? el.y) - el.y;
      s.set(el, { x: el.x + dx, y: el.y + dy, width: op.w ?? el.width, height: op.h ?? el.height, name: op.name ?? el.name });
      const moved = s.els.filter((e) => e.frameId === el.id && e.type !== "arrow" && !(s.isLabel(e) && s.get(e.containerId!)?.type === "arrow"));
      if (dx || dy) for (const e of moved) s.set(e, { x: e.x + dx, y: e.y + dy });
      for (const e of [el, ...moved]) for (const a of s.arrowsTo(e.id)) s.route(a);
      return { at: { frame: null, x: el.x, y: el.y } };
    }

    // Box items: shape, note, text, image, owner-drawn.
    const from = s.frameOf(el);
    const target = op.frame !== undefined ? s.resolveFrame(op.frame) : from;
    const moving = (target?.id ?? null) !== el.frameId;
    if (op.text !== undefined && el.type === "text") {
      const size = measure(op.text, el.fontSize);
      s.set(el, { text: op.text, originalText: op.text, width: size.w, height: size.h });
    }
    if (op.text !== undefined && kind === "note") {
      s.setLabel(el, op.text);
    }
    const w = op.w ?? el.width;
    const h = op.h ?? el.height;
    const old = s.rel(el);
    const given =
      op.x !== undefined || op.y !== undefined
        ? { x: op.x ?? old.x, y: op.y ?? old.y }
        : moving ? {} : { x: old.x, y: old.y };
    const geometryChanged = moving || op.x !== undefined || op.y !== undefined || op.w !== undefined || op.h !== undefined || op.text !== undefined;
    const at = geometryChanged
      ? s.place(el.id, target, w, h, given, { anchorOnly: el.type === "text", except: el.id })
      : { x: el.x, y: el.y };
    s.set(el, { x: at.x, y: at.y, width: w, height: h, frameId: target?.id ?? null });
    if (op.color !== undefined && (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond")) {
      const pair = COLOR_PAIRS[op.color];
      s.set(el, { strokeColor: pair.stroke, backgroundColor: el.backgroundColor === "transparent" ? "transparent" : pair.background });
      const label = s.labelOf(el);
      if (label) s.set(label, { strokeColor: pair.stroke });
    } else if (op.color !== undefined) s.set(el, { strokeColor: COLOR_PAIRS[op.color].stroke });
    if (op.label !== undefined) s.setLabel(el, op.label);
    s.follow(el);
    return { at: s.rel(el) };
  },

  delete(s, op) {
    const missing = [...new Set(op.ids)].filter((id) => !s.get(id));
    if (missing.length) fail(`delete: no element ${missing.join(", ")}`);
    const gone = new Set<string>();
    const drop = (e: CanvasElement) => {
      if (gone.has(e.id)) return;
      gone.add(e.id);
      const label = s.labelOf(e);
      if (label) gone.add(label.id);
      for (const a of s.arrowsTo(e.id)) drop(a);
    };
    for (const id of op.ids) drop(s.get(id)!);
    // Labels whose container went, even if the container didn't list them.
    for (const e of s.els) if (s.isLabel(e) && gone.has(e.containerId!)) drop(e);
    const deleted = s.els.filter((e) => gone.has(e.id)).map((e) => e.id);
    const released: string[] = [];
    for (const e of s.els) {
      if (gone.has(e.id) || !e.frameId || !gone.has(e.frameId)) continue;
      s.set(e, { frameId: null });
      if (!s.isLabel(e) && e.type !== "arrow") released.push(e.id);
    }
    s.remove(gone);
    return released.length ? { deleted, released } : { deleted };
  },
};

const OP_NAMES = ["frame", "shape", "text", "note", "image", "connect", "update", "delete"];

function schemaError(raw: unknown, issues: { path: PropertyKey[]; message: string }[]): string {
  const r = (raw ?? {}) as { op?: unknown; id?: unknown };
  if (typeof r.op !== "string" || !OP_NAMES.includes(r.op))
    return `unknown op ${JSON.stringify(r.op ?? null)}; use ${list(OP_NAMES).replace(/ and /, " or ")}`;
  const who = typeof r.id === "string" ? `${r.op} ${r.id}` : r.op;
  return `${who}: ${issues.map((i) => `${i.path.map(String).join(".") || "op"}: ${i.message}`).join("; ")}`;
}

/** Apply one canvas_edit call's ops to a canvas. Pure: the given doc is never mutated. */
export function applyCanvasOps(doc: CanvasDoc, ops: readonly unknown[], opts: ApplyOptions): ApplyResult {
  if (opts.expectedRev !== opts.rev) {
    return {
      doc, rev: opts.rev, results: [],
      error: `the canvas changed since you read it: it is at rev ${opts.rev}, you sent expectedRev ${opts.expectedRev}. Call canvas_read and send your ops again.`,
    };
  }
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > MAX_OPS) {
    return { doc, rev: opts.rev, results: [], error: `send 1 to ${MAX_OPS} ops per call; you sent ${Array.isArray(ops) ? ops.length : 0}` };
  }
  const next = opts.rev + 1;
  let els = structuredClone(doc.elements).filter((e) => !e.isDeleted);
  const results: OpResult[] = [];
  for (const [index, raw] of ops.entries()) {
    const parsed = CanvasOpSchema.safeParse(raw);
    const named = raw as { op?: unknown; id?: unknown } | null;
    const id = typeof named?.id === "string" ? named.id : undefined;
    if (!parsed.success) {
      results.push({ index, op: typeof named?.op === "string" ? named.op : "?", ...(id && { id }), ok: false, error: schemaError(raw, parsed.error.issues) });
      continue;
    }
    const op = parsed.data;
    const scene = new Scene(structuredClone(els), opts, next);
    try {
      const done = (HANDLERS[op.op] as Handler<typeof op.op>)(scene, op as never);
      scene.finish();
      els = scene.els;
      results.push({ index, op: op.op, ...(id && { id }), ok: true, ...done });
    } catch (e) {
      if (!(e instanceof OpError)) throw e;
      results.push({ index, op: op.op, ...(id && { id }), ok: false, error: e.message });
    }
  }
  if (!results.some((r) => r.ok)) return { doc, rev: opts.rev, results };
  return { doc: { ...structuredClone(doc), elements: els }, rev: next, results };
}
