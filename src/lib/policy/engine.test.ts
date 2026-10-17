import { describe, expect, it } from "vitest";
import { decide } from "@/lib/policy/engine";
import type { ArgConstraint, FlowRule, PolicyEvent, ToolRule } from "@/lib/policy/types";

const NOW = new Date("2026-10-17T12:00:00Z");

function ev(over: Partial<PolicyEvent> = {}): PolicyEvent {
  return {
    agentId: "pip",
    archetype: "researcher",
    projectId: "acme",
    tool: "zz_probe",
    args: {},
    argSpans: [],
    contextLabels: [],
    sinks: [],
    ...over,
  };
}

function toolRule(over: Partial<ToolRule> = {}): ToolRule {
  return { id: "r_tool01", kind: "tool", scope: {}, match: { tools: ["*"] }, effect: "deny", createdBy: "owner", ...over };
}

function flowRule(over: Partial<FlowRule> = {}): FlowRule {
  return { id: "r_flow01", kind: "flow", scope: {}, labels: ["*"], sinks: ["*"], action: "block", createdBy: "owner", ...over };
}

/** A deny rule guarded by one arg constraint: fires (deny) exactly when the constraint holds. */
function denyWhen(c: ArgConstraint): ToolRule {
  return toolRule({ args: [c] });
}

const fired = (e: PolicyEvent, rules: (ToolRule | FlowRule)[]) => decide(e, rules, [], NOW).firedRuleIds;
const effect = (e: PolicyEvent, rules: (ToolRule | FlowRule)[]) => decide(e, rules, [], NOW).effect;

describe("decide: defaults", () => {
  it("asks for a tool no rule and no tier knows", () => {
    expect(effect(ev({ tool: "zz_unknown_tool" }), [])).toBe("ask");
  });
});

describe("decide: scope", () => {
  it("matches only when every present scope key matches (AND)", () => {
    const r = toolRule({ scope: { agents: ["pip"], projects: ["acme"] } });
    expect(fired(ev({ agentId: "pip", projectId: "acme" }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ agentId: "pip", projectId: "bluebird" }), [r])).toEqual([]);
    expect(fired(ev({ agentId: "rex", projectId: "acme" }), [r])).toEqual([]);
  });

  it("treats a missing key or '*' as matching anything", () => {
    const star = toolRule({ scope: { agents: ["*"], projects: ["*"] } });
    const empty = toolRule({ id: "r_tool02", scope: {} });
    expect(fired(ev({ agentId: "anyone", projectId: "anything" }), [star, empty])).toEqual(["r_tool01", "r_tool02"]);
  });

  it("matches archetypes", () => {
    const r = toolRule({ scope: { archetypes: ["writer", "engineer"] } });
    expect(fired(ev({ archetype: "engineer" }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ archetype: "researcher" }), [r])).toEqual([]);
  });

  it("matches project globs such as dm:*", () => {
    const r = toolRule({ scope: { projects: ["dm:*"] } });
    expect(fired(ev({ projectId: "dm:pip" }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ projectId: "acme" }), [r])).toEqual([]);
  });
});

describe("decide: tool globs", () => {
  it("matches tool names by glob", () => {
    const r = toolRule({ match: { tools: ["web_*"] } });
    expect(effect(ev({ tool: "web_search" }), [r])).toBe("deny");
    expect(fired(ev({ tool: "fetch_page" }), [r])).toEqual([]);
    expect(fired(ev({ tool: "my_web_search" }), [r])).toEqual([]);
  });
});

