/*
 * The NL compiler against a FAKE Crusoe: every reply is a complete chat-completion body, so a parser that reads a
 * field the real API doesn't send (or skips one it does) breaks here too.
 */
import { describe, expect, it } from "vitest";
import { compileRules, type CompileContext } from "@/lib/policy/compile";
import { DEFAULT_RULES } from "@/lib/policy/defaults";
import { readBack } from "@/lib/policy/readback";
import { MODELS } from "@/lib/models";

const NOW = new Date("2026-10-17T12:00:00Z");
const CTX: CompileContext = {
  agents: [
    { id: "mira", name: "Mira", archetype: "chief" },
    { id: "pip", name: "Pip", archetype: "coordinator" },
    { id: "rex", name: "Rex", archetype: "researcher" },
  ],
  projects: ["acme-launch", "bluebird"],
  rules: DEFAULT_RULES,
  now: NOW,
};
const TEXT = "Rex can't send email.";

function completion(model: string, content: string) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1760702400,
    model,
    choices: [{ index: 0, message: { role: "assistant", content, reasoning_content: null, tool_calls: [] }, logprobs: null, finish_reason: "stop" }],
    usage: { prompt_tokens: 2100, completion_tokens: 180, total_tokens: 2280, prompt_tokens_details: { cached_tokens: 0 } },
  };
}

interface Call {
  url: string;
  body: { model: string; temperature: number; messages: { role: string; content: string }[] };
}

/** A fake fetch that answers each call with the next scripted reply: a content string (200) or a status number. */
function fakeCrusoe(replies: (string | number)[]) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), body });
    const next = replies.shift();
    if (next === undefined) throw new Error("fake Crusoe: no reply scripted");
    if (typeof next === "number") return new Response(JSON.stringify({ error: { message: "at capacity", code: next } }), { status: next });
    return Response.json(completion(body.model, next));
  }) as typeof fetch;
  return { fetchFn, calls };
}

const deps = (fetchFn: typeof fetch) => ({ fetch: fetchFn, apiKey: "test-key", sleep: async () => {} });
const json = (v: unknown) => JSON.stringify(v);

const DENY_REX = { kind: "tool", scope: { agents: ["rex"] }, match: { tools: ["send_email"] }, effect: "deny" };
const VALID = json({ rules: [DENY_REX], assumptions: [], questions: [] });

