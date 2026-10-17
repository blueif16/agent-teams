import { describe, expect, it } from "vitest";
import type { ToolEvent } from "./ledger";
import { totals } from "./stats";

const search: ToolEvent = {
  t: "tool",
  at: "2026-10-17T10:00:00.000Z",
  team: "company",
  agent: "mira",
  tool: "web_search",
  endpoint: "ydc-index.io/v1/search",
  ms: 600,
  cost: 0.005,
  ok: true,
};

describe("totals() with tool rows", () => {
  it("leaves the model-call figures and the approvals untouched by a tool row", () => {
    const { lastAt, ...withTool } = totals([search]);
    const { lastAt: none, ...empty } = totals([]);
    expect(withTool).toEqual(empty);
    expect(lastAt).toBe(search.at);
    expect(none).toBeNull();
  });
});
