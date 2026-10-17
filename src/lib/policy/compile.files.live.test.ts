/*
 * Live eval of the NL compiler on the five file-permission sentences (compile-files.cases.ts), against real Crusoe
 * (GLM-5.3, falling back per modelChain). Skipped unless ZONES_LIVE=1 and a key is set (CRUSOE_API_KEY, or
 * CRUSOE_ENV_FILE pointing at a .env.local that has it):
 *   ZONES_LIVE=1 CRUSOE_ENV_FILE=../../.env.local npx vitest run src/lib/policy/compile.files.live.test.ts
 * Scores each sentence pass/fail by its deterministic checks, meters the cost from each response's usage, and stops
 * before going over $0.10. The raw replies land in ZONES_EVAL_OUT (default /tmp/zones-eval.json) for review.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRICES } from "@/lib/models";
import { compileRules } from "@/lib/policy/compile";
import { FILE_CASES, FILES_CTX } from "@/lib/policy/compile-files.cases";

const envFile = process.env.CRUSOE_ENV_FILE;
if (process.env.ZONES_LIVE === "1" && !process.env.CRUSOE_API_KEY && envFile && existsSync(envFile)) {
  const line = readFileSync(envFile, "utf8").split("\n").find((l) => l.startsWith("CRUSOE_API_KEY="));
  if (line) process.env.CRUSOE_API_KEY = line.slice("CRUSOE_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
}
const LIVE = process.env.ZONES_LIVE === "1" && Boolean(process.env.CRUSOE_API_KEY);
const BUDGET_USD = 0.1;

let spent = 0;
const replies: { model: string; content: string }[] = [];

/** fetch that adds each response's usage to `spent` at list price. */
const metered: typeof fetch = async (url, init) => {
  const res = await fetch(url, init);
  const body = (await res.clone().json().catch(() => null)) as {
    model?: string;
    usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
    choices?: { message?: { content?: string } }[];
  } | null;
  const model = body?.model ?? JSON.parse(String(init?.body)).model;
  const p = PRICES[model] ?? PRICES[JSON.parse(String(init?.body)).model];
  if (body?.usage && p) {
    const cached = body.usage.prompt_tokens_details?.cached_tokens ?? 0;
    spent += ((body.usage.prompt_tokens - cached) * p.input + cached * p.cached + body.usage.completion_tokens * p.output) / 1e6;
  }
  replies.push({ model, content: body?.choices?.[0]?.message?.content ?? `(status ${res.status})` });
  return res;
};

describe.skipIf(!LIVE)("NL compiler, live, on file permissions", () => {
  it(
    "scores the five sentences and stays under budget",
    async () => {
      const results: { id: string; text: string; failures: string[]; rules: unknown; assumptions: string[]; questions: unknown; replies: typeof replies }[] = [];
      for (const c of FILE_CASES) {
        if (spent >= BUDGET_USD) throw new Error(`budget reached at $${spent.toFixed(4)}`);
        replies.length = 0;
        const out = await compileRules({ text: c.text }, { ...FILES_CTX, now: new Date() }, { fetch: metered });
        const failures = out.ok ? c.check(out.result) : [`compile failed: ${out.error} ${out.issues.join("; ")}`];
        results.push({
          id: c.id,
          text: c.text,
          failures,
          rules: out.ok ? out.result.rules : null,
          assumptions: out.ok ? out.result.assumptions : [],
          questions: out.ok ? out.result.questions : [],
          replies: [...replies],
        });
      }
      const score = results.filter((r) => r.failures.length === 0).length;
      const summary = { score: `${score}/${FILE_CASES.length}`, costUsd: Number(spent.toFixed(4)), results };
      writeFileSync(process.env.ZONES_EVAL_OUT ?? "/tmp/zones-eval.json", JSON.stringify(summary, null, 2));
      console.log(`zones eval: ${summary.score}, $${summary.costUsd}`);
      for (const r of results) console.log(`  ${r.failures.length ? "FAIL" : "PASS"} ${r.id}${r.failures.length ? `: ${r.failures.join("; ")}` : ""}`);
      expect(spent).toBeLessThanOrEqual(BUDGET_USD);
      expect(score).toBe(FILE_CASES.length);
    },
    600_000,
  );
});
