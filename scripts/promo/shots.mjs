// The effect registry: one entry per interaction worth filming. Each says which core feature it shows
// (lib.mjs FEATURES) and what it demonstrates, so the editing agent can cut by story beat without watching
// everything. Agent replies are staged (stage.mjs): no live model is called.
//   setup  runs at full speed before recording (navigate, scroll, queue staged replies)
//   act    runs slowed and recorded; d.mark(what, box) names the moments the editor will cut on
import { rule } from "./stage.mjs";

const CHANNEL = "bookbird-launch"; // staged name of bookbird-run-1 (org.mjs)

async function openChannel(page, name) {
  await page.locator("aside").getByText(name, { exact: true }).first().click();
  await page.waitForTimeout(1500);
}

/** The bubble holding `text`, scrolled to `at` (0 top … 1 bottom) of the thread. */
async function bubble(page, text, at = 0.45) {
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

const menuButton = (page, label) => page.getByRole("menu").getByRole("button", { name: new RegExp(`^${label}:`) });

/** Click a message, sweep the menu's emoji, pick one: the shared body of the order shots. */
async function order(page, d, { text, label, sweep = [] }) {
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

const reply = (page, text, cps = 75) => rule(page, { kind: "stream", url: "/api/chat", method: "POST", text, cps, delayMs: 900, once: true });

export const EFFECTS = [
  // ───────────────────────────── reactions (hero)
  {
    id: "reactions.go-ahead",
    feature: "reactions",
    title: "👍 Go ahead: click a message, pick the order, the agent acts and answers",
    demonstrates: "The full reaction loop on the designer's latest message: left-click opens the quick-actions menu, the cursor sweeps the five orders (each grows, the hint line names it), 👍 lands as a chip under the message, the bubble bumps, Pia flips to working (header count + mascot), typing dots, then a reply quoting the order streams in right below. Reactions are instructions, not decoration.",
    suggestedUse: "The hero sequence. Cut on 'pick Go ahead' for the punch; the slow-mo covers the chip pop.",
    staged: "Pia's reply text is scripted (fetch stub for POST /api/chat); channel name and transcript polished (org.mjs).",
    async setup({ page }) {
      await openChannel(page, CHANNEL);
      await bubble(page, "It didn't stack well", 0.5);
      await reply(page, "On it. Phone view ships by default now; I'll check mockup.html at 375 px before I hand it back.");
    },
    async act({ page, d }) {
      await order(page, d, { text: "It didn't stack well", label: "Go ahead", sweep: ["Dig in", "Redo", "Hold", "Remember", "Go ahead"] });
      await d.wait(700);
      d.mark("chip + status working + typing dots");
      await d.wait(2100);
      d.mark("quoted reply finished streaming", await d.box(page.getByText("Phone view ships by default").first()));
    },
    tail: 700,
  },
  {
    id: "reactions.redo",
    feature: "reactions",
    title: "🔁 Redo: send the writer's hype draft back",
    demonstrates: "One click sends work back: 🔁 on Wren's draft ('Revolutionary booking for modern clinics') and Wren answers with the fix. Quality control is a reaction away.",
    suggestedUse: "Quick cut in a montage of orders.",
    staged: "Wren's reply text is scripted.",
    async setup({ page }) {
      await openChannel(page, CHANNEL);
      await bubble(page, "Revolutionary booking for modern clinics", 0.4);
      await reply(page, "Redoing it: dropping \"revolutionary\" and tagging every number with its fact.");
    },
    async act({ page, d }) {
      await order(page, d, { text: "Revolutionary booking for modern clinics", label: "Redo" });
      await d.wait(2600);
      d.mark("Wren's reply streamed", await d.box(page.getByText("dropping \"revolutionary\"").first()));
    },
  },
  {
    id: "reactions.hold-rive",
    feature: "reactions",
    title: "✋ Hold: the agent's Rive mascot stops working",
    demonstrates: "With Ravi's profile open, ✋ on his message pauses him: the status chip pops to Idle and his live Rive mascot puts the keyboard away. An order changes what the agent is doing, visibly.",
    suggestedUse: "Pairs reactions with rive-status: frame the right-hand panel after the click.",
    staged: "Ravi is set working by a scripted run on /api/runs; his reply text is scripted.",
    async setup({ page }) {
      await openChannel(page, CHANNEL);
      await bubble(page, "I looked at 7 pages", 0.4);
      await page.getByRole("button", { name: "Ravi's profile" }).first().click();
      await page.waitForTimeout(1500);
      // Ravi working on something before the order lands.
      await page.evaluate(() => window.__stage.run("a:ravi:p:bookbird-run-1", "", { now: "Reading Cliniko's pricing page", done: false, delayMs: 0 }));
      await page.waitForTimeout(1200);
      await reply(page, "Holding. I'll wait for your go before touching the pricing pages.");
    },
    async act({ page, d }) {
      await order(page, d, { text: "I looked at 7 pages", label: "Hold" });
      await d.wait(500);
      d.mark("Ravi goes idle: status chip + Rive mascot", await d.box(page.locator("main, body").getByText("Ravi", { exact: true }).last()));
      await d.wait(2400);
    },
    focus: async () => ({ x: 900, y: 40, w: 540, h: 420 }),
    tail: 600,
  },
  {
    id: "reactions.remember",
    feature: "reactions",
    title: "📌 Remember: an order becomes a standing instruction",
    demonstrates: "📌 on Pia's message saves it as a standing instruction: a new line lands under Remembers in her profile, and she confirms. Agents keep what you teach them.",
    suggestedUse: "Bridge into soul-memory beats.",
    staged: "Pia's reply text is scripted.",
    async setup({ page }) {
      await openChannel(page, CHANNEL);
      await bubble(page, "It didn't stack well", 0.4);
      await page.getByRole("button", { name: "Pia's profile" }).first().click();
      await page.waitForTimeout(1500);
      await reply(page, "Saved: I'll always ship the phone view with every mockup.");
    },
    async act({ page, d }) {
      await order(page, d, { text: "It didn't stack well", label: "Remember" });
      await d.wait(700);
      d.mark("Remembers row lands in Pia's profile");
      await d.wait(2200);
    },
    tail: 600,
  },
  {
    id: "reactions.hover-bar",
    feature: "reactions",
    title: "Hover bar: Slack-style quick orders on every agent message",
    demonstrates: "Hovering an agent message reveals the quick bar; sweeping across it, each emoji grows. Fast, familiar, Slack-like.",
    suggestedUse: "Very short insert before the menu shots.",
    async setup({ page }) {
      await openChannel(page, CHANNEL);
      await bubble(page, "Thanks. Any competitors you want covered for sure?", 0.5);
    },
    async act({ page, d }) {
      const msg = page.getByText("Thanks. Any competitors you want covered for sure?").first();
      const b = await d.hover(msg, { ms: 600, fx: 0.6 });
      d.mark("hover bar appears", { x: b.x, y: b.y - 40, w: b.w + 80, h: b.h + 40 });
      await d.wait(300);
      for (const s of ["Go ahead", "Dig in", "Redo", "Hold", "Remember"]) {
        await d.hover(page.getByRole("button", { name: new RegExp(`^${s}:`) }).first(), { ms: 200 });
        await d.wait(180);
      }
      d.mark("swept all five orders");
    },
    tail: 500,
  },

  // ───────────────────────────── stats
  {
    id: "stats.team-performance",
    feature: "stats",
    title: "Team Performance: spend, tokens, cache hit, per-agent and per-hour charts grow in",
    demonstrates: "Open a team's Performance tab and the real numbers animate in: KPI tiles pop (a whole project cost about 26 cents), tokens-by-agent bars and spend-by-hour bars grow. Live, clear stats from the real ledger.",
    suggestedUse: "Stats beat; the poster is a clean still of the tiles.",
    staged: "None: real ledger data for #discord-competitor.",
    async setup({ page }) {
      await openChannel(page, "discord-competitor");
      await page.getByRole("button", { name: "Team overview" }).click();
      await page.waitForTimeout(1500);
    },
    async act({ page, d }) {
      await d.click(page.getByRole("button", { name: "Performance", exact: true }), { ms: 600, what: "open the Performance tab" });
      await d.wait(900);
      d.mark("KPI tiles + charts animated in", { x: 1030, y: 380, w: 400, h: 500 });
      await d.wait(900);
    },
    focus: async () => ({ x: 1030, y: 330, w: 400, h: 560 }),
    tail: 600,
  },
];
