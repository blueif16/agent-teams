import { describe, expect, it } from "vitest";
import { scan } from "@/lib/policy/detectors";
import { BENIGN_SECRET_LIKE } from "./fixtures/benign";
import { SECRET_FIXTURES } from "./fixtures/secrets";

describe("secret rules: true positives", () => {
  it("cover at least 25 vendored gitleaks rules and all 3 secretlint rules", () => {
    const gitleaks = new Set(SECRET_FIXTURES.filter((f) => f.detector === "gitleaks").map((f) => f.rule));
    const secretlint = new Set(SECRET_FIXTURES.filter((f) => f.detector === "secretlint").map((f) => f.rule));
    expect(gitleaks.size).toBeGreaterThanOrEqual(25);
    expect(secretlint.size).toBe(3);
  });

  it.each(SECRET_FIXTURES)("$detector/$rule reports the secret as $label", async ({ text, secret, label, detector }) => {
    const start = text.indexOf(secret);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(await scan(text)).toContainEqual({ start, end: start + secret.length, label, detector });
  });
});

describe("secret rules: false positives", () => {
  it.each(BENIGN_SECRET_LIKE)("finds nothing in $name", async ({ text }) => {
    expect(await scan(text)).toEqual([]);
  });
});

describe("secret rules: precedence", () => {
  it("drops the generic match when a provider rule found the same secret", async () => {
    const text = 'GITHUB_TOKEN = "ghp_R7mQ2xL9vT4kN8pW3sY6dF1hJ5bC0gZaE2uI"';
    const labels = (await scan(text)).map((s) => s.label);
    expect(labels).toContain("secret.github");
    expect(labels).not.toContain("secret.generic");
  });

  it("finds several secrets in one text, each at its own offset", async () => {
    const aws = "AKIALALEMEL33243OLIB";
    const slack = "xoxb-781236542736-2364535789652-GkwFDQoHqzXDVsC6GzqYUypD";
    const text = `deploy with ${aws}\nand notify via ${slack}\n`;
    const spans = await scan(text);
    expect(spans).toContainEqual({ start: text.indexOf(aws), end: text.indexOf(aws) + aws.length, label: "secret.aws", detector: "gitleaks" });
    expect(spans).toContainEqual({ start: text.indexOf(slack), end: text.indexOf(slack) + slack.length, label: "secret.slack", detector: "gitleaks" });
  });
});
