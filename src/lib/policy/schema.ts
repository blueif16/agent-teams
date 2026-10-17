/*
 * zod mirror of policy/v1 (types.ts), for everything that enters from outside: the NL compiler's output, saved rules
 * and the rules file. Objects are strict, so a typo ("agent" for "agents") fails instead of silently widening a rule,
 * and lists that would make a rule a no-op must be non-empty.
 */
import * as z from "zod";
import { compileRegex } from "./engine";
import type { Archetype, ArgConstraint, Rule } from "./types";

export const ARCHETYPES = ["chief", "lead", "writer", "researcher", "analyst", "engineer", "coordinator"] as const satisfies readonly Archetype[];
export const RULE_ID = /^r_[a-z0-9]{6,}$/;

/** A group with a quantifier inside that is itself repeated without bound, like (a+)+ or (x*)*. */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,\d*\})(?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,\d*\})/;

/** Why a regex source can't be saved, or null when it's fine. */
export function regexProblem(source: string): string | null {
  if (!compileRegex(source)) return "doesn't compile";
  if (NESTED_QUANTIFIER.test(source)) return "has a nested quantifier that can hang on hostile input";
  return null;
}

const text = z.string().min(1);
const list = z.array(text).min(1);
const oneOrMore = z.union([text, list]);
const primitive = z.union([z.string(), z.number(), z.boolean()]);

const VALUE_BY_OP: Record<ArgConstraint["op"], z.ZodType> = {
  host_in: oneOrMore,
  host_not_in: oneOrMore,
  domain_in: oneOrMore,
  domain_not_in: oneOrMore,
  path_glob: oneOrMore,
  path_not_glob: oneOrMore,
  in: z.union([primitive, z.array(primitive).min(1)]),
  not_in: z.union([primitive, z.array(primitive).min(1)]),
  matches: oneOrMore,
  not_matches: oneOrMore,
  max_len: z.number().int().nonnegative(),
};

const ArgConstraintSchema = z
  .strictObject({
    path: text,
    op: z.enum(Object.keys(VALUE_BY_OP) as [ArgConstraint["op"], ...ArgConstraint["op"][]]),
    value: z.unknown(),
  })
  .superRefine((c, ctx) => {
    if (!VALUE_BY_OP[c.op].safeParse(c.value).success) {
      ctx.addIssue({ code: "custom", path: ["value"], message: `wrong value for op ${c.op}` });
      return;
    }
    if (c.op === "matches" || c.op === "not_matches") {
      for (const src of [c.value].flat() as string[]) {
        const problem = regexProblem(src);
        if (problem) ctx.addIssue({ code: "custom", path: ["value"], message: `regex ${JSON.stringify(src)} ${problem}` });
      }
    }
  });

const LabelSet = z.strictObject({ any: list.optional(), none: list.optional() });
const ConditionSchema = z.strictObject({
  contextLabels: LabelSet.optional(),
  argLabels: LabelSet.optional(),
  destFromUntrusted: z.boolean().optional(),
});

const base = {
  id: z.string().regex(RULE_ID, "must be r_ + 6 or more lowercase letters or digits"),
  scope: z.strictObject({ agents: list.optional(), archetypes: z.array(z.enum(ARCHETYPES)).min(1).optional(), projects: list.optional() }),
  mode: z.enum(["enforce", "shadow"]).optional(),
  locked: z.boolean().optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  reason: z.string().max(160).optional(),
  createdBy: z.enum(["default", "owner", "nl-compiler", "approval"]),
  source: z.strictObject({ nl: z.string().optional(), approvalId: z.string().optional() }).optional(),
};

const args = z.array(ArgConstraintSchema).min(1).optional();

export const ToolRuleSchema = z.strictObject({
  ...base,
  kind: z.literal("tool"),
  match: z.strictObject({ tools: list }),
  effect: z.enum(["allow", "ask", "deny"]),
  args,
  when: ConditionSchema.optional(),
  approval: z
    .strictObject({
      allowedDecisions: z.array(z.enum(["approve", "edit", "reject", "respond"])).optional(),
      offerGrants: z.array(z.enum(["once", "thread", "project", "7d", "30d", "always"])).optional(),
      phrase: z.string().optional(),
    })
    .optional(),
});

export const FlowRuleSchema = z.strictObject({
  ...base,
  kind: z.literal("flow"),
  labels: list,
  sinks: list,
  where: args,
  action: z.enum(["allow", "redact", "mask", "hash", "tokenize", "ask", "block"]),
});

export const GrantRuleSchema = z.strictObject({
  ...base,
  kind: z.literal("grant"),
  tool: text,
  args,
  grantScope: z.enum(["once", "thread", "project", "until", "always"]),
  uses: z.strictObject({ max: z.number().int().min(1).optional(), used: z.number().int().nonnegative().optional() }).optional(),
});

export const BudgetRuleSchema = z.strictObject({
  ...base,
  kind: z.literal("budget"),
  match: z.strictObject({ tools: list }).optional(),
  metric: z.enum(["calls", "cost_usd", "egress_bytes"]),
  limit: z.strictObject({ amount: z.number().nonnegative(), per: z.enum(["run", "thread", "day", "project"]) }),
  onExceed: z.enum(["ask", "deny", "end", "pause_agent"]),
});

export const ClassifierRuleSchema = z
  .strictObject({
    ...base,
    kind: z.literal("classifier"),
    label: text,
    detect: z.strictObject({
      terms: list.optional(),
      regex: list.optional(),
      validator: z.enum(["luhn", "iban_mod97", "us_ssn", "jwt", "none"]).optional(),
      caseInsensitive: z.boolean().optional(),
    }),
  })
  .superRefine((r, ctx) => {
    if (!r.detect.terms?.length && !r.detect.regex?.length) ctx.addIssue({ code: "custom", path: ["detect"], message: "needs terms or regex" });
    r.detect.regex?.forEach((src, i) => {
      const problem = regexProblem(src);
      if (problem) ctx.addIssue({ code: "custom", path: ["detect", "regex", i], message: `regex ${problem}` });
    });
  });

export const RuleSchema: z.ZodType<Rule> = z.discriminatedUnion("kind", [
  ToolRuleSchema,
  FlowRuleSchema,
  GrantRuleSchema,
  BudgetRuleSchema,
  ClassifierRuleSchema,
]);

/** "rules.0.scope: Unrecognized key: agent" lines, for errors and the compiler's repair turn. */
export function issueLines(error: z.ZodError, prefix: (string | number)[] = []): string[] {
  return error.issues.map((i) => `${[...prefix, ...i.path].join(".") || "(root)"}: ${i.message}`);
}