describe("decide: arg constraints", () => {
  it("host_in holds when the URL host is listed", () => {
    const r = denyWhen({ path: "url", op: "host_in", value: ["docs.acme.com"] });
    expect(fired(ev({ args: { url: "https://DOCS.acme.com/a?b=1" } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { url: "https://acme.com/" } }), [r])).toEqual([]);
  });

  it("host_not_in holds when the URL host is not listed", () => {
    const r = denyWhen({ path: "url", op: "host_not_in", value: ["docs.acme.com"] });
    expect(fired(ev({ args: { url: "https://evil.example/" } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { url: "https://docs.acme.com/x" } }), [r])).toEqual([]);
  });

  it("domain_in holds for the domain and its subdomains, not look-alikes", () => {
    const r = denyWhen({ path: "url", op: "domain_in", value: ["pastebin.com"] });
    expect(fired(ev({ args: { url: "https://pastebin.com/raw/1" } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { url: "https://www.pastebin.com/" } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { url: "https://notpastebin.com/" } }), [r])).toEqual([]);
  });

  it("domain_in reads the host of an email address", () => {
    const r = denyWhen({ path: "to[*]", op: "domain_in", value: ["acme.com"] });
    expect(fired(ev({ args: { to: ["sam@acme.com"] } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { to: ["sam@acme.co"] } }), [r])).toEqual([]);
  });

  it("domain_not_in on a restricting rule holds when ANY value is outside the list", () => {
    const r = denyWhen({ path: "to[*]", op: "domain_not_in", value: ["acme.com"] });
    expect(fired(ev({ args: { to: ["sam@acme.com", "eve@evil.example"] } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { to: ["sam@acme.com", "kim@eu.acme.com"] } }), [r])).toEqual([]);
  });

  it("path_glob matches paths with * inside one segment and ** across segments, after normalizing ..", () => {
    const r = denyWhen({ path: "path", op: "path_glob", value: "/projects/acme/**" });
    expect(fired(ev({ args: { path: "/projects/acme/notes/a.md" } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { path: "/projects/acme/../bluebird/a.md" } }), [r])).toEqual([]);
    const one = denyWhen({ path: "path", op: "path_glob", value: "/projects/*/a.md" });
    expect(fired(ev({ args: { path: "/projects/acme/a.md" } }), [one])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { path: "/projects/acme/x/a.md" } }), [one])).toEqual([]);
  });

  it("path_not_glob holds when the path is outside the glob", () => {
    const r = denyWhen({ path: "path", op: "path_not_glob", value: "/projects/acme/**" });
    expect(fired(ev({ args: { path: "/projects/acme/../bluebird/a.md" } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { path: "/projects/acme/a.md" } }), [r])).toEqual([]);
  });

  it("in holds when the value is listed", () => {
    const r = denyWhen({ path: "channel", op: "in", value: ["launch"] });
    expect(fired(ev({ args: { channel: "launch" } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { channel: "general" } }), [r])).toEqual([]);
  });

  it("not_in holds when the value is not listed", () => {
    const r = denyWhen({ path: "channel", op: "not_in", value: ["launch"] });
    expect(fired(ev({ args: { channel: "general" } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { channel: "launch" } }), [r])).toEqual([]);
  });

  it("matches tests a regex, honouring a leading (?i)", () => {
    const r = denyWhen({ path: "query", op: "matches", value: "(?i)^password" });
    expect(fired(ev({ args: { query: "PASSWORD reset" } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { query: "reset password" } }), [r])).toEqual([]);
  });

  it("matches also tests the normalized form of a URL", () => {
    // 0x0a000001 is 10.0.0.1; the WHATWG parser normalizes it, so a dotted-quad regex still catches it.
    const r = denyWhen({ path: "url", op: "matches", value: "^https?://(\\d{1,3}\\.){3}\\d{1,3}([:/?#]|$)" });
    expect(fired(ev({ args: { url: "http://0x0a000001/x" } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { url: "http://example.com/" } }), [r])).toEqual([]);
  });

  it("not_matches holds when the regex does not match", () => {
    const r = denyWhen({ path: "query", op: "not_matches", value: "^safe:" });
    expect(fired(ev({ args: { query: "anything" } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { query: "safe: weather" } }), [r])).toEqual([]);
  });

  it("max_len holds when the value is at most N characters", () => {
    const r = denyWhen({ path: "query", op: "max_len", value: 5 });
    expect(fired(ev({ args: { query: "12345" } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { query: "123456" } }), [r])).toEqual([]);
  });

  it("a constraint on a missing arg never makes a restricting rule fire", () => {
    const r = denyWhen({ path: "url", op: "host_not_in", value: ["docs.acme.com"] });
    expect(fired(ev({ args: { url: "https://evil.example/" } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { query: "x" } }), [r])).toEqual([]);
  });

  it("requires every constraint to hold", () => {
    const r = toolRule({
      args: [
        { path: "url", op: "domain_in", value: ["acme.com"] },
        { path: "method", op: "in", value: ["POST"] },
      ],
    });
    expect(fired(ev({ args: { url: "https://acme.com/", method: "POST" } }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ args: { url: "https://acme.com/", method: "GET" } }), [r])).toEqual([]);
  });
});

