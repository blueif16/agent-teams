// Auto permission system shots (feature "permissions").
// Helpers and staging live in common.mjs; the entry shape is documented in ../shots.mjs.
import { GUILD, GUILD_PID, openChannel, openTeamPanel, tab, rule, scrollToBottom } from "./common.mjs";
import { policyCard, grantButton } from "../permissions-stage.mjs";

const SLEUTH = "sleuth-3snf";
const SENTENCE = "Sleuth can search the web freely, but ask me before spending more than $2 on research, and never email anyone outside acme.com";
const QUESTION = "Should the $2 limit reset every run or every day?";

const base = (id, kind, extra) => ({ id, kind, scope: { agents: [SLEUTH] }, mode: "enforce", createdBy: "nl-compiler", source: { nl: SENTENCE }, ...extra });
const webRule = (id) => base(id, "tool", { match: { tools: ["web_search"] }, effect: "allow", reason: "Search the web freely" });
const budgetRule = (id, per) => base(id, "budget", { metric: "cost_usd", limit: { amount: 2, per }, onExceed: "ask", reason: "Ask before spending more than $2 on research" });
const mailRule = (id) => base(id, "tool", { match: { tools: ["send_email"] }, effect: "deny", args: [{ path: "to[*]", op: "domain_not_in", value: ["acme.com"] }], reason: "Never email outside acme.com" });

const readBacks = (per) => [
  "Sleuth can search the web without asking.",
  `Sleuth can spend at most $2 per ${per}, then ask you.`,
  "Sleuth can't send email when any recipient is outside acme.com.",
];
const conflicts = (rid) => [{ kind: "tightens", ruleId: rid, otherRuleId: "r_mail01", note: "Email was Ask for every recipient; outside acme.com it is now a hard stop." }];

const compile = (per, rids) => ({
  rules: [webRule(rids[0]), budgetRule(rids[1], per), mailRule(rids[2])],
  readBack: readBacks(per),
  assumptions: ["Research means the web research tool", "acme.com includes its subdomains"],
  questions: per === "run" ? [{ q: QUESTION, options: ["Every run", "Every day", "Per project"] }] : [],
  conflicts: conflicts(rids[2]),
  dryRun: { total: 214, block: 1, ask: 3, redact: 0, allow: 210 },
});

async function openPermissions(page) {
  await openChannel(page, GUILD);
  await openTeamPanel(page);
  await page.getByRole("button", { name: "Sleuth's profile" }).last().click();
  await page.waitForTimeout(1600);
}

