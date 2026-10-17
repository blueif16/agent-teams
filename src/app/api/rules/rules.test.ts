/*
 * The rules API, calling the route handlers directly: a Request in, a Response out. The store lives in a temp dir
 * (POLICY_DIR) and Crusoe is a fake fetch that returns complete chat-completion bodies.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "@/app/api/rules/[id]/route";
import { POST as COMPILE } from "@/app/api/rules/compile/route";
import { GET, POST } from "@/app/api/rules/route";
import { DEFAULT_RULES } from "@/lib/policy/defaults";
import { listDetectors } from "@/lib/policy/detectors";
import type { CompileResult, Rule, RulesResponse } from "@/lib/policy/types";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "rules-api-"));
  vi.stubEnv("POLICY_DIR", dir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

const get = (query = "") => GET(new Request(`http://localhost/api/rules${query}`));
const post = (body: unknown) => POST(new Request("http://localhost/api/rules", { method: "POST", body: JSON.stringify(body) }));
const del = (id: string) => DELETE(new Request(`http://localhost/api/rules/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
const compile = (body: unknown) => COMPILE(new Request("http://localhost/api/rules/compile", { method: "POST", body: JSON.stringify(body) }));

const rule = (over: Partial<Rule> = {}): Rule =>
  ({ id: "r_own001", kind: "tool", scope: {}, match: { tools: ["web_search"] }, effect: "deny", createdBy: "owner", ...over }) as Rule;

function fakeCrusoe(contents: string[]) {
  const calls: unknown[] = [];
  vi.stubEnv("CRUSOE_API_KEY", "test-key");
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const content = contents.shift();
    if (content === undefined) throw new Error("fake Crusoe: no reply scripted");
    return Response.json({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1760702400,
      model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content, reasoning_content: null, tool_calls: [] }, logprobs: null, finish_reason: "stop" }],
      usage: { prompt_tokens: 2100, completion_tokens: 180, total_tokens: 2280, prompt_tokens_details: { cached_tokens: 0 } },
    });
  });
  return calls;
}

describe("GET /api/rules", () => {
  it("returns the rules in force with a read-back each, the tiers and the detectors", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as RulesResponse;
    expect(body.rules.map((r) => r.id)).toEqual(DEFAULT_RULES.map((r) => r.id));
    expect(Object.keys(body.readBack).sort()).toEqual(DEFAULT_RULES.map((r) => r.id).sort());
    expect(body.readBack.r_proj01).toBe("Block project data from going to other projects.");
    expect(body.tiers.map((t) => t.tier)).toEqual(["T0", "T1", "T2", "T3", "T4", "T5", "T6", "T7"]);
    expect(body.detectors).toEqual(listDetectors());
    expect(body).not.toHaveProperty("capabilities");
    expect(body).not.toHaveProperty("permissions");
    expect(body.data?.find((g) => g.label === "Secrets and keys")).toMatchObject({ outcome: "block", locked: true });
  });

  it("gives an agent's permissions after its rules", async () => {
    expect((await post({ rules: [rule({ scope: { agents: ["mira"] } })], mode: "enforce" })).status).toBe(201);
    const res = await get("?agent=mira");
    expect(res.status).toBe(200);
    const body = (await res.json()) as RulesResponse;
    const perm = Object.fromEntries((body.permissions ?? []).map((p) => [p.id, p]));
    expect(perm["web.search"]).toMatchObject({ access: "deny", ruleIds: ["r_own001"] });
    expect(perm.email?.access).toBe("ask");
    expect(perm.code?.access).toBe("deny");
  });

  it("404s an unknown agent unless its archetype is given", async () => {
    expect((await get("?agent=zed")).status).toBe(404);
    const res = await get("?agent=zed&archetype=researcher");
    expect(res.status).toBe(200);
    expect(((await res.json()) as RulesResponse).permissions).toHaveLength(15);
  });

  it("lists only the rules that can apply to the agent and project asked about", async () => {
    const saved = await post({ rules: [rule({ id: "r_blue01", scope: { projects: ["bluebird"] } }), rule({ id: "r_rexx01", scope: { agents: ["rex"] } })], mode: "enforce" });
    expect(saved.status).toBe(201);
    const ids = async (q: string) => ((await (await get(q)).json()) as RulesResponse).rules.map((r) => r.id);
    expect(await ids("?project=bluebird")).toContain("r_blue01");
    expect(await ids("?project=acme")).not.toContain("r_blue01");
    expect(await ids("?agent=mira")).not.toContain("r_rexx01");
    expect(await ids("")).toEqual(expect.arrayContaining(["r_blue01", "r_rexx01"]));
  });
});

describe("POST /api/rules", () => {
  it("saves rules in the requested mode and returns them with their final ids (201)", async () => {
    const res = await post({ rules: [rule(), rule({ id: "r_secr01" })], mode: "shadow" });
    expect(res.status).toBe(201);
    const { rules } = (await res.json()) as { rules: Rule[] };
    expect(rules).toHaveLength(2);
    expect(rules[0].id).toBe("r_own001");
    expect(rules[1].id).not.toBe("r_secr01");
    expect(rules.every((r) => r.mode === "shadow")).toBe(true);
    const listed = ((await (await get()).json()) as RulesResponse).rules.map((r) => r.id);
    expect(listed).toEqual(expect.arrayContaining(rules.map((r) => r.id)));
  });

  it("rejects invalid rules with the failing paths (400) and saves nothing", async () => {
    const res = await post({ rules: [{ ...rule(), scope: { agent: ["pip"] } }], mode: "enforce" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: string[] };
    expect(body.issues.some((i) => i.startsWith("rules.0.scope"))).toBe(true);
    expect(((await (await get()).json()) as RulesResponse).rules).toHaveLength(DEFAULT_RULES.length);
  });

  it("rejects a bad mode or a missing rules list (400)", async () => {
    expect((await post({ rules: [rule()], mode: "loud" })).status).toBe(400);
    expect((await post({ mode: "enforce" })).status).toBe(400);
  });
});

describe("POST /api/rules/compile", () => {
  it("compiles a sentence into a CompileResult", async () => {
    const calls = fakeCrusoe([JSON.stringify({ rules: [{ kind: "tool", scope: { agents: ["mira"] }, match: { tools: ["execute"] }, effect: "deny" }], assumptions: [], questions: [] })]);
    const res = await compile({ text: "Mira can never run shell commands.", agent: "mira" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CompileResult;
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0]).toMatchObject({ createdBy: "nl-compiler", source: { nl: "Mira can never run shell commands." } });
    expect(body.readBack).toEqual(["Mira can't run shell commands."]);
    expect(body.dryRun).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("returns 422 with the issues when the model's rules stay invalid", async () => {
    const bad = JSON.stringify({ rules: [{ kind: "tool", scope: {}, match: { tools: ["send_fax"] }, effect: "deny" }], assumptions: [], questions: [] });
    fakeCrusoe([bad, bad]);
    const res = await compile({ text: "No faxes." });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { issues: string[] }).issues.join("\n")).toMatch(/send_fax/);
  });

  it("rejects a missing sentence (400)", async () => {
    expect((await compile({ text: "  " })).status).toBe(400);
  });
});

describe("DELETE /api/rules/[id]", () => {
  it("deletes an owner rule", async () => {
    await post({ rules: [rule()], mode: "enforce" });
    const res = await del("r_own001");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(((await (await get()).json()) as RulesResponse).rules.map((r) => r.id)).not.toContain("r_own001");
  });

  it("refuses a locked rule with 400", async () => {
    await post({ rules: [rule({ locked: true })], mode: "enforce" });
    const res = await del("r_own001");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/locked/i);
    expect(((await (await get()).json()) as RulesResponse).rules.map((r) => r.id)).toContain("r_own001");
  });

  it("refuses a default rule with 400", async () => {
    const res = await del("r_secr03");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/default|built-in/i);
  });

  it("404s a rule that doesn't exist", async () => {
    expect((await del("r_nope00")).status).toBe(404);
  });
});
