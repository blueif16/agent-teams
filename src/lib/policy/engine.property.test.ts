/*
 * Invariants of decide(), over a small random domain where rules often match (so the properties aren't vacuous;
 * each test also checks that its interesting case happened often enough).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide } from "@/lib/policy/engine";
import { OUTCOME_ORDER } from "@/lib/policy/types";
import type { Archetype, ArgConstraint, Condition, Decision, FlowRule, GrantRule, Outcome, PolicyEvent, Rule, Scope, ToolRule } from "@/lib/policy/types";

const RUNS = 300;
const NOW = new Date("2026-10-17T12:00:00Z");
const PAST = "2026-10-01T00:00:00Z";
const FUTURE = "2026-11-01T00:00:00Z";

const TOOLS = ["send_email", "fetch_page", "execute", "read_file", "zz_tool"];
const TOOL_PATTERNS = [...TOOLS, "*", "*", "send_*", "fetch_*"];
const AGENTS = ["pip", "rex", "mira"];
const PROJECTS = ["acme", "bluebird", "dm:pip"];
const ARCHETYPES: Archetype[] = ["chief", "lead", "writer", "researcher", "analyst", "engineer", "coordinator"];
const LABELS = ["secret.aws", "pii.email", "pii.phone", "project:acme", "untrusted", "owner_private"];
const LABEL_PATTERNS = [...LABELS, "secret.*", "pii.*", "project:*", "*"];
const SINKS = ["web", "email", "model:crusoe", "trace:langsmith", "memory:global", "project:other", "api:github.com"];
const SINK_PATTERNS = [...SINKS, "model:*", "api:*", "*"];
const URLS = ["https://acme.com/a", "https://pastebin.com/x", "http://10.0.0.1/", "https://docs.acme.com/"];
const EMAILS = ["sam@acme.com", "eve@evil.example", "kim@eu.acme.com"];

const rank = (o: Outcome) => OUTCOME_ORDER.indexOf(o);
const some = <T>(xs: readonly T[]) => fc.subarray([...xs], { minLength: 1, maxLength: 3 });

/** Absent `absent` times out of `absent + 1`, so rules stay broad enough to match often. */
const rarely = <T>(arb: fc.Arbitrary<T>, absent = 2): fc.Arbitrary<T | undefined> =>
  fc.oneof({ arbitrary: fc.constant(undefined), weight: absent }, { arbitrary: arb, weight: 1 });
const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const arbScope: fc.Arbitrary<Scope> = fc
  .record({
    agents: rarely(some([...AGENTS, "*"])),
    archetypes: rarely(fc.subarray(ARCHETYPES, { minLength: 2, maxLength: 5 })),
    projects: rarely(some([...PROJECTS, "*", "dm:*"])),
  })
  .map(defined);

const arbConstraint: fc.Arbitrary<ArgConstraint> = fc.oneof(
  fc.record({
    path: fc.constant("url"),
    op: fc.constantFrom("host_in", "host_not_in", "domain_in", "domain_not_in"),
    value: some(["acme.com", "pastebin.com", "docs.acme.com", "10.0.0.1"]),
  }),
  fc.record({ path: fc.constant("to[*]"), op: fc.constantFrom("in", "not_in", "domain_in", "domain_not_in"), value: some([...EMAILS, "acme.com"]) }),
  fc.record({ path: fc.constant("url"), op: fc.constantFrom("matches", "not_matches"), value: fc.constantFrom("^https?://\\d", "pastebin") }),
  fc.record({ path: fc.constant("query"), op: fc.constant("max_len"), value: fc.integer({ min: 0, max: 8 }) }),
  fc.record({ path: fc.constant("path"), op: fc.constantFrom("path_glob", "path_not_glob"), value: fc.constantFrom("/projects/acme/**", "/projects/*/a.md") }),
) as fc.Arbitrary<ArgConstraint>;

