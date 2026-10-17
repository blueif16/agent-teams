/*
 * Conflict and overlap check for new rules (E §5.2 step 6), by enumerating the small finite domain: tools in the tier
 * table and catalog × archetypes, agents and projects named in the rules × the labels and sinks in play × arg values
 * drawn from every constraint in play. For each cell a new rule touches, decide() runs with and without it:
 * - tightens: some outcome changes; one entry per rule (or tier default) whose outcome it overrides.
 * - revokes_grant: a cell a standing grant let through is now refused or asked.
 * - duplicate: an existing rule of the same kind and outcome covers exactly the same cells.
 * - shadowed: no outcome changes; the rule that already decides most of its cells is named.
 * deny and block count as the same outcome (both refuse the call). Budgets and classifiers aren't decided per call,
 * so they are only checked for duplicates.
 */
import { explain, flowRuleHits, grantApplies, isExpired, rank, toolRuleMatches, type Explanation } from "./engine";
import { globMatch } from "./glob";
import { ARCHETYPES } from "./schema";
import { TIERS, TOOL_CATALOG, tierOf } from "./tiers";
import type { Archetype, ArgConstraint, FlowRule, GrantRule, Label, Outcome, PolicyEvent, Rule, RuleConflict, Scope, Sink, ToolRule } from "./types";

type Decidable = ToolRule | FlowRule | GrantRule;

const concrete = (pattern: string) => pattern.replace(/\*+/g, "x");
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const BASE_LABELS = ["secret.x", "pii.x", "owner_private", "untrusted", "project:x"];
const BASE_SINKS = ["model:crusoe", "trace:langsmith", "web", "email", "calendar", "api:x", "memory:self", "memory:global", "project:other"];
const EMAILISH = /^(to|cc|bcc|recipients?|attendees|email)$/;

/** The outcome class conflicts compare: deny and block both refuse the call. */
const outcomeClass = (o: Outcome) => (o === "block" || o === "deny" ? "refuse" : o);

interface Domain {
  tools: string[];
  labels: Label[];
  sinks: Sink[];
  agents: string[];
  projects: string[];
  archetypes: Archetype[];
  argSamples: Record<string, unknown>[];
}

function scopeValues(rules: Rule[], key: keyof Scope): string[] {
  return rules.flatMap((r) => (r.scope[key] as string[] | undefined) ?? []).filter((v) => v !== "*");
}

function constraintsOf(r: Rule): ArgConstraint[] {
  if (r.kind === "tool" || r.kind === "grant") return r.args ?? [];
  if (r.kind === "flow") return r.where ?? [];
  return [];
}

function setPath(path: string, value: unknown): Record<string, unknown> {
  const parts = path.replace(/\[(?:\*|\d+)\]/g, "[]").split(".");
  let v: unknown = value;
  for (let i = parts.length - 1; i >= 0; i--) {
    const isList = parts[i].endsWith("[]");
    const key = parts[i].replace("[]", "");
    v = { [key]: isList ? [v] : v };
  }
  return v as Record<string, unknown>;
}

/** Values that satisfy and violate one constraint, for its path. */
function valuesFor(c: ArgConstraint): unknown[] {
  const base = (c.path.replace(/\[(?:\*|\d+)\]/g, "").split(".").pop() ?? "").toLowerCase();
  const list = ([c.value].flat() as unknown[]).map(String);
  const asDest = (host: string) => (EMAILISH.test(base) ? `user@${host}` : `https://${host}/`);
  switch (c.op) {
    case "host_in":
    case "host_not_in":
    case "domain_in":
    case "domain_not_in":
      return [asDest(concrete(list[0]).replace(/^x\./, "a.")), asDest("zz.example")];
    case "path_glob":
    case "path_not_glob":
      return [list[0].replace(/\*\*/g, "x/y").replace(/[*?]/g, "x"), "/zz/none"];
    case "in":
    case "not_in":
      return [[c.value].flat()[0], "zz_other"];
    case "matches":
    case "not_matches":
      return EMAILISH.test(base) ? ["user@zz.example", "user@10.0.0.1"] : ["https://zz.example/", "http://10.0.0.1/", "zz"];
    case "max_len": {
      const n = typeof c.value === "number" ? c.value : 0;
      return ["x".repeat(n), "x".repeat(n + 1)];
    }
  }
}

