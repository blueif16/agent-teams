/*
 * Live eval of the NL compiler on E §5.3's five worked examples, against real Crusoe (GLM-5.3, falling back per
 * modelChain). Skipped unless CRUSOE_LIVE=1 and CRUSOE_API_KEY are set:
 *   CRUSOE_LIVE=1 npx vitest run src/lib/policy/compile.live.test.ts
 * Checks are deterministic: the rule kinds, effects/actions, labels, sinks and scope, and what decide() does with the
 * compiled rules on top of the defaults. None of these sentences appear in the compiler's prompt.
 */
import { describe, expect, it } from "vitest";
import { compileRules, type CompileContext } from "@/lib/policy/compile";
import { DEFAULT_RULES } from "@/lib/policy/defaults";
import { decide, globMatch } from "@/lib/policy/engine";
import type { CompileResult, PolicyEvent, Rule } from "@/lib/policy/types";

const LIVE = process.env.CRUSOE_LIVE === "1" && Boolean(process.env.CRUSOE_API_KEY);
const NOW = new Date();
const CTX: CompileContext = {
  agents: [
    { id: "mira", name: "Mira", archetype: "chief" },
    { id: "pip", name: "Pip", archetype: "coordinator" },
    { id: "rex", name: "Rex", archetype: "researcher" },
    { id: "kim", name: "Kim", archetype: "writer" },
  ],
  projects: ["acme-launch", "bluebird"],
  rules: DEFAULT_RULES,
  now: NOW,
};

async function compile(text: string): Promise<CompileResult> {
  const out = await compileRules({ text }, CTX);
  if (!out.ok) throw new Error(`${out.error}\n${out.issues.join("\n")}`);
  return out.result;
}

const ev = (over: Partial<PolicyEvent>): PolicyEvent => ({
  agentId: "pip",
  archetype: "coordinator",
  projectId: "acme-launch",
  tool: "zz_probe",
  args: {},
  argSpans: [],
  contextLabels: [],
  sinks: [],
  ...over,
});
const effect = (r: CompileResult, e: PolicyEvent) => decide(e, [...DEFAULT_RULES, ...r.rules], [], NOW).effect;
const covers = (patterns: string[], value: string) => patterns.some((p) => globMatch(p, value));
const flows = (r: CompileResult) => r.rules.filter((x): x is Extract<Rule, { kind: "flow" }> => x.kind === "flow");

describe.skipIf(!LIVE)("NL compiler, live (E §5.3)", { timeout: 300_000 }, () => {
  it("1. Never send anything from the Acme project to anyone outside acme.com.", async () => {
    const r = await compile("Never send anything from the Acme project to anyone outside acme.com.");
    const block = flows(r).find((f) => f.action === "block" && f.sinks.includes("email") && covers(f.labels, "project:acme-launch"));
    expect(block, JSON.stringify(r.rules)).toBeDefined();
    expect(block!.where?.some((c) => /^to/.test(c.path) && c.op === "domain_not_in" && [c.value].flat().includes("acme.com"))).toBe(true);
    const mail = (to: string) =>
      ev({ tool: "send_email", args: { to: [to] }, argSpans: [{ path: "body", start: 0, end: 4, label: "project:acme-launch" }], contextLabels: ["project:acme-launch"], sinks: ["email"] });
    expect(effect(r, mail("eve@evil.example"))).toBe("block");
    expect(effect(r, mail("sam@acme.com"))).toBe("ask");
    expect(r.questions.length).toBeGreaterThanOrEqual(1);
  });

  it("2. Researchers can browse freely but only Mira can email.", async () => {
    const r = await compile("Researchers can browse freely but only Mira can email.");
    expect(r.rules.some((x) => x.kind === "tool" && x.effect === "deny" && covers(x.match.tools, "send_email")), JSON.stringify(r.rules)).toBe(true);
    const mail = (agentId: string, archetype: PolicyEvent["archetype"]) => ev({ agentId, archetype, tool: "send_email", args: { to: ["sam@acme.com"] }, sinks: ["email"] });
    expect(effect(r, mail("rex", "researcher"))).toBe("deny");
    expect(effect(r, mail("pip", "coordinator"))).toBe("deny");
    expect(["ask", "allow"]).toContain(effect(r, mail("mira", "chief")));
    expect(effect(r, ev({ agentId: "rex", archetype: "researcher", tool: "fetch_page", args: { url: "https://docs.example.org/guide" }, sinks: ["web"] }))).toBe("allow");
    expect(r.questions.length).toBeGreaterThanOrEqual(1);
  });

  it("3. Don't let my API keys reach LangSmith or the model.", async () => {
    const r = await compile("Don't let my API keys reach LangSmith or the model.");
    for (const rule of r.rules) expect(r.conflicts.some((c) => c.ruleId === rule.id && (c.kind === "duplicate" || c.kind === "shadowed")), JSON.stringify(rule)).toBe(true);
    const span = [{ path: "messages", start: 0, end: 20, label: "secret.aws" }];
    expect(["tokenize", "block"]).toContain(effect(r, ev({ tool: "model_call", argSpans: span, sinks: ["model:crusoe"] })));
    expect(["redact", "tokenize", "block"]).toContain(effect(r, ev({ tool: "trace_export", argSpans: span, sinks: ["trace:langsmith"] })));
  });

  it("4. Pip can post in #launch without asking for the next 7 days.", async () => {
    const r = await compile("Pip can post in #launch without asking for the next 7 days.");
    const g = r.rules.find((x): x is Extract<Rule, { kind: "grant" }> => x.kind === "grant" && x.tool === "post_message");
    expect(g, JSON.stringify(r.rules)).toBeDefined();
    expect(g!.scope.agents).toEqual(["pip"]);
    const days = (Date.parse(g!.expiresAt ?? "") - NOW.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(6.5);
    expect(days).toBeLessThan(8.01);
    const post = (agentId: string, channel: string) => ev({ agentId, tool: "post_message", args: { channel, text: "hi" }, sinks: [] });
    expect([effect(r, post("pip", "launch")), effect(r, post("pip", "#launch"))]).toContain("allow");
    expect(effect(r, post("pip", "general"))).toBe("ask");
    expect(effect(r, post("rex", "launch"))).toBe("ask");
  });

  it("5. Keep what agents learn on Bluebird out of other projects.", async () => {
    const r = await compile("Keep what agents learn on Bluebird out of other projects.");
    const block = flows(r).find((f) => f.action === "block" && covers(f.labels, "project:bluebird"));
    expect(block, JSON.stringify(r.rules)).toBeDefined();
    expect(covers(block!.sinks, "memory:global") && covers(block!.sinks, "project:other")).toBe(true);
    const learn = (sink: string) => ev({ projectId: "bluebird", tool: "dream_write", contextLabels: ["project:bluebird"], sinks: [sink] });
    expect(effect(r, learn("memory:global"))).toBe("block");
    expect(effect(r, learn("project:other"))).toBe("block");
    expect(effect(r, learn("memory:self"))).toBe("allow");
  });
});
