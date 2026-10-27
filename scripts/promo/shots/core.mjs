// Reactions, Rive status, live channel, PM coordination, staffing, team choice, artifacts.
// Helpers and staging live in common.mjs; the entry shape is documented in ../shots.mjs.
import { TEXT } from "../org.mjs";
import { CHANNEL, GUILD, GUILD_PID, GUILD_PROPOSAL, MIRA_SENTENCE, openChannel, bubble, menuButton, order, reply, openTeamPanel, tab, rule, scrollToBottom } from "./common.mjs";

// The plan moving: each step is what the PM and experts change (task id → status), applied cumulatively to the real
// plan of the Guildhall concept project. Progress and milestone counts are recomputed from the tasks.
const PLAN_STEPS = [
  { tasks: [["t1", "done"], ["t4", "in_progress"], ["t7", "in_progress"]], runs: [["sleuth-3snf", "Writing the differentiation thesis"], ["beacon-xpvp", "Drafting the monetization model"]], what: "PM accepts Sleuth's ranking: t1 done, thesis + monetization start" },
  { tasks: [["t2", "done"], ["t6", "in_progress"]], runs: [["sprocket-dmmy", "Costing the launch scope"]], what: "Sprocket's cost envelope accepted: t2 done, t6 starts" },
  { tasks: [["t5", "review"]], runs: [], done: ["swatch-be67"], what: "Swatch hands in the core loop for review" },
  { tasks: [["t5", "done"], ["t4", "review"]], runs: [], done: ["sleuth-3snf"], what: "Core loop accepted; thesis in review" },
  { tasks: [["t4", "done"], ["t6", "done"], ["t7", "done"], ["t8", "in_progress"]], runs: [["beacon-xpvp", "Assembling the build-decision brief"]], done: ["sprocket-dmmy"], what: "Everything accepted; the PM assembles the brief" },
];

function planAtStep(state, step) {
  const s = structuredClone(state);
  for (const st of PLAN_STEPS.slice(0, step)) for (const [id, status] of st.tasks) {
    const t = s.plan.tasks.find((x) => x.id === id);
    if (t) t.status = status;
  }
  const ts = s.plan.tasks, n = (st) => ts.filter((t) => t.status === st).length;
  s.plan.progress = { done: n("done"), total: ts.length, blocked: n("blocked"), review: n("review"), inProgress: n("in_progress") };
  s.plan.milestones = s.plan.milestones.map((m) => {
    const mt = ts.filter((t) => t.milestone === m.id), done = mt.filter((t) => t.status === "done").length;
    return { ...m, done, total: mt.length || m.total, status: mt.length && done === mt.length ? "done" : done ? "in_progress" : m.status };
  });
  if (s.pm?.progress) s.pm.progress = { ...s.pm.progress, done: n("done"), total: ts.length, blocked: n("blocked") };
  s.rev = (s.rev ?? 0) + step;
  return s;
}

