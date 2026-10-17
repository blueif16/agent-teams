import { describe, expect, it } from "vitest";
import { RuleSchema } from "@/lib/policy/schema";

const tool = { id: "r_abc123", kind: "tool", scope: {}, match: { tools: ["send_email"] }, effect: "ask", createdBy: "owner" };
const ok = (v: unknown) => RuleSchema.safeParse(v).success;

describe("RuleSchema (policy/v1)", () => {
  it("accepts a valid rule of each kind", () => {
    expect(ok(tool)).toBe(true);
    expect(ok({ id: "r_flow01", kind: "flow", scope: {}, labels: ["secret.*"], sinks: ["web"], action: "block", createdBy: "default" })).toBe(true);
    expect(ok({ id: "r_gr0001", kind: "grant", scope: { agents: ["pip"] }, tool: "send_email", grantScope: "until", expiresAt: "2026-11-16T00:00:00Z", createdBy: "approval" })).toBe(true);
    expect(ok({ id: "r_bud001", kind: "budget", scope: {}, metric: "calls", limit: { amount: 20, per: "run" }, onExceed: "end", createdBy: "owner" })).toBe(true);
    expect(ok({ id: "r_cls001", kind: "classifier", scope: {}, label: "project:bluebird", detect: { terms: ["Bluebird"] }, createdBy: "owner" })).toBe(true);
  });

  it("rejects an id that isn't r_ + 6 lowercase letters or digits", () => {
    expect(ok({ ...tool, id: "r_buy01" })).toBe(false);
    expect(ok({ ...tool, id: "r_ABC123" })).toBe(false);
  });

  it("rejects an unknown scope key, so a typo can't widen a rule to everyone", () => {
    expect(ok({ ...tool, scope: { agent: ["pip"] } })).toBe(false);
  });

  it("rejects unknown keys and missing kind-specific fields", () => {
    expect(ok({ ...tool, effects: "deny" })).toBe(false);
    expect(ok({ ...tool, match: undefined })).toBe(false);
  });

  it("rejects empty lists that would make a rule a silent no-op", () => {
    expect(ok({ ...tool, match: { tools: [] } })).toBe(false);
    expect(ok({ ...tool, scope: { agents: [] } })).toBe(false);
  });

  it("rejects a reason over 160 characters and a non-ISO expiry", () => {
    expect(ok({ ...tool, reason: "x".repeat(161) })).toBe(false);
    expect(ok({ ...tool, expiresAt: "next tuesday" })).toBe(false);
  });

  it("checks constraint values by op", () => {
    const withArg = (c: unknown) => ({ ...tool, args: [c] });
    expect(ok(withArg({ path: "to[*]", op: "domain_not_in", value: ["acme.com"] }))).toBe(true);
    expect(ok(withArg({ path: "to[*]", op: "domain_not_in", value: 3 }))).toBe(false);
    expect(ok(withArg({ path: "query", op: "max_len", value: -1 }))).toBe(false);
    expect(ok(withArg({ path: "url", op: "matches", value: "([a-z" }))).toBe(false);
  });

  it("rejects regexes with nested quantifiers (ReDoS)", () => {
    expect(ok({ id: "r_cls001", kind: "classifier", scope: {}, label: "pii.x", detect: { regex: ["(a+)+$"] }, createdBy: "owner" })).toBe(false);
    expect(ok({ id: "r_cls001", kind: "classifier", scope: {}, label: "pii.x", detect: { regex: ["\\bKF-\\d{6}\\b"] }, createdBy: "owner" })).toBe(true);
  });
});