function buildDomain(rules: Rule[]): Domain {
  const named = rules.flatMap((r) => (r.kind === "tool" || r.kind === "budget" ? (r.match?.tools ?? []) : r.kind === "grant" ? [r.tool] : []));
  const tools = uniq([...TIERS.flatMap((t) => t.tools), ...Object.keys(TOOL_CATALOG), ...named].map(concrete));
  const ruleLabels = rules.flatMap((r) => {
    if (r.kind === "flow") return r.labels;
    if (r.kind === "classifier") return [r.label];
    if (r.kind === "tool") return [...(r.when?.contextLabels?.any ?? []), ...(r.when?.contextLabels?.none ?? []), ...(r.when?.argLabels?.any ?? []), ...(r.when?.argLabels?.none ?? [])];
    return [];
  });
  const labels = uniq([...BASE_LABELS, ...ruleLabels.map(concrete)]);
  const sinks = uniq([...BASE_SINKS, ...Object.values(TOOL_CATALOG).flatMap((c) => c.sinks), ...rules.flatMap((r) => (r.kind === "flow" ? r.sinks : []))].map(concrete));
  const mentioned = uniq(scopeValues(rules, "archetypes")) as Archetype[];
  const archetypes = [...mentioned, ...ARCHETYPES.filter((a) => !mentioned.includes(a)).slice(0, 1)];
  const argSamples: Record<string, unknown>[] = [{}];
  const seen = new Set(["{}"]);
  for (const c of rules.flatMap(constraintsOf)) {
    for (const v of valuesFor(c)) {
      const sample = setPath(c.path, v);
      const key = JSON.stringify(sample);
      if (!seen.has(key)) {
        seen.add(key);
        argSamples.push(sample);
      }
    }
  }
  return {
    tools,
    labels,
    sinks,
    agents: uniq([...scopeValues(rules, "agents").map(concrete), "agent_x"]),
    projects: uniq([...scopeValues(rules, "projects").map(concrete), "proj_x"]),
    archetypes,
    argSamples,
  };
}

const catalogSinks = (tool: string) =>
  uniq(Object.entries(TOOL_CATALOG).filter(([pattern]) => globMatch(pattern, tool)).flatMap(([, c]) => c.sinks.map(concrete)));
const toolsForSink = (d: Domain, sink: Sink) => {
  const hits = d.tools.filter((t) => catalogSinks(t).some((s) => globMatch(s, sink) || globMatch(sink, s)));
  return hits.length ? hits : ["zz_tool"];
};

/** Every cell of the domain a rule could touch (before checking that it does). */
function cellsFor(r: Decidable, d: Domain): PolicyEvent[] {
  const pick = (key: keyof Scope, all: string[]) => {
    const own = ((r.scope[key] as string[] | undefined) ?? []).filter((v) => v !== "*").map(concrete);
    return own.length ? own : all;
  };
  const agents = pick("agents", d.agents);
  const archetypes = pick("archetypes", d.archetypes) as Archetype[];
  const projects = pick("projects", d.projects);
  const span = (label: Label, path = "body") => ({ path, start: 0, end: 4, label });
  const labelSets: Pick<PolicyEvent, "argSpans" | "contextLabels">[] =
    r.kind === "flow"
      ? d.labels.filter((l) => r.labels.some((p) => globMatch(p, l))).map((l) => ({ argSpans: [span(l)], contextLabels: [l] }))
      : [
          { argSpans: [], contextLabels: [] },
          ...d.labels.map((l) => ({ argSpans: [span(l)], contextLabels: [l] })),
          { argSpans: [span("untrusted", "url"), span("untrusted", "to[0]")], contextLabels: ["untrusted"] },
        ];
  const toolSinks: [string, Sink[]][] =
    r.kind === "flow"
      ? d.sinks.filter((s) => r.sinks.some((p) => globMatch(p, s))).flatMap((s) => toolsForSink(d, s).map((t): [string, Sink[]] => [t, [s]]))
      : d.tools
          .filter((t) => (r.kind === "tool" ? r.match.tools : [r.tool]).some((p) => globMatch(p, t)))
          .flatMap((t) => [[t, []] as [string, Sink[]], ...catalogSinks(t).map((s): [string, Sink[]] => [t, [s]])]);
  const own = constraintsOf(r);
  const allSatisfied = own.reduce<Record<string, unknown>>((acc, c) => ({ ...acc, ...setPath(c.path, valuesFor(c)[0]) }), {});
  const argSamples = own.length > 1 ? [...d.argSamples, allSatisfied] : d.argSamples;

  const out: PolicyEvent[] = [];
  for (const agentId of agents)
    for (const archetype of archetypes)
      for (const projectId of projects)
        for (const [tool, sinks] of toolSinks)
          for (const args of argSamples)
            for (const ls of labelSets) out.push({ agentId, archetype, projectId, tool, args, sinks, ...ls });
  return out;
}

function touches(r: Decidable, e: PolicyEvent, now: Date): boolean {
  if (isExpired(r, now)) return false;
  if (r.kind === "tool") return toolRuleMatches(r, e);
  if (r.kind === "flow") return flowRuleHits(r, e) !== null;
  return grantApplies(r, e);
}

const outcomeOf = (r: Decidable) => (r.kind === "tool" ? r.effect : r.kind === "flow" ? r.action : "grant");

