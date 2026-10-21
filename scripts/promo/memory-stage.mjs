// Staged overlay (capture only, not in the product) for the learning step at project close: the PM's real retro
// (retro-run3.md) and the revised skill (skills/lead-pm/SKILL.md) as a diff with the added lines highlighted.
// Sits over the agent's real side pane like viewer.mjs. Content is the team's real files.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";
import { ROOT } from "./lib.mjs";

const file = (p) => readFileSync(join(ROOT, ".data/projects/bookbird-run-1/files", p), "utf8");
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const inline = (s) => esc(s).replace(/∥/g, '<span style="font-family:system-ui">∥</span>').replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");

const CSS = `
#__mem{position:fixed;z-index:40;background:#fff;display:flex;flex-direction:column;overflow:hidden;color:#111;font-family:var(--font-sans);border-bottom-right-radius:20px}
#__mem .vh{display:flex;align-items:center;gap:10px;height:58px;padding:0 16px;border-bottom:1px solid #ececec;flex-shrink:0}
#__mem .vi{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:#eef2fe;color:#4166eb;flex-shrink:0}
#__mem .vn{font-size:14px;font-weight:600;line-height:18px}#__mem .vm{font-size:12px;color:#8a8a8a;line-height:16px}
#__mem .vt{margin-left:auto;display:flex;gap:2px;background:rgba(0,0,0,.045);border-radius:999px;padding:3px}
#__mem .vt span{font-size:12px;padding:4px 12px;border-radius:999px;color:#666;cursor:pointer}
#__mem .vt span.on{background:#fff;color:#111;box-shadow:0 1px 3px rgba(0,0,0,.1)}
#__mem .pg{flex:1;overflow:hidden;position:relative}
#__mem .retro{padding:18px 26px;font-size:12.5px;line-height:18.5px;color:#222}
#__mem .retro h1{font-size:17px;font-weight:650;margin:0 0 8px}
#__mem .retro h2{font-size:13px;font-weight:650;margin:12px 0 5px;color:#4166eb}
#__mem .retro p{margin:0 0 7px}
#__mem .retro .gap{padding:7px 10px;border-radius:10px;background:#fafafa;margin-bottom:7px}
#__mem .retro .rule{margin-top:4px;padding:5px 9px;border-radius:8px;background:#e8f6ee;color:#14633f;font-weight:550}
#__mem code{font-family:var(--font-mono);font-size:11.5px;background:rgba(0,0,0,.06);padding:0 4px;border-radius:4px}
#__mem .counts{margin-top:8px;padding:8px 10px;border-radius:10px;background:#fff4e0;color:#8a5200}
#__mem .chg{margin-top:8px;padding:8px 10px;border-radius:10px;background:#f6f8ff}
#__mem .diff{padding:16px 18px;font-size:12.5px;line-height:19px}
#__mem .df{font-family:var(--font-mono);font-size:12px;color:#555;margin-bottom:10px}
#__mem .ln{display:flex;gap:10px;padding:3px 10px;border-radius:6px;color:#444}
#__mem .ln i{font-style:normal;width:10px;color:#aaa;flex-shrink:0;font-family:var(--font-mono)}
#__mem .ln.add{background:#e4f7ea;color:#0f5132}#__mem .ln.add i{color:#16794c;font-weight:700}
#__mem .ft{margin-top:12px;display:flex;align-items:center;gap:10px;font-size:12px;color:#777}
#__mem .btn{background:#111;color:#fff;border-radius:999px;padding:6px 14px;font-weight:600;font-size:12px}
`;

const RETRO = () => {
  const src = file("retro-run3.md").split("\n");
  const keep = [];
  let skip = false;
  for (const l of src) {
    if (/^## What went right/.test(l)) skip = true;
    else if (/^## /.test(l)) skip = false;
    if (!skip && !/^Sources:/.test(l)) keep.push(l);
  }
  let html = "";
  for (const raw of keep) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith("# ")) html += `<h1>${inline(l.slice(2))}</h1>`;
    else if (l.startsWith("## ")) html += `<h2>${inline(l.slice(3))}</h2>`;
    else if (l.startsWith("Rule:")) html += `<div class="rule">${inline(l)}</div></div>`;
    else if (/^\*\*\d\./.test(l)) html += `<div class="gap"><p>${inline(l)}</p>`;
    else if (l.startsWith("[F#]")) html += `<div class="counts">${inline(l)}</div>`;
    else if (l.startsWith("`/project/skills")) html += `<div class="chg">${inline(l)}</div>`;
    else html += `<p>${inline(l)}</p>`;
  }
  return html;
};

