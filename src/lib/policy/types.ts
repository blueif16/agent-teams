/*
 * policy/v1: the privacy and tool rules every agent runs under (docs/design/team-setup.md §6,
 * docs/research/E-privacy.md §4). Shared by the engine, the API routes and the Rules tab.
 *
 * Most restrictive wins (block/deny > ask > tokenize > redact/hash/mask > allow). Adding a rule never relaxes a
 * decision; only a grant relaxes, and only ask → allow. Locked rules can't be relaxed by a grant.
 */

export type Archetype = "chief" | "lead" | "writer" | "researcher" | "analyst" | "engineer" | "designer" | "coordinator";

/** Data labels on spans of text: `secret.<kind>`, `pii.<kind>`, `owner_private`, `project:<id>`, `untrusted`. */
export type Label = string;

/** Where data can go: `model:crusoe`, `trace:langsmith`, `web`, `email`, `calendar`, `api:<host>`, `memory:self`, `memory:global`, `project:other`, `ui`, `ledger`. */
export type Sink = string;

export type ToolEffect = "allow" | "ask" | "deny";
export type FlowAction = "allow" | "redact" | "mask" | "hash" | "tokenize" | "ask" | "block";
/** Every outcome, most restrictive first. */
export const OUTCOME_ORDER = ["block", "deny", "ask", "tokenize", "redact", "hash", "mask", "allow"] as const;
export type Outcome = (typeof OUTCOME_ORDER)[number];

/** All present keys must match (AND); a missing key or "*" matches anything. */
export interface Scope {
  agents?: string[];
  archetypes?: Archetype[];
  /** Project ids, "dm:*" or "*". */
  projects?: string[];
}

export interface ArgConstraint {
  /** JSONPath-lite into the tool args: "url", "to[*]", "path". */
  path: string;
  op: "host_in" | "host_not_in" | "domain_in" | "domain_not_in" | "path_glob" | "path_not_glob" | "in" | "not_in" | "matches" | "not_matches" | "max_len";
  value: unknown;
}

export interface Condition {
  contextLabels?: { any?: Label[]; none?: Label[] };
  argLabels?: { any?: Label[]; none?: Label[] };
  /** The URL host or recipient first appeared in untrusted content. */
  destFromUntrusted?: boolean;
}

interface RuleBase {
  /** `r_` + 6 or more lowercase letters or digits. */
  id: string;
  scope: Scope;
  /** shadow = log only, never enforced. */
  mode?: "enforce" | "shadow";
  /** Grants can't relax it, and the owner can't delete it from the UI. */
  locked?: boolean;
  /** ISO date-time. */
  expiresAt?: string;
  /** Shown on cards and chips; ≤ 160 chars. */
  reason?: string;
  createdBy: "default" | "owner" | "nl-compiler" | "approval";
  source?: { nl?: string; approvalId?: string };
}

export interface ToolRule extends RuleBase {
  kind: "tool";
  /** Globs: "web_*". */
  match: { tools: string[] };
  effect: ToolEffect;
  /** All must hold for the rule to match. */
  args?: ArgConstraint[];
  when?: Condition;
  approval?: {
    allowedDecisions?: ("approve" | "edit" | "reject" | "respond")[];
    offerGrants?: ("once" | "thread" | "project" | "7d" | "30d" | "always")[];
    /** e.g. "send this email". */
    phrase?: string;
  };
}

export interface FlowRule extends RuleBase {
  kind: "flow";
  /** "secret.*", "pii.email", "project:*", "owner_private". */
  labels: Label[];
  /** "model:crusoe", "web", "email", "memory:global", "project:other", "api:*". */
  sinks: Sink[];
  where?: ArgConstraint[];
  action: FlowAction;
}

/** Minted by an approval ("Approve & allow for … on this project"). Turns ask → allow, nothing else. */
export interface GrantRule extends RuleBase {
  kind: "grant";
  tool: string;
  args?: ArgConstraint[];
  grantScope: "once" | "thread" | "project" | "until" | "always";
  uses?: { max?: number; used?: number };
}

export interface BudgetRule extends RuleBase {
  kind: "budget";
  match?: { tools: string[] };
  metric: "calls" | "cost_usd" | "egress_bytes";
  limit: { amount: number; per: "run" | "thread" | "day" | "project" };
  onExceed: "ask" | "deny" | "end" | "pause_agent";
}

/** A custom data class, e.g. a project codename. */
export interface ClassifierRule extends RuleBase {
  kind: "classifier";
  label: Label;
  detect: {
    /** Whole-word terms. */
    terms?: string[];
    /** JS regex source, compiled and ReDoS-checked at save. */
    regex?: string[];
    validator?: "luhn" | "iban_mod97" | "us_ssn" | "jwt" | "none";
    caseInsensitive?: boolean;
  };
}

