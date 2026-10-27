// Renders every Rive mascot rig in every action on a transparent background.
//   node scripts/promo/rive.mjs --inspect      list artboards, state machines and action values
//   node scripts/promo/rive.mjs [rig ...]      render (default: all rigs)
// Output: promo-assets/rive/<rig>/<clip>.{mov,webm,png} + the source .riv, listed in manifest.json.
import { readFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, setRate, recorder, encodeAlpha, poster, addToManifest as add, rel as relTo } from "autocap";
import { FEATURES } from "./features.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const OUT = join(ROOT, "promo-assets");
const addToManifest = (entry) => add(OUT, entry, FEATURES);
const rel = (p) => relTo(OUT, p);

const RIGS = ["felipe", "dottie", "alfred", "pip", "ledger", "pixel"];
const WHO = { felipe: "PM (blue cloud, beret)", dottie: "Researcher (green bean)", alfred: "Writer (yellow pear, glasses + bowtie)", pip: "Designer (teal heart, sprout)", ledger: "Analyst (purple blob, glasses)", pixel: "Engineer (orange pixel, headphones)" };
const SIZE = 1024; // px, square
const RATE = 0.2;
const LOOP_MS = 4000; // page time per action clip
const TRANSITION_MS = 2500;
// Targeted set (owner, 2026-10-20): the four status loops + the one transition that sells "working".
const CLIPS = [
  { clip: "idle", start: "idle", ms: LOOP_MS, title: "idle", demonstrates: "At rest: the plush mascot breathes and blinks. The baseline before an agent gets work.", suggestedUse: "Roster / team lineup shots, or the 'before' of a status change." },
  { clip: "working", start: "working", ms: LOOP_MS, title: "working", demonstrates: "Busy on a task: a keyboard and two mittens come out and it types. This is what a live agent looks like while it works.", suggestedUse: "Any beat about agents doing real work in parallel; tile several rigs side by side." },
  { clip: "needs-you", start: "needs-you", ms: LOOP_MS, title: "needs you", demonstrates: "Waiting on the owner: an orange ! bubble pops and it waves. Agents ask for approval or answers instead of guessing.", suggestedUse: "Approval / question beats; pairs with the approval card effect." },
  { clip: "done", start: "done", ms: LOOP_MS, title: "done", demonstrates: "Task finished: a green check badge appears. Work is accepted and handed back.", suggestedUse: "Payoff beats: artifacts delivered, project closed." },
  { clip: "idle-to-working", start: "idle", then: "working", ms: TRANSITION_MS, title: "idle → working", demonstrates: "The moment an agent picks up a task: the keyboard and mittens animate in. Status changes are animated, not swapped.", suggestedUse: "Cut on the switch (400 ms) as the PM assigns work.", moments: [{ atMs: 400, what: "action switches to working; keyboard + mittens animate in" }] },
];

const HTML = `<!doctype html><html><body style="margin:0;background:transparent">
<canvas id="c" width="${SIZE}" height="${SIZE}" style="width:${SIZE}px;height:${SIZE}px;display:block"></canvas>
<script src="/rive.js"></script>
<script>
  rive.RuntimeLoader.setWasmUrl('/rive.wasm');
  window.load = (name, action) => new Promise((res, rej) => {
    const r = new rive.Rive({
      src: '/' + name + '.riv', canvas: document.getElementById('c'), stateMachines: 'Agent', autoplay: true,
      layout: new rive.Layout({ fit: rive.Fit.Contain, alignment: rive.Alignment.Center }),
      onLoad: () => {
        const vmi = r.viewModelByName('Agent').instance();
        r.bindViewModelInstance(vmi);
        if (action) vmi.enum('action').value = action;
        window.VMI = vmi;
        res({ contents: r.contents, values: vmi.enum('action').values });
      },
      onLoadError: (e) => rej(String(e)),
    });
  });
  window.act = (a) => { window.VMI.enum('action').value = a; };
</script></body></html>`;

async function open() {
  const s = await launch({ width: SIZE, height: SIZE, dpr: 1, transparent: true });
  const files = { "/rive.js": "node_modules/@rive-app/canvas/rive.js", "/rive.wasm": "public/rive/rive.wasm" };
  await s.page.route("http://rive.local/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/") return route.fulfill({ contentType: "text/html", body: HTML });
    const f = files[p] ?? (p.endsWith(".riv") ? `public/rive${p}` : null);
    if (!f) return route.fulfill({ status: 404 });
    route.fulfill({ body: readFileSync(join(ROOT, f)), contentType: p.endsWith(".wasm") ? "application/wasm" : p.endsWith(".js") ? "text/javascript" : "application/octet-stream" });
  });
  await s.page.goto("http://rive.local/");
  return s;
}

async function take(rig, { clip, start, then, ms, title, demonstrates, suggestedUse, moments = [] }) {
  const s = await open();
  const { page, cdp } = s;
  const info = await page.evaluate(([n, a]) => window.load(n, a), [rig, start]);
  await page.waitForTimeout(1200); // settle into the start action at full speed
  await setRate(page, cdp, RATE);
  const dir = join(OUT, ".frames", `rive-${rig}-${clip}`);
  const rec = recorder(cdp, { dir, alpha: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE }, scale: 1 });
  if (then) {
    await page.waitForTimeout(400 / RATE);
    await page.evaluate((a) => window.act(a), then);
  }
  await page.waitForTimeout(ms / RATE);
  const frames = await rec.stop();
  await s.browser.close();
  const outDir = join(OUT, "rive", rig);
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, clip);
  encodeAlpha(frames, base, { rate: RATE });
  poster(frames[Math.floor(frames.length * 0.6)].file, base + ".png");
  rmSync(dir, { recursive: true, force: true });
  const fps = Math.round(frames.length / ((frames.at(-1).wall - frames[0].wall) * RATE / 1000));
  addToManifest({
    id: `rive.${rig}.${clip}`,
    kind: "rive-action",
    feature: "rive-status",
    title: `${rig} (${WHO[rig]}): ${title}`,
    demonstrates,
    suggestedUse,
    moments,
    rive: { stateMachine: "Agent", viewModel: "Agent", enumProperty: "action", value: then ?? start },
    files: { hevcAlpha: rel(base + ".mov"), webmAlpha: rel(base + ".webm"), poster: rel(base + ".png"), source: rel(join(outDir, `${rig}.riv`)) },
    size: [SIZE, SIZE],
    fps: 60,
    capturedFps: fps,
    durationMs: Math.round((frames.at(-1).wall - frames[0].wall) * RATE),
    alpha: true,
  });
  console.log(`  ${rig}/${clip}: ${frames.length} frames (${fps} fps of page time)`);
  return info;
}

const args = process.argv.slice(2);
if (args[0] === "--inspect") {
  const s = await open();
  for (const rig of RIGS) {
    const info = await s.page.evaluate((n) => window.load(n), rig);
    console.log(rig, JSON.stringify({ values: info.values, artboards: info.contents.artboards.map((a) => ({ name: a.name, animations: a.animations, stateMachines: a.stateMachines.map((m) => ({ name: m.name, inputs: m.inputs })) })) }));
  }
  await s.browser.close();
} else {
  const rigs = args.length ? args : RIGS;
  for (const rig of rigs) {
    mkdirSync(join(OUT, "rive", rig), { recursive: true });
    copyFileSync(join(ROOT, "public/rive", `${rig}.riv`), join(OUT, "rive", rig, `${rig}.riv`));
    for (const c of CLIPS) await take(rig, c);
  }
}
