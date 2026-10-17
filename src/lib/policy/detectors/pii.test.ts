import { describe, expect, it } from "vitest";
import { scan } from "@/lib/policy/detectors";
import { BENIGN_MEASURED, BENIGN_PII_LIKE, BENIGN_SECRET_LIKE } from "./fixtures/benign";
import { PII_FIXTURES } from "./fixtures/pii";

describe("Presidio ports: true positives", () => {
  it("cover every recognizer", () => {
    expect(new Set(PII_FIXTURES.map((f) => f.recognizer))).toEqual(new Set(["email", "phone", "credit_card", "us_ssn", "iban", "ip"]));
  });

  it.each(PII_FIXTURES)("$recognizer reports $value as $label", async ({ text, value, label }) => {
    const start = text.indexOf(value);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(await scan(text)).toContainEqual({ start, end: start + value.length, label, detector: "presidio-ports" });
  });
});

describe("Presidio ports: false positives", () => {
  it.each(BENIGN_PII_LIKE)("finds nothing in $name", async ({ text }) => {
    expect(await scan(text)).toEqual([]);
  });
});

describe("Presidio ports: context words", () => {
  it("needs a context word before a dashed US number to call it a phone", async () => {
    expect(await scan("Build 415-555-0132 passed")).toEqual([]);
    expect(await scan("Call 415-555-0132 after five")).toEqual([{ start: 5, end: 17, label: "pii.phone", detector: "presidio-ports" }]);
  });

  it("only counts context words in the five words before the match", async () => {
    expect(await scan("phone one two three four five six 415-555-0132")).toEqual([]);
  });
});

describe("false positives measured on the repo's own text", () => {
  it.each(BENIGN_MEASURED)("finds nothing in $name", async ({ text }) => {
    expect(await scan(text)).toEqual([]);
  });
});

describe("false-positive rate over all hard negatives", () => {
  it("is zero", async () => {
    const all = [...BENIGN_SECRET_LIKE, ...BENIGN_PII_LIKE, ...BENIGN_MEASURED];
    expect(all.length).toBeGreaterThanOrEqual(30);
    const hits = [];
    for (const f of all) if ((await scan(f.text)).length) hits.push(f.name);
    expect(hits).toEqual([]);
  });
});