export const EFFECTS = [
  {
    id: "permissions.plain-words",
    feature: "permissions",
    title: "One sentence becomes enforced permissions",
    demonstrates: "The owner types a single plain-English sentence into Sleuth's Permissions tab. It turns into three specific rules, each read back in a fixed plain sentence (never written by a model), with one multiple-choice question, a note that it tightens the existing email rule, and a dry run over the last 214 calls. One click on Save and the rules sit in 'Your rules'. What you said is exactly what is enforced.",
    suggestedUse: "The hero of the permissions story: open on the sentence, cut on the proposal card, end on the saved rows.",
    staged: "The compile and save responses (POST /api/rules/compile and /api/rules) are scripted JSON in the real CompileResult shape, including the 214-call dry run; nothing is written. The agent panel, capability list and the existing email rule are the live app.",
    async setup({ page }) {
      await openPermissions(page);
      await tab(page, "Permissions").click();
      await page.waitForTimeout(1400);
      // The answered recompile first (more specific body), then the first compile; one-shot each.
      await rule(page, { kind: "json", url: "/api/rules/compile", method: "POST", bodyIncludes: "every day", body: compile("day", ["r_web7k2", "r_bud3m9", "r_mail8x4"]), delayMs: 900, once: true });
      await rule(page, { kind: "json", url: "/api/rules/compile", method: "POST", body: compile("run", ["r_web7k2", "r_bud3m9", "r_mail8x4"]), delayMs: 1100, once: true });
      await rule(page, { kind: "json", url: "/api/rules", method: "POST", body: { rules: compile("day", ["r_web7k2", "r_bud3m9", "r_mail8x4"]).rules }, delayMs: 600, once: true });
    },
    async act({ page, d }) {
      const box = page.getByRole("textbox", { name: "Change a permission" });
      await d.click(box, { ms: 600, what: "click the permission box" });
      await d.wait(200);
      for (const word of SENTENCE.match(/\S+\s*/g)) {
        await page.keyboard.type(word, { delay: 0 });
        await d.wait(word.length * 26);
      }
      await d.wait(300);
      d.mark("the owner's sentence", await d.box(box));
      await d.click(page.getByRole("button", { name: "Turn into a rule" }), { ms: 500, what: "turn it into rules" });
      const head = page.getByRole("heading", { name: "Proposed rules" });
      await head.waitFor({ timeout: 20000 });
      await d.wait(900);
      const card = head.locator("xpath=../..");
      d.mark("proposal card: three rules, plain-English read-backs", await d.box(card.locator("ul").first()));
      await d.wait(1400);
      const q = page.getByText(QUESTION);
      d.mark("one question to settle", await d.box(q.locator("xpath=..")));
      await d.wait(600);
      await d.click(page.getByRole("button", { name: "Every day", exact: true }), { ms: 600, what: "answer: every day" });
      await page.getByText("per day, then ask you").waitFor({ timeout: 20000 });
      await d.wait(900);
      d.mark("conflict note and dry run", await d.box(page.getByText("Tightens").locator("xpath=../..")));
      await d.wait(900);
      const dry = page.getByText("Last 214 calls").locator("xpath=..");
      await page.getByRole("button", { name: "Save", exact: true }).scrollIntoViewIfNeeded();
      await d.wait(500);
      d.mark("dry run: 214 calls replayed", await d.box(dry));
      await d.wait(1200);
      await d.click(page.getByRole("button", { name: "Save", exact: true }), { ms: 600, what: "Save" });
      const mine = page.getByRole("heading", { name: "Your rules" });
      await mine.waitFor({ timeout: 20000 });
      await d.wait(1600);
      d.mark("saved: three rules in Your rules", await d.box(mine.locator("xpath=..")));
      await d.wait(1200);
    },
    tail: 600,
  },
  {
    id: "permissions.capabilities",
    feature: "permissions",
    title: "What an agent can do: free, asks you, or never",
    demonstrates: "Sleuth's Permissions tab lists every capability with one of three plain states: Allowed, Asks you, or Never (blocked). Reading and searching are free, email, posts and spending ask first, and running code is blocked outright. The owner sees the whole boundary at a glance, not a config file.",
    suggestedUse: "Establishing shot before plain-words, or the closing 'here is the result' beat.",
    staged: "Nothing: this is the live Permissions tab for Sleuth with the app's real default rules.",
    async setup({ page }) {
      await openPermissions(page);
    },
    async act({ page, d }) {
      await d.click(tab(page, "Permissions"), { ms: 600, what: "open the Permissions tab" });
      const sec = page.getByRole("heading", { name: "Sleuth can" });
      await sec.waitFor();
      await d.wait(900);
      d.mark("what Sleuth can do freely", await d.box(sec.locator("xpath=..")));
      await d.wait(1300);
      const moreBtn = page.getByRole("button", { name: /more Sleuth doesn't have/ });
      await moreBtn.scrollIntoViewIfNeeded();
      await d.wait(700);
      await d.click(moreBtn, { ms: 600, what: "open the rest" });
      await page.getByText("Send email", { exact: true }).waitFor();
      await d.wait(900);
      const more = page.getByText("Send email", { exact: true }).locator("xpath=../../../..");
      await page.getByText("Run code", { exact: true }).scrollIntoViewIfNeeded();
      await d.wait(500);
      d.mark("what asks you, what is never allowed", await d.box(more));
      await d.wait(1600);
    },
    tail: 600,
  },
  {
    id: "permissions.auto-approve",
    feature: "permissions",
    title: "Approve once, never be asked again: the second request goes through on its own",
    demonstrates: "Sleuth asks to run a paid research query and an approval card lands. The owner picks 'Approve & allow for this project'. When Sleuth needs a similar query minutes later, no card appears and nobody is pinged: a green line says it was allowed by the owner's rule, decided by the policy engine and not the chat model. Agents keep working, within what the owner said yes to.",
    suggestedUse: "The 'agents don't interrupt you' beat. Cut on the green receipt line.",
    staged: "The approval card is fed through scripted /api/approvals and event stubs and Sleuth's messages are scripted runs. The 'Approve & allow for this project' button and both green policy lines are STAGED overlays in the app's visual language (the app has no such UI yet; grants from approvals are not minted yet). Nothing is written.",
    stage: { cursor: true, fakeES: ["/api/runs", "/api/events"] },
    async setup({ page }) {
      await openChannel(page, GUILD);
      await rule(page, { kind: "json", url: `/api/approvals?project=${GUILD_PID}`, body: { approvals: [] } });
    },
    async act({ page, d }) {
      const T = `a:${SLEUTH}:p:${GUILD_PID}`;
      const TITLE = "Sleuth wants to run a You.com Research query";
      await page.evaluate((T) => window.__stage.run(T, "To size the creator-revenue tiers I need a cited deep-research pass. It costs about $0.40.", { now: "Planning a research query", cps: 60, delayMs: 200 }), T);
      await d.wait(500);
      await page.evaluate(([pid, title]) => {
        window.__stage.rules.unshift({ kind: "json", url: `/api/approvals?project=${pid}`, body: { approvals: [{ id: "ap_9k2x7q", agentId: "sleuth-3snf", title, detail: "Research: \"Discord creator-revenue share by tier, 2025-26\". About $0.40, returns cited sources.", createdAt: new Date().toISOString() }] } });
        window.__stage.emit("/api/events", "message", { topic: "approvals" });
      }, [GUILD_PID, TITLE]);
      const card = page.getByText(TITLE).locator("xpath=..");
      await card.waitFor();
      await card.scrollIntoViewIfNeeded();
      await grantButton(page, TITLE);
      await d.wait(900);
      d.mark("approval card lands", await d.box(card));
      await d.wait(900);
      await d.click(page.locator("#__grant"), { ms: 700, what: "Approve & allow for this project" });
      await d.wait(900);
      await policyCard(page, { afterText: TITLE, id: "__p1", tone: "blue", title: "Rule saved from your approval", lines: ["Sleuth can run research without asking, in this project."], foot: "Remove it any time in Sleuth's Permissions." });
      await d.wait(500);
      d.mark("rule saved from the approval", await d.box(page.locator("#__p1")));
      await d.wait(1600);
      await page.evaluate((T) => window.__stage.run(T, "", { now: "Researching Patreon, Substack and Circle tiers", done: false, delayMs: 0 }), T);
      await d.wait(700);
      await policyCard(page, { afterId: "__p1", id: "__p2", tone: "green", title: "Allowed automatically", lines: ["<b>Research query</b>: \"Patreon, Substack and Circle creator pricing tiers\" (about $0.40)", "By your rule: Sleuth can run research without asking, in this project."], foot: "Decided by the policy engine, not the model. No approval needed." });
      await d.wait(500);
      d.mark("second request allowed by the rule, no card, no ping", await d.box(page.locator("#__p2")));
      await d.wait(2200);
    },
    tail: 600,
  },
  {
    id: "permissions.blocked-secret",
    feature: "permissions",
    title: "A leaked key never leaves: the rule blocks it before it is sent",
    demonstrates: "Sprocket tries to email a contractor a deploy log with a live access key in it. The policy engine stops the call before it goes out, citing the locked rule 'secrets never leave the machine'. The owner did nothing; the guardrail held.",
    suggestedUse: "The 'can't do what you forbade' beat, after auto-approve.",
    staged: "Sprocket's messages are scripted runs and the red policy card is a STAGED overlay (the app has no in-chat block notice yet). The rule text is the real default rule r_secr03; the key is fake. Nothing is sent.",
    async setup({ page }) {
      await openChannel(page, GUILD);
    },
    async act({ page, d }) {
      const T = `a:sprocket-dmmy:p:${GUILD_PID}`;
      await page.evaluate((T) => window.__stage.run(T, "Emailing the deploy log to the contractor so they can reproduce the presence bug.", { now: "Sending deploy.log by email", cps: 60, delayMs: 200 }), T);
      await d.wait(900);
      const msg = page.getByText("Emailing the deploy log").first();
      await msg.scrollIntoViewIfNeeded();
      await policyCard(page, { afterText: "Emailing the deploy log to the contractor so they can reproduce the presence bug.", up: 2, id: "__p3", tone: "red", title: "Blocked before it was sent", lines: ["Email to <b>dev@northwind-contract.io</b> contained an access key: <code style=\"background:#fff;border-radius:6px;padding:1px 6px\">AWS_KEY=AKIA4F7Q&#8203;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;</code>", "Rule: block secrets from going to the web, email, the calendar, any API or other projects."], foot: "Locked rule. Decided by the policy engine; nothing left the machine." });
      await scrollToBottom(page); // the card lands under the composer otherwise
      await d.wait(500);
      d.mark("send blocked: secret detected", await d.box(page.locator("#__p3")));
      await d.wait(2200);
    },
    tail: 600,
  },
];