export const EFFECTS = [
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
      await page.evaluate(() => window.__stage.run("a:ravi:p:bookbird-run-1", "", { run: "ravi-busy", now: "Reading Cliniko's pricing page", done: false, delayMs: 0 }));
      await page.waitForTimeout(1200);
      await reply(page, "Holding. I'll wait for your go before touching the pricing pages.");
    },
    async act({ page, d }) {
      await order(page, d, { text: "I looked at 7 pages", label: "Hold" });
      // The busy run ends when he holds, so the status and his Rive mascot settle to idle.
      await page.evaluate(() => window.__stage.emit("/api/runs", "done", { type: "done", thread: "a:ravi:p:bookbird-run-1", run: "ravi-busy", text: "" }));
      await d.wait(500);
      d.mark("Ravi goes idle: status chip + Rive mascot", { x: 950, y: 110, w: 470, h: 330 });
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
  {
    id: "reactive.live-channel",
    feature: "reactive",
    title: "Live channel: three agents report at once, the PM answers",
    demonstrates: "An AI Slack that's alive: in #guildhall-concept the researcher, designer and engineer stream their reports at the same time, each with a live status, then the PM accepts and redirects. Nobody refreshes anything.",
    suggestedUse: "The 'it's alive' beat; smart.mp4 follows each report as it lands.",
    staged: "Four scripted runs on /api/runs.",
    async setup({ page }) {
      await openChannel(page, GUILD);
      await scrollToBottom(page);
    },
    async act({ page, d }) {
      const T = (who) => `a:${who}:p:${GUILD_PID}`;
      const run = (who, text, o) => page.evaluate(([t, x, o]) => window.__stage.run(t, x, o), [T(who), text, o]);
      const reports = [
        ["sleuth-3snf", "Three of the five creator communities I checked moved paid tiers off Discord this year. Ranked table with dated sources in segments.md.", { now: "Writing segments.md", cps: 55, delayMs: 200 }, "Three of the five creator"],
        ["swatch-be67", "Onboarding is three states now: invite, pick your circles, first post. Empty and error states drawn for each.", { now: "Drawing onboarding states", cps: 50, delayMs: 900 }, "Onboarding is three states"],
        ["sprocket-dmmy", "Hardest constraint is presence fan-out: ~2.4M updates a minute at 100k online. Batching into 5 s windows cuts it 12×.", { now: "Costing presence fan-out", cps: 52, delayMs: 1700 }, "Hardest constraint is presence"],
      ];
      const done = reports.map(([who, text, o]) => run(who, text, o));
      for (const [, , o, start] of reports) {
        await d.wait(o.delayMs === 200 ? 700 : 800);
        await scrollToBottom(page);
        const el = page.getByText(start, { exact: false }).last();
        d.mark(`report streaming: ${start}…`, await d.box(el));
      }
      await Promise.all(done);
      await scrollToBottom(page);
      await run("beacon-xpvp", "Accepted Sleuth's ranking. Swatch, build the loop around creators first; Sprocket, cost the 5 s batching.", { cps: 60, delayMs: 300 });
      await scrollToBottom(page);
      d.mark("PM accepts and redirects", await d.box(page.getByText("Accepted Sleuth's ranking", { exact: false }).last()));
      await d.wait(600);
    },
    tail: 800,
  },

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
      d.mark("the ask, typed", await d.box(box));
      await d.wait(250);
      await page.keyboard.press("Enter");
      await d.wait(450);
      d.mark("the ask lands in Mira's DM", await d.box(page.getByText("Build us a Discord competitor", { exact: false }).last()));
      await d.move(980, 420, 500); // off the composer, so the camera can follow the reply up
      // Mira's sentence streams at reading speed; the proposal JSON (hidden while streaming) lands in one burst.
      await page.evaluate((t) => window.__stage.run("a:mira:p:dm", t, { run: "mira-guild", cps: 70, delayMs: 200, done: false }), MIRA_SENTENCE);
      await d.wait((MIRA_SENTENCE.length / 70) * 1000 + 500);
      d.mark("Mira's one-line pick", await d.box(page.getByText("This is a build, not a concept", { exact: false }).last()));
      const fence = `\n\n\`\`\`project\n${JSON.stringify(GUILD_PROPOSAL)}\n\`\`\``;
      await page.evaluate((f) => {
        window.__stage.emit("/api/runs", "token", { type: "token", thread: "a:mira:p:dm", run: "mira-guild", text: f });
        window.__stage.emit("/api/runs", "done", { type: "done", thread: "a:mira:p:dm", run: "mira-guild" });
      }, fence);
      // Cards appear once the app's real /api/projects/plan staffs them; wait for them, then let the entrance settle.
      await page.getByRole("button", { name: /^Pick/ }).first().waitFor();
      await d.wait(900);
      // A card is ~296×540 px from its label's top-left.
      const label = (t) => page.getByText(t, { exact: true }).first();
      const cardOf = (b) => ({ x: b.x - 24, y: b.y - 22, w: 296, h: 540 });
      const lean = cardOf(await d.box(label("Lean"))), balanced = cardOf(await d.box(label("Balanced")));
      d.mark("three staffed options with cost + time", { x: lean.x, y: lean.y, w: balanced.x + balanced.w * 1.5 - lean.x, h: lean.h });
      await d.hover(label("Lean"), { ms: 500 });
      await d.wait(350);
      await d.click(label("Balanced"), { ms: 600, what: "pick Balanced" });
      await d.wait(700);
      d.mark("Balanced picked, Launch ready", balanced);
      await d.wait(500);
    },
    focus: async () => ({ x: 430, y: 200, w: 1010, h: 700 }),
    tail: 600,
  },
  {
    id: "artifacts.designer-canvas",
    feature: "artifacts",
    title: "Designer: click mockup.html and it opens on a canvas, desktop and phone side by side",
    demonstrates: "Pia (designer) hands back her work as a file in chat. Clicking it slides open her pane as a design canvas: the real mockup.html rendered as a desktop artboard and a phone artboard, then her cursor selects the phone view. Each archetype presents work in its own native form.",
    suggestedUse: "Artifacts beat, designer. Cut on 'canvas open'.",
    staged: "The canvas viewer is staged for capture (not in the app); the mockup is the team's real mockup.html (run 3).",
    viewer: ["designer"],
    async setup({ page }) {
      await openChannel(page, CHANNEL);
      await bubble(page, "It didn't stack well", 0.5);
    },
    async act({ page, d }) {
      await d.click(page.getByText("mockup.html", { exact: true }).filter({ visible: true }).last(), { ms: 650, what: "click mockup.html" });
      await d.wait(900);
      d.mark("canvas open: desktop + phone artboards", { x: 936, y: 44, w: 494, h: 846 });
      await d.wait(1900);
      d.mark("Pia's cursor selects the phone artboard");
      await d.wait(600);
    },
    focus: async () => ({ x: 600, y: 44, w: 830, h: 846 }),
  },
  {
    id: "artifacts.researcher-table",
    feature: "artifacts",
    title: "Researcher: teardown.csv opens as a table with the gap called out",
    demonstrates: "Ravi (researcher) delivers a competitor teardown. Clicking teardown.csv opens it as a clean table: rows slide in, the 'leads with' and 'small-clinic angle' chips pop, and the gap the team will exploit is called out underneath.",
    suggestedUse: "Artifacts beat, researcher.",
    staged: "The table viewer is staged; the data is the team's real teardown.csv.",
    viewer: ["researcher"],
    async setup({ page }) {
      await openChannel(page, CHANNEL);
      await bubble(page, "I looked at 7 pages", 0.5);
    },
    async act({ page, d }) {
      await d.click(page.getByText("teardown.csv", { exact: true }).filter({ visible: true }).last(), { ms: 650, what: "click teardown.csv" });
      await d.wait(1500);
      d.mark("table open: rows + chips + gap", { x: 936, y: 44, w: 494, h: 600 });
      await d.wait(900);
    },
    focus: async () => ({ x: 600, y: 44, w: 830, h: 846 }),
  },
  {
    id: "artifacts.writer-doc",
    feature: "artifacts",
    title: "Writer: copy.md opens as a document, every number tagged to its fact",
    demonstrates: "Wren (writer) delivers the landing copy. Clicking copy.md opens a rendered document; sections fade in and each fact tag ([F1], [F3]…) pops, showing every claim is traceable to the client's facts.",
    suggestedUse: "Artifacts beat, writer.",
    staged: "The document viewer is staged; the copy is the team's real copy.md (run 3).",
    viewer: ["writer"],
    async setup({ page }) {
      await openChannel(page, CHANNEL);
      await bubble(page, "Redone: hero is now", 0.5);
    },
    async act({ page, d }) {
      await d.click(page.getByText("copy.md", { exact: true }).filter({ visible: true }).last(), { ms: 650, what: "click copy.md" });
      await d.wait(1700);
      d.mark("document open: fact tags popped", { x: 936, y: 44, w: 494, h: 700 });
      await d.wait(800);
    },
    focus: async () => ({ x: 600, y: 44, w: 830, h: 846 }),
  },
  {
    id: "artifacts.analyst-chart",
    feature: "artifacts",
    title: "Analyst: the cost memo opens as a chart with the line the price has to clear",
    demonstrates: "Tally (analyst) posts the cost memo. Clicking it opens a chart: wholesale per unit at 30/40/50% retailer margin grows in, with the $239 landed-cost ceiling drawn across. Numbers become a decision.",
    suggestedUse: "Artifacts beat, analyst.",
    staged: "Tally's message and the chart viewer are staged; the numbers come from the team's real cost-and-margin memo.",
    viewer: ["analyst"],
    async setup({ page }) {
      await openChannel(page, "chronoshield-us-launch");
      await page.evaluate((t) => window.__stage.run(t, "Cost memo is in: at a 40% retail margin we get $239 a watch, so landed cost has to come in under that. 📎 [cost-and-margin-memo.md](/artifacts/memo)", { cps: 400, delayMs: 0 }), "a:tally-78gz:p:p_a02256fa71429065");
      await page.waitForTimeout(1800);
    },
    async act({ page, d }) {
      await d.click(page.getByText("cost-and-margin-memo.md", { exact: true }).filter({ visible: true }).last(), { ms: 650, what: "click the cost memo" });
      await d.wait(1500);
      d.mark("chart grown with the $239 ceiling", { x: 936, y: 44, w: 494, h: 520 });
      await d.wait(900);
    },
    focus: async () => ({ x: 600, y: 44, w: 830, h: 846 }),
  },
  {
    id: "artifacts.engineer-tests",
    feature: "artifacts",
    title: "Engineer: the test log replays from 14 failing to 26 passing",
    demonstrates: "Gizmo (engineer) reports the fix. Clicking test-run.log opens a terminal that replays the run: the baseline's red Fs, a diff touching only merchant/ (tests byte-identical), then a full green bar and '26 passed'. Engineers show proof, not claims.",
    suggestedUse: "Artifacts beat, engineer; strong end-of-sequence payoff.",
    staged: "Gizmo's message and the terminal replay are staged; the 12/14 → 26 numbers match the team's real benchmark plan.",
    viewer: ["engineer"],
    async setup({ page }) {
      await openChannel(page, "checkout-reliability");
      await page.evaluate((t) => window.__stage.run(t, "All 26 tests green, tests/ untouched, no public API changes. 📎 [test-run.log](/artifacts/log)", { cps: 400, delayMs: 0 }), "a:gizmo-tvb7:p:p_4de7ac093d23578d");
      await page.waitForTimeout(1800);
    },
    async act({ page, d }) {
      await d.click(page.getByText("test-run.log", { exact: true }).filter({ visible: true }).last(), { ms: 650, what: "click test-run.log" });
      await d.wait(4200);
      d.mark("26 passed", { x: 936, y: 44, w: 494, h: 500 });
      await d.wait(800);
    },
    focus: async () => ({ x: 600, y: 44, w: 830, h: 846 }),
  },

  {
    id: "pm.plan-live",
    feature: "pm-coordination",
    title: "The PM's plan, expanded, moving live as each agent reports",
    demonstrates: "Open the Plan tab and expand it: the PM's task graph (a DAG of who does what, in what order) fills the screen. Then the project moves on its own: the PM accepts Sleuth's ranking and the thesis unblocks, Sprocket's cost work is accepted, Swatch's core loop goes to review and is accepted, and the PM starts assembling the final brief. Each task's status ring changes as it happens, progress and milestones count up, and the owners' mascots in the channel header switch to working. Ends on the Board view with the work in its columns.",
    suggestedUse: "The PM-coordination hero. smart.mp4 hops to each task as it changes; slowmo works for the status flips.",
    staged: "The plan is the real Guildhall concept plan (rev 27); its status changes are staged step by step (served state + the app's own state:<pid> refresh event), and the agents' work is scripted runs.",
    stage: { streams: ["/api/runs", "/api/events"] },
    async routes(page) {
      page.__planStep = 0;
      let real = null;
      await page.route((u) => u.pathname === `/api/projects/${GUILD_PID}/state`, async (route) => {
        if (!real) {
          const res = await route.fetch();
          real = JSON.parse(TEXT.reduce((acc, [a, b]) => acc.split(a).join(b), await res.text()));
        }
        await route.fulfill({ json: planAtStep(real, page.__planStep) });
      });
    },
    async setup({ page }) {
      await openChannel(page, GUILD);
      await openTeamPanel(page);
    },
    async act({ page, d }) {
      await d.click(tab(page, "Plan"), { ms: 550, what: "open the Plan tab" });
      await d.wait(700);
      await d.click(page.getByRole("button", { name: /open .*full|full size|Open full/i }).first(), { ms: 550, what: "expand the plan" });
      await d.wait(1100);
      const graph = await d.box(page.locator(".react-flow").last());
      d.mark("the expanded DAG: who does what, in what order", graph);
      await d.wait(700);
      for (const [i, st] of PLAN_STEPS.entries()) {
        page.__planStep = i + 1;
        for (const [who, now] of st.runs) await page.evaluate(([t, n]) => window.__stage.run(t, "", { run: `plan-${t}`, now: n, done: false, delayMs: 0 }), [`a:${who}:p:${GUILD_PID}`, now]);
        for (const who of st.done ?? []) await page.evaluate((t) => window.__stage.emit("/api/runs", "done", { type: "done", thread: t, run: `plan-${t}`, text: "" }), `a:${who}:p:${GUILD_PID}`);
        await page.evaluate((pid) => window.__stage.emit("/api/events", "message", { topic: `state:${pid}` }), GUILD_PID);
        await d.wait(350);
        const boxes = [];
        for (const [id] of st.tasks) {
          const b = await page.locator(`[aria-label^="${id} "]`).first().boundingBox();
          if (b) boxes.push({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) });
        }
        const u = boxes.length ? { x: Math.min(...boxes.map((b) => b.x)), y: Math.min(...boxes.map((b) => b.y)) } : null;
        d.mark(st.what, u ? { ...u, w: Math.max(...boxes.map((b) => b.x + b.w)) - u.x, h: Math.max(...boxes.map((b) => b.y + b.h)) - u.y } : graph);
        await d.wait(1250);
      }
      d.mark("7 of 8 done, the PM on the brief", graph);
      await d.wait(600);
      await d.click(page.getByRole("tab", { name: "Board", exact: true }).first(), { ms: 600, what: "flip to the Board" });
      await d.wait(1200);
      d.mark("the same work, by column", await d.box(page.locator("main, body").locator("text=Done").first()).catch(() => graph));
    },
    tail: 600,
  },
];
