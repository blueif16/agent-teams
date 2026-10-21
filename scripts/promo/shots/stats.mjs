// Stats shots (feature "stats"): the numbers, clearly, animating in.
// Helpers and staging live in common.mjs; the entry shape is documented in ../shots.mjs.
import { GUILD, GUILD_PID, openChannel, openTeamPanel, tab, rule } from "./common.mjs";

const scrollTo = (loc, block = "start") => loc.evaluate((n, b) => n.scrollIntoView({ block: b, behavior: "smooth" }), block);

export const EFFECTS = [
  {
    id: "stats.team-performance",
    feature: "stats",
    title: "Team Performance: spend, tokens, cache hit, per-agent bars grow in, chart or table",
    demonstrates: "Open a team's Performance tab and the real numbers animate in: KPI tiles pop (a whole project cost about 26 cents, 83% cache hit, 100% accepted), then the panel scrolls to tokens-by-agent bars growing, and a click flips the chart to a table. Live, clear stats from the real ledger.",
    suggestedUse: "Stats beat; the poster is a clean still of the tiles. Cut on 'KPI tiles pop' then 'charts grow'.",
    staged: "None: real ledger data for the Guildhall concept project (shown as #guildhall-concept).",
    async setup({ page }) {
      await openChannel(page, GUILD);
      await openTeamPanel(page);
    },
    async act({ page, d }) {
      await d.click(tab(page, "Performance"), { ms: 600, what: "open the Performance tab" });
      await d.wait(500);
      d.mark("KPI tiles pop: $0.26, 83% cache, 100% accepted", await d.box(page.getByText("Cache hit", { exact: true }).last().locator("xpath=ancestor::div[3]")).catch(() => undefined) ?? { x: 950, y: 500, w: 470, h: 210 });
      await d.wait(1600);
      const bars = page.getByText(/^Tokens by agent/).last();
      await bars.waitFor({ timeout: 60000 });
      await scrollTo(bars);
      await d.wait(600);
      d.mark("tokens by agent bars", await d.box(bars.locator("xpath=..")).catch(() => undefined) ?? { x: 950, y: 200, w: 470, h: 320 });
      await d.wait(900);
      await d.click(page.getByRole("button", { name: "Show as table" }).first(), { ms: 500, what: "show the chart as a table" });
      await d.wait(1400);
      d.mark("same numbers as a table", await d.box(page.getByRole("table").first()).catch(() => undefined));
      await d.wait(900);
    },
    focus: async () => ({ x: 940, y: 120, w: 500, h: 780 }),
    tail: 600,
  },
  {
    id: "stats.agent-performance",
    feature: "stats",
    title: "Agent Performance: tokens per call bars grow, tiles pop, models and orders listed",
    demonstrates: "Open Beacon's profile and its Performance tab: spend, tokens, cache hit and reply-time tiles pop, then the tokens-per-call stacked bars grow call by call. Each agent's cost and speed are one tab away.",
    suggestedUse: "Stats beat, per-agent. Pair with the team Performance shot.",
    staged: "None: real ledger data for Beacon on the Guildhall concept project.",
    async setup({ page }) {
      await openChannel(page, GUILD);
      await page.getByRole("button", { name: "Beacon's profile" }).first().click();
      await page.waitForTimeout(1500);
    },
    async act({ page, d }) {
      await d.click(tab(page, "Performance"), { ms: 600, what: "open the agent's Performance tab" });
      await d.wait(500);
      d.mark("agent KPI tiles pop", await d.box(page.getByText("Cache hit", { exact: true }).last().locator("xpath=ancestor::div[3]")).catch(() => undefined) ?? { x: 950, y: 500, w: 470, h: 210 });
      await d.wait(1600);
      const chart = page.getByText(/^Tokens per call/).last();
      await scrollTo(chart);
      await d.wait(600);
      d.mark("tokens-per-call bars grow", await d.box(chart.locator("xpath=..")).catch(() => undefined) ?? { x: 950, y: 200, w: 470, h: 320 });
      await d.wait(1600);
      await d.hover(page.getByText("Your orders", { exact: true }).last(), { ms: 500 });
      await d.wait(700);
    },
    focus: async () => ({ x: 940, y: 120, w: 500, h: 780 }),
    tail: 600,
  },
  {
    id: "stats.mira-chart",
    feature: "stats",
    title: "Ask Mira which team is performing best: one sentence, then a chart card grows in",
    demonstrates: "In her DM you ask 'Which team is performing best?'. Mira answers in one sentence and a bar chart card of real per-team ledger spend grows in below it, with the cheapest, best-accepted team highlighted. Cross-team answers are numbers you can see, not paragraphs.",
    suggestedUse: "Stats beat, the Mira answer. Cut on 'chart card grows in'.",
    staged: "Mira's reply (sentence + chart JSON) is scripted; the figures are the real ledger totals per project (Guildhall $0.26, Chronoshield hardware $0.26, Checkout $0.12). The chart card itself is the app's real renderer.",
    async routes(page) {
      await page.route((u) => u.pathname === "/api/projects/dm/messages", (r) => (r.request().method() === "GET" ? r.fulfill({ json: { messages: [], more: false } }) : r.fallback()));
    },
    async setup({ page }) {
      await page.locator("aside").getByText("Mira", { exact: true }).first().click();
      await page.waitForTimeout(1500);
      await rule(page, { kind: "json", url: "/api/threads/a%3Amira", method: "POST", body: { delivered: "run", runId: "mira-stats" }, once: true });
    },
    async act({ page, d }) {
      const box = page.getByPlaceholder("Send a message");
      await d.click(box, { ms: 600, what: "click the composer" });
      await box.pressSequentially("Which team is performing best?", { delay: 30 / d.rate, timeout: 0 });
      await d.wait(250);
      d.mark("send the question");
      await page.keyboard.press("Enter");
      await d.wait(500);
      const spec = { type: "bar", title: "Cost per team", subtitle: "Spend so far, from the ledger", x: ["#checkout-reliability", "#guildhall-concept", "#chronoshield-hardware"], series: [{ name: "Spend", values: [0.12, 0.26, 0.26] }], unit: "$", highlight: "#checkout-reliability" };
      const text = `Checkout-reliability is the most efficient: 82 calls for $0.12, while Guildhall and Chronoshield hardware each cost $0.26 at 83% and 91% cache hit.\n\n\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\``;
      await page.evaluate(([t]) => window.__stage.run("a:mira:p:dm", t, { run: "mira-stats", cps: 240, delayMs: 300 }), [text]);
      await d.wait(1800);
      const card = page.getByText("Cost per team", { exact: true }).last();
      await card.waitFor({ timeout: 60000 }).catch(() => {});
      d.mark("chart card grows in", await d.box(card.locator("xpath=ancestor::div[3]")).catch(() => undefined));
      await d.wait(2200);
      await d.click(tab(page, "Table"), { ms: 500, what: "toggle chart to table" });
      await d.wait(1200);
    },
    focus: async () => ({ x: 430, y: 150, w: 1010, h: 750 }),
    tail: 600,
  },
];
