/* Runs a check the way claims will: params through the scenario schema (so defaults apply), then the registry. */
import type { z } from "zod";
import { CHECKS, type CheckName } from "../../scenario";
import { CHECK_FNS } from "../index";
import type { CheckContext, CheckResult } from "../types";

export function runCheck<K extends CheckName>(name: K, ctx: CheckContext, params: z.input<(typeof CHECKS)[K]>): CheckResult {
  const parsed = CHECKS[name].parse(params) as z.output<(typeof CHECKS)[K]>;
  return CHECK_FNS[name](ctx, parsed);
}
