// Staged artifact viewers (capture only, not in the product): clicking an agent's 📎 file opens the app's real
// side pane (the agent's profile, with its native slide-in) and lays that archetype's view of the file over it:
// designer → canvas with desktop + phone artboards, researcher → table, writer → document with fact tags,
// analyst → chart, engineer → a test run going green. Content is the teams' real files where they exist.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

const file = (p) => readFileSync(join(ROOT, ".data/projects", p), "utf8");
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const srcdoc = (html) => esc(html);

const ICON = {
  canvas: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/></svg>',
  table: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/></svg>',
  doc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h7M9 17h5"/></svg>',
  chart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  terminal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 9l3 3-3 3M12 15h6"/></svg>',
};

function header(name, meta, kind, toggle) {
  return `<div class="vh"><span class="vi">${ICON[kind]}</span><span><div class="vn">${esc(name)}</div><div class="vm">${esc(meta)}</div></span>${
    toggle ? `<span class="vt">${toggle.map((t, i) => `<span class="${i === toggle.length - 1 ? "on" : ""}">${t}</span>`).join("")}</span>` : ""
  }</div>`;
}

// Artboard sizes in pane px; the iframe renders the page at its real width and is scaled down.
function artboard({ x, y, w, pageW, pageH, html, label, id }) {
  const s = w / pageW;
  return `<div class="al" style="left:${x}px;top:${y}px">${label}</div><div class="ab" data-id="${id}" style="left:${x}px;top:${y}px;width:${w}px;height:${Math.round(pageH * s)}px"><iframe srcdoc="${srcdoc(html)}" style="width:${pageW}px;height:${pageH}px;transform:scale(${s})"></iframe></div>`;
}

const MOCK = (run) => file(`bookbird-run-${run}/files/mockup.html`);

