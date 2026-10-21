// The effect registry: one entry per interaction worth filming. Each says which core feature it shows
// (lib.mjs FEATURES) and what it demonstrates, so the editing agent can cut by story beat without watching
// everything. Agent replies are staged (stage.mjs): no live model is called.
//   setup  runs at full speed before recording (navigate, scroll, queue staged replies)
//   act    runs slowed and recorded; d.mark(what, box) names the moments the editor will cut on
import { rule } from "../stage.mjs";
export { rule };

export const CHANNEL = "bookbird-launch"; // staged name of bookbird-run-1 (org.mjs)

export async function openChannel(page, name) {
  await page.locator("aside").getByText(name, { exact: true }).first().click();
  await page.waitForTimeout(1500);
}

/** The bubble holding `text`, scrolled to `at` (0 top … 1 bottom) of the thread. */
export async function bubble(page, text, at = 0.45) {
  const el = page.getByText(text).first();
  await el.evaluate((n, at) => {
    const scroller = (() => { for (let p = n.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p; return null; })();
    if (!scroller) return;
    const r = n.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    scroller.scrollTop += r.top - s.top - (s.height * at - r.height / 2);
  }, at);
  await page.waitForTimeout(400);
  return el;
}

/** Scrolls the open conversation to its newest message (live replies land at the bottom). */
export async function scrollToBottom(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("section *")) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 300) el.scrollTop = el.scrollHeight;
    }
  });
  await page.waitForTimeout(500);
}

export const menuButton = (page, label) => page.getByRole("menu").getByRole("button", { name: new RegExp(`^${label}:`) });

/** Click a message, sweep the menu's emoji, pick one: the shared body of the order shots. */
export async function order(page, d, { text, label, sweep = [] }) {
  const msg = page.getByText(text).first();
  await d.click(msg, { ms: 650, fx: 0.3, what: "left-click the agent's message" });
  await d.wait(380);
  d.mark("quick-actions menu open", await d.box(page.getByRole("menu")));
  for (const s of sweep) {
    await d.hover(menuButton(page, s), { ms: 260 });
    await d.wait(240);
  }
  await d.click(menuButton(page, label), { ms: 300, dwell: 220, what: `pick ${label}` });
}


export const GUILD = "guildhall-concept"; // staged name of p_138321a0e045aa0a (org.mjs): a real run with a real plan
export const GUILD_PID = "p_138321a0e045aa0a";

export async function openTeamPanel(page) {
  await page.getByRole("button", { name: "Team overview" }).click();
  await page.waitForTimeout(1400);
}
/** A segmented tab in the team or agent panel (role="tab", icon-only with an aria-label). */
export const tab = (page, label) => page.getByRole("tab", { name: label, exact: true }).last();

/** Mira's realistic proposal for a real build (owner: stage it with good numbers). */
export const GUILD_PROPOSAL = {
  name: "Guildhall beta",
  channel: "guildhall-beta",
  goal: "Ship a paid beta of Guildhall, a community chat app for creator communities: real-time channels, roles and Stripe memberships, with 200 creators onboarded",
  due: "2026-12-18",
  metric: "200 paying creator communities on the beta, day-30 retention above 40%",
  scope: { must: ["real-time channels and threads", "roles and moderation", "Stripe memberships", "web beta"], wont: ["voice and video at launch", "public server discovery"] },
  open: ["Which creator niche first: fitness, finance or gaming?", "Managed real-time (Ably) or self-hosted?"],
  options: [
    { label: "Lean", summary: "One engineer ships a text-only web MVP to test the wedge with 20 creators.", kind: "solo", roles: [{ archetype: "engineer", role: "Full-stack engineer", need: "ship a text-only web MVP", qualifications: ["Next.js", "real-time messaging"] }], budgetUsd: 180, etaDays: 14 },
    { label: "Balanced", summary: "A PM runs research, design and the real-time core in parallel to a paid web beta.", kind: "project", roles: [{ archetype: "lead", role: "PM" }, { archetype: "researcher", role: "Market researcher", need: "rank creator niches on evidence", qualifications: ["market research", "primary-source citation"] }, { archetype: "designer", role: "Product designer", need: "design the core loop with every state", qualifications: ["interaction design", "state coverage"] }, { archetype: "engineer", role: "Platform engineer", need: "build real-time channels and Stripe memberships", qualifications: ["real-time messaging architecture", "payments"] }], budgetUsd: 640, etaDays: 30 },
    { label: "Full", summary: "Two engineers so the web app and the iOS app ship together.", kind: "project", roles: [{ archetype: "lead", role: "PM" }, { archetype: "designer", role: "Product designer", need: "design web and iOS flows", qualifications: ["interaction design", "mobile"] }, { archetype: "engineer", role: "Platform engineer", need: "real-time core and payments", qualifications: ["real-time messaging architecture", "payments"] }, { archetype: "engineer", role: "iOS engineer", need: "ship the iOS client", qualifications: ["Swift", "SwiftUI"] }], budgetUsd: 980, etaDays: 42 },
  ],
};
export const MIRA_SENTENCE = "This is a build, not a concept: I'd go Balanced, so the wedge, the design and the real-time core move together.";

/** The agent's answer to the next order (only requests carrying an order match; the heartbeat doesn't). */
export const reply = (page, text, cps = 75) => rule(page, { kind: "stream", url: "/api/chat", method: "POST", bodyIncludes: '"order":', text, cps, delayMs: 900, once: true });

