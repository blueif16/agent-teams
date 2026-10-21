// Captures each effect in the app as raw material for the promo edit.
//   node scripts/promo/effects.mjs                 every effect
//   node scripts/promo/effects.mjs reactions stats  effects whose id starts with any of these
//   node scripts/promo/effects.mjs --list
// Per effect, in promo-assets/effects/<id>/:
//   full.mp4    2880x1800 60 fps, real speed, whole window (for any reframing)
//   focus.mp4   16:9 crop around where the action happens, real speed
//   slowmo.mp4  the focus crop at 1/3 speed (captured at 150+ fps of page time, so it's true slow motion)
//   poster.png  the payoff frame, focus crop
//   timeline.json  cursor path, clicks and marked moments in ms + boxes in CSS px (×2 for device px)
// and an entry in promo-assets/manifest.json saying what it shows and why (feature, demonstrates, moments).
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { launch, setRate, recorder, encodeMp4, poster, addToManifest, rel, OUT, APP, CLEAN_CSS } from "./lib.mjs";
import { installStage, Director } from "./stage.mjs";
import { polish } from "./org.mjs";
import { EFFECTS } from "./shots.mjs";

// PROMO_DEBUG=1: full speed, no recording or encoding, a screenshot in promo-assets/.debug/ when a shot fails or ends.
const DEBUG = !!process.env.PROMO_DEBUG;
// 0.1: even when the machine is busy (~10 fps of retina screenshots), that's 100 fps of page time.
const RATE = Number(process.env.PROMO_RATE ?? (DEBUG ? 1 : 0.1));
const SLOW = 3;
const W = 1440, H = 900, DPR = 2;

/** The smallest 16:9 box (≥ 720×405) holding `b` plus padding, kept inside the window. */
function frame16x9(b, pad = 110) {
  let w = Math.max(b.w + pad * 2, 720), h = Math.max(b.h + pad * 2, 405);
  if (w / h > 16 / 9) h = w * 9 / 16; else w = h * 16 / 9;
  w = Math.min(w, W); h = Math.min(h, H);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const x = Math.min(Math.max(cx - w / 2, 0), W - w), y = Math.min(Math.max(cy - h / 2, 0), H - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function union(boxes) {
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

async function capture(fx) {
  console.log(`● ${fx.id}`);
  const s = await launch({ width: W, height: H, dpr: DPR });
  const { page, cdp, browser } = s;
  page.setDefaultTimeout(8000 / RATE); // Playwright waits are wall-clock; the page runs RATE× slower
  try {
    return await captureIn(fx, s);
  } catch (e) {
    if (DEBUG) {
      mkdirSync(join(OUT, ".debug"), { recursive: true });
      await page.screenshot({ path: join(OUT, ".debug", `${fx.id}.png`) }).catch(() => {});
    }
    throw e;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function captureIn(fx, { page, cdp, browser }) {
  await installStage(page, fx.stage ?? {});
  if (fx.polish !== false) await polish(page);
  if (fx.routes) await fx.routes(page);
  await page.goto(APP, { waitUntil: "load", timeout: 90000 }); // the dev server may be compiling
  await page.addStyleTag({ content: CLEAN_CSS });
  await page.waitForTimeout(1500);
  const d = new Director(page, RATE);
  await d.place(1300, 820);
  await fx.setup?.({ page, d });
  await page.waitForTimeout(600);
  console.log("  setup done, recording");

  await setRate(page, cdp, RATE);
  const dir = join(OUT, ".frames", fx.id);
  const rec = recorder(cdp, { dir, clip: { x: 0, y: 0, width: W, height: H }, scale: DPR });
  d.start(rec);
  let frames;
  try {
    await d.wait(fx.lead ?? 300);
    await fx.act({ page, d });
    await d.wait(fx.tail ?? 900);
  } finally {
    frames = await rec.stop();
  }
  if (DEBUG) {
    mkdirSync(join(OUT, ".debug"), { recursive: true });
    await page.screenshot({ path: join(OUT, ".debug", `${fx.id}.png`) });
    rmSync(dir, { recursive: true, force: true });
    console.log("  debug: marks", JSON.stringify(d.marks.map((m) => m.what)));
    return;
  }
  const focusBox = fx.focus ? await fx.focus({ page, d }) : null;
  await browser.close();

  const durationMs = Math.round((frames.at(-1).wall - frames[0].wall) * RATE);
  const boxes = d.marks.filter((m) => m.box).map((m) => m.box);
  const focus = frame16x9(focusBox ?? (boxes.length ? union(boxes) : { x: 0, y: 0, w: W, h: H }), fx.pad);
  const crop = { x: focus.x * DPR, y: focus.y * DPR, w: focus.w * DPR, h: focus.h * DPR };
  const out = join(OUT, "effects", fx.id);
  mkdirSync(out, { recursive: true });
  encodeMp4(frames, join(out, "full.mp4"), { rate: RATE });
  encodeMp4(frames, join(out, "focus.mp4"), { rate: RATE, crop });
  encodeMp4(frames, join(out, "slowmo.mp4"), { rate: RATE, crop, stretch: SLOW });
  const payoff = fx.posterAtMs ?? (d.marks.at(-1)?.atMs ?? durationMs * 0.6) + 500;
  const pf = frames.reduce((best, f) => (Math.abs(f.wall * RATE - payoff) < Math.abs(best.wall * RATE - payoff) ? f : best), frames[0]);
  poster(pf.file, join(out, "poster.png"), crop);
  writeFileSync(join(out, "timeline.json"), JSON.stringify({ viewport: { w: W, h: H, dpr: DPR }, durationMs, focus, marks: d.marks, cursor: d.cursor }, null, 1));
  rmSync(dir, { recursive: true, force: true });

  const capturedFps = Math.round(frames.length / (durationMs / 1000));
  addToManifest({
    id: `effect.${fx.id}`,
    kind: "effect",
    feature: fx.feature,
    title: fx.title,
    demonstrates: fx.demonstrates,
    suggestedUse: fx.suggestedUse,
    moments: d.marks.map(({ atMs, what }) => ({ atMs, what })),
    files: { full: rel(join(out, "full.mp4")), focus: rel(join(out, "focus.mp4")), slowmo: rel(join(out, "slowmo.mp4")), poster: rel(join(out, "poster.png")), timeline: rel(join(out, "timeline.json")) },
    size: { full: [W * DPR, H * DPR], focus: [crop.w, crop.h] },
    focusBoxCss: focus,
    fps: 60,
    capturedFps,
    durationMs,
    slowmoFactor: SLOW,
    cursor: fx.stage?.cursor ?? true,
    staged: fx.staged ?? null,
    alpha: false,
  });
  console.log(`  ${frames.length} frames, ${capturedFps} fps of page time, ${(durationMs / 1000).toFixed(1)} s, focus ${focus.w}x${focus.h}`);
}

const args = process.argv.slice(2);
if (args[0] === "--list") {
  for (const fx of EFFECTS) console.log(`${fx.id.padEnd(34)} ${fx.feature.padEnd(16)} ${fx.title}`);
} else {
  const pick = args.length ? EFFECTS.filter((fx) => args.some((a) => fx.id.startsWith(a))) : EFFECTS;
  for (const fx of pick) {
    try {
      await capture(fx);
    } catch (e) {
      console.error(`  ✗ ${fx.id}: ${e.message}`);
    }
  }
}
