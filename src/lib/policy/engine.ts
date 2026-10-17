/*
 * The policy/v1 evaluator (design §6, E §4). `decide` is pure, so enforcement, dry runs and the conflict check share
 * it. Semantics, in one place:
 * - A rule applies when its scope matches (AND of present keys, globs, "*" = any) and its own match holds.
 * - Arg constraints are read in the safe direction. A rule that restricts (tool ask/deny, any flow action but allow)
 *   holds a constraint when ANY value at the path satisfies it, so "to[*] domain_not_in [acme.com]" fires when one
 *   recipient is outside. A rule that relaxes (tool allow, flow allow, grants) needs EVERY value to satisfy it. A
 *   missing arg never satisfies a constraint.
 * - Flow rules match labels on arg spans and in the context. Rewrites (tokenize/redact/hash/mask) need a located span;
 *   block/ask/allow also fire on a label that is only in the context, because anything the agent writes may derive
 *   from it.
 * - Paths are matched as the file system resolves them (normPath): "..", "//" and trailing slashes resolved, case and
 *   Unicode form folded. A path that escapes (not absolute, or ".." out of its top-level folder) meets every
 *   restricting path constraint and no relaxing one.
 * - Most restrictive wins (OUTCOME_ORDER). When no enforced tool rule matches, the tool's tier decides (tiers.ts);
 *   a tool in no tier asks.
 */
import { globMatch } from "./glob";
import { tierOf } from "./tiers";
import { OUTCOME_ORDER } from "./types";
import type { ArgConstraint, Condition, Decide, Decision, FlowRule, GrantRule, Label, Outcome, PolicyEvent, Rule, Scope, ToolRule } from "./types";

type Transform = Decision["transforms"][number];
type Rewrite = Transform["action"];

const REWRITES = new Set<Outcome>(["tokenize", "redact", "hash", "mask"]);

/** Lower is more restrictive. */
export const rank = (o: Outcome): number => OUTCOME_ORDER.indexOf(o);
export const strictest = (a: Outcome, b: Outcome): Outcome => (rank(a) <= rank(b) ? a : b);

// ---------- globs ----------

export { globMatch };
const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\/]/g, "\\$&");
const anyGlob = (patterns: readonly string[], value: string) => patterns.some((p) => globMatch(p, value));
const labelsHit = (patterns: readonly Label[], labels: readonly Label[]) => labels.some((l) => anyGlob(patterns, l));

// ---------- scope ----------

export function inScope(scope: Scope | undefined, e: PolicyEvent): boolean {
  const ok = (list: readonly string[] | undefined, v: string) => list === undefined || anyGlob(list, v);
  return ok(scope?.agents, e.agentId) && ok(scope?.archetypes, e.archetype) && ok(scope?.projects, e.projectId);
}

// ---------- arg paths ----------

/** JSONPath-lite: "url", "to[*]", "to[0]", "items[*].url". A final array is read element by element. */
export function resolvePath(args: unknown, path: string): unknown[] {
  const tokens = path.match(/\[(?:\*|\d+)\]|[^.[\]]+/g) ?? [];
  let cur: unknown[] = [args];
  for (const t of tokens) {
    if (t === "[*]") cur = cur.flatMap((v) => (Array.isArray(v) ? v : [v]));
    else if (t.startsWith("[")) {
      const i = Number(t.slice(1, -1));
      cur = cur.flatMap((v) => (Array.isArray(v) && i < v.length ? [v[i]] : []));
    } else {
      cur = cur.flatMap((v) =>
        v && typeof v === "object" && !Array.isArray(v) && Object.hasOwn(v, t) ? [(v as Record<string, unknown>)[t]] : [],
      );
    }
  }
  return cur.flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => v !== undefined && v !== null);
}

/** "to[1]" → "to", "message.url" → "url". */
const baseArg = (path: string) => (path.replace(/\[(?:\*|\d+)\]/g, "").split(".").pop() ?? "").toLowerCase();

// ---------- values ----------

