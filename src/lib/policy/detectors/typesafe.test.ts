import { describe, expect, it } from "vitest";
import { scanDetailed } from "./pipeline";
import type { Span } from "./index";

/*
 * Fake TypeSafe: answers each question the way Jev did in the live check (2026-10-17, jev-1.13.0), with the complete
 * response shape it returned: { model, answers: { <id>: { type, choice, confidence, probabilities } }, usage }.
 */
interface Call {
  url: string;
  headers: Record<string, string>;
  body: { model: string; state: { text: string }; questions: Record<string, { type: string; instructions: string; criteria: Record<string, string> }> };
}

const CHOICES = ["secret", "person_name", "address", "gov_id", "account_number", "none"] as const;

function jevAnswer(choice: (typeof CHOICES)[number], p: number) {
  const probabilities = Object.fromEntries(CHOICES.map((c) => [c, c === choice ? p : c === "none" ? Math.round((1 - p) * 100) / 100 : 0]));
  return { type: "choice", choice, confidence: Math.round((p - 0.01) * 100) / 100, probabilities };
}

/** Judges a question by the quoted candidate in its instructions. */
function fakeTypesafe(judge: (candidate: string) => [(typeof CHOICES)[number], number]) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as Call["body"];
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()), body });
    const answers = Object.fromEntries(
      Object.entries(body.questions).map(([id, q]) => {
        const candidate = /"([^"]*)"/.exec(q.instructions)?.[1] ?? "";
        return [id, jevAnswer(...judge(candidate))];
      }),
    );
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 618, output_tokens: 124 } }), {
      status: 200,
      headers: { "content-type": "application/json", "x-typesafe-request-id": "req_test" },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const ENV = { TYPESAFE_API_KEY: "test-key-not-real" };
const GHP = "ghp_R7mQ2xL9vT4kN8pW3sY6dF1hJ5bC0gZaE2uI";
const EMAIL = "maria.lopez@acme-corp.io";
const TEXT = `Hi team, Jane Doe here. Deploy with key AKIAIOSFODNN7EXAMPLE and token ${GHP}; questions to ${EMAIL}.`;

const at = (text: string, value: string, label: string, detector: string): Span => {
  const start = text.indexOf(value);
  return { start, end: start + value.length, label, detector };
};

const judgeFixture = (candidate: string): [(typeof CHOICES)[number], number] =>
  candidate === "Jane Doe" ? ["person_name", 0.96] : candidate === "AKIAIOSFODNN7EXAMPLE" ? ["secret", 0.99] : ["none", 0.97];

describe("TypeSafe provider: layering", () => {
  it("replaces every local hit with a placeholder before the text leaves the machine", async () => {
    const ts = fakeTypesafe(judgeFixture);
    const local = await scanDetailed(TEXT);
    expect(local.spans.length).toBeGreaterThanOrEqual(2);
    await scanDetailed(TEXT, { hosted: true, env: ENV, fetch: ts.fetch });
    expect(ts.calls).toHaveLength(1);
    const sent = JSON.stringify(ts.calls[0].body);
    for (const s of local.spans) expect(sent).not.toContain(TEXT.slice(s.start, s.end));
    expect(ts.calls[0].body.state.text).toContain("[[REDACTED_1]]");
  });

  it("does not call TypeSafe when nothing is left to judge after the local pack", async () => {
    const ts = fakeTypesafe(judgeFixture);
    const result = await scanDetailed(`token ${GHP}`, { hosted: true, env: ENV, fetch: ts.fetch });
    expect(ts.calls).toHaveLength(0);
    expect(result.spans).toEqual([at(`token ${GHP}`, GHP, "secret.github", "gitleaks")]);
  });
});

describe("TypeSafe provider: request and mapping", () => {
  it("posts choice questions to /v1/systemone with a bearer key and jev-latest", async () => {
    const ts = fakeTypesafe(judgeFixture);
    await scanDetailed(TEXT, { hosted: true, env: ENV, fetch: ts.fetch });
    const [call] = ts.calls;
    expect(call.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(call.headers.authorization).toBe("Bearer test-key-not-real");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.body.model).toBe("jev-latest");
    const questions = Object.values(call.body.questions);
    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions) {
      expect(q.type).toBe("choice");
      expect(Object.keys(q.criteria)).toEqual([...CHOICES]);
    }
  });

  it("maps Jev's choices to labelled spans in the original text, next to the local spans", async () => {
    const ts = fakeTypesafe(judgeFixture);
    const result = await scanDetailed(TEXT, { hosted: true, env: ENV, fetch: ts.fetch });
    expect(result.degraded).toBeUndefined();
    expect(result.spans).toContainEqual(at(TEXT, "Jane Doe", "pii.person", "typesafe"));
    expect(result.spans).toContainEqual(at(TEXT, "AKIAIOSFODNN7EXAMPLE", "secret.generic", "typesafe"));
    expect(result.spans).toContainEqual(at(TEXT, GHP, "secret.github", "gitleaks"));
    expect(result.spans).toContainEqual(at(TEXT, EMAIL, "pii.email", "presidio-ports"));
  });

  it("maps address, gov_id and account_number too", async () => {
    const text = "Ship to Baker Street. Passport 5550123987 on file. Account 9900112233 at the bank.";
    const ts = fakeTypesafe((c) => (c === "Baker Street" ? ["address", 0.9] : c === "5550123987" ? ["gov_id", 0.8] : c === "9900112233" ? ["account_number", 0.85] : ["none", 0.99]));
    const result = await scanDetailed(text, { hosted: true, env: ENV, fetch: ts.fetch });
    expect(result.spans).toEqual([at(text, "Baker Street", "pii.address", "typesafe"), at(text, "5550123987", "pii.gov_id", "typesafe"), at(text, "9900112233", "pii.bank", "typesafe")]);
  });

  it("reports nothing for 'none' or for a choice below 0.5 confidence", async () => {
    const ts = fakeTypesafe((c) => (c === "Jane Doe" ? ["person_name", 0.4] : ["none", 0.97]));
    const result = await scanDetailed("Hi team, Jane Doe here.", { hosted: true, env: ENV, fetch: ts.fetch });
    expect(ts.calls).toHaveLength(1);
    expect(result.spans).toEqual([]);
  });
});

