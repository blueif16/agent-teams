import { describe, expect, it } from "vitest";
import { findConflicts } from "@/lib/policy/conflicts";
import { DEFAULT_RULES } from "@/lib/policy/defaults";
import type { Rule } from "@/lib/policy/types";

const NOW = new Date("2026-10-17T12:00:00Z");
const conflicts = (rule: Rule, existing: Rule[] = DEFAULT_RULES) => findConflicts([rule], existing, NOW);
const kinds = (rule: Rule, existing?: Rule[]) => conflicts(rule, existing).map((c) => [c.kind, c.otherRuleId]);

const flow = (over: Partial<Rule>): Rule => ({ id: "r_new001", kind: "flow", scope: {}, labels: ["*"], sinks: ["*"], action: "block", createdBy: "nl-compiler", ...over }) as Rule;
const tool = (over: Partial<Rule>): Rule => ({ id: "r_new001", kind: "tool", scope: {}, match: { tools: ["*"] }, effect: "deny", createdBy: "nl-compiler", ...over }) as Rule;

describe("findConflicts", () => {
  it("duplicate: the same cells and outcome as an existing rule (E §5.3 example 3)", () => {
    expect(kinds(flow({ labels: ["secret.*"], sinks: ["model:*"], action: "tokenize" }))).toEqual([["duplicate", "r_secr01"]]);
  });

  it("shadowed: a stricter-or-equal existing rule already decides every cell", () => {
    expect(kinds(flow({ labels: ["secret.aws"], sinks: ["email"], action: "block" }))).toEqual([["shadowed", "r_secr03"]]);
  });

  it("tightens: it changes outcomes an existing rule decided (E §5.3 example 5 tightens R4's ask)", () => {
    const c = conflicts(flow({ labels: ["project:bluebird"], sinks: ["memory:global", "project:other"], action: "block" }));
    expect(c.map((x) => [x.kind, x.otherRuleId])).toEqual([["tightens", "r_proj02"]]);
    expect(c[0].note).toMatch(/ask → block/);
  });

  it("tightens a tier default, named by its tier, most-affected first", () => {
    const c = conflicts(tool({ scope: { archetypes: ["writer"] }, match: { tools: ["post_message"] }, effect: "deny" }));
    expect(c[0]).toMatchObject({ kind: "tightens", otherRuleId: "tier:T4", ruleId: "r_new001" });
    expect(c[0].note).toMatch(/ask → deny/);
    expect(c.every((x) => x.kind === "tightens")).toBe(true);
  });

  it("treats deny and block as the same outcome (both refuse the call)", () => {
    // Blocking personal info to the web tightens the T3 default, but where a raw-IP or paste-host deny already
    // refuses the call, deny → block is no change.
    const c = conflicts(flow({ labels: ["pii.*"], sinks: ["web"], action: "block" }));
    expect(c.map((x) => x.otherRuleId)).toContain("tier:T3");
    expect(c.map((x) => x.otherRuleId).filter((id) => /^r_(rawip|paste)/.test(id))).toEqual([]);
  });

  it("revokes_grant: a new deny overrides a standing grant", () => {
    const g: Rule = {
      id: "r_g7f3a1",
      kind: "grant",
      scope: { agents: ["pip"], projects: ["acme-launch"] },
      tool: "send_email",
      args: [{ path: "to[*]", op: "in", value: ["sam@acme.com"] }],
      grantScope: "project",
      createdBy: "approval",
    };
    const c = kinds(tool({ scope: { agents: ["pip"] }, match: { tools: ["send_email"] }, effect: "deny" }), [...DEFAULT_RULES, g]);
    expect(c).toContainEqual(["revokes_grant", "r_g7f3a1"]);
    expect(c).toContainEqual(["tightens", "r_mail01"]);
  });

  it("a grant that a locked rule keeps from ever applying is shadowed by it", () => {
    const g: Rule = { id: "r_newg01", kind: "grant", scope: {}, tool: "purchase_*", grantScope: "always", createdBy: "nl-compiler" };
    expect(kinds(g)).toEqual([["shadowed", "r_buy001"]]);
  });

  it("duplicate budgets", () => {
    const b: Rule = { id: "r_bud001", kind: "budget", scope: {}, match: { tools: ["web_search"] }, metric: "calls", limit: { amount: 20, per: "run" }, onExceed: "end", createdBy: "owner" };
    expect(kinds({ ...b, id: "r_bud002", createdBy: "nl-compiler" } as Rule, [...DEFAULT_RULES, b])).toEqual([["duplicate", "r_bud001"]]);
  });
});
