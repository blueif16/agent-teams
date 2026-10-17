import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createResearch, RESEARCH_PRICE_USD, RESEARCH_URL } from "./youcom";

const RESPONSE = readFileSync(new URL("./__fixtures__/youcom/research-skill-candidates.json", import.meta.url), "utf8");

/** A fake You.com: records each request and answers with `status` and `body`. */
function fakeYou(status = 200, body = RESPONSE) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetch };
}

const SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

describe("createResearch", () => {
  it("posts the documented request: X-API-Key, input, research_effort, output_schema, source_control", async () => {
    const you = fakeYou();
    const research = createResearch({ apiKey: "ydc-test-key", fetch: you.fetch });
    await research({ input: "q", effort: "deep", outputSchema: SCHEMA, sourceControl: { include_domains: ["github.com", "skills.sh"] } });
    expect(you.calls).toHaveLength(1);
    const [call] = you.calls;
    expect(call.url).toBe("https://api.you.com/v1/research");
    expect(RESEARCH_URL).toBe(call.url);
    expect(call.headers.get("x-api-key")).toBe("ydc-test-key");
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.body).toEqual({
      input: "q",
      research_effort: "deep",
      output_schema: SCHEMA,
      source_control: { include_domains: ["github.com", "skills.sh"] },
    });
  });

  it("sends only what was asked: no schema or source control keys when not given, standard effort by default", async () => {
    const you = fakeYou();
    await createResearch({ apiKey: "k", fetch: you.fetch })({ input: "q" });
    expect(you.calls[0].body).toEqual({ input: "q", research_effort: "standard" });
  });

  it("returns the content, sources and warnings, with the tier's list price and the latency", async () => {
    const you = fakeYou();
    const result = await createResearch({ apiKey: "k", fetch: you.fetch })({ input: "q", effort: "deep", outputSchema: SCHEMA });
    const expected = JSON.parse(RESPONSE);
    expect(result.content).toEqual(expected.output.content);
    expect(result.contentType).toBe("object");
    expect(result.sources).toEqual(expected.output.sources);
    expect(result.warnings).toEqual([]);
    expect(result.effort).toBe("deep");
    expect(result.costUsd).toBe(0.1);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("prices each tier at You.com's list price per call ($12, $50, $100, $450, $1,200 per 1k)", () => {
    expect(RESEARCH_PRICE_USD).toEqual({ lite: 0.012, standard: 0.05, deep: 0.1, exhaustive: 0.45, frontier: 1.2 });
  });

  it("throws on an HTTP error with the status and detail, never the key", async () => {
    const you = fakeYou(401, JSON.stringify({ detail: "Invalid API key" }));
    const call = createResearch({ apiKey: "ydc-secret-123", fetch: you.fetch })({ input: "q" });
    await expect(call).rejects.toThrow(/401.*Invalid API key/);
    await expect(call).rejects.not.toThrow(/ydc-secret-123/);
  });

  it("refuses, without calling, what You.com would reject with 422: a schema on lite, frontier without background", async () => {
    const you = fakeYou();
    const research = createResearch({ apiKey: "k", fetch: you.fetch });
    await expect(research({ input: "q", effort: "lite", outputSchema: SCHEMA })).rejects.toThrow(/lite/);
    await expect(research({ input: "q", effort: "frontier" })).rejects.toThrow(/frontier/);
    expect(you.calls).toHaveLength(0);
  });

  it("refuses, without calling, when there is no API key", async () => {
    const you = fakeYou();
    await expect(createResearch({ apiKey: "", fetch: you.fetch })({ input: "q" })).rejects.toThrow(/YDC_API_KEY/);
    expect(you.calls).toHaveLength(0);
  });
});