const arbLabelCond = fc.record({ any: some(LABEL_PATTERNS), none: some(LABEL_PATTERNS) }, { requiredKeys: [] });
const arbWhen: fc.Arbitrary<Condition> = fc.record(
  { contextLabels: arbLabelCond, argLabels: arbLabelCond, destFromUntrusted: fc.boolean() },
  { requiredKeys: [] },
);

const arbMeta = fc
  .record({
    mode: rarely(fc.constantFrom<"enforce" | "shadow">("enforce", "shadow")),
    locked: rarely(fc.boolean()),
    expiresAt: rarely(fc.constantFrom(PAST, FUTURE)),
  })
  .map(defined);

const arbToolRule = (effects: ToolRule["effect"][]): fc.Arbitrary<ToolRule> =>
  fc
    .tuple(
      arbScope,
      some(TOOL_PATTERNS),
      fc.constantFrom(...effects),
      rarely(fc.array(arbConstraint, { minLength: 1, maxLength: 2 })),
      rarely(arbWhen, 3),
      arbMeta,
    )
    .map(([scope, tools, effect, args, when, meta]) => ({
      id: "r_tmp000",
      kind: "tool" as const,
      scope,
      match: { tools },
      effect,
      ...(args ? { args } : {}),
      ...(when ? { when } : {}),
      ...meta,
      createdBy: "owner" as const,
    }));

const arbFlowRule = (actions: FlowRule["action"][]): fc.Arbitrary<FlowRule> =>
  fc
    .tuple(arbScope, some(LABEL_PATTERNS), some(SINK_PATTERNS), fc.constantFrom(...actions), rarely(fc.array(arbConstraint, { maxLength: 1 }), 3), arbMeta)
    .map(([scope, labels, sinks, action, where, meta]) => ({
      id: "r_tmp000",
      kind: "flow" as const,
      scope,
      labels,
      sinks,
      action,
      ...(where ? { where } : {}),
      ...meta,
      createdBy: "owner" as const,
    }));

const arbGrant: fc.Arbitrary<GrantRule> = fc
  .tuple(
    arbScope,
    fc.constantFrom(...TOOL_PATTERNS),
    rarely(fc.array(arbConstraint, { minLength: 1, maxLength: 1 })),
    fc.constantFrom<GrantRule["grantScope"]>("once", "thread", "project", "until", "always"),
    rarely(fc.record({ max: fc.integer({ min: 1, max: 2 }), used: fc.integer({ min: 0, max: 2 }) }, { requiredKeys: [] })),
    fc
      .record({ mode: rarely(fc.constantFrom<"enforce" | "shadow">("enforce", "shadow")), expiresAt: rarely(fc.constantFrom(PAST, FUTURE)) })
      .map(defined),
  )
  .map(([scope, tool, args, grantScope, uses, meta]) => ({
    id: "r_tmp000",
    kind: "grant" as const,
    scope,
    tool,
    ...(args ? { args } : {}),
    grantScope,
    ...(uses ? { uses } : {}),
    ...meta,
    createdBy: "approval" as const,
  }));

const ACTIONS: FlowRule["action"][] = ["allow", "redact", "mask", "hash", "tokenize", "ask", "block"];
const arbRule: fc.Arbitrary<Rule> = fc.oneof(arbToolRule(["allow", "ask", "deny"]), arbFlowRule(ACTIONS));
const withIds = <T extends Rule>(rs: T[], prefix: string): T[] => rs.map((r, i) => ({ ...r, id: `r_${prefix}${String(i).padStart(4, "0")}` }));
const arbRules = fc.array(arbRule, { maxLength: 8 }).map((rs) => withIds(rs, "rule"));
const arbGrants = fc.array(arbGrant, { maxLength: 2 }).map((gs) => withIds(gs, "gran"));

