// Smart camera: re-frames a captured effect (full.mp4, 2880x1800 retina) into a 1920x1080 clip whose camera pushes
// in on what is being acted on, follows the cursor, and eases back out, like Screen Studio's auto-zoom.
//   node scripts/promo/camera.mjs reactions.go-ahead [more ids…]     (no ids: every effect with a timeline)
// Reads effects/<id>/timeline.json (marks with element boxes, the cursor path) → writes effects/<id>/smart.mp4.
// The plan: a keyframe per marked box (framed with padding, zoom ≤ MAX_ZOOM), arriving shortly before the moment;
// far jumps go out-then-in; the cursor is kept in frame; the whole path runs through a spring so it feels physical.
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { OUT, ROOT, rel, patchManifest } from "./lib.mjs";

const FPS = 60;
const OUT_W = 1920, OUT_H = 1080;
const MAX_ZOOM = 2.4; // narrowest view = 1440 / 2.4 = 600 CSS px wide
const PAD = 70; // CSS px around a framed element
const LEAD = 700, ARRIVE = 160; // start moving LEAD ms before a moment, be there ARRIVE ms before it

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function frameFor(box, W, H) {
  const minW = W / MAX_ZOOM;
  let w = Math.max(box.w + PAD * 2, ((box.h + PAD * 2) * 16) / 9, minW);
  w = Math.min(w, W, (H * 16) / 9);
  return { cx: box.x + box.w / 2, cy: box.y + box.h / 2, w };
}

function clampCam(c, W, H) {
  const w = Math.min(c.w, W, (H * 16) / 9), h = (w * 9) / 16;
  return { w, cx: Math.min(Math.max(c.cx, w / 2), W - w / 2), cy: Math.min(Math.max(c.cy, h / 2), H - h / 2) };
}

export function plan(tl) {
  const { w: W, h: H } = tl.viewport;
  const wide = clampCam({ cx: W / 2, cy: H / 2, w: W }, W, H);
  // Start a touch in from wide on the first action, so the clip opens with motion rather than a static frame.
  const keys = [{ t: 0, ...wide }];
  for (const m of tl.marks.filter((m) => m.box)) {
    const target = clampCam(frameFor(m.box, W, H), W, H);
    const prev = keys[keys.length - 1];
    const tArrive = Math.max(prev.t + 200, m.atMs - ARRIVE);
    const tStart = Math.max(prev.t, tArrive - LEAD);
    const dist = Math.hypot(target.cx - prev.cx, target.cy - prev.cy);
    // Far apart while zoomed in: pull out on the way, then push in.
    if (dist > Math.min(prev.w, target.w) * 0.75 && tArrive - tStart > 400) {
      const mid = clampCam({ cx: (prev.cx + target.cx) / 2, cy: (prev.cy + target.cy) / 2, w: Math.min(W, Math.max(prev.w, target.w) + dist) }, W, H);
      keys.push({ t: tStart, ...prev }, { t: (tStart + tArrive) / 2, ...mid });
    } else {
      keys.push({ t: tStart, ...prev });
    }
    keys.push({ t: tArrive, ...target });
  }
  return keys;
}

function camAt(keys, t) {
  if (t <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const e = easeInOut(b.t === a.t ? 1 : (t - a.t) / (b.t - a.t));
      // Zoom interpolates in log space, so a push-in feels even.
      return { cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e, w: Math.exp(Math.log(a.w) + (Math.log(b.w) - Math.log(a.w)) * e) };
    }
  }
  return keys[keys.length - 1];
}

function cursorAt(cursor, t) {
  let c = null;
  for (const p of cursor) if (p.atMs <= t) c = p; else break;
  return c;
}

export function path(tl) {
  const { w: W, h: H } = tl.viewport;
  const keys = plan(tl);
  const n = Math.round((tl.durationMs / 1000) * FPS);
  const out = [];
  let s = null, v = { cx: 0, cy: 0, w: 0 };
  const k = 170, damp = 2 * Math.sqrt(k) * 1.0, dt = 1 / FPS; // critically damped spring
  for (let i = 0; i < n; i++) {
    const t = (i / FPS) * 1000;
    let c = { ...camAt(keys, t) };
    // Keep the cursor inside the frame with a margin.
    const p = cursorAt(tl.cursor, t);
    if (p) {
      const h = (c.w * 9) / 16, m = c.w * 0.08;
      if (p.x < c.cx - c.w / 2 + m) c.cx = p.x - m + c.w / 2;
      if (p.x > c.cx + c.w / 2 - m) c.cx = p.x + m - c.w / 2;
      if (p.y < c.cy - h / 2 + m) c.cy = p.y - m + h / 2;
      if (p.y > c.cy + h / 2 - m) c.cy = p.y + m - h / 2;
    }
    c = clampCam(c, W, H);
    if (!s) s = { ...c };
    for (const key of ["cx", "cy", "w"]) {
      const a = k * (c[key] - s[key]) - damp * v[key];
      v[key] += a * dt;
      s[key] += v[key] * dt;
    }
    out.push(clampCam(s, W, H));
  }
  return out;
}

const PY = join(ROOT, "scripts/promo/.venv/bin/python");

export function render(id) {
  const dir = join(OUT, "effects", id);
  const tl = JSON.parse(readFileSync(join(dir, "timeline.json"), "utf8"));
  const dpr = tl.viewport.dpr;
  const boxes = path(tl).map((c) => {
    const w = c.w * dpr, h = ((c.w * 9) / 16) * dpr;
    return [(c.cx * dpr) - w / 2, (c.cy * dpr) - h / 2, w, h].map((v) => Math.round(v * 100) / 100);
  });
  const camFile = join(dir, ".camera.json");
  writeFileSync(camFile, JSON.stringify({ src: [tl.viewport.w * dpr, tl.viewport.h * dpr], out: [OUT_W, OUT_H], fps: FPS, boxes }));
  execFileSync(PY, [join(ROOT, "scripts/promo/camera_render.py"), join(dir, "full.mp4"), join(dir, "smart.mp4"), camFile], { stdio: ["ignore", "ignore", "inherit"] });
  rmSync(camFile);
  return join(dir, "smart.mp4");
}

const ids = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const all = existsSync(join(OUT, "effects")) ? readdirSync(join(OUT, "effects")).filter((d) => existsSync(join(OUT, "effects", d, "timeline.json"))) : [];
  for (const id of ids.length ? ids : all) {
    const out = render(id);
    patchManifest(`effect.${id}`, { files: { smart: rel(out) } });
    console.log(`  ${id}: ${rel(out)}`);
  }
}
