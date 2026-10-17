import { describe, expect, it } from "vitest";
import { costOf, MODELS } from "@/lib/models";

describe("costOf", () => {
  it("bills cached input at the cached rate", () => {
    // 1M input of which 1M cached on main: 1 × $0.007, no uncached input, no output.
    expect(costOf(MODELS.main, 1e6, 1e6, 0)).toBeCloseTo(0.007, 6);
  });
});
