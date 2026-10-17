/*
 * The Permissions view's logic: what each capability resolves to for one agent, what can tighten it, which ones the
 * agent's toolset makes relevant, and what the flow rules protect. Real engine, real default rules, real registry.
 */
import { describe, expect, it } from "vitest";
import { CAPABILITIES, dataGuards, permissionsFor, toolsetOf, type AgentContext } from "@/lib/policy/capabilities";
import { DEFAULT_RULES } from "@/lib/policy/defaults";
import { globMatch } from "@/lib/policy/engine";
import { TIERS } from "@/lib/policy/tiers";
import type { Permission, Rule } from "@/lib/policy/types";
import { REGISTRY } from "@/lib/tools/registry";

const NOW = new Date("2026-10-17T12:00:00Z");
const MIRA: AgentContext = { agentId: "mira", archetype: "chief", projectId: "" };
const PIP: AgentContext = { agentId: "pip", archetype: "researcher", projectId: "acme" };
const ENGINEER: AgentContext = { agentId: "eli", archetype: "engineer", projectId: "acme" };

function perms(agent: AgentContext, rules: Rule[] = DEFAULT_RULES): Record<string, Permission> {
  return Object.fromEntries(permissionsFor(agent, rules, toolsetOf(agent.archetype), NOW).map((p) => [p.id, p]));
}
const limitIds = (p: Permission | undefined) => (p?.limits ?? []).map((l) => l.ruleId);

describe("permissionsFor: access under the default rules", () => {
  it.each([
    ["email", "ask", false, ["r_mail01"]],
    ["code", "deny", false, []],
    ["web.search", "allow", false, []],
    ["money", "ask", true, ["r_buy001"]],
  ] as const)("%s → %s (locked %s)", (id, access, locked, ruleIds) => {
    expect(perms(MIRA)[id]).toMatchObject({ access, locked, ruleIds });
  });
});

describe("permissionsFor: owner rules", () => {
  const own: Rule = { id: "r_own001", kind: "tool", scope: { agents: ["mira"] }, match: { tools: ["web_search"] }, effect: "deny", createdBy: "owner" };

  it("denies web search for the agent the rule names and leaves another agent allowed", () => {
    expect(perms(MIRA, [...DEFAULT_RULES, own])["web.search"]).toMatchObject({ access: "deny", ruleIds: ["r_own001"], locked: false });
    expect(perms(PIP, [...DEFAULT_RULES, own])["web.search"]).toMatchObject({ access: "allow", ruleIds: [] });
  });
});

describe("permissionsFor: limits", () => {
  it("attaches the raw-IP and paste-site rules to opening pages and calling services, not to reading files", () => {
    const p = perms(MIRA);
    for (const id of ["web.open", "apis"]) {
      expect(limitIds(p[id]), id).toEqual(expect.arrayContaining(["r_rawip1", "r_paste1"]));
      expect(p[id].limits.filter((l) => /^r_(rawip|paste)/.test(l.ruleId)).every((l) => l.access === "deny"), id).toBe(true);
    }
    expect(p["files.read"]?.limits).toEqual([]);
  });

  it("shows the untrusted-destination rule on email and on opening pages, as an ask", () => {
    const p = perms(MIRA);
    for (const id of ["email", "web.open"]) {
      expect(p[id]?.limits.find((l) => l.ruleId === "r_taint1"), id).toMatchObject({ access: "ask" });
    }
  });

  it("shows a limit once when two rules say the same thing", () => {
    // r_rawip1 (url) and r_rawip2 (urls[*]) both attach to fetch_page with the same reason.
    const texts = (perms(MIRA)["web.open"]?.limits ?? []).map((l) => l.text);
    expect(texts.length).toBeGreaterThan(0);
    expect(new Set(texts).size).toBe(texts.length);
    expect(limitIds(perms(MIRA)["web.open"])).not.toContain("r_rawip2");
  });

  it("uses the read-back when a conditional rule has no reason", () => {
    const own: Rule = {
      id: "r_own002",
      kind: "tool",
      scope: {},
      match: { tools: ["send_email"] },
      effect: "deny",
      args: [{ path: "to[*]", op: "domain_not_in", value: ["acme.com"] }],
      createdBy: "owner",
    };
    const limit = perms(MIRA, [...DEFAULT_RULES, own]).email?.limits.find((l) => l.ruleId === "r_own002");
    expect(limit?.access).toBe("deny");
    expect(limit?.text).toMatch(/acme\.com/);
  });
});