/** Who decided a cell before the new rule: the rules (or tier default) behind its outcome, or the grant that lifted it. */
function deciders(x: Explanation, tool: string): string[] {
  if (x.liftedBy) return [x.liftedBy];
  const cls = outcomeClass(x.decision.effect);
  const ids = x.contributions.filter((c) => outcomeClass(c.outcome) === cls).map((c) => c.ruleId ?? `tier:${tierOf(tool)?.tier ?? "none"}`);
  return ids.length ? uniq(ids) : [`tier:${tierOf(tool)?.tier ?? "none"}`];
}

const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${k}:${canonical((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
const IGNORED = new Set(["id", "createdBy", "source", "reason", "mode", "expiresAt", "locked"]);
const essence = (r: Rule) => canonical(Object.fromEntries(Object.entries(r).filter(([k]) => !IGNORED.has(k))));

function analyze(n: Decidable, existing: Rule[], d: Domain, now: Date): RuleConflict[] {
  const rules = existing.filter((r) => r.kind !== "grant");
  const grants = existing.filter((r): r is GrantRule => r.kind === "grant");
  const live: Decidable = { ...n, mode: "enforce" };
  const cells = cellsFor(live, d).filter((e) => touches(live, e, now));
  if (!cells.length) return [];

  const tightened = new Map<string, { count: number; example: string }>();
  const revoked = new Map<string, number>();
  const decidedBy = new Map<string, number>();
  let changed = 0;
  for (const e of cells) {
    const before = explain(e, rules, grants, now);
    const after = live.kind === "grant" ? explain(e, rules, [...grants, live], now) : explain(e, [...rules, live], grants, now);
    const same =
      outcomeClass(before.decision.effect) === outcomeClass(after.decision.effect) &&
      JSON.stringify(before.decision.transforms) === JSON.stringify(after.decision.transforms);
    const who = deciders(before, e.tool);
    if (same) {
      for (const id of who) decidedBy.set(id, (decidedBy.get(id) ?? 0) + 1);
      continue;
    }
    changed++;
    const stricter = rank(after.decision.effect) <= rank(before.decision.effect);
    if (!stricter) continue; // a relaxation (a grant lifting an ask, an allow over a tier default) is not a conflict
    if (before.liftedBy) {
      revoked.set(before.liftedBy, (revoked.get(before.liftedBy) ?? 0) + 1);
      continue;
    }
    for (const id of who) {
      const t = tightened.get(id) ?? { count: 0, example: `${e.tool}: ${before.decision.effect} → ${after.decision.effect}` };
      t.count++;
      tightened.set(id, t);
    }
  }

  const byCount = <V>(m: Map<string, V>, count: (v: V) => number) => [...m.entries()].sort((a, b) => count(b[1]) - count(a[1]) || (a[0] < b[0] ? -1 : 1));
  const out: RuleConflict[] = [];
  for (const [id, n2] of byCount(revoked, (v) => v)) {
    out.push({ kind: "revokes_grant", ruleId: n.id, otherRuleId: id, note: `Overrides grant ${id} in ${n2} of ${cells.length} cases: those calls would no longer go through without asking.` });
  }
  for (const [id, t] of byCount(tightened, (v) => v.count)) {
    out.push({ kind: "tightens", ruleId: n.id, otherRuleId: id, note: `Changes ${t.count} of ${cells.length} cases decided by ${id}, e.g. ${t.example}.` });
  }
  if (changed) return out;

  // Nothing changes: a duplicate if an existing rule of the same kind and outcome covers exactly the same cells.
  for (const x of existing) {
    if (x.kind !== n.kind || x.mode === "shadow" || outcomeOf(x as Decidable) !== outcomeOf(n)) continue;
    const xs = x as Decidable;
    if (!cells.every((e) => touches(xs, e, now))) continue;
    const theirs = cellsFor(xs, d).filter((e) => touches(xs, e, now));
    if (theirs.every((e) => touches(live, e, now))) {
      return [{ kind: "duplicate", ruleId: n.id, otherRuleId: x.id, note: `Covers the same ${cells.length} cases with the same outcome as ${x.id}.` }];
    }
  }
  const [top] = byCount(decidedBy, (v) => v);
  return top ? [{ kind: "shadowed", ruleId: n.id, otherRuleId: top[0], note: `Never changes an outcome: ${top[0]} already decides ${top[1]} of its ${cells.length} cases.` }] : [];
}

export function findConflicts(added: Rule[], existing: Rule[], now: Date = new Date()): RuleConflict[] {
  const d = buildDomain([...existing, ...added]);
  return added.flatMap((n): RuleConflict[] => {
    if (n.kind === "tool" || n.kind === "flow" || n.kind === "grant") return analyze(n, existing, d, now);
    const twin = existing.find((x) => x.kind === n.kind && essence(x) === essence(n));
    return twin ? [{ kind: "duplicate", ruleId: n.id, otherRuleId: twin.id, note: `Same ${n.kind} as ${twin.id}.` }] : [];
  });
}