/** The host a URL, a bare host or an email address points at, normalized by the WHATWG URL parser. */
export function hostOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  let host: string;
  try {
    if (/^[a-z][a-z0-9+.-]*:[/\\]{2}/i.test(s)) host = new URL(s).hostname;
    else if (s.startsWith("//")) host = new URL(`http:${s}`).hostname;
    else {
      const email = /^(?:mailto:)?(?:[^<>]*<)?[^\s<>@/]+@([^\s<>@/?#]+)>?$/i.exec(s);
      host = new URL(`http://${email ? email[1] : s}`).hostname;
    }
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, "");
  return host || null;
}

const normDomain = (d: string) => d.trim().toLowerCase().replace(/^\*?\./, "").replace(/\.$/, "");

/**
 * A path as the file system will resolve it: "." and empty segments dropped (so "//" and a trailing "/" go), ".."
 * resolved, in NFC. POSIX without node:path, so the engine also runs in the browser. null when the path escapes: it
 * isn't absolute, or a ".." climbs out of its top-level folder (each agent mount is one, so that is a jump between
 * mounts or past the root). Case is folded by the glob match, the way macOS compares names.
 */
export function normPath(p: string): string | null {
  if (!p.startsWith("/")) return null;
  const out: string[] = [];
  for (const seg of p.normalize("NFC").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg !== "..") out.push(seg);
    else if (out.length > 1) out.pop();
    else return null;
  }
  return `/${out.join("/")}`;
}

const pathGlobCache = new Map<string, RegExp>();
function pathGlob(glob: string, p: string): boolean {
  let re = pathGlobCache.get(glob);
  if (!re) {
    if (pathGlobCache.size > 2000) pathGlobCache.clear();
    const src = glob
      .normalize("NFC")
      .split("**")
      .map((part) => part.split("*").map((s) => s.split("?").map(escapeRe).join("[^/]")).join("[^/]*"))
      .join(".*");
    // u + i: Unicode case folding, so "ſ" or the Kelvin sign can't stand in for "s" or "k" unseen.
    re = new RegExp(`^${src}$`, "isu");
    pathGlobCache.set(glob, re);
  }
  const norm = normPath(p);
  return norm !== null && re.test(norm);
}

const regexCache = new Map<string, RegExp | null>();
/** A JS regex source; a leading "(?i)" (gitleaks style) turns on the i flag. Invalid sources match nothing. */
export function compileRegex(source: string): RegExp | null {
  if (regexCache.has(source)) return regexCache.get(source)!;
  if (regexCache.size > 2000) regexCache.clear();
  let re: RegExp | null;
  try {
    re = source.startsWith("(?i)") ? new RegExp(source.slice(4), "i") : new RegExp(source);
  } catch {
    re = null;
  }
  regexCache.set(source, re);
  return re;
}

function normalizedUrl(s: string): string | null {
  if (!/^[a-z][a-z0-9+.-]*:[/\\]{2}/i.test(s.trim())) return null;
  try {
    return new URL(s.trim()).href;
  } catch {
    return null;
  }
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);
const asText = (v: unknown) => (typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));
const primitive = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";

type PositiveOp = "host_in" | "domain_in" | "path_glob" | "in" | "matches" | "max_len";
const NEGATION: Partial<Record<ArgConstraint["op"], PositiveOp>> = {
  host_not_in: "host_in",
  domain_not_in: "domain_in",
  path_not_glob: "path_glob",
  not_in: "in",
  not_matches: "matches",
};

