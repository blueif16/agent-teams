// Shared capture rig for promo assets: slowed-down page clock, retina screenshot loop, encoders, manifest.
// Measured on this Mac (2026-10-20): full 2880x1800 JPEG ≈ 35 fps, a small clip PNG ≈ 80–120 fps. Running the
// page at RATE 0.2 turns that into 175–600 fps of page time, so every spring and pop is captured smoothly.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const OUT = join(ROOT, "promo-assets");
export const APP = process.env.PROMO_APP_URL ?? "http://localhost:3000";
const CHROME = process.env.PROMO_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// One virtual clock for performance.now, Date.now, rAF timestamps and timer delays. CSS and WAAPI animations
// are slowed separately through CDP (Animation.setPlaybackRate), by the same factor.
const DILATE = `(() => {
  const rn = performance.now.bind(performance), rd = Date.now;
  let rate = 1, w0 = rn(), v0 = w0; const d0 = rd() - w0;
  const vnow = () => v0 + (rn() - w0) * rate;
  window.__setRate = r => { v0 = vnow(); w0 = rn(); rate = r; };
  window.__vnow = vnow;
  performance.now = vnow; Date.now = () => Math.round(d0 + vnow());
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(() => cb(vnow()));
  const st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
  window.setTimeout = (f, ms = 0, ...a) => st(f, ms / rate, ...a);
  window.setInterval = (f, ms = 0, ...a) => si(f, ms / rate, ...a);
})();`;

export async function launch({ width = 1440, height = 900, dpr = 2, transparent = false } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--disable-frame-rate-limit", "--disable-gpu-vsync", "--hide-scrollbars"] });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await page.addInitScript(DILATE);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Animation.enable");
  if (transparent) await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  page.on("pageerror", (e) => console.warn("  pageerror:", e.message));
  return { browser, context, page, cdp, width, height, dpr };
}

export async function setRate(page, cdp, rate) {
  await cdp.send("Animation.setPlaybackRate", { playbackRate: rate });
  await page.evaluate((r) => window.__setRate(r), rate);
}

/** Hides dev chrome that must never appear in footage. */
export const CLEAN_CSS = `nextjs-portal{display:none!important} *{caret-color:transparent}`;

/**
 * Screenshot loop. Frames go to `dir` as they arrive; each is stamped with wall time. Call stop() to end.
 * clip is in CSS px (default: the whole viewport); scale is device px per CSS px. The explicit clip matters:
 * without it, headless Chrome returns 1× frames and system Chrome also crops ~87 px off the bottom.
 * alpha → PNG with a transparent background, otherwise JPEG.
 */
export function recorder(cdp, { dir, clip, scale, alpha = false, quality = 93 }) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const writes = [];
  let running = true;
  const t0 = performance.now();
  const loop = (async () => {
    while (running) {
      const t = performance.now();
      const r = await cdp.send("Page.captureScreenshot", {
        format: alpha ? "png" : "jpeg",
        ...(alpha ? {} : { quality }),
        optimizeForSpeed: true,
        clip: { ...clip, scale },
      });
      const file = join(dir, `f${String(frames.length).padStart(5, "0")}.${alpha ? "png" : "jpg"}`);
      frames.push({ file, wall: (t + performance.now()) / 2 - t0 });
      writes.push(writeFile(file, Buffer.from(r.data, "base64")));
    }
  })();
  return {
    t0,
    /** ms since start, wall clock */
    now: () => performance.now() - t0,
    async stop() {
      running = false;
      await loop;
      await Promise.all(writes);
      return frames;
    },
  };
}

/** Writes an ffmpeg concat list where each frame lasts its page-time duration × stretch. */
function concatList(frames, rate, stretch, listPath) {
  let s = "";
  frames.forEach((f, i) => {
    const next = frames[i + 1]?.wall ?? f.wall + 1000 / 30;
    s += `file '${f.file}'\nduration ${(((next - f.wall) * rate * stretch) / 1000).toFixed(6)}\n`;
  });
  s += `file '${frames[frames.length - 1].file}'\n`;
  writeFileSync(listPath, s);
}