describe("TypeSafe provider: only when asked and configured", () => {
  it("is not called without hosted: true", async () => {
    const ts = fakeTypesafe(judgeFixture);
    await scanDetailed(TEXT, { env: ENV, fetch: ts.fetch });
    expect(ts.calls).toHaveLength(0);
  });

  it("is not called when TYPESAFE_API_KEY is unset", async () => {
    const ts = fakeTypesafe(judgeFixture);
    const result = await scanDetailed(TEXT, { hosted: true, env: {}, fetch: ts.fetch });
    expect(ts.calls).toHaveLength(0);
    expect(result.spans).toContainEqual(at(TEXT, GHP, "secret.github", "gitleaks"));
  });
});

describe("TypeSafe provider: degraded fallback", () => {
  const localOnly = async () => (await scanDetailed(TEXT)).spans;

  it.each([
    ["the network fails", (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch],
    ["it answers 500", (async () => new Response("upstream error", { status: 500 })) as unknown as typeof fetch],
    ["it answers 401", (async () => new Response(JSON.stringify({ detail: "Invalid API key" }), { status: 401 })) as unknown as typeof fetch],
    ["the body is not JSON", (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch],
    ["the body has no answers", (async () => new Response(JSON.stringify({ model: "jev-1.13.0", usage: {} }), { status: 200 })) as unknown as typeof fetch],
  ])("returns the local spans, flagged degraded, when %s", async (_name, fetch) => {
    const result = await scanDetailed(TEXT, { hosted: true, env: ENV, fetch });
    expect(result.degraded).toMatch(/\S/);
    expect(result.spans).toEqual(await localOnly());
  });

  it("gives up on a hung call after hostedTimeoutMs", async () => {
    const hung = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const t0 = performance.now();
    const result = await scanDetailed(TEXT, { hosted: true, env: ENV, fetch: hung, hostedTimeoutMs: 200 });
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(result.degraded).toMatch(/timed out/);
    expect(result.spans).toEqual(await localOnly());
  });
});

describe.runIf(process.env.TYPESAFE_LIVE === "1")("TypeSafe provider: live (TYPESAFE_LIVE=1)", () => {
  it("judges the harmless fixture through the real API", async () => {
    process.loadEnvFile(process.env.TYPESAFE_ENV_FILE ?? ".env.local");
    const t0 = performance.now();
    const result = await scanDetailed(TEXT, { hosted: true });
    const ms = Math.round(performance.now() - t0);
    console.log(`TypeSafe live: ${result.degraded ? `degraded (${result.degraded})` : "ok"} in ${ms} ms, ${result.spans.filter((s) => s.detector === "typesafe").length} hosted spans`);
    expect(result.degraded).toBeUndefined();
    expect(result.spans).toContainEqual(at(TEXT, "Jane Doe", "pii.person", "typesafe"));
  }, 30_000);
});