describe("compileRules", () => {
  it("turns valid model output into rules with code-made ids, the sentence as source, and read-backs", async () => {
    const { fetchFn, calls } = fakeCrusoe([json({ rules: [{ ...DENY_REX, id: "r_model1", createdBy: "owner" }], assumptions: ["x"], questions: [] })]);
    const out = await compileRules({ text: TEXT }, CTX, deps(fetchFn));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const [rule] = out.result.rules;
    expect(rule.id).toMatch(/^r_[a-z0-9]{6,}$/);
    expect(rule.id).not.toBe("r_model1");
    expect(rule.createdBy).toBe("nl-compiler");
    expect(rule.source).toEqual({ nl: TEXT });
    expect(out.result.readBack).toEqual([readBack(rule)]);
    expect(out.result.readBack).toEqual(["Rex can't send email."]);
    expect(out.result.assumptions).toEqual(["x"]);
    expect(out.result.dryRun).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("asks GLM-5.3 at temperature 0, with the catalog and rules in force as trusted context", async () => {
    const { fetchFn, calls } = fakeCrusoe([VALID]);
    await compileRules({ text: TEXT }, CTX, deps(fetchFn));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/chat\/completions$/);
    expect(calls[0].body.model).toBe(MODELS.advisor);
    expect(calls[0].body.temperature).toBe(0);
    const prompt = calls[0].body.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain(TEXT);
    expect(prompt).toContain("send_email");
    expect(prompt).toContain("r_secr01");
    expect(prompt).toContain("acme-launch");
  });

  it("falls back along modelChain(advisor) when GLM-5.3 is at capacity", async () => {
    const { fetchFn, calls } = fakeCrusoe([429, 429, 429, VALID]);
    const out = await compileRules({ text: TEXT }, CTX, deps(fetchFn));
    expect(out.ok).toBe(true);
    expect(calls.map((c) => c.body.model)).toEqual([MODELS.advisor, MODELS.advisor, MODELS.advisor, MODELS.main]);
  });

  it("reports the model as unavailable when every model in the chain fails", async () => {
    const { fetchFn } = fakeCrusoe([429, 429, 429, 503, 503]);
    const out = await compileRules({ text: TEXT }, CTX, deps(fetchFn));
    expect(out).toMatchObject({ ok: false, status: 502 });
  });

  it("makes exactly one repair call naming the failing path, then succeeds", async () => {
    const bad = json({ rules: [{ ...DENY_REX, scope: { agent: ["rex"] } }], assumptions: [], questions: [] });
    const { fetchFn, calls } = fakeCrusoe([bad, VALID]);
    const out = await compileRules({ text: TEXT }, CTX, deps(fetchFn));
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(2);
    const repair = calls[1].body.messages;
    expect(repair.at(-2)).toEqual({ role: "assistant", content: bad });
    expect(repair.at(-1)?.content).toContain("rules.0.scope");
  });

  it("returns an error, never a half-valid rule, when the repair is still invalid", async () => {
    const half = json({ rules: [DENY_REX, { kind: "tool", scope: {}, match: { tools: ["send_email"] }, effect: "maybe" }], assumptions: [], questions: [] });
    const { fetchFn, calls } = fakeCrusoe([half, half]);
    const out = await compileRules({ text: TEXT }, CTX, deps(fetchFn));
    expect(calls).toHaveLength(2);
    expect(out).toMatchObject({ ok: false, status: 422 });
    expect(out).not.toHaveProperty("result");
    if (!out.ok) expect(out.issues.some((i) => i.startsWith("rules.1.effect"))).toBe(true);
  });

  it("repairs output that isn't JSON", async () => {
    const { fetchFn, calls } = fakeCrusoe(["Sure! Here is the rule you asked for.", "```json\n" + VALID + "\n```"]);
    const out = await compileRules({ text: TEXT }, CTX, deps(fetchFn));
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("returns the questions for an ambiguous sentence", async () => {
    const q = { q: "Does 'send' also cover web uploads and API calls?", options: ["Email, web uploads and APIs", "Email only"] };
    const { fetchFn } = fakeCrusoe([json({ rules: [], assumptions: [], questions: [q] })]);
    const out = await compileRules({ text: "Never send anything from Acme outside acme.com." }, CTX, deps(fetchFn));
    expect(out.ok && out.result.questions).toEqual([q]);
  });

  it("treats more than 3 questions, or a question with 1 option, as invalid", async () => {
    const q = { q: "Which?", options: ["a", "b"] };
    const tooMany = json({ rules: [], assumptions: [], questions: [q, q, q, q] });
    const oneOption = json({ rules: [], assumptions: [], questions: [{ q: "Which?", options: ["a"] }] });
    const { fetchFn } = fakeCrusoe([tooMany, oneOption]);
    expect(await compileRules({ text: TEXT }, CTX, deps(fetchFn))).toMatchObject({ ok: false, status: 422 });
  });

  it("rejects invented tools, agents, projects and labels", async () => {
    const invented = json({
      rules: [
        { kind: "tool", scope: { agents: ["zed"] }, match: { tools: ["send_fax"] }, effect: "deny" },
        { kind: "flow", scope: { projects: ["globex"] }, labels: ["pii.*", "project:globex"], sinks: ["email"], action: "block" },
      ],
      assumptions: [],
      questions: [],
    });
    const { fetchFn } = fakeCrusoe([invented, invented]);
    const out = await compileRules({ text: TEXT }, CTX, deps(fetchFn));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.issues.join("\n")).toMatch(/send_fax/);
    expect(out.issues.join("\n")).toMatch(/zed/);
    expect(out.issues.join("\n")).toMatch(/globex/);
  });

  it("rejects an arg path the tool doesn't have, so a constraint can't silently never match", async () => {
    const wrongPath = json({
      rules: [{ kind: "flow", scope: {}, labels: ["pii.*"], sinks: ["email"], where: [{ path: "recipient", op: "domain_not_in", value: ["acme.com"] }], action: "block" }],
      assumptions: [],
      questions: [],
    });
    const { fetchFn } = fakeCrusoe([wrongPath, wrongPath]);
    const out = await compileRules({ text: TEXT }, CTX, deps(fetchFn));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.issues.join("\n")).toMatch(/recipient/);
  });

  it("rejects a grant on a locked rule and an allow for secrets", async () => {
    const relax = json({
      rules: [
        { kind: "grant", scope: {}, tool: "purchase_*", grantScope: "always" },
        { kind: "flow", scope: {}, labels: ["secret.*"], sinks: ["web"], action: "allow" },
      ],
      assumptions: [],
      questions: [],
    });
    const { fetchFn } = fakeCrusoe([relax, relax]);
    const out = await compileRules({ text: TEXT }, CTX, deps(fetchFn));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.issues.some((i) => i.startsWith("rules.0") && /r_buy001/.test(i))).toBe(true);
    expect(out.issues.some((i) => i.startsWith("rules.1") && /secret/i.test(i))).toBe(true);
  });

  it("attaches conflicts with the rules in force", async () => {
    const dup = json({ rules: [{ kind: "flow", scope: {}, labels: ["secret.*"], sinks: ["model:*"], action: "tokenize" }], assumptions: [], questions: [] });
    const { fetchFn } = fakeCrusoe([dup]);
    const out = await compileRules({ text: "Don't let my API keys reach the model." }, CTX, deps(fetchFn));
    expect(out.ok && out.result.conflicts.map((c) => [c.kind, c.otherRuleId])).toEqual([["duplicate", "r_secr01"]]);
  });

  it("strips mode and locked from model output: saving decides those", async () => {
    const { fetchFn } = fakeCrusoe([json({ rules: [{ ...DENY_REX, mode: "shadow", locked: true }], assumptions: [], questions: [] })]);
    const out = await compileRules({ text: TEXT }, CTX, deps(fetchFn));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.rules[0]).not.toHaveProperty("mode");
    expect(out.result.rules[0]).not.toHaveProperty("locked");
  });
});
