import { describe, expect, it } from "vitest";
import { decide } from "@/lib/policy/engine";
import { DEFAULT_RULES } from "@/lib/policy/defaults";
import { RuleSchema } from "@/lib/policy/schema";
import type { GrantRule, PolicyEvent } from "@/lib/policy/types";

const NOW = new Date("2026-10-17T12:00:00Z");

function ev(over: Partial<PolicyEvent>): PolicyEvent {
  return { agentId: "pip", archetype: "researcher", projectId: "a", tool: "zz_probe", args: {}, argSpans: [], contextLabels: [], sinks: [], ...over };
}
const run = (e: PolicyEvent, grants: GrantRule[] = []) => decide(e, DEFAULT_RULES, grants, NOW);

const AWS = "AKIAIOSFODNN7EXAMPLE";
const awsSpan = (path: string, start = 0) => ({ path, start, end: start + AWS.length, label: "secret.aws" });

function grantFor(tool: string, over: Partial<GrantRule> = {}): GrantRule {
  return { id: "r_grant1", kind: "grant", scope: {}, tool, grantScope: "always", createdBy: "approval", ...over };
}

describe("baseline rules", () => {
  it("are valid policy/v1 rules with unique ids, made by default, for everyone", () => {
    for (const r of DEFAULT_RULES) expect(RuleSchema.safeParse(r).success, r.id).toBe(true);
    expect(new Set(DEFAULT_RULES.map((r) => r.id)).size).toBe(DEFAULT_RULES.length);
    expect(DEFAULT_RULES.every((r) => r.createdBy === "default" && Object.keys(r.scope).length === 0)).toBe(true);
    expect(DEFAULT_RULES.length).toBeGreaterThanOrEqual(10);
  });

  it("R1: tokenizes a secret before it reaches the model", () => {
    const d = run(ev({ tool: "model_call", args: { prompt: `key ${AWS}` }, argSpans: [awsSpan("prompt", 4)], sinks: ["model:crusoe"] }));
    expect(d.effect).toBe("tokenize");
    expect(d.transforms).toEqual([{ ...awsSpan("prompt", 4), action: "tokenize" }]);
  });

  it("R1: redacts a secret in a LangSmith trace and in memory", () => {
    const trace = run(ev({ tool: "trace_export", args: { inputs: AWS }, argSpans: [awsSpan("inputs")], sinks: ["trace:langsmith"] }));
    expect(trace.transforms).toEqual([{ ...awsSpan("inputs"), action: "redact" }]);
    const memory = run(ev({ tool: "write_file", args: { content: AWS }, argSpans: [awsSpan("content")], sinks: ["memory:self"] }));
    expect(memory.effect).toBe("redact");
  });

  it("R1: blocks a secret in email args, even with a grant for the recipient", () => {
    const e = ev({ tool: "send_email", args: { to: ["sam@acme.com"], body: AWS }, argSpans: [awsSpan("body")], sinks: ["email"] });
    expect(run(e).effect).toBe("block");
    expect(run(e, [grantFor("send_email")]).effect).toBe("block");
    expect(run(e).firedRuleIds).toContain("r_secr03");
  });

  it("R1: blocks a secret in a web search query", () => {
    expect(run(ev({ tool: "web_search", args: { query: AWS }, argSpans: [awsSpan("query")], sinks: ["web"] })).effect).toBe("block");
  });

  it.each(["http://10.0.0.1", "http://10.0.0.1:8080/admin", "HTTP://user@10.0.0.1/", "http://0x0a000001/", "http://10.1/", "http://[::1]/"])(
    "R2: denies fetch_page to the raw IP %s",
    (url) => {
      expect(run(ev({ tool: "fetch_page", args: { url }, sinks: ["web"] })).effect).toBe("deny");
    },
  );

  it("R2: denies a raw IP in a list of URLs too", () => {
    expect(run(ev({ tool: "fetch_page", args: { urls: ["https://acme.com/", "http://10.0.0.1/"] }, sinks: ["web"] })).effect).toBe("deny");
  });

  it("R2: still allows fetch_page to a named public host", () => {
    expect(run(ev({ tool: "fetch_page", args: { url: "https://docs.acme.com/guide" }, sinks: ["web"] })).effect).toBe("allow");
  });

  it.each(["https://pastebin.com/raw/abc", "https://x1.webhook.site/", "https://abc.ngrok-free.app/", "https://transfer.sh/x"])(
    "R2: denies paste and tunnel hosts: %s",
    (url) => {
      expect(run(ev({ tool: "fetch_page", args: { url }, sinks: ["web"] })).effect).toBe("deny");
    },
  );

  it("R3: asks before fetching a URL that came from untrusted content", () => {
    const url = "https://evil.example/?d=notes";
    const e = ev({ tool: "fetch_page", args: { url }, argSpans: [{ path: "url", start: 0, end: url.length, label: "untrusted" }], contextLabels: ["untrusted"], sinks: ["web"] });
    expect(run(e).effect).toBe("ask");
    expect(run({ ...e, argSpans: [] }).effect).toBe("allow");
  });

  it("R3: a grant can't lift the taint ask on an email to a recipient from untrusted content", () => {
    const e = ev({
      tool: "send_email",
      args: { to: ["eve@evil.example"] },
      argSpans: [{ path: "to[0]", start: 0, end: 16, label: "untrusted" }],
      contextLabels: ["untrusted"],
      sinks: ["email"],
    });
    expect(run(e, [grantFor("send_email")]).effect).toBe("ask");
    expect(run(e).firedRuleIds).toContain("r_taint1");
  });

  it("R4: blocks project:a content going to another project", () => {
    const e = ev({ tool: "post_message", args: { text: "plan" }, argSpans: [{ path: "text", start: 0, end: 4, label: "project:a" }], sinks: ["project:other"] });
    expect(run(e).effect).toBe("block");
    expect(run(e).firedRuleIds).toContain("r_proj01");
  });

  it("R4: asks before project data goes into cross-project memory, and a grant can lift it", () => {
    const e = ev({ tool: "dream_write", args: { text: "lesson" }, contextLabels: ["project:a"], sinks: ["memory:global"] });
    expect(run(e).effect).toBe("ask");
    expect(run(e).firedRuleIds).toContain("r_proj02");
    expect(run(e, [grantFor("dream_write")]).effect).toBe("allow");
  });

  it("R4: lets an agent write its own project memory", () => {
    expect(run(ev({ tool: "dream_write", contextLabels: ["project:a"], sinks: ["memory:self"] })).effect).toBe("allow");
  });

  it("R6: asks before every email, and a recipient grant lifts it", () => {
    const e = ev({ tool: "send_email", args: { to: ["sam@acme.com"] }, sinks: ["email"] });
    expect(run(e).effect).toBe("ask");
    expect(run(e).firedRuleIds).toContain("r_mail01");
    const g = grantFor("send_email", { args: [{ path: "to[*]", op: "in", value: ["sam@acme.com"] }], grantScope: "project" });
    expect(run(e, [g]).effect).toBe("allow");
  });

  it("R6: asks before every purchase, and no grant lifts it", () => {
    const e = ev({ tool: "purchase_flight", args: { amount: 120 }, sinks: ["api:airline.example"] });
    expect(run(e).effect).toBe("ask");
    expect(run(e, [grantFor("purchase_*")]).effect).toBe("ask");
    expect(run(e).firedRuleIds).toContain("r_buy001");
  });
});