function ff(args) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
}

const EVEN = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

/** Opaque clip: H.264 60 fps, high quality, plays everywhere. crop is in device px. */
export function encodeMp4(frames, out, { rate, stretch = 1, crop } = {}) {
  const list = out + ".txt";
  concatList(frames, rate, stretch, list);
  const vf = [crop && `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`, "fps=60", EVEN, "format=yuv420p"].filter(Boolean).join(",");
  ff(["-f", "concat", "-safe", "0", "-i", list, "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-movflags", "+faststart", out]);
  rmSync(list);
}

/**
 * Transparent clip: HEVC-with-alpha .mov (Final Cut, Premiere/DaVinci on Mac, Safari, QuickTime) + VP9 .webm
 * with alpha (Chrome, Remotion, HyperFrames). ProRes 4444 was 30× larger (160 MB per 4 s at 1024²), so it's out.
 */
export function encodeAlpha(frames, base, { rate, stretch = 1 } = {}) {
  const list = base + ".txt";
  concatList(frames, rate, stretch, list);
  ff(["-f", "concat", "-safe", "0", "-i", list, "-vf", `fps=60,${EVEN},format=bgra`, "-c:v", "hevc_videotoolbox", "-alpha_quality", "0.9", "-q:v", "70", "-tag:v", "hvc1", base + ".mov"]);
  ff(["-f", "concat", "-safe", "0", "-i", list, "-vf", `fps=60,${EVEN},format=yuva420p`, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "22", "-row-mt", "1", "-auto-alt-ref", "0", base + ".webm"]);
  rmSync(list);
}

export function poster(frameFile, out, crop) {
  ff(["-i", frameFile, ...(crop ? ["-vf", `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`] : []), "-frames:v", "1", "-update", "1", out]);
}

/**
 * Merges one asset entry into promo-assets/manifest.json (keyed by id). Every entry carries notes for the
 * editing agent: `feature` (a key of FEATURES), `title`, `demonstrates` (what a viewer sees and why it matters),
 * `moments` ([{atMs, what}] in the real-speed clip) and `suggestedUse`.
 */
export function addToManifest(entry) {
  for (const k of ["feature", "title", "demonstrates", "files"]) if (!entry[k]) throw new Error(`manifest entry ${entry.id} is missing ${k}`);
  if (!FEATURES[entry.feature]) throw new Error(`manifest entry ${entry.id}: unknown feature ${entry.feature}`);
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, "manifest.json");
  const m = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { generated: null, assets: {} };
  m.features = FEATURES;
  m.assets[entry.id] = entry;
  m.generated = new Date().toISOString();
  writeFileSync(path, JSON.stringify(m, null, 2));
}

export const rel = (p) => p.replace(OUT + "/", "");

/** The owner's core features (2026-10-20). Every asset names the one it shows, so the edit can be built by story beat. */
export const FEATURES = {
  reactive: "An AI Slack that is alive: replies stream in, statuses and channels update the moment agents act.",
  reactions: "Emoji reactions are orders (👍 go ahead, 👀 dig in, 🔁 redo, ✋ hold, 📌 remember): click one and the agent acts and answers.",
  "rive-status": "Every agent is a plush Rive mascot whose animation shows its live status: idle, working (keyboard + mittens), needs you (! bubble), done (check).",
  stats: "Clear, live stats: spend, tokens, cache hit, acceptance, latency, per-agent and per-hour charts.",
  "team-choice": "Mira (the CEO agent) proposes 2–3 team options with realistic cost and time, and you pick one.",
  "soul-memory": "Each agent's SOUL.md and memory are versioned and improve over time; you can browse every git edit, diff and restore.",
  artifacts: "Teams hand back the artifacts they built (tables, docs, HTML mockups, charts) right in the chat.",
  "pm-coordination": "The PM plans, assigns work to each expert, gets reports back and accepts or sends work back.",
  staffing: "The PM/CEO staff a team from archetypes plus workers with proven skills and past project experience.",
};