function positive(op: PositiveOp, v: unknown, value: unknown): boolean {
  switch (op) {
    case "host_in": {
      const h = hostOf(v);
      return h !== null && asList(value).some((p) => typeof p === "string" && globMatch(p.trim().toLowerCase(), h));
    }
    case "domain_in": {
      const h = hostOf(v);
      return h !== null && asList(value).some((d) => typeof d === "string" && (h === normDomain(d) || h.endsWith(`.${normDomain(d)}`)));
    }
    case "path_glob":
      return typeof v === "string" && asList(value).some((g) => typeof g === "string" && pathGlob(g, v));
    case "in":
      return primitive(v) && asList(value).some((x) => primitive(x) && String(x) === String(v));
    case "matches": {
      const s = asText(v);
      const norm = normalizedUrl(s);
      return asList(value).some((src) => {
        const re = typeof src === "string" ? compileRegex(src) : null;
        return re !== null && (re.test(s) || (norm !== null && re.test(norm)));
      });
    }
    case "max_len":
      return typeof value === "number" && asText(v).length <= value;
  }
}

/** Whether one constraint holds, read in the safe direction for the rule (see the header). */
export function constraintHolds(c: ArgConstraint, args: Record<string, unknown>, relaxing: boolean): boolean {
  const values = resolvePath(args, c.path);
  if (!values.length) return false;
  const base = NEGATION[c.op];
  const test = base ? (v: unknown) => !positive(base, v, c.value) : (v: unknown) => positive(c.op as PositiveOp, v, c.value);
  // A path that escapes can't be placed anywhere, so it meets every restricting path test and no relaxing one.
  const judge = c.op === "path_glob" || c.op === "path_not_glob" ? (v: unknown) => (typeof v === "string" && normPath(v) === null ? !relaxing : test(v)) : test;
  return relaxing ? values.every(judge) : values.some(judge);
}

const allHold = (cs: ArgConstraint[] | undefined, args: Record<string, unknown>, relaxing: boolean) =>
  (cs ?? []).every((c) => constraintHolds(c, args, relaxing));

// ---------- conditions ----------

/** Arg names that carry a destination (URL, recipient, channel) for any tool. */
const DEST_ARGS = new Set(["url", "urls", "to", "cc", "bcc", "recipient", "recipients", "attendees", "channel", "host", "endpoint", "webhook"]);

export const destFromUntrusted = (e: PolicyEvent) => e.argSpans.some((s) => s.label === "untrusted" && DEST_ARGS.has(baseArg(s.path)));

function whenHolds(w: Condition | undefined, e: PolicyEvent): boolean {
  if (!w) return true;
  const argLabels = e.argSpans.map((s) => s.label);
  if (w.contextLabels?.any && !labelsHit(w.contextLabels.any, e.contextLabels)) return false;
  if (w.contextLabels?.none && labelsHit(w.contextLabels.none, e.contextLabels)) return false;
  if (w.argLabels?.any && !labelsHit(w.argLabels.any, argLabels)) return false;
  if (w.argLabels?.none && labelsHit(w.argLabels.none, argLabels)) return false;
  if (w.destFromUntrusted !== undefined && w.destFromUntrusted !== destFromUntrusted(e)) return false;
  return true;
}

// ---------- rule matching ----------

export function toolRuleMatches(r: ToolRule, e: PolicyEvent): boolean {
  return inScope(r.scope, e) && anyGlob(r.match?.tools ?? [], e.tool) && allHold(r.args, e.args, r.effect === "allow") && whenHolds(r.when, e);
}

/** The spans a flow rule rewrites (or flags) in this event, or null when it doesn't apply. */
export function flowRuleHits(r: FlowRule, e: PolicyEvent): PolicyEvent["argSpans"] | null {
  if (!inScope(r.scope, e)) return null;
  if (!e.sinks.some((s) => anyGlob(r.sinks, s))) return null;
  if (!allHold(r.where, e.args, r.action === "allow")) return null;
  const spans = e.argSpans.filter((s) => anyGlob(r.labels, s.label));
  if (REWRITES.has(r.action)) return spans.length ? spans : null;
  return spans.length || labelsHit(r.labels, e.contextLabels) ? spans : null;
}

// ---------- decide ----------

export interface Contribution {
  /** null for the default when no tool rule matched. */
  ruleId: string | null;
  outcome: Outcome;
  locked: boolean;
}

