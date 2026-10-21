// Stats shots (feature "stats"): the numbers, clearly, animating in.
// Helpers and staging live in common.mjs; the entry shape is documented in ../shots.mjs.
import { CHANNEL, GUILD, GUILD_PID, GUILD_PROPOSAL, MIRA_SENTENCE, openChannel, bubble, menuButton, order, reply, openTeamPanel, tab, rule } from "./common.mjs";

export const EFFECTS = [
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
];
