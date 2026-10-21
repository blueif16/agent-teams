// Staged policy moments for the permissions shots (capture only, NOT in the product): the app has no UI yet for
// "Approve & allow for this project" or for the line saying a call was decided by a rule. Each helper injects a
// small element in the app's own look (bubble gray, accent blue, green/red washes) next to the real approval card.
const svg = (c, d) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const SHIELD = (c) => svg(c, '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path class="tick" d="M8.5 12l2.5 2.5L15.5 9.5" stroke-dasharray="14" stroke-dashoffset="14"/>');
const BAN = (c) => svg(c, '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>');
const TONES = {
  green: { bg: "#e9f6ee", ink: "#16794c", ring: "#bfe3cf", icon: SHIELD("#16794c") },
  red: { bg: "#fdeeee", ink: "#c2353b", ring: "#f3c4c6", icon: BAN("#c2353b") },
  blue: { bg: "#eef2fe", ink: "#4166eb", ring: "#c9d5fa", icon: SHIELD("#4166eb") },
};

/**
 * A policy card after the real approval card (`afterText` = its title) or after an earlier staged card (`afterId`).
 * lines are HTML. Returns nothing; find it again by `id`.
 */
export async function policyCard(page, { afterText, afterId, up = 1, tone = "green", title, lines = [], foot, id }) {
  await page.evaluate(([afterText, afterId, up, t, title, lines, foot, id]) => {
    let after = afterId ? document.getElementById(afterId) : null;
    if (!after) {
      const leaf = [...document.querySelectorAll("p")].filter((e) => e.textContent.trim() === afterText).pop();
      after = leaf ?? null;
      for (let i = 0; i < up && after; i++) after = after.parentElement; // up=1: the approval card (a div holding its title)
    }
    if (!after) throw new Error("policyCard: nothing to attach to");
    const el = document.createElement("div");
    el.id = id;
    el.style.cssText = `margin-top:10px;max-width:min(540px,100%);border-radius:20px;padding:14px 16px;background:${t.bg};box-shadow:0 0 0 1px ${t.ring};font-size:14px;line-height:20px;color:#1a1a1a`;
    el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:${t.ink}"><span style="display:grid">${t.icon}</span>${title}</div>${lines.map((l) => `<div style="margin-top:6px;color:#444">${l}</div>`).join("")}${foot ? `<div style="margin-top:8px;font-size:12px;color:#7a7a7a">${foot}</div>` : ""}`;
    after.insertAdjacentElement("afterend", el);
    el.animate([{ opacity: 0, transform: "translateY(10px) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
    el.querySelector(".tick")?.animate([{ strokeDashoffset: 14 }, { strokeDashoffset: 0 }], { duration: 420, delay: 260, fill: "forwards", easing: "ease-out" });
    el.scrollIntoView({ block: "nearest" });
  }, [afterText ?? null, afterId ?? null, up, TONES[tone], title, lines, foot ?? null, id]);
}

/**
 * Adds "Approve & allow for this project" beside the real Approve/Decline buttons of the card titled `title`.
 * Clicking it presses the real Approve (so the card's own green flash and check play) and reports `window.__grant`.
 */
export async function grantButton(page, title) {
  await page.evaluate((title) => {
    const leaf = [...document.querySelectorAll("p")].filter((e) => e.textContent.trim() === title).pop();
    const row = [...leaf.parentElement.querySelectorAll("button")].find((b) => b.textContent.trim() === "Approve")?.parentElement;
    const b = document.createElement("button");
    b.id = "__grant";
    b.type = "button";
    b.textContent = "Approve & allow for this project";
    b.style.cssText = "border-radius:9999px;background:#fff;padding:6px 16px;font-size:14px;font-weight:500;color:#4166eb;box-shadow:0 0 0 1px #c9d5fa;cursor:pointer;white-space:nowrap";
    b.onclick = () => { window.__granted = true; [...row.querySelectorAll("button")].find((x) => x.textContent.trim() === "Approve").click(); };
    row.appendChild(b);
    b.animate([{ opacity: 0, transform: "scale(.9)" }, { opacity: 1, transform: "none" }], { duration: 300, fill: "backwards" });
  }, title);
}
