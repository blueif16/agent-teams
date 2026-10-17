/*
 * The NL compiler on file permissions, against a FAKE Crusoe replaying model outputs (complete chat-completion
 * bodies). The five sentences and their deterministic checks live in compile-files.cases.ts, shared with the live eval.
 */
import { describe, expect, it } from "vitest";
import { compileRules } from "@/lib/policy/compile";
import { FILE_CASES, FILES_CTX } from "@/lib/policy/compile-files.cases";
import { readBack } from "@/lib/policy/readback";
import { ZONES } from "@/lib/policy/zones";

function completion(model: string, content: string) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1760702400,
    model,
    choices: [{ index: 0, message: { role: "assistant", content, reasoning_content: null, tool_calls: [] }, logprobs: null, finish_reason: "stop" }],
    usage: { prompt_tokens: 5200, completion_tokens: 240, total_tokens: 5440, prompt_tokens_details: { cached_tokens: 0 } },
  };
}

type Msg = { role: string; content: string };

function fakeCrusoe(replies: string[]) {
  const calls: { messages: Msg[] }[] = [];
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    const next = replies.shift();
    if (next === undefined) throw new Error("fake Crusoe: no reply scripted");
    return Response.json(completion(body.model, next));
  }) as typeof fetch;
  return { fetchFn, calls };
}

const deps = (fetchFn: typeof fetch) => ({ fetch: fetchFn, apiKey: "test-key", sleep: async () => {} });
const json = (v: unknown) => JSON.stringify(v);
const WRITE = ["write_file", "edit_file"];

const HOME = ZONES.find((z) => z.id === "home")!;
const SECRETS = ZONES.find((z) => z.id === "secrets")!;

/** What the model answered for each sentence: one reply, or a first try and the repaired one. */
const REPLIES: Record<string, string[]> = {
  "readonly-except-report": [
    json({
      rules: [
        {
          kind: "tool",
          scope: { agents: ["rex"] },
          match: { tools: ["write_file", "edit_file", "delete_file"] },
          effect: "deny",
          args: [{ path: "path", op: "path_not_glob", value: ["/project/research.md"] }],
          reason: "Rex writes only its report",
        },
      ],
      assumptions: ['"The researcher" is Rex, the only researcher.'],
      questions: [],
    }),
  ],
  "bo-landing-copy": [
    json({
      rules: [{ kind: "tool", scope: { agents: ["bo"] }, match: { tools: WRITE }, effect: "allow", args: [{ path: "path", op: "path_glob", value: ["/project/docs/landing-copy.md"] }] }],
      assumptions: ['"The landing copy" is Ana\'s deliverable /project/docs/landing-copy.md.'],
      questions: [],
    }),
  ],
  "rex-soul": [
    json({ rules: [{ kind: "tool", scope: { agents: ["rex"] }, match: { tools: WRITE }, effect: "allow", args: [{ path: "path", op: "path_glob", value: "/home/SOUL.md" }] }], assumptions: [], questions: [] }),
    json({ rules: [], assumptions: [`Its soul, memory & notes are protected: ${HOME.reason}`], questions: [] }),
  ],
  "kai-env": [
    json({ rules: [{ kind: "tool", scope: { agents: ["kai"] }, match: { tools: ["read_file"] }, effect: "allow", args: [{ path: "path", op: "path_glob", value: "/project/.env" }] }], assumptions: [], questions: [] }),
    json({ rules: [], assumptions: [`Secrets & settings are forbidden: ${SECRETS.reason}`], questions: [] }),
  ],
  "rex-sources": [
    json({
      rules: [{ kind: "tool", scope: { agents: ["rex"] }, match: { tools: WRITE }, effect: "allow", args: [{ path: "path", op: "path_glob", value: ["/project/research/sources.md"] }] }],
      assumptions: [],
      questions: [],
    }),
  ],
};

describe("compileRules on file permissions", () => {
  it("gives the compiler the zone map and each agent's archetype, write scope and deliverables as trusted context", async () => {
    const { fetchFn, calls } = fakeCrusoe([...REPLIES["bo-landing-copy"]]);
    await compileRules({ text: "Let Bo edit the landing copy.", agent: "bo" }, FILES_CTX, deps(fetchFn));
    const user = calls[0].messages.find((m) => m.role === "user")!.content;
    const facts = JSON.parse(user.slice(user.indexOf("<facts>") + 7, user.indexOf("</facts>")));
    expect(facts.files?.zones?.find((z: { id: string }) => z.id === "state")).toMatchObject({ severity: "protected", paths: expect.arrayContaining(["/project/state/**"]) });
    expect(facts.files?.agents?.rex).toEqual({ archetype: "researcher", canWrite: ["/project/research.md"], deliverables: [] });
    expect(facts.files?.agents?.ana).toEqual({ archetype: "writer", canWrite: ["/project/docs/**", "/project/docs/landing-copy.md"], deliverables: ["/project/docs/landing-copy.md"] });
    expect(facts.files?.writeTools).toEqual(["write_file", "edit_file", "delete_file"]);
    expect(calls[0].messages[0].content).toContain("<files>");
  });

  for (const c of FILE_CASES) {
    it(`"${c.text}" compiles to rules that pass its checks`, async () => {
      const { fetchFn } = fakeCrusoe([...REPLIES[c.id]]);
      const out = await compileRules({ text: c.text }, FILES_CTX, deps(fetchFn));
      if (!out.ok) throw new Error(`${out.error}\n${out.issues.join("\n")}`);
      expect(c.check(out.result)).toEqual([]);
      expect(out.result.readBack).toEqual(out.result.rules.map(readBack));
    });
  }

  it("refuses an allow that opens a protected zone, telling the model the zone's reason in the repair turn", async () => {
    const { fetchFn, calls } = fakeCrusoe([...REPLIES["rex-soul"]]);
    const out = await compileRules({ text: "Rex should be able to rewrite his own SOUL.md." }, FILES_CTX, deps(fetchFn));
    expect(calls).toHaveLength(2);
    const repair = calls[1].messages.at(-1)!.content;
    expect(repair).toContain("rules.0.args.0.value");
    expect(repair).toContain(HOME.reason);
    expect(out.ok && out.result.rules).toEqual([]);
  });

  it("refuses an allow that would read a forbidden zone", async () => {
    const { fetchFn, calls } = fakeCrusoe([REPLIES["kai-env"][0], REPLIES["kai-env"][0]]);
    const out = await compileRules({ text: "Kai may read the .env file in the project." }, FILES_CTX, deps(fetchFn));
    expect(calls).toHaveLength(2);
    expect(calls[1].messages.at(-1)!.content).toContain(SECRETS.reason);
    expect(out).toMatchObject({ ok: false, status: 422 });
  });

  it("rejects an allow on file writes that names no files, or the whole shared folder", async () => {
    const bare = json({ rules: [{ kind: "tool", scope: { agents: ["bo"] }, match: { tools: WRITE }, effect: "allow" }], assumptions: [], questions: [] });
    const all = json({ rules: [{ kind: "tool", scope: { agents: ["bo"] }, match: { tools: WRITE }, effect: "allow", args: [{ path: "path", op: "path_glob", value: "/project/**" }] }], assumptions: [], questions: [] });
    for (const reply of [bare, all]) {
      const { fetchFn } = fakeCrusoe([reply, reply]);
      const out = await compileRules({ text: "Let Bo edit files." }, FILES_CTX, deps(fetchFn));
      expect(out).toMatchObject({ ok: false, status: 422, issues: [expect.stringMatching(/^rules\.0/)] });
    }
  });
});
