// agent-teams adapter for autocap (github.com/blueif16/autocap):  npx rec ls | check | take | cut [shot-id-prefix …]
// Restart `next dev` before a batch of takes: it leaks memory into swap and drops the capture fps.
import { EFFECTS } from "./scripts/promo/shots.mjs";
import { FEATURES } from "./scripts/promo/features.mjs";
import { polish } from "./scripts/promo/org.mjs";
import { installViewer } from "./scripts/promo/viewer.mjs";
import { installRuns } from "./scripts/promo/runs-stage.mjs";

export default {
  url: process.env.PROMO_APP_URL ?? "http://localhost:3000",
  out: "promo-assets",
  viewport: { width: 1440, height: 900, dpr: 2 },
  css: "nextjs-portal{display:none!important}",
  stage: {
    streams: ["/api/runs"],
    // Writes that must never reach the real server during a capture (model calls, messages to agents, launches,
    // ledger, approvals, file edits). The app's heartbeat POSTs /api/chat too; it gets an empty text reply.
    block: ["^/api/chat$", "^/api/threads/", "^/api/projects$", "^/api/projects/[^/]+/close$", "^/api/ledger$", "^/api/approvals/", "^/api/agents/", "^/api/rules"],
    blockText: ["^/api/chat$"],
  },
  features: FEATURES,
  console: "^\\[viewer\\]",
  python: "scripts/promo/.venv/bin/python",
  async prepare({ page, shot }) {
    await installRuns(page);
    if (shot.polish !== false) await polish(page);
    if (shot.viewer) await installViewer(page, shot.viewer);
  },
  shots: EFFECTS,
};
