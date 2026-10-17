import { describe, expect, it } from "vitest";
import { compactionTriggers, contextFill, CONTEXT_WINDOW } from "./context-budget";
import { MODELS } from "./models";

describe("compactionTriggers", () => {
  it("gives V4.1 Flash the design's limits on a 500K tokens/min account (docs/research/F §4.2)", () => {
    expect(compactionTriggers("lead", { model: MODELS.main })).toMatchObject({ soft: 64_000, hard: 96_000 });
    expect(compactionTriggers("chief", { model: MODELS.main })).toMatchObject({ soft: 48_000, hard: 80_000 });
    expect(compactionTriggers("worker", { model: MODELS.main })).toMatchObject({ soft: 96_000, hard: 128_000 });
  });

  it("grows with the account's tokens/min, since that budget is what binds", () => {
    const small = compactionTriggers("lead", { model: MODELS.main, tpm: 500_000 });
    const big = compactionTriggers("lead", { model: MODELS.main, tpm: 2_000_000 });
    expect(big.soft).toBeGreaterThan(small.soft);
  });

  it("never lets a trigger pass half (soft) or three quarters (hard) of a small model's window", () => {
    const t = compactionTriggers("worker", { window: 131_072, tpm: 2_000_000 });
    expect(t.soft).toBeLessThanOrEqual(131_072 / 2);
    expect(t.hard).toBeLessThanOrEqual((131_072 * 3) / 4);
    expect(t.hard).toBeGreaterThan(t.soft);
  });

  it("knows V4.1 Flash's 1M window", () => {
    expect(CONTEXT_WINDOW[MODELS.main]).toBe(1_048_576);
  });
});

describe("contextFill", () => {
  it("is the share of the hard trigger in use, with the soft trigger marked on the same scale", () => {
    const t = compactionTriggers("lead", { model: MODELS.main });
    const fill = contextFill(48_000, t);
    expect(fill.used).toBeCloseTo(0.5);
    expect(fill.compactsAt).toBeCloseTo(64_000 / 96_000);
  });

  it("stays within 0..1", () => {
    const t = compactionTriggers("lead", { model: MODELS.main });
    expect(contextFill(500_000, t).used).toBe(1);
    expect(contextFill(-5, t).used).toBe(0);
  });
});