export interface Explanation {
  decision: Decision;
  /** What each enforced rule (and the default) asked for. */
  contributions: Contribution[];
  /** The grant that lifted the ask, if one did. */
  liftedBy: string | null;
}

const spanKey = (s: { path: string; start: number; end: number; label: Label }) => `${s.path}\u0000${s.start}\u0000${s.end}\u0000${s.label}`;

function compareTransforms(a: Transform, b: Transform): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : a.start - b.start || a.end - b.end || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
}

/** Expired at `now`. A grant whose date can't be read counts as expired (fail closed); any other rule stays on. */
export function isExpired(r: Rule, now: Date): boolean {
  if (!r.expiresAt) return false;
  const t = Date.parse(r.expiresAt);
  if (Number.isNaN(t)) return r.kind === "grant";
  return t <= now.getTime();
}

const usesLeft = (g: GrantRule) => (g.uses?.used ?? 0) < (g.uses?.max ?? (g.grantScope === "once" ? 1 : Infinity));

export function grantApplies(g: GrantRule, e: PolicyEvent): boolean {
  return inScope(g.scope, e) && globMatch(g.tool, e.tool) && allHold(g.args, e.args, true) && usesLeft(g);
}

export function explain(e: PolicyEvent, rules: Rule[], grants: GrantRule[], now: Date): Explanation {
  const contributions: Contribution[] = [];
  const fired = new Set<string>();
  const rewrites = new Map<string, Transform>();
  let toolMatched = false;
  const live = rules.filter((r) => !isExpired(r, now));

  for (const r of live) {
    const shadow = r.mode === "shadow";
    if (r.kind === "tool") {
      if (!toolRuleMatches(r, e)) continue;
      fired.add(r.id);
      if (shadow) continue;
      contributions.push({ ruleId: r.id, outcome: r.effect, locked: Boolean(r.locked) });
      toolMatched = true;
    } else if (r.kind === "flow") {
      const spans = flowRuleHits(r, e);
      if (!spans) continue;
      fired.add(r.id);
      if (shadow) continue;
      contributions.push({ ruleId: r.id, outcome: r.action, locked: Boolean(r.locked) });
      if (!REWRITES.has(r.action)) continue;
      for (const s of spans) {
        const key = spanKey(s);
        const prev = rewrites.get(key);
        const action = r.action as Rewrite;
        if (!prev || rank(action) < rank(prev.action)) rewrites.set(key, { path: s.path, start: s.start, end: s.end, label: s.label, action });
      }
    }
  }

  // No enforced tool rule matched: the tool's tier decides, and a tool in no tier asks.
  if (!toolMatched) contributions.push({ ruleId: null, outcome: tierOf(e.tool)?.effect ?? "ask", locked: false });

  let effect = contributions.reduce<Outcome>((acc, c) => strictest(acc, c.outcome), "allow");
  let liftedBy: string | null = null;

  // A grant lifts every ask when none of them is locked; whatever else applied (a rewrite) still applies.
  if (effect === "ask" && !contributions.some((c) => c.outcome === "ask" && c.locked)) {
    const candidates = [...live.filter((r): r is GrantRule => r.kind === "grant"), ...grants]
      .filter((g) => !isExpired(g, now) && grantApplies(g, e))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const g of candidates.filter((g) => g.mode === "shadow")) fired.add(g.id);
    const used = candidates.find((g) => g.mode !== "shadow");
    if (used) {
      fired.add(used.id);
      liftedBy = used.id;
      effect = contributions.filter((c) => c.outcome !== "ask").reduce<Outcome>((acc, c) => strictest(acc, c.outcome), "allow");
    }
  }

  const labels = [...new Set([...e.argSpans.map((s) => s.label), ...e.contextLabels])].sort();
  return {
    decision: { effect, transforms: [...rewrites.values()].sort(compareTransforms), firedRuleIds: [...fired].sort(), labels },
    contributions,
    liftedBy,
  };
}

export const decide: Decide = (event, rules, grants, now) => explain(event, rules, grants, now).decision;