describe("permissionsFor: relevance", () => {
  it("marks a capability in the chief's toolset and one outside it", () => {
    const p = perms(MIRA);
    expect(p.team?.inToolset).toBe(true); // find_agent and dispatch are chief tools
    expect(p.email?.inToolset).toBe(false);
  });

  it("never counts a T7 tool as in the toolset", () => {
    expect(REGISTRY.some((d) => d.tier === "T7" && d.archetypes.includes("engineer"))).toBe(true);
    expect(perms(ENGINEER).code?.inToolset).toBe(false);
  });

  it("shows soon only when every one of its tools in the toolset is planned", () => {
    const p = perms(MIRA);
    expect(p.plan).toMatchObject({ inToolset: true, planned: true }); // report is planned
    expect(p["files.read"]).toMatchObject({ inToolset: true, planned: false }); // file_tools is ready
    expect(p.email?.planned).toBe(false);
  });
});

describe("the capability map", () => {
  it("lists the capabilities in order with their labels", () => {
    expect(permissionsFor(MIRA, DEFAULT_RULES, toolsetOf("chief"), NOW).map((p) => [p.id, p.label])).toEqual([
      ["files.read", "Read files"],
      ["files.write", "Write and edit files"],
      ["plan", "Plan and track work"],
      ["team", "Work with teammates"],
      ["memory", "Update its own memory"],
      ["web.search", "Search the web"],
      ["web.open", "Open web pages"],
      ["email", "Send email"],
      ["post", "Post messages"],
      ["calendar", "Change your calendar"],
      ["delete", "Delete files"],
      ["apis", "Call outside services"],
      ["money", "Spend money"],
      ["accounts", "Use passwords and accounts"],
      ["code", "Run code"],
    ]);
  });

  it("puts every tiered tool and every registry call in exactly one capability", () => {
    const runtime = new Set(["model_call", "trace_export"]);
    const tools = [...new Set([...TIERS.flatMap((t) => t.tools), ...REGISTRY.flatMap((d) => d.calls)])];
    const homes = (tool: string) => CAPABILITIES.filter((c) => c.tools.some((p) => globMatch(p, tool))).map((c) => c.id);
    expect(tools.filter((t) => !runtime.has(t) && homes(t).length !== 1).map((t) => [t, homes(t)])).toEqual([]);
    expect([...runtime].flatMap(homes)).toEqual([]);
  });
});

describe("dataGuards", () => {
  const byLabel = (rules: Rule[]) => Object.fromEntries(dataGuards(rules, NOW).map((g) => [g.label, g]));

  it("groups the secret rules: blocked and locked, three rules", () => {
    const g = byLabel(DEFAULT_RULES)["Secrets and keys"];
    expect(g).toMatchObject({ id: "secret", outcome: "block", locked: true });
    expect(g?.rules.map((r) => r.outcome)).toEqual(["hidden", "hidden", "block"]);
  });

  it("groups the project rules: blocked, two rules", () => {
    const g = byLabel(DEFAULT_RULES)["Project data"];
    expect(g).toMatchObject({ id: "project", outcome: "block", locked: false });
    expect(g?.rules.map((r) => r.ruleId)).toEqual(["r_proj01", "r_proj02"]);
  });

  it("shows a family that is only rewritten as hidden, and an unknown label under its own name", () => {
    const own: Rule[] = [
      { id: "r_pii001", kind: "flow", scope: {}, labels: ["pii.email"], sinks: ["web"], action: "mask", createdBy: "owner" },
      { id: "r_code01", kind: "flow", scope: {}, labels: ["codename"], sinks: ["email"], action: "ask", createdBy: "owner" },
    ];
    const g = byLabel(own);
    expect(g["Personal info"]).toMatchObject({ id: "pii", outcome: "hidden" });
    expect(g.codename).toMatchObject({ id: "codename", outcome: "ask" });
  });

  it("ranks asking above hiding within a family", () => {
    const own: Rule[] = [
      { id: "r_pii001", kind: "flow", scope: {}, labels: ["pii.email"], sinks: ["web"], action: "tokenize", createdBy: "owner" },
      { id: "r_pii002", kind: "flow", scope: {}, labels: ["pii.phone"], sinks: ["email"], action: "ask", createdBy: "owner" },
    ];
    expect(byLabel(own)["Personal info"]).toMatchObject({ outcome: "ask" });
  });
});
