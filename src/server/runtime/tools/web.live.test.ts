/*
 * Live check of the web tools against real You.com: one search and one page fetch, about $0.006 at list price.
 * Skipped unless YDC_LIVE=1 and a key is set (YDC_API_KEY, or YDC_ENV_FILE pointing at a .env.local that has it):
 *   YDC_LIVE=1 YDC_ENV_FILE=../../../.env.local npx vitest run src/server/runtime/tools/web.live.test.ts
 * The ledger rows are captured in memory, so nothing is written to .data/.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ToolEvent } from "@/lib/ledger";
import { UNTRUSTED_TAG, webTools } from "./web";

const envFile = process.env.YDC_ENV_FILE;
if (process.env.YDC_LIVE === "1" && !process.env.YDC_API_KEY && envFile && existsSync(envFile)) {
  const line = readFileSync(envFile, "utf8").split("\n").find((l) => l.startsWith("YDC_API_KEY="));
  if (line) process.env.YDC_API_KEY = line.slice("YDC_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
}
const LIVE = process.env.YDC_LIVE === "1" && Boolean(process.env.YDC_API_KEY);

describe.skipIf(!LIVE)("web tools, live against You.com", () => {
  it("searches and fetches one page for under $0.02, each call one ledger row", { timeout: 60_000 }, async () => {
    const rows: ToolEvent[] = [];
    const [webSearch, fetchPage] = webTools({ agentId: "rex", projectId: "live-check" }, { record: async (e) => void rows.push(e) });

    const found = String(await webSearch.invoke({ query: "LangGraph JS checkpointer durable execution", count: 5 }));
    expect(found).toContain(`</${UNTRUSTED_TAG}>`);
    expect(found).toMatch(/^\[1\] /m);
    expect(found.length / 4).toBeLessThanOrEqual(2000);

    const page = String(await fetchPage.invoke({ url: "https://en.wikipedia.org/wiki/Web_search_engine" }));
    expect(page).toContain(`</${UNTRUSTED_TAG}>`);
    expect(page).toMatch(/search engine/i);

    expect(rows.map((r) => [r.tool, r.ok])).toEqual([
      ["web_search", true],
      ["fetch_page", true],
    ]);
    const cost = rows.reduce((s, r) => s + r.cost, 0);
    expect(cost).toBeLessThan(0.02);
    console.log(
      `live: ${rows.map((r) => `${r.tool} ${r.ms} ms $${r.cost.toFixed(3)}`).join(" · ")} · total $${cost.toFixed(3)} · ` +
        `search ${found.length} chars, page ${page.length} chars`,
    );
  });
});
