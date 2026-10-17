import { afterEach, describe, expect, it, vi } from "vitest";
import { listDetectors, scan } from "@/lib/policy/detectors";
import { PII_FIXTURES } from "./fixtures/pii";
import { SECRET_FIXTURES } from "./fixtures/secrets";

afterEach(() => vi.unstubAllEnvs());

describe("listDetectors", () => {
  it("returns one summary per set, local sets first", () => {
    expect(listDetectors().map((d) => d.id)).toEqual(["gitleaks", "secretlint", "presidio-ports", "typesafe"]);
  });

  it("gives each set its real rule count, kind and license", () => {
    const byId = Object.fromEntries(listDetectors().map((d) => [d.id, d]));
    // 222 upstream gitleaks rules minus the 5 that only fire on a file path.
    expect(byId.gitleaks).toMatchObject({ kind: "secret", rules: 217, license: "MIT" });
    expect(byId.secretlint).toMatchObject({ kind: "secret", rules: 3, license: "MIT" });
    expect(byId["presidio-ports"]).toMatchObject({ kind: "pii", rules: 6, license: "MIT" });
    // secret, person_name, address, gov_id, account_number (none maps to no label).
    expect(byId.typesafe).toMatchObject({ kind: "pii", rules: 5 });
    expect(byId.typesafe.license).toMatch(/proprietary/i);
    for (const d of listDetectors()) expect(d.source).toMatch(/^https:\/\//);
  });

  it("marks TypeSafe configured only when TYPESAFE_API_KEY is set", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(listDetectors().find((d) => d.id === "typesafe")?.configured).toBe(false);
    vi.stubEnv("TYPESAFE_API_KEY", "test-key-not-real");
    expect(listDetectors().find((d) => d.id === "typesafe")?.configured).toBe(true);
  });

  it("lists every detector id that scan() reports", async () => {
    const ids = new Set(listDetectors().map((d) => d.id));
    const texts = [...SECRET_FIXTURES.map((f) => f.text), ...PII_FIXTURES.map((f) => f.text)];
    for (const t of texts) for (const s of await scan(t)) expect(ids).toContain(s.detector);
  });
});