const DIFF = () => {
  const lines = file("skills/lead-pm/SKILL.md").split("\n").filter(Boolean);
  const out = lines.map((l, i) => `<div class="ln ${i >= 5 ? "add" : ""}"><i>${i >= 5 ? "+" : ""}</i><span>${inline(l)}</span></div>`);
  return `<div class="df">skills/lead-pm/SKILL.md &nbsp;·&nbsp; +4 lines</div>${out.join("")}<div class="ft"><span class="btn">Install on approval</span> four rules from the run 3 retro</div>`;
};

const header = (on) =>
  `<div class="vh"><span class="vi"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h7M9 17h5"/></svg></span><span><div class="vn">Project closed: what Juno learned</div><div class="vm">Juno · PM · Bookbird run 3</div></span><span class="vt"><span class="${on === "retro" ? "on" : ""}" data-k="retro">Retro</span><span class="${on === "diff" ? "on" : ""}" data-k="diff">Skill change</span></span></div>`;

const STAGE = ({ retro, diff, css }) => {
  const anim = (el, kf, o) => el && el.animate(kf, { fill: "both", easing: "cubic-bezier(.2,.8,.2,1)", ...o });
  const view = (k) => {
    const v = document.getElementById("__mem");
    v.querySelectorAll(".vt span").forEach((s) => s.classList.toggle("on", s.dataset.k === k));
    const pg = v.querySelector(".pg");
    pg.innerHTML = k === "retro" ? `<div class="retro">${retro}</div>` : `<div class="diff">${diff}</div>`;
    const kids = [...pg.firstElementChild.children];
    kids.forEach((c, i) => anim(c, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 340, delay: 120 + i * (k === "diff" ? 150 : 90) }));
    if (k === "diff") pg.querySelectorAll(".ln.add").forEach((c, i) => anim(c, [{ backgroundColor: "#fff3a8" }, { backgroundColor: "#e4f7ea" }], { duration: 900, delay: 700 + i * 150, fill: "backwards" }));
  };
  const show = () => {
    if (!document.getElementById("__mem_css")) {
      const st = document.createElement("style");
      st.id = "__mem_css";
      st.textContent = css;
      document.head.appendChild(st);
    }
    const strip = document.querySelector(".w-\\[44\\%\\]") ?? document.querySelector('[class*="w-[44%]"]');
    const r = strip?.getBoundingClientRect() ?? { x: innerWidth * 0.56, width: innerWidth * 0.44 - 10 };
    for (const n of document.querySelectorAll("span,button,div")) if (n.childElementCount === 0 && /: activity$/.test(n.textContent)) n.textContent = "retro-run3.md";
    document.getElementById("__mem")?.remove();
    const v = document.createElement("div");
    v.id = "__mem";
    v.style.cssText = `left:${r.x}px;top:44px;width:${r.width}px;height:${innerHeight - 54}px`;
    v.innerHTML = `<div class="hd"></div><div class="pg"></div>`;
    document.body.appendChild(v);
    anim(v, [{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "none" }], { duration: 380 });
    v.querySelector(".hd").outerHTML = "HEADER";
    v.addEventListener("click", (e) => { const s = e.target.closest(".vt span"); if (s) view(s.dataset.k); });
    view("retro");
  };
  window.__mem = { show, view };
};

/** Installs window.__mem.show() (opens the retro over the open agent pane) and .view("retro"|"diff"). */
export async function installMemoryStage(page) {
  const fn = STAGE.toString().replace('"HEADER"', JSON.stringify(header("retro")));
  await page.evaluate(`(${fn})(${JSON.stringify({ retro: RETRO(), diff: DIFF(), css: CSS })})`);
}
