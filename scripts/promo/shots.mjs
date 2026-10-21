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


const GUILD = "guildhall-concept"; // staged name of p_138321a0e045aa0a (org.mjs): a real run with a real plan
const GUILD_PID = "p_138321a0e045aa0a";

async function openTeamPanel(page) {
  await page.getByRole("button", { name: "Team overview" }).click();
  await page.waitForTimeout(1400);
}
/** A segmented tab in the team or agent panel (role="tab", icon-only with an aria-label). */
const tab = (page, label) => page.getByRole("tab", { name: label, exact: true }).last();

/** Mira's realistic proposal for a real build (owner: stage it with good numbers). */
const GUILD_PROPOSAL = {
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
const MIRA_SENTENCE = "This is a build, not a concept: I'd go Balanced, so the wedge, the design and the real-time core move together.";

/** The agent's answer to the next order (only requests carrying an order match; the heartbeat doesn't). */
const reply = (page, text, cps = 75) => rule(page, { kind: "stream", url: "/api/chat", method: "POST", bodyIncludes: '"order":', text, cps, delayMs: 900, once: true });

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
    staged: "None: real ledger data for the Guildhall concept project (shown as #guildhall-concept).",
    async setup({ page }) {
      await openChannel(page, GUILD);
      await openTeamPanel(page);
    },
    async act({ page, d }) {
      await d.click(tab(page, "Performance"), { ms: 600, what: "open the Performance tab" });
      await d.wait(900);
      d.mark("KPI tiles + charts animated in", { x: 1030, y: 380, w: 400, h: 500 });
      await d.wait(900);
    },
    focus: async () => ({ x: 1030, y: 330, w: 400, h: 560 }),
    tail: 600,
  },

  // ───────────────────────────── rive-status
  {
    id: "rive-status.channel-header",
    feature: "rive-status",
    title: "Channel header: three agents start working at once, their Rive mascots pull out keyboards",
    demonstrates: "The team's mascots sit on top of the channel. As the researcher, designer and engineer each start a task, their live Rive mascots switch to working (keyboard + mittens) one after another and the header count climbs to '3 working'. You see who is busy at a glance.",
    suggestedUse: "Tight on the header; the stagger reads well at real speed.",
    staged: "Three scripted runs on /api/runs (start + now line).",
    async setup({ page }) {
      await openChannel(page, GUILD);
    },
    async act({ page, d }) {
      const header = await d.box(page.getByText("4 agents", { exact: false }).first());
      d.mark("all idle", { x: header.x - 140, y: 30, w: header.w + 280, h: header.y + header.h - 10 });
      for (const [who, now] of [["sleuth-3snf", "Reading Discord's Creator Revenue FAQ"], ["swatch-be67", "Sketching the onboarding states"], ["sprocket-dmmy", "Costing presence fan-out at 100k users"]]) {
        await page.evaluate(([t, n]) => window.__stage.run(t, "", { now: n, done: false, delayMs: 0 }), [`a:${who}:p:${GUILD_PID}`, now]);
        await d.wait(650);
      }
      d.mark("3 working: keyboards out", { x: header.x - 140, y: 30, w: header.w + 280, h: header.y + header.h - 10 });
      await d.wait(1800);
    },
    tail: 400,
  },
  {
    id: "rive-status.profile",
    feature: "rive-status",
    title: "Agent profile: the big Rive mascot goes from idle to working, with its 'now' line",
    demonstrates: "Sleuth's profile header carries a large live mascot. When a task starts, the mascot animates into working, the status chip pops and the Now line says exactly what it's doing ('Reading Discord's Creator Revenue FAQ'). When the run ends it settles back.",
    suggestedUse: "Hero close-up for rive-status; crop to the mascot for a tight insert.",
    staged: "A scripted run on /api/runs.",
    async setup({ page }) {
      await openChannel(page, GUILD);
      await openTeamPanel(page);
      await page.getByRole("button", { name: "Sleuth's profile" }).last().click();
      await page.waitForTimeout(1600);
    },
    async act({ page, d }) {
      d.mark("idle");
      await page.evaluate((t) => window.__stage.run(t, "Ranked: creators running paid communities first.", { now: "Reading Discord's Creator Revenue FAQ", delayMs: 0, cps: 4 }), `a:sleuth-3snf:p:${GUILD_PID}`);
      await d.wait(400);
      d.mark("working: mascot + status chip + now line");
      await d.wait(2600);
    },
    focus: async () => ({ x: 980, y: 50, w: 440, h: 330 }),
    tail: 600,
  },

  // ───────────────────────────── reactive
  {
    id: "reactive.live-channel",
    feature: "reactive",
    title: "Live channel: three agents report at once, the PM answers",
    demonstrates: "An AI Slack that's alive: in #guildhall-concept the researcher, designer and engineer stream their reports at the same time, each with typing and a live status, then the PM accepts and redirects. Nobody refreshes anything.",
    suggestedUse: "The 'it's alive' beat; works full-frame or as the focus crop.",
    staged: "Four scripted runs on /api/runs.",
    async setup({ page }) {
      await openChannel(page, GUILD);
    },
    async act({ page, d }) {
      const T = (who) => `a:${who}:p:${GUILD_PID}`;
      d.mark("three reports start streaming");
      await Promise.all([
        page.evaluate(([t]) => window.__stage.run(t, "Three of the five creator communities I checked moved paid tiers off Discord this year. Ranked table with dated sources in segments.md.", { now: "Writing segments.md", cps: 55, delayMs: 200 }), [T("sleuth-3snf")]),
        page.evaluate(([t]) => window.__stage.run(t, "Onboarding is three states now: invite, pick your circles, first post. Empty and error states drawn for each.", { now: "Drawing onboarding states", cps: 50, delayMs: 700 }), [T("swatch-be67")]),
        page.evaluate(([t]) => window.__stage.run(t, "Hardest constraint is presence fan-out: ~2.4M updates a minute at 100k online. Batching into 5 s windows cuts it 12×.", { now: "Costing presence fan-out", cps: 52, delayMs: 1200 }), [T("sprocket-dmmy")]),
      ]);
      d.mark("PM accepts and redirects");
      await page.evaluate(([t]) => window.__stage.run(t, "Accepted Sleuth's ranking. Swatch, build the loop around creators first; Sprocket, cost the 5 s batching.", { cps: 60, delayMs: 300 }), [T("beacon-xpvp")]);
      await d.wait(600);
    },
    focus: async () => ({ x: 430, y: 300, w: 1010, h: 600 }),
    tail: 800,
  },

  // ───────────────────────────── pm-coordination (real plan, rev 27)
  {
    id: "pm.plan-graph",
    feature: "pm-coordination",
    title: "The PM's plan as a live graph: tasks pop in by dependency",
    demonstrates: "Open the Plan tab and the PM's task graph builds itself: each task (owner, status, dependencies) pops in in order, blocked edges dashed. This is the plan Beacon wrote and keeps updating as experts report.",
    suggestedUse: "PM-coordination beat; follow with pm.task-drawer.",
    staged: "None: the real plan of the Guildhall concept project.",
    async setup({ page }) {
      await openChannel(page, GUILD);
      await openTeamPanel(page);
    },
    async act({ page, d }) {
      await d.click(tab(page, "Plan"), { ms: 600, what: "open the Plan tab" });
      await d.wait(1200);
      d.mark("graph built", { x: 1030, y: 330, w: 400, h: 560 });
      await d.wait(700);
    },
    focus: async () => ({ x: 1030, y: 330, w: 400, h: 560 }),
  },
  {
    id: "pm.open-full-board",
    feature: "pm-coordination",
    title: "Open full: the plan widens, then flips from graph to board",
    demonstrates: "The plan opens full size (the pane widens with a spring), then the Graph/Board toggle glides and the same tasks regroup as a kanban board by status. The PM's coordination, two ways.",
    suggestedUse: "Motion-heavy transition shot.",
    staged: "None: real plan.",
    async setup({ page }) {
      await openChannel(page, GUILD);
      await openTeamPanel(page);
      await tab(page, "Plan").click();
      await page.waitForTimeout(1500);
    },
    async act({ page, d }) {
      await d.click(page.getByRole("button", { name: /open .*full|full size|Open full/i }).first(), { ms: 600, what: "open the plan full size" });
      await d.wait(1100);
      await d.click(page.getByRole("tab", { name: "Board", exact: true }).first(), { ms: 600, what: "flip to the board" });
      await d.wait(1300);
      d.mark("board view", { x: 440, y: 60, w: 1000, h: 830 });
    },
    focus: async () => ({ x: 430, y: 40, w: 1010, h: 860 }),
  },
  {
    id: "pm.task-drawer",
    feature: "pm-coordination",
    title: "A task's drawer: owner, acceptance criteria, the expert's report and evidence",
    demonstrates: "Click a task in the plan and its drawer slides up: who owns it, the acceptance bar the PM set, the expert's last report and the evidence file. The PM accepts work on evidence, not vibes.",
    suggestedUse: "Detail insert after pm.plan-graph.",
    staged: "None: real task t1 (Sleuth's ranking, in review).",
    async setup({ page }) {
      await openChannel(page, GUILD);
      await openTeamPanel(page);
      await tab(page, "Plan").click();
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: /open .*full|full size|Open full/i }).first().click();
      await page.waitForTimeout(1500);
    },
    async act({ page, d }) {
      await d.click(page.getByRole("button", { name: /^t1 / }).first(), { ms: 650, what: "open task t1" });
      await d.wait(1400);
      d.mark("drawer open: acceptance + report + evidence");
      await d.wait(800);
    },
    focus: async () => ({ x: 430, y: 40, w: 1010, h: 860 }),
  },
  {
    id: "pm.overview",
    feature: "pm-coordination",
    title: "Team overview: the PM strip fills with progress",
    demonstrates: "The team panel opens on the PM strip: the progress segments fill one by one, the waiting-on-you pill pops, and the context bar shows how much of the PM's memory window is in use.",
    suggestedUse: "Opening shot of the team panel.",
    staged: "None: real state.",
    async setup({ page }) {
      await openChannel(page, GUILD);
    },
    async act({ page, d }) {
      await d.click(page.getByRole("button", { name: "Team overview" }), { ms: 650, what: "open the team panel" });
      await d.wait(1600);
      d.mark("PM strip filled", { x: 1030, y: 380, w: 400, h: 260 });
    },
    focus: async () => ({ x: 1030, y: 44, w: 400, h: 600 }),
  },
  {
    id: "pm.decisions",
    feature: "pm-coordination",
    title: "Decisions log: every call the PM made, with its reason",
    demonstrates: "The Decisions tab lists what the PM decided and why, newest first, entries sliding in. A team that explains itself.",
    suggestedUse: "Quick insert.",
    staged: "None: real decisions.",
    async setup({ page }) {
      await openChannel(page, GUILD);
      await openTeamPanel(page);
    },
    async act({ page, d }) {
      await d.click(tab(page, "Decisions"), { ms: 600, what: "open Decisions" });
      await d.wait(1400);
      d.mark("decisions listed", { x: 1030, y: 380, w: 400, h: 500 });
    },
    focus: async () => ({ x: 1030, y: 300, w: 400, h: 590 }),
  },

  // ───────────────────────────── soul-memory (real vault history: 3 runs of learning)
  {
    id: "soul-memory.history",
    feature: "soul-memory",
    title: "Versioned memory: open Wren's MEMORY.md history and read what she learned",
    demonstrates: "Wren's Soul and memory tab shows her SOUL.md and MEMORY.md as cards. Opening MEMORY.md's history slides in a git-backed timeline: one commit per project run. Expanding one shows the diff of what she learned (e.g. no hype words, tag every number). Agents get better, and every change is reviewable and restorable.",
    suggestedUse: "The soul-memory beat; cut on 'diff expanded'.",
    staged: "None: real vault commits from three Bookbird runs.",
    async setup({ page }) {
      await openChannel(page, CHANNEL);
      await bubble(page, "Redone: hero is now", 0.4);
      await page.getByRole("button", { name: "Wren's profile" }).first().click();
      await page.waitForTimeout(1500);
    },
    async act({ page, d }) {
      await d.click(tab(page, "Soul and memory"), { ms: 600, what: "open Soul and memory" });
      await d.wait(900);
      d.mark("SOUL.md + MEMORY.md cards");
      await d.click(page.getByRole("button", { name: "History of MEMORY.md" }).first(), { ms: 600, what: "open MEMORY.md history" });
      await d.wait(1000);
      d.mark("history timeline: one commit per run");
      await d.click(page.getByRole("dialog").locator("button[aria-expanded]").nth(1), { ms: 550, what: "expand a commit" });
      await d.wait(1500);
      d.mark("diff expanded: what she learned");
    },
    focus: async () => ({ x: 760, y: 40, w: 680, h: 860 }),
  },

  // ───────────────────────────── staffing
  {
    id: "staffing.skills-library",
    feature: "staffing",
    title: "Skills library: filter by archetype, the skills each kind of agent can be staffed with",
    demonstrates: "The Skills library groups every installed skill by archetype. Clicking Researcher, Designer, Engineer glides the highlight and re-sorts the results. This is the pool the PM and Mira staff teams from.",
    suggestedUse: "Staffing beat, before the option cards.",
    async setup({ page }) {
      await page.getByRole("button", { name: "Skills", exact: true }).first().click();
      await page.waitForTimeout(1800);
    },
    async act({ page, d }) {
      const group = page.getByRole("group", { name: "Archetype" });
      for (const a of ["Researcher", "Designer", "Engineer"]) {
        await d.click(group.getByRole("button", { name: new RegExp(a, "i") }).first(), { ms: 450, what: `filter: ${a}` });
        await d.wait(700);
      }
      d.mark("engineer skills listed");
    },
  },

  // ───────────────────────────── team-choice (Mira, staged realistic numbers)
  {
    id: "team-choice.proposal",
    feature: "team-choice",
    title: "Ask Mira for a build, get three staffed team options with realistic cost and time",
    demonstrates: "You ask Mira (the CEO agent) to build a Discord competitor for creators. She answers in one sentence and the option cards land: Lean (one engineer, $180, 14 days), Balanced (PM + 3 experts, $640, 30 days), Full (PM + 3 experts incl. iOS, $980, 42 days). Each card is staffed with real agents, their skills and rehire badges. You pick Balanced (the ring glides) and launch.",
    suggestedUse: "The team-choice beat; the poster is the three cards.",
    staged: "Mira's reply (sentence + proposal JSON) is scripted with realistic budgets; staffing on the cards is the app's real /api/projects/plan; launch is stubbed (no project is created).",
    async routes(page) {
      // A clean DM, so the ask is the first thing on screen.
      await page.route((u) => u.pathname === "/api/projects/dm/messages", (r) => (r.request().method() === "GET" ? r.fulfill({ json: { messages: [], more: false } }) : r.fallback()));
    },
    async setup({ page }) {
      await page.locator("aside").getByText("Mira", { exact: true }).first().click();
      await page.waitForTimeout(1500);
      await rule(page, { kind: "json", url: "/api/threads/a%3Amira", method: "POST", body: { delivered: "run", runId: "mira-guild" }, once: true });
    },
    async act({ page, d }) {
      const box = page.getByPlaceholder("Send a message");
      await d.click(box, { ms: 600, what: "click the composer" });
      await box.pressSequentially("Build us a Discord competitor for paid creator communities. Real product, web first.", { delay: 22 / d.rate, timeout: 0 });
      await d.wait(250);
      d.mark("send the ask");
      await page.keyboard.press("Enter");
      await d.wait(500);
      const text = `${MIRA_SENTENCE}\n\n\`\`\`project\n${JSON.stringify(GUILD_PROPOSAL)}\n\`\`\``;
      await page.evaluate(([t]) => window.__stage.run("a:mira:p:dm", t, { run: "mira-guild", cps: 260, delayMs: 300 }), [text]);
      await d.wait(2600);
      d.mark("option cards staffed", await d.box(page.getByText("Balanced", { exact: true }).first()).catch(() => undefined));
      await d.hover(page.getByText("Lean", { exact: true }).first(), { ms: 500 });
      await d.wait(300);
      await d.hover(page.getByText("Full", { exact: true }).first(), { ms: 500 });
      await d.wait(300);
      await d.click(page.getByText("Balanced", { exact: true }).first(), { ms: 500, what: "pick Balanced" });
      await d.wait(900);
    },
    focus: async () => ({ x: 430, y: 200, w: 1010, h: 700 }),
    tail: 600,
  },
];