export const ARTIFACTS = {
  designer: {
    name: "mockup.html",
    agent: "Pia",
    kind: "canvas",
    html: () =>
      header("mockup.html", "Pia · Designer · desktop + phone", "canvas", ["Desktop", "Phone", "Both"]) +
      `<div class="vb cv">${artboard({ x: 22, y: 44, w: 390, pageW: 1280, pageH: 800, html: MOCK(3), label: "Desktop · 1280", id: "desk" })}${artboard({ x: 286, y: 250, w: 178, pageW: 390, pageH: 800, html: MOCK(3), label: "Phone · 390", id: "phone" })}<div class="mc" data-name="Pia"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M4 3l15 8-6.5 1.6L9 19z" fill="#f472b6" stroke="#fff" stroke-width="1.5"/></svg><span>Pia</span></div></div>`,
    select: "phone",
  },
  "designer-evolution": {
    name: "mockup.html", // install it instead of `designer` so the same link opens the history
    agent: "Pia",
    kind: "canvas",
    html: () =>
      header("mockup.html", "Pia · Designer · runs 1 → 3", "canvas", ["Run 1", "Run 2", "Run 3"]) +
      `<div class="vb cv">${artboard({ x: 22, y: 40, w: 214, pageW: 1280, pageH: 800, html: MOCK(1), label: "Run 1", id: "r1" })}${artboard({ x: 252, y: 40, w: 214, pageW: 1280, pageH: 800, html: MOCK(2), label: "Run 2", id: "r2" })}${artboard({ x: 22, y: 236, w: 444, pageW: 1280, pageH: 800, html: MOCK(3), label: "Run 3 · current", id: "r3" })}</div>`,
    select: "r3",
  },
  researcher: {
    name: "teardown.csv",
    agent: "Ravi",
    kind: "table",
    html: () => {
      const [head, ...rows] = file("bookbird-run-3/files/teardown.csv").split("\n").filter((l) => l && !l.startsWith("#"));
      const cols = head.split(",");
      const chip = (v) => `<span class="ch ch-${v.replace(/\W/g, "")}">${esc(v)}</span>`;
      const cell = (c, v) => (c === "url" ? `<span class="mu">${esc(v.replace(/^https?:\/\/(www\.)?/, ""))}</span>` : ["leads_with", "shows_price", "small_clinic_angle"].includes(c) ? chip(v) : `<b>${esc(v)}</b>`);
      const keep = ["page", "headline", "leads_with", "small_clinic_angle"];
      return (
        header("teardown.csv", `Ravi · Researcher · ${rows.length} competitor pages`, "table", ["Table", "Raw"]) +
        `<div class="vb tb"><table><tr>${keep.map((c) => `<th>${c.replace(/_/g, " ")}</th>`).join("")}</tr>${rows
          .map((r) => {
            const v = r.split(",");
            return `<tr class="row">${keep.map((c) => `<td>${cell(c, v[cols.indexOf(c)] ?? "")}</td>`).join("")}</tr>`;
          })
          .join("")}</table><div class="gap"><b>Gap:</b> none of the four speaks to a 1–10 practitioner clinic or says setup is self-serve → <i>“built for small clinics, no setup call”</i></div></div>`
      );
    },
  },
  writer: {
    name: "copy.md",
    agent: "Wren",
    kind: "doc",
    html: () => {
      const body = marked.parse(file("bookbird-run-3/files/copy.md")).replace(/\[(F\d+)\]/g, '<span class="tag">$1</span>');
      return header("copy.md", "Wren · Writer · every number tagged to a fact", "doc", ["Preview", "Markdown"]) + `<div class="vb doc">${body}<div class="note">Voice: plain and warm, no hype · 4 facts cited</div></div>`;
    },
  },
  analyst: {
    name: "cost-and-margin-memo.md",
    agent: "Tally",
    kind: "chart",
    html: () => {
      const bars = [["30%", 279], ["40%", 239], ["50%", 200]];
      const H = 220, max = 320, y = (v) => H - (v / max) * H;
      const svg = `<svg class="bars" viewBox="0 0 400 ${H + 40}" width="100%"><line x1="30" x2="390" y1="${y(239)}" y2="${y(239)}" stroke="#e5484d" stroke-width="1.5" stroke-dasharray="5 4"/><text x="34" y="${y(239) - 8}" font-size="11" fill="#e5484d">landed-cost ceiling $239</text>${bars
        .map(([m, v], i) => `<g class="bar" style="transform-origin:${70 + i * 110 + 35}px ${H}px"><rect x="${70 + i * 110}" y="${y(v)}" width="70" height="${H - y(v)}" rx="8" fill="${i === 1 ? "#4166eb" : "#a9b7f6"}"/><text x="${70 + i * 110 + 35}" y="${y(v) - 8}" text-anchor="middle" font-size="13" font-weight="600" fill="#111">$${v}</text></g><text x="${70 + i * 110 + 35}" y="${H + 20}" text-anchor="middle" font-size="12" fill="#666">${m}</text>`)
        .join("")}<line x1="30" x2="390" y1="${H}" y2="${H}" stroke="#ddd"/></svg>`;
      return (
        header("cost-and-margin-memo.md", "Tally · Analyst · what the $399 price has to survive", "chart", ["Chart", "Table", "Memo"]) +
        `<div class="vb an"><div class="ct">Our wholesale per unit at a $399 shelf price, by retailer margin</div>${svg}<p>At a typical 40% big-box margin we receive <b>$239</b> a watch, so a rugged solar hybrid with a moving shutter has to land under that. <b>Next:</b> one ODM quote removes more uncertainty than any desk research.</p></div>`
      );
    },
  },
  engineer: {
    name: "test-run.log",
    agent: "Gizmo",
    kind: "terminal",
    html: () => header("test-run.log", "Gizmo · Engineer · merchant/ fixes, tests/ untouched", "terminal", ["Log", "Diff"]) + `<div class="vb"><div class="term"></div></div>`,
    lines: [
      ["$ pytest -q", "c"],
      ["baseline (before fixes)", "m"],
      ["..F.FF..F.FF.F..FF.F.FFF.F", "mix"],
      ["14 failed, 12 passed in 2.83s", "r"],
      ["", ""],
      ["$ git diff --stat merchant/", "c"],
      [" merchant/pricing.py    |  6 +++---", ""],
      [" merchant/inventory.py  | 14 ++++++++------", ""],
      [" merchant/checkout.py   |  9 +++++----", ""],
      [" tests/                 |  0  (byte-identical)", "m"],
      ["", ""],
      ["$ pytest -q", "c"],
      ["..........................", "g"],
      ["26 passed in 2.41s ✓", "G"],
    ],
  },
};

const CSS = `
#__viewer{position:fixed;z-index:40;background:#fff;display:flex;flex-direction:column;overflow:hidden;color:#111;font-family:var(--font-sans);border-bottom-right-radius:20px}
#__viewer .vh{display:flex;align-items:center;gap:10px;height:58px;padding:0 16px;border-bottom:1px solid #ececec;flex-shrink:0}
#__viewer .vi{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:#eef2fe;color:#4166eb;flex-shrink:0}
#__viewer .vn{font-size:14px;font-weight:600;line-height:18px}
#__viewer .vm{font-size:12px;color:#8a8a8a;line-height:16px}
#__viewer .vt{margin-left:auto;display:flex;gap:2px;background:rgba(0,0,0,.045);border-radius:999px;padding:3px}
#__viewer .vt span{font-size:12px;padding:4px 10px;border-radius:999px;color:#666}
#__viewer .vt span.on{background:#fff;color:#111;box-shadow:0 1px 3px rgba(0,0,0,.1)}
#__viewer .vb{flex:1;position:relative;overflow:hidden}
#__viewer .cv{background:#f4f5f7;background-image:radial-gradient(#d6d9df 1px,transparent 1px);background-size:16px 16px}
#__viewer .ab{position:absolute;background:#fff;border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,.1),0 0 0 1px rgba(0,0,0,.06);overflow:hidden}
#__viewer .ab iframe{border:0;transform-origin:0 0;pointer-events:none;display:block}
#__viewer .al{position:absolute;font-size:11px;color:#8a8a8a;margin-top:-17px}
#__viewer .sel{position:absolute;border:1.5px solid #4166eb;border-radius:7px;pointer-events:none}
#__viewer .sel i{position:absolute;width:7px;height:7px;background:#fff;border:1.5px solid #4166eb;border-radius:2px}
#__viewer .mc{position:absolute;left:60px;top:400px;display:flex;align-items:flex-start;gap:2px;opacity:0}
#__viewer .mc span{background:#f472b6;color:#fff;font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;margin-top:12px}
#__viewer .tb{padding:14px 16px}
#__viewer table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}
#__viewer th{text-align:left;font-weight:600;color:#777;background:#fafafa;padding:8px 10px;border-bottom:1px solid #ececec;text-transform:capitalize}
#__viewer td{padding:11px 10px;border-bottom:1px solid #f1f1f1;vertical-align:top;line-height:17px}
#__viewer .mu{color:#8a8a8a}
#__viewer .ch{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11.5px;background:#f1f1f1;color:#555}
#__viewer .ch-no{background:#fdecec;color:#c4333a}#__viewer .ch-partial{background:#fff4e0;color:#a35c00}#__viewer .ch-yes{background:#e6f6ec;color:#16794c}
#__viewer .ch-features,#__viewer .ch-allinone{background:#eef2fe;color:#4166eb}#__viewer .ch-price{background:#f3eefe;color:#7a4fd6}
#__viewer .gap{margin-top:14px;padding:12px 14px;border-radius:14px;background:#f6f8ff;font-size:13px;line-height:19px;color:#333}
#__viewer .doc{padding:20px 26px;font-size:14px;line-height:22px;overflow:hidden}
#__viewer .doc h1{font-size:19px;font-weight:650;margin:0 0 12px}
#__viewer .doc p{margin:0 0 11px}#__viewer .doc ul{margin:0 0 11px;padding-left:18px}
#__viewer .tag{display:inline-block;background:#eef2fe;color:#4166eb;border-radius:999px;padding:0 6px;font-size:11px;font-weight:650;line-height:17px;margin-left:2px}
#__viewer .note{margin-top:8px;font-size:12px;color:#8a8a8a}
#__viewer .an{padding:18px 20px}#__viewer .ct{font-size:13px;font-weight:600;margin-bottom:8px}
#__viewer .an p{font-size:13px;line-height:20px;color:#333;margin-top:10px}
#__viewer .term{position:absolute;inset:14px;background:#0f1115;border-radius:14px;color:#d5d7db;font-family:var(--font-mono);font-size:12.5px;line-height:21px;padding:14px 16px;overflow:hidden;white-space:pre}
#__viewer .term .c{color:#9aa4b2}#__viewer .term .m{color:#6b7280}#__viewer .term .r{color:#f87171}#__viewer .term .g{color:#4ade80}#__viewer .term .G{color:#4ade80;font-weight:700}
#__viewer .term .f{color:#f87171}#__viewer .term .p{color:#4ade80}
`;

const VIEWER = ({ artifacts, css }) => {
  const anim = (el, kf, opts) => el && el.animate(kf, { fill: "both", easing: "cubic-bezier(.2,.8,.2,1)", ...opts });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function open(key) {
    const a = artifacts[key];
    console.log("[viewer] open", key, !!a);
    if (!a) return;
    // Open the agent's real pane, then lay the view over its body.
    const prof = [...document.querySelectorAll(`[aria-label="${a.agent}'s profile"]`)].pop();
    if (prof && ![...document.querySelectorAll("button,span")].some((n) => n.textContent === `${a.agent}: activity`)) prof.click();
    await wait(60);
    const strip = document.querySelector(".w-\\[44\\%\\]") ?? document.querySelector('[class*="w-[44%]"]');
    const r = strip?.getBoundingClientRect() ?? { x: innerWidth * 0.56, width: innerWidth * 0.44 - 10 };
    for (const n of document.querySelectorAll("span,button,div")) if (n.childElementCount === 0 && n.textContent === `${a.agent}: activity`) n.textContent = a.name;
    if (!document.getElementById("__viewer_css")) {
      const st = document.createElement("style");
      st.id = "__viewer_css";
      st.textContent = css;
      document.head.appendChild(st);
    }
    document.getElementById("__viewer")?.remove();
    const v = document.createElement("div");
    v.id = "__viewer";
    v.style.cssText = `left:${r.x}px;top:44px;width:${r.width}px;height:${innerHeight - 54}px`;
    v.innerHTML = a.html;
    document.body.appendChild(v);
    anim(v, [{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "none" }], { duration: 380 });
    if (a.kind === "canvas") {
      v.querySelectorAll(".ab").forEach((b, i) => anim(b, [{ opacity: 0, transform: "translateY(18px) scale(.94)" }, { opacity: 1, transform: "none" }], { duration: 520, delay: 160 + i * 140 }));
      v.querySelectorAll(".al").forEach((b, i) => anim(b, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 260 + i * 140 }));
      await wait(900);
      const t = v.querySelector(`.ab[data-id="${a.select}"]`);
      const mc = v.querySelector(".mc");
      if (mc && t) {
        anim(mc, [{ opacity: 0, transform: "translate(0,0)" }, { opacity: 1, transform: "translate(0,0)", offset: 0.15 }, { opacity: 1, transform: `translate(${t.offsetLeft + t.offsetWidth * 0.6 - 60}px,${t.offsetTop + t.offsetHeight * 0.55 - 400}px)` }], { duration: 900 });
        await wait(800);
      }
      if (t) {
        const s = document.createElement("div");
        s.className = "sel";
        s.style.cssText = `left:${t.offsetLeft - 4}px;top:${t.offsetTop - 4}px;width:${t.offsetWidth + 8}px;height:${t.offsetHeight + 8}px`;
        s.innerHTML = ["-4px;top:-4px", "calc(100% - 4px);top:-4px", "-4px;top:calc(100% - 4px)", "calc(100% - 4px);top:calc(100% - 4px)"].map((p) => `<i style="left:${p}"></i>`).join("");
        t.parentElement.appendChild(s);
        anim(s, [{ opacity: 0, transform: "scale(1.04)" }, { opacity: 1, transform: "none" }], { duration: 260 });
        anim(t, [{ transform: "none" }, { transform: "scale(1.03)" }, { transform: "none" }], { duration: 500, easing: "ease-out" });
      }
    } else if (a.kind === "table") {
      v.querySelectorAll("tr.row").forEach((row, i) => anim(row, [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 380, delay: 200 + i * 110 }));
      v.querySelectorAll(".ch").forEach((c, i) => anim(c, [{ transform: "scale(.6)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 300, delay: 420 + i * 40, easing: "cubic-bezier(.3,1.6,.5,1)" }));
      anim(v.querySelector(".gap"), [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 400, delay: 950 });
    } else if (a.kind === "doc") {
      [...v.querySelector(".doc").children].forEach((c, i) => anim(c, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 360, delay: 160 + i * 90 }));
      v.querySelectorAll(".tag").forEach((t, i) => anim(t, [{ transform: "scale(.4)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 320, delay: 700 + i * 120, easing: "cubic-bezier(.3,1.7,.5,1)" }));
    } else if (a.kind === "chart") {
      v.querySelectorAll(".bar").forEach((b, i) => anim(b, [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: 650, delay: 250 + i * 130 }));
      anim(v.querySelector(".bars line"), [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 800 });
    } else if (a.kind === "terminal") {
      const term = v.querySelector(".term");
      await wait(250);
      for (const [text, cls] of a.lines) {
        const line = document.createElement("div");
        term.appendChild(line);
        if (cls === "mix" || cls === "g") {
          for (const ch of text) {
            const s = document.createElement("span");
            s.className = ch === "F" ? "f" : "p";
            s.textContent = ch;
            line.appendChild(s);
            await wait(18);
          }
        } else {
          line.className = cls;
          line.textContent = text;
        }
        await wait(text.startsWith("$") ? 380 : 120);
      }
    }
  }
  window.__viewer = { open };
  // Pressing a 📎 file name that matches a staged artifact opens the viewer instead of navigating. Matched by text
  // on press, because the bubble re-renders under hover (the click can land on a parent) and links in live replies
  // render as plain spans.
  const match = (el) => {
    for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) {
      const t = n.textContent?.trim();
      const key = Object.keys(artifacts).find((k) => artifacts[k].name === t);
      if (key) return key;
    }
    return null;
  };
  let pending = null;
  addEventListener("mousedown", (e) => { pending = match(e.target); console.log("[viewer] mousedown", e.target.tagName, JSON.stringify(e.target.textContent?.slice(0, 40)), pending); if (pending) { e.preventDefault(); e.stopPropagation(); } }, true);
  addEventListener("mouseup", (e) => { if (pending) { e.preventDefault(); e.stopPropagation(); const k = pending; setTimeout(() => (pending = null), 0); open(k); } }, true);
  addEventListener("click", (e) => { if (match(e.target) || pending) { e.preventDefault(); e.stopPropagation(); } }, true);
};

/** Installs the viewer with the given artifact keys (default: all). */
export async function installViewer(page, keys = Object.keys(ARTIFACTS)) {
  const artifacts = Object.fromEntries(keys.map((k) => { const { html, ...rest } = ARTIFACTS[k]; return [k, { ...rest, html: html() }]; }));
  await page.addInitScript(VIEWER, { artifacts, css: CSS });
}