export type Rule = ToolRule | FlowRule | GrantRule | BudgetRule | ClassifierRule;
export type RuleKind = Rule["kind"];

/** One tool call (or prompt) the engine decides on. */
export interface PolicyEvent {
  agentId: string;
  archetype: Archetype;
  projectId: string;
  tool: string;
  args: Record<string, unknown>;
  /** Labelled spans found in the args (by detectors, classifiers and provenance). */
  argSpans: { path: string; start: number; end: number; label: Label }[];
  /** Labels present anywhere in the agent's context. */
  contextLabels: Label[];
  sinks: Sink[];
}

export interface Decision {
  effect: Outcome;
  /** What to rewrite before the call goes out. */
  transforms: { path: string; start: number; end: number; label: Label; action: Exclude<FlowAction, "allow" | "ask" | "block"> }[];
  firedRuleIds: string[];
  labels: Label[];
}

/** decide(event, rules, grants, now): pure, so enforcement, dry runs and conflict checks share it. */
export type Decide = (event: PolicyEvent, rules: Rule[], grants: GrantRule[], now: Date) => Decision;

/** Tool tiers (design §6): the default outcome when no rule matches. */
export type Tier = "T0" | "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7";
export interface TierDefault {
  tier: Tier;
  /** "Internal read", "Public read egress", … */
  name: string;
  tools: string[];
  effect: ToolEffect;
}

/** A detector set in the local pack, or a hosted provider (TypeSafe Jev). */
export interface DetectorSummary {
  id: string;
  name: string;
  kind: "secret" | "pii" | "custom";
  rules: number;
  source: string;
  license: string;
  /** For hosted providers: whether its key is configured. */
  configured?: boolean;
}

/** GET /api/rules?agent=&project= */
export interface RulesResponse {
  rules: Rule[];
  /** Plain-English line per rule id, rendered from the JSON by a fixed template (never by an LLM). */
  readBack: Record<string, string>;
  tiers: TierDefault[];
  detectors: DetectorSummary[];
  /** When `agent` is given: the effective default per tier for that agent after its rules. */
  capabilities?: { tier: Tier; name: string; effect: ToolEffect; firedRuleIds: string[] }[];
}

export interface RuleConflict {
  kind: "shadowed" | "tightens" | "revokes_grant" | "duplicate";
  ruleId: string;
  otherRuleId: string;
  note: string;
}

/** POST /api/rules/compile { text, agent?, project? } */
export interface CompileResult {
  rules: Rule[];
  readBack: string[];
  assumptions: string[];
  /** ≤ 3 multiple-choice questions when the sentence is ambiguous. */
  questions: { q: string; options: string[] }[];
  conflicts: RuleConflict[];
  /** Replay over recorded calls; null when there is nothing recorded yet. */
  dryRun: { total: number; block: number; ask: number; redact: number; allow: number } | null;
}

/** POST /api/rules { rules, mode } → 201: the saved rules with their final ids. */
export interface SaveRulesResponse {
  rules: Rule[];
}

/** DELETE /api/rules/[id] → 200 { ok: true }, or 400 { error } for locked and default rules. */
export type DeleteRuleResponse = { ok: true } | { error: string };

/** Plain-language access, the only three states the Permissions view shows for a capability. */
export type Access = "allow" | "ask" | "deny";

/** One capability ("Send email") for one agent: its access with no special conditions, and what can tighten it. */
export interface Permission {
  /** Stable capability id, e.g. "email". */
  id: string;
  /** "Send email". */
  label: string;
  /** Strictest decide() over its tools for this agent, no labels, no args. */
  access: Access;
  /** The agent's toolset has ≥ 1 of its tools. */
  inToolset: boolean;
  /** Every one of its tools in the toolset is status "planned" (shows "soon"). */
  planned: boolean;
  /** A locked rule decided `access`. */
  locked: boolean;
  /** Conditional rules (args / when) that can apply. */
  limits: { text: string; access: Access; ruleId: string }[];
  /** Rules that decided `access` (fired), for "who set it". */
  ruleIds: string[];
}

/** Flow rules grouped by what they protect ("Secrets and keys"), for the Data section. */
export interface DataGuard {
  /** Family id: "secret" | "pii" | "project" | "owner_private" | the raw label. */
  id: string;
  /** "Secrets and keys". */
  label: string;
  /** Strictest across the family. */
  outcome: "block" | "ask" | "hidden" | "allow";
  /** Any locked rule in the family. */
  locked: boolean;
  rules: { ruleId: string; text: string; outcome: "block" | "ask" | "hidden" | "allow"; locked: boolean }[];
}
