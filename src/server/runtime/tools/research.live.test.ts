/*
 * Live check of `research` against real You.com: one lite call, about $0.012 at list price.
 * Skipped unless YDC_LIVE=1 and a key is set (YDC_API_KEY, or YDC_ENV_FILE pointing at a .env.local that has it):
 *   YDC_LIVE=1 YDC_ENV_FILE=../../../.env.local npx vitest run src/server/runtime/tools/research.live.test.ts
 * The ledger row is captured in memory, so nothing is written to .data/.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ToolEvent } from "@/lib/ledger";
import { researchTool } from "./research";
import { UNTRUSTED_TAG } from "./web";

const envFile = process.env.YDC_ENV_FILE;
if (process.env.YDC_LIVE === "1" && !process.env.YDC_API_KEY && envFile && existsSync(envFile)) {
  const line = readFileSync(envFile, "utf8").split("\n").find((l) => l.startsWith("YDC_API_KEY="));
  if (line) process.env.YDC_API_KEY = line.slice("YDC_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
}
const LIVE = process.env.YDC_LIVE === "1" && Boolean(process.env.YDC_API_KEY);

describe.skipIf(!LIVE)("research, live against You.com", () => {
  it("answers one lite question with numbered sources, one ledger row at $0.012", { timeout: 90_000 }, async () => {
    const rows: ToolEvent[] = [];
    const research = researchTool({ agentId: "rex", team: "live-check" }, { record: async (e) => void rows.push(e) });

    const out = String(await research.invoke({ question: "What does LangGraph's interrupt() do, and how is a paused graph resumed?", tier: "lite" }));
    expect(out).toContain(`</${UNTRUSTED_TAG}>`);
    expect(out).toMatch(/^\[1\] /m);
    expect(out).toMatch(/interrupt/i);
    expect(rows).toMatchObject([{ tool: "research", tier: "lite", cost: 0.012, ok: true }]);
    console.log(`live: research lite ${rows[0].ms} ms $${rows[0].cost} · ${out.length} chars`);
  });
});
