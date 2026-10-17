/*
 * The local detector pack: every rule in scan order, plus the allowlists that apply to a whole set.
 */
import type { AllowSpec, RuleSpec, SetAllowlists } from "./engine";
import { GITLEAKS_GLOBAL_ALLOW, GITLEAKS_RULES } from "./gitleaks.gen";
import { SECRETLINT_RULES } from "./secretlint";

/**
 * Our additions to gitleaks' allowlists, per rule. A UUID under a key named like `api_request_id` is an id, not a key
 * (detect-secrets' potential-UUID heuristic, E §3). Only the generic rule gets it: Heroku, Snyk and MessageBird keys
 * are UUID-shaped and their rules must keep matching them.
 */
const EXTRA_ALLOW: Record<string, AllowSpec[]> = {
  "generic-api-key": [{ regexes: [{ source: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", flags: "i" }] }],
};

const withExtraAllow = (r: RuleSpec): RuleSpec => (EXTRA_ALLOW[r.id] ? { ...r, allow: [...(r.allow ?? []), ...EXTRA_ALLOW[r.id]] } : r);

export const PACK_RULES: RuleSpec[] = [...GITLEAKS_RULES.map(withExtraAllow), ...SECRETLINT_RULES];

export const PACK_ALLOW: SetAllowlists = {
  gitleaks: GITLEAKS_GLOBAL_ALLOW,
};