describe("decide: when conditions", () => {
  it("contextLabels.any needs one matching label in context (globs allowed)", () => {
    const r = toolRule({ when: { contextLabels: { any: ["pii.*"] } } });
    expect(fired(ev({ contextLabels: ["pii.email"] }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ contextLabels: ["untrusted"] }), [r])).toEqual([]);
  });

  it("contextLabels.none fails when a listed label is in context", () => {
    const r = toolRule({ when: { contextLabels: { none: ["owner_private"] } } });
    expect(fired(ev({ contextLabels: [] }), [r])).toEqual(["r_tool01"]);
    expect(fired(ev({ contextLabels: ["owner_private"] }), [r])).toEqual([]);
  });

  it("argLabels look at the labels of spans in the args", () => {
    const span = { path: "body", start: 0, end: 4, label: "pii.phone" };
    const any = toolRule({ when: { argLabels: { any: ["pii.phone"] } } });
    const none = toolRule({ id: "r_tool02", when: { argLabels: { none: ["pii.*"] } } });
    expect(fired(ev({ argSpans: [span] }), [any, none])).toEqual(["r_tool01"]);
    expect(fired(ev({ argSpans: [] }), [any, none])).toEqual(["r_tool02"]);
  });

  it("destFromUntrusted holds when the destination arg carries an untrusted span", () => {
    const r = toolRule({ when: { destFromUntrusted: true } });
    const url = "https://evil.example/?d=";
    const onDest = ev({ tool: "fetch_page", args: { url }, argSpans: [{ path: "url", start: 8, end: 20, label: "untrusted" }] });
    const onBody = ev({
      tool: "send_email",
      args: { to: ["sam@acme.com"], body: "hello" },
      argSpans: [{ path: "body", start: 0, end: 5, label: "untrusted" }],
    });
    const onRecipient = ev({
      tool: "send_email",
      args: { to: ["sam@acme.com", "eve@evil.example"] },
      argSpans: [{ path: "to[1]", start: 0, end: 16, label: "untrusted" }],
    });
    expect(fired(onDest, [r])).toEqual(["r_tool01"]);
    expect(fired(onBody, [r])).toEqual([]);
    expect(fired(onRecipient, [r])).toEqual(["r_tool01"]);
  });
});