const arbEvent: fc.Arbitrary<PolicyEvent> = fc.record({
  agentId: fc.constantFrom(...AGENTS),
  archetype: fc.constantFrom(...ARCHETYPES),
  projectId: fc.constantFrom(...PROJECTS),
  tool: fc.constantFrom(...TOOLS),
  args: fc.record(
    {
      url: fc.constantFrom(...URLS),
      to: fc.subarray(EMAILS, { maxLength: 2 }),
      query: fc.constantFrom("", "abc", "password reset"),
      path: fc.constantFrom("/projects/acme/a.md", "/projects/bluebird/a.md", "/projects/acme/../x/a.md"),
    },
    { requiredKeys: [] },
  ) as fc.Arbitrary<Record<string, unknown>>,
  argSpans: fc.array(
    fc.record({ path: fc.constantFrom("url", "to[0]", "body", "query"), start: fc.constant(0), end: fc.constant(4), label: fc.constantFrom(...LABELS) }),
    { maxLength: 3 },
  ),
  contextLabels: fc.subarray(LABELS, { maxLength: 3 }),
  sinks: fc.subarray(SINKS, { minLength: 1, maxLength: 3 }),
});

/** What a decision becomes when its asks are lifted: the strongest rewrite still applied, else allow. */
const lifted = (d: Decision): Outcome => d.transforms.reduce<Outcome>((acc, t) => (rank(t.action) < rank(acc) ? t.action : acc), "allow");

describe("decide: properties", () => {
  it("adding a deny or block rule never makes a decision less restrictive", () => {
    let tightened = 0;
    const arbRestrictive = fc.oneof(arbToolRule(["deny"]), arbFlowRule(["block"])).map((r) => ({ ...r, id: "r_extra000" }));
    fc.assert(
      fc.property(arbEvent, arbRules, arbGrants, arbRestrictive, (e, rules, grants, extra) => {
        const before = decide(e, rules, grants, NOW);
        const after = decide(e, [...rules, extra], grants, NOW);
        if (rank(after.effect) < rank(before.effect)) tightened++;
        expect(rank(after.effect)).toBeLessThanOrEqual(rank(before.effect));
      }),
      { numRuns: RUNS },
    );
    expect(tightened).toBeGreaterThan(RUNS / 20);
  });

  it("adding a grant only ever lifts an ask, and changes nothing else", () => {
    let liftedCount = 0;
    fc.assert(
      fc.property(arbEvent, arbRules, arbGrants, arbGrant, (e, rules, grants, g) => {
        const before = decide(e, rules, grants, NOW);
        const after = decide(e, rules, [...grants, { ...g, id: "r_extra000" }], NOW);
        expect(after.transforms).toEqual(before.transforms);
        expect(after.labels).toEqual(before.labels);
        if (after.effect === before.effect) return;
        liftedCount++;
        expect(before.effect).toBe("ask");
        expect(after.effect).toBe(lifted(before));
      }),
      { numRuns: RUNS },
    );
    expect(liftedCount).toBeGreaterThan(RUNS / 50);
  });

  it("the decision does not depend on rule or grant order", () => {
    let multi = 0;
    const arbCase = fc.tuple(arbEvent, arbRules, arbGrants).chain(([e, rules, grants]) =>
      fc.tuple(
        fc.constant(e),
        fc.constant(rules),
        fc.constant(grants),
        fc.shuffledSubarray(rules, { minLength: rules.length, maxLength: rules.length }),
        fc.shuffledSubarray(grants, { minLength: grants.length, maxLength: grants.length }),
      ),
    );
    fc.assert(
      fc.property(arbCase, ([e, rules, grants, rules2, grants2]) => {
        const a = decide(e, rules, grants, NOW);
        if (a.firedRuleIds.length > 1) multi++;
        expect(decide(e, rules2, grants2, NOW)).toEqual(a);
      }),
      { numRuns: RUNS },
    );
    expect(multi).toBeGreaterThan(RUNS / 10);
  });
});
