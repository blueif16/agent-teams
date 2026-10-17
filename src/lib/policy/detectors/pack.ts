/*
 * The local detector pack: every rule in scan order, plus the allowlists that apply to a whole set.
 */
import type { AllowSpec, RuleSpec, SetAllowlists } from "./engine";
import { GITLEAKS_GLOBAL_ALLOW, GITLEAKS_RULES } from "./gitleaks.gen";
import { PRESIDIO_ALLOW, PRESIDIO_RULES } from "./presidio";
import { SECRETLINT_RULES } from "./secretlint";

/**
 * Our additions to gitleaks' allowlists, per rule, for the generic rule only (provider rules keep their own):
 * - a UUID under a key like `api_request_id` is an id (detect-secrets' potential-UUID heuristic, E §3); Heroku, Snyk
 *   and MessageBird keys are UUID-shaped, so their rules must not get this;
 * - a 40-hex value assigned to a name ending in commit/sha/revision is a git SHA (`SECRETLINT_COMMIT = "92f0…"`).
 */
const EXTRA_ALLOW: Record<string, AllowSpec[]> = {
  "generic-api-key": [
    { regexes: [{ source: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", flags: "i" }] },
    { target: "match", regexes: [{ source: "(?:commit|sha1?|revision)[\"']?\\s*[:=]\\s*[\"'\\x60]?[0-9a-f]{40}\\b", flags: "i" }] },
  ],
};

const withExtraAllow = (r: RuleSpec): RuleSpec => (EXTRA_ALLOW[r.id] ? { ...r, allow: [...(r.allow ?? []), ...EXTRA_ALLOW[r.id]] } : r);

export const PACK_RULES: RuleSpec[] = [...GITLEAKS_RULES.map(withExtraAllow), ...SECRETLINT_RULES, ...PRESIDIO_RULES];

export const PACK_ALLOW: SetAllowlists = {
  gitleaks: GITLEAKS_GLOBAL_ALLOW,
  "presidio-ports": PRESIDIO_ALLOW,
};