describe("decide: flow rules", () => {
  const awsSpan = { path: "body", start: 6, end: 26, label: "secret.aws" };

  it("matches label globs on arg spans against sink globs", () => {
    const r = flowRule({ labels: ["secret.*"], sinks: ["api:*", "web"] });
    expect(effect(ev({ argSpans: [awsSpan], sinks: ["api:github.com"] }), [r])).toBe("block");
    expect(fired(ev({ argSpans: [awsSpan], sinks: ["email"] }), [r])).toEqual([]);
    expect(fired(ev({ argSpans: [{ ...awsSpan, label: "pii.email" }], sinks: ["web"] }), [r])).toEqual([]);
  });

  it("matches project:* against a project label", () => {
    const r = flowRule({ labels: ["project:*"], sinks: ["project:other"] });
    expect(effect(ev({ argSpans: [{ path: "text", start: 0, end: 3, label: "project:acme" }], sinks: ["project:other"] }), [r])).toBe("block");
  });

  it("a block or ask flow also fires on a label that is only in context", () => {
    const r = flowRule({ labels: ["project:*"], sinks: ["memory:global"], action: "ask" });
    const allow = toolRule({ effect: "allow" });
    const e = ev({ contextLabels: ["project:acme"], sinks: ["memory:global"] });
    expect(effect(e, [r, allow])).toBe("ask");
    expect(fired(e, [r, allow])).toEqual(["r_flow01", "r_tool01"]);
  });

  it("a rewrite flow emits one transform per matching span and nothing for context-only labels", () => {
    const r = flowRule({ labels: ["secret.*"], sinks: ["model:crusoe"], action: "tokenize" });
    const both = ev({ argSpans: [awsSpan], contextLabels: ["secret.github"], sinks: ["model:crusoe"] });
    expect(decide(both, [r], [], NOW).transforms).toEqual([{ ...awsSpan, action: "tokenize" }]);
    const contextOnly = ev({ contextLabels: ["secret.github"], sinks: ["model:crusoe"] });
    expect(decide(contextOnly, [r], [], NOW).transforms).toEqual([]);
    expect(fired(contextOnly, [r])).toEqual([]);
  });

  it("keeps the most restrictive rewrite per span", () => {
    const redact = flowRule({ id: "r_flow01", labels: ["secret.*"], sinks: ["model:crusoe"], action: "redact" });
    const tokenize = flowRule({ id: "r_flow02", labels: ["secret.aws"], sinks: ["model:*"], action: "tokenize" });
    const d = decide(ev({ argSpans: [awsSpan], sinks: ["model:crusoe"] }), [redact, tokenize], [], NOW);
    expect(d.transforms).toEqual([{ ...awsSpan, action: "tokenize" }]);
  });

  it("applies `where` constraints to the args", () => {
    const r = flowRule({ labels: ["pii.*"], sinks: ["email"], where: [{ path: "to[*]", op: "domain_not_in", value: ["acme.com"] }] });
    const span = { path: "body", start: 0, end: 3, label: "pii.email" };
    expect(fired(ev({ args: { to: ["eve@evil.example"] }, argSpans: [span], sinks: ["email"] }), [r])).toEqual(["r_flow01"]);
    expect(fired(ev({ args: { to: ["sam@acme.com"] }, argSpans: [span], sinks: ["email"] }), [r])).toEqual([]);
  });
});

describe("decide: combining", () => {
  it("most restrictive wins across a tool rule and a flow rule", () => {
    const allow = toolRule({ effect: "allow" });
    const block = flowRule({ labels: ["secret.*"], sinks: ["email"] });
    const d = decide(ev({ argSpans: [{ path: "body", start: 0, end: 4, label: "secret.aws" }], sinks: ["email"] }), [allow, block], [], NOW);
    expect(d.effect).toBe("block");
    expect(d.firedRuleIds).toEqual(["r_flow01", "r_tool01"]);
  });

  it("an ask beats a rewrite, and the rewrite is still listed", () => {
    const ask = toolRule({ effect: "ask" });
    const redact = flowRule({ labels: ["pii.email"], sinks: ["email"], action: "redact" });
    const span = { path: "body", start: 0, end: 4, label: "pii.email" };
    const d = decide(ev({ argSpans: [span], sinks: ["email"] }), [ask, redact], [], NOW);
    expect(d.effect).toBe("ask");
    expect(d.transforms).toEqual([{ ...span, action: "redact" }]);
  });

  it("most restrictive wins between two tool rules", () => {
    const allow = toolRule({ id: "r_tool01", effect: "allow" });
    const ask = toolRule({ id: "r_tool02", effect: "ask" });
    expect(effect(ev(), [allow, ask])).toBe("ask");
  });

  it("an allow rule that matches replaces the default", () => {
    const e = ev({ tool: "zz_unknown_tool" });
    expect(effect(e, [])).toBe("ask");
    expect(effect(e, [toolRule({ effect: "allow" })])).toBe("allow");
    expect(fired(e, [toolRule({ effect: "allow" })])).toEqual(["r_tool01"]);
  });

  it("reports the labels in the args and the context", () => {
    const d = decide(ev({ argSpans: [{ path: "a", start: 0, end: 1, label: "pii.email" }], contextLabels: ["untrusted", "pii.email"] }), [], [], NOW);
    expect(d.labels).toEqual(["pii.email", "untrusted"]);
  });
});
