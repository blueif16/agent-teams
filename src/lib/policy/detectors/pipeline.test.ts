import { describe, expect, it } from "vitest";
import { scan } from "@/lib/policy/detectors";
import type { RuleSpec } from "./engine";
import { scanLocal } from "./pipeline";

const AWS = "AKIALALEMEL33243OLIB";
/** Exponential backtracking in V8 on a run of a's that ends in something else (RE2 would be linear). */
const EVIL: RuleSpec = { id: "evil", label: "secret.evil", detector: "test", source: "^(a+)+$", flags: "m", secretGroup: 0 };
const HOSTILE = `aws_token = "${AWS}"\n${"a".repeat(40)}!\n`;

describe("scan in a worker with a timeout", () => {
  it("returns within timeoutMs, flagged timedOut, with the spans found before the runaway rule", async () => {
    const timeoutMs = 300;
    const t0 = performance.now();
    const result = await scanLocal(HOSTILE, { timeoutMs, extraRules: [EVIL] });
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(timeoutMs + 150);
    expect(result.timedOut).toBe(true);
    const start = HOSTILE.indexOf(AWS);
    expect(result.spans).toContainEqual({ start, end: start + AWS.length, label: "secret.aws", detector: "gitleaks" });
  });

  it("recovers after a timeout: the next scan completes normally", async () => {
    await scanLocal(HOSTILE, { timeoutMs: 200, extraRules: [EVIL] });
    const result = await scanLocal(`key ${AWS}`, { timeoutMs: 2000 });
    expect(result.timedOut).toBe(false);
    expect(result.spans).toEqual([{ start: 4, end: 4 + AWS.length, label: "secret.aws", detector: "gitleaks" }]);
  });

  it("skips a rule whose keywords are absent, so its regex never runs", async () => {
    const result = await scanLocal(HOSTILE, { timeoutMs: 1000, extraRules: [{ ...EVIL, keywords: ["zzz-not-in-text"] }] });
    expect(result.timedOut).toBe(false);
  });

  it("keeps concurrent scans apart", async () => {
    const slack = "xoxb-781236542736-2364535789652-GkwFDQoHqzXDVsC6GzqYUypD";
    const [a, b] = await Promise.all([scanLocal(`aws ${AWS}`, {}), scanLocal(`slack ${slack}`, {})]);
    expect(a.spans).toEqual([{ start: 4, end: 4 + AWS.length, label: "secret.aws", detector: "gitleaks" }]);
    expect(b.spans).toEqual([{ start: 6, end: 6 + slack.length, label: "secret.slack", detector: "gitleaks" }]);
  });

  it("runs in the worker, not the unprotected in-process fallback", async () => {
    const result = await scanLocal(`aws ${AWS}`, {});
    expect(result.inProcess).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("scan() honours ScanOptions.timeoutMs and still returns what it found", async () => {
    // Only the public options: no injected rule, so nothing runs away and the scan completes.
    expect(await scan(`aws ${AWS}`, { timeoutMs: 1500 })).toEqual([{ start: 4, end: 4 + AWS.length, label: "secret.aws", detector: "gitleaks" }]);
  });
});
