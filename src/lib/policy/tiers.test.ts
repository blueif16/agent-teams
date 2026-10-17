import { describe, expect, it } from "vitest";
import { decide, globMatch } from "@/lib/policy/engine";
import { TIERS, TOOL_CATALOG, tierOf } from "@/lib/policy/tiers";
import type { PolicyEvent } from "@/lib/policy/types";

const NOW = new Date("2026-10-17T12:00:00Z");
const ev = (tool: string): PolicyEvent => ({
  agentId: "pip",
  archetype: "researcher",
  projectId: "acme",
  tool,
  args: {},
  argSpans: [],
  contextLabels: [],
  sinks: [],
});

describe("tiers (E §6)", () => {
  it("has T0–T7 with the defaults from the design", () => {
    expect(TIERS.map((t) => [t.tier, t.effect])).toEqual([
      ["T0", "allow"],
      ["T1", "allow"],
      ["T2", "allow"],
      ["T3", "allow"],
      ["T4", "ask"],
      ["T5", "ask"],
      ["T6", "ask"],
      ["T7", "deny"],
    ]);
  });

  it.each([
    ["read_file", "T0"],
    ["ls", "T0"],
    ["glob", "T0"],
    ["grep", "T0"],
    ["write_file", "T1"],
    ["edit_file", "T1"],
    ["web_search", "T3"],
    ["fetch_page", "T3"],
    ["research", "T3"],
    ["answer", "T3"],
    ["send_email", "T4"],
    ["post_message", "T4"],
    ["http_post", "T5"],
    ["purchase_flight", "T6"],
    ["pay_invoice", "T6"],
    ["execute", "T7"],
  ])("puts %s in %s", (tool, tier) => {
    expect(tierOf(tool)?.tier).toBe(tier);
  });

  it("knows no tier for a tool it has never heard of", () => {
    expect(tierOf("zz_unknown_tool")).toBeUndefined();
  });

  it("puts every catalog tool in a tier", () => {
    const orphans = Object.keys(TOOL_CATALOG).filter((tool) => !TIERS.some((t) => t.tools.some((p) => globMatch(p, tool))));
    expect(Object.keys(TOOL_CATALOG).length).toBeGreaterThan(10);
    expect(orphans).toEqual([]);
  });
});

describe("decide: tier defaults when no tool rule matches", () => {
  it.each([
    ["read_file", "allow"],
    ["write_file", "allow"],
    ["fetch_page", "allow"],
    ["send_email", "ask"],
    ["purchase_flight", "ask"],
    ["zz_unknown_tool", "ask"],
  ])("%s → %s", (tool, effect) => {
    expect(decide(ev(tool), [], [], NOW).effect).toBe(effect);
  });

  it("denies execute by default", () => {
    expect(decide(ev("execute"), [], [], NOW).effect).toBe("deny");
  });

  it("a matching tool rule replaces the tier default", () => {
    const ask = { id: "r_ask001", kind: "tool" as const, scope: {}, match: { tools: ["read_file"] }, effect: "ask" as const, createdBy: "owner" as const };
    expect(decide(ev("read_file"), [], [], NOW).effect).toBe("allow");
    expect(decide(ev("read_file"), [ask], [], NOW).effect).toBe("ask");
  });
});
