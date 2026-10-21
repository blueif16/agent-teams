// Self-optimization and memory shots (feature "soul-memory").
// Helpers and staging live in common.mjs; the entry shape is documented in ../shots.mjs.
import { CHANNEL, GUILD, GUILD_PID, GUILD_PROPOSAL, MIRA_SENTENCE, openChannel, bubble, menuButton, order, reply, openTeamPanel, tab, rule } from "./common.mjs";

export const EFFECTS = [
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
  {
    id: "soul-memory.designer-evolution",
    feature: "soul-memory",
    title: "The same designer, three runs: the mockup gets better every time",
    demonstrates: "Pia's mockup from runs 1, 2 and 3 side by side on her canvas: a bare page, then cards, then a polished hero with a live booking widget. What she learned (saved to her memory) shows up in the work.",
    suggestedUse: "Learning beat, right after soul-memory.history.",
    staged: "The canvas viewer is staged; all three mockups are the team's real outputs.",
    viewer: ["designer-evolution"],
    async setup({ page }) {
      await openChannel(page, CHANNEL);
      await bubble(page, "It didn't stack well", 0.5);
    },
    async act({ page, d }) {
      await d.click(page.getByText("mockup.html", { exact: true }).filter({ visible: true }).last(), { ms: 650, what: "click mockup.html" });
      await d.wait(2400);
      d.mark("runs 1 → 3 on the canvas", { x: 936, y: 44, w: 494, h: 846 });
      await d.wait(800);
    },
    focus: async () => ({ x: 600, y: 44, w: 830, h: 846 }),
  },
];
