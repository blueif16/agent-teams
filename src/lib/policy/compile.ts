/*
 * Natural language → policy/v1 rules (design §6, E §5.2). Each stage is code except the compile call:
 * 1. trusted context only: the tool catalog, agents, projects, the label and sink vocabulary and the rules in force
 *    (never an agent transcript; Conseca's rule);
 * 2. compile with GLM-5.3 at temperature 0, falling back along modelChain(advisor) with backoff on 429/503;
 * 3. validate: zod against the contract, then references (tools, agents, projects, labels, sinks, arg paths, hosts)
 *    and safety lints; one repair turn naming the failing paths; still invalid → an error, never a half-valid rule;
 * 4. ids, createdBy and source.nl are set by code; read-back from readback.ts; conflicts from conflicts.ts;
 * 5. dry run: `deps.replay` is the seam for a future policy_events replay; with nothing recorded it is null.
 */
import { MODELS, modelChain, reasoningFields } from "../models";
import { findConflicts } from "./conflicts";
import { globMatch } from "./glob";
import { readBack } from "./readback";
import { ARCHETYPES, issueLines, newRuleId, RuleSchema } from "./schema";
import { TIERS, TOOL_CATALOG } from "./tiers";
import type { Archetype, ArgConstraint, CompileResult, Rule } from "./types";
import * as z from "zod";

export interface CompileInput {
  text: string;
  /** Where the owner typed it: a hint for "here" or "this project", not a scope by itself. */
  agent?: string;
  project?: string;
}

export interface CompileContext {
  agents: { id: string; name: string; archetype?: Archetype }[];
  projects: string[];
  /** Every rule in force (defaults included). */
  rules: Rule[];
  now: Date;
}

export interface CompileDeps {
  fetch?: typeof fetch;
  apiKey?: string;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Replay the proposed rules over recorded calls (policy_events). Until calls are recorded, there is nothing to replay. */
  replay?: (rules: Rule[]) => Promise<CompileResult["dryRun"]>;
}

export type CompileOutcome =
  | { ok: true; result: CompileResult; model: string }
  | { ok: false; status: number; error: string; issues: string[] };

// ---------- the prompt (agent-facing; the executor is a cheap model, so the contract is explicit) ----------

export const SYSTEM_PROMPT = `<role>
You compile the owner's plain-English privacy and tool rules into policy/v1 JSON for Agent Teams. You are a careful
policy engineer: you never widen access beyond what the sentence says, and when a word could mean two different
things you ask instead of guessing. Code parses your JSON and enforces it exactly as written, so a wrong field leaks data.
</role>

<output_spec>
Return ONE JSON object and nothing else: no prose, no markdown fence.
{"rules": [Rule, ...], "assumptions": ["...", ...], "questions": [{"q": "...", "options": ["recommended option", "other option"]}]}
- rules: zero or more rules in the shapes below. Never write "id", "createdBy", "source", "mode" or "locked": code sets them.
- assumptions: one short sentence for each choice the sentence didn't spell out, and one for anything a rule in force
  already covers, naming its id (e.g. "Already covered by r_secr01 and r_secr02.").
- questions: at most 3, only for real ambiguity. Each has 2 or 3 options with the recommended option first.
</output_spec>

<policy_v1>
Every rule has "kind" and "scope". scope = {"agents"?: [agent ids], "archetypes"?: [archetypes], "projects"?: [project ids]}.
All present keys must match; leave a key out to mean everyone. Use only ids listed in <facts>.

kind "tool" decides whether a tool call may run:
  {"kind":"tool","scope":{},"match":{"tools":["send_email"]},"effect":"allow"|"ask"|"deny",
   "args"?: [ArgConstraint], "when"?: {"contextLabels"?: {"any"?: [labels], "none"?: [labels]}, "argLabels"?: {"any"?: [labels], "none"?: [labels]}, "destFromUntrusted"?: true},
   "reason"?: "at most 160 characters"}
kind "flow" decides where labelled data may go:
  {"kind":"flow","scope":{},"labels":["pii.email"],"sinks":["email"],"action":"allow"|"redact"|"mask"|"hash"|"tokenize"|"ask"|"block","where"?: [ArgConstraint]}
kind "grant" lets one tool skip an "ask" (it never lifts a deny, a block or a locked rule):
  {"kind":"grant","scope":{"agents":["rex"]},"tool":"send_email","args"?: [ArgConstraint],"grantScope":"once"|"thread"|"project"|"until"|"always","expiresAt"?: "2026-10-24T23:59:59Z"}
kind "budget": {"kind":"budget","scope":{},"match"?: {"tools":[...]},"metric":"calls"|"cost_usd"|"egress_bytes","limit":{"amount":20,"per":"run"|"thread"|"day"|"project"},"onExceed":"ask"|"deny"|"end"|"pause_agent"}
kind "classifier" marks matching text with a label: {"kind":"classifier","scope":{},"label":"project:<id>","detect":{"terms"?: [...],"regex"?: [JS regex],"caseInsensitive"?: true}}

ArgConstraint = {"path": one of the tool's "args" in <facts> ("url", "to[*]", "channel", ...), "op": ..., "value": ...}
  host_in, host_not_in, domain_in, domain_not_in: value is a list of host names, e.g. ["acme.com"]
  in, not_in: value is a list of exact values · path_glob, path_not_glob: a glob · matches, not_matches: a JS regex · max_len: a number
On a rule that restricts (ask, deny, block or a rewrite), a constraint on "to[*]" holds when ANY recipient satisfies it.
On a grant or an allow it must hold for EVERY recipient.
All constraints in one rule must hold together (AND). For "any of to, cc or bcc", write one rule per path.

How rules combine: the most restrictive outcome wins (block/deny > ask > tokenize > redact/hash/mask > allow). Rule
order doesn't matter. A tool no tool rule matches gets its tier default (in <facts>). Adding a deny never relaxes
anything; only a grant relaxes, and only ask → allow.

Scope has no "except". For "everyone except X", scope the rule to every archetype other than X's; if other agents
share X's archetype, also list them by id and add an assumption that agents hired later with that archetype aren't
covered. Listing only today's agent ids leaves out every agent hired later.
</policy_v1>

<owner_words>
What owners' words usually mean here (each sink is listed in <facts>):
- "send", "share", "upload", "post outside" → email, web, api:*, calendar (ask which ones if the sentence doesn't say)
- "learn", "remember", "memory", "notes" → memory:self (this project) and memory:global (carries into other projects)
- "other projects", "other teams" → project:other AND memory:global: project details reach other projects both by
  being sent there and through what an agent remembers
- "the model", "Crusoe" → model:crusoe · "LangSmith", "traces", "logs" → trace:langsmith
- "API keys", "passwords", "tokens", "credentials" → secret.* · "personal info" → pii.* · "<project> data" → project:<id>
- "X can do Y" when Y already asks (its tier default or a rule in force) is ambiguous: allowed but still asked first,
  or allowed without asking? Ask, recommending the existing ask, unless the sentence says "without asking".
</owner_words>

<the_bar>
Required, every one:
1. Every part of the sentence is covered by a rule, an assumption or a question. Keeping data away from a place is a
   flow rule (labels → sinks); stopping a tool is a tool rule.
2. Use only tool names, agent ids, archetypes, project ids, labels and sinks from <facts>, and only arg paths listed
   for the tool. Labels are secret.*, secret.<kind>, pii.*, pii.<kind>, owner_private, untrusted, project:* or
   project:<project id>.
3. Use the narrowest scope that does what the sentence says.
4. Turn time words into "expiresAt" from "now" in <facts> ("for the next 7 days" = now + 7 days).
5. If a word maps to more than one tool, label, sink or scope and the choice changes what is enforced, do NOT pick:
   write the rules for the clear part and ask a question with 2-3 options, recommended first.
6. If a rule in force already does what the sentence asks, write no new rule and say so in an assumption with its ids.
Must NOT: invent tools, agents, projects, domains or labels; write an allow or a grant broader than the sentence;
try to relax a locked rule (it can't be relaxed: say so in an assumption); write anything outside the JSON.
</the_bar>

<example>
Sentence: "Strip card numbers out of memory and traces."
{"rules":[{"kind":"flow","scope":{},"labels":["pii.credit_card"],"sinks":["memory:self","memory:global","trace:langsmith"],"action":"redact","reason":"Card numbers never stay in memory or traces"}],"assumptions":["\\"Memory\\" covers each agent's own memory and cross-project memory."],"questions":[]}
</example>
<example>
Sentence: "Rex can email dana@kestrel.example without asking until Friday."   (now = 2026-10-14T09:00:00Z, a Wednesday)
{"rules":[{"kind":"grant","scope":{"agents":["rex"]},"tool":"send_email","args":[{"path":"to[*]","op":"in","value":["dana@kestrel.example"]}],"grantScope":"until","expiresAt":"2026-10-17T23:59:59Z"}],"assumptions":["\\"Until Friday\\" means through the end of Friday, Oct 17 (UTC)."],"questions":[]}
</example>
<example>
Sentence: "Engineers shouldn't touch the web."
{"rules":[{"kind":"tool","scope":{"archetypes":["engineer"]},"match":{"tools":["web_search","fetch_page"]},"effect":"deny"}],"assumptions":[],"questions":[{"q":"Should engineers also lose the research and answer tools?","options":["Yes, no web tools at all","No, only search and opening pages"]}]}
</example>

<self_check>
Before answering, check silently: (a) one JSON object with exactly the keys rules, assumptions, questions; (b) every
rule uses only names from <facts> and the fields above, with no id; (c) every part of the sentence is covered by a
rule, an assumption or a question; (d) at most 3 questions, each with 2-3 options; (e) nothing allows more than the
sentence does. Fix whatever fails, then output the JSON only.
</self_check>`;

const SINK_MEANINGS: Record<string, string> = {
  "model:crusoe": "every prompt sent to the model",
  "trace:langsmith": "LangSmith traces",
  web: "URLs, page fetches and search queries",
  email: "outgoing email",
  calendar: "calendar events",
  "api:*": "any third-party API (api:<host> for one)",
  "memory:self": "the agent's own memory for this project",
  "memory:global": "memory that carries into the agent's other projects",
  "project:other": "another team's channel, thread or files",
  ui: "the owner's screen (always allowed)",
  ledger: "metrics only",
};

const catalogEntry = (tool: string) => TOOL_CATALOG[tool] ?? Object.entries(TOOL_CATALOG).find(([p]) => globMatch(p, tool))?.[1];

function facts(input: CompileInput, ctx: CompileContext) {
  const classifierLabels = ctx.rules.flatMap((r) => (r.kind === "classifier" ? [r.label] : []));
  return {
    now: ctx.now.toISOString(),
    typedIn: { agent: input.agent ?? null, project: input.project ?? null },
    tools: TIERS.flatMap((t) =>
      t.tools.map((name) => ({ name, tier: `${t.tier} ${t.name}`, default: t.effect, sinks: catalogEntry(name)?.sinks ?? [], args: catalogEntry(name)?.args ?? [] })),
    ),
    agents: ctx.agents,
    archetypes: ARCHETYPES,
    projects: ctx.projects,
    labels: {
      secrets: "secret.* or secret.<kind>: aws, github, private_key, jwt, generic, ...",
      personal: "pii.* or pii.<kind>: email, phone, credit_card, ssn, iban, ip, person, address",
      other: ["owner_private", "untrusted", "project:*", ...ctx.projects.map((p) => `project:${p}`), ...classifierLabels],
    },
    sinks: SINK_MEANINGS,
    rulesInForce: ctx.rules.map((r) => ({ id: r.id, kind: r.kind, ...(r.locked ? { locked: true } : {}), readBack: readBack(r) })),
  };
}

function userMessage(input: CompileInput, ctx: CompileContext): string {
  const where = [input.agent ? `for agent ${input.agent}` : "", input.project ? `on project ${input.project}` : ""].filter(Boolean).join(" ");
  return `<facts>
${JSON.stringify(facts(input, ctx))}
</facts>

<task>
The owner typed this in the Rules tab${where ? ` ${where}` : ""}:
"${input.text}"
Compile it into policy/v1 rules following <policy_v1> and <the_bar>.
</task>

<output_only>One JSON object {"rules", "assumptions", "questions"}, nothing else, no ids.</output_only>`;
}

const repairMessage = (issues: string[]) => `Your JSON failed validation:
${issues.map((i) => `- ${i}`).join("\n")}
Return the whole corrected JSON object only, with the same keys. Fix what the errors name; if something can't be
expressed with the names in <facts>, drop it and ask a question or add an assumption instead.`;

// ---------- the model call ----------

type Message = { role: "system" | "user" | "assistant"; content: string };
const BASE_URL = process.env.CRUSOE_BASE_URL ?? "https://api.inference.crusoecloud.com/v1";

async function post(model: string, messages: Message[], deps: CompileDeps, retries: number): Promise<Response> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  // Backoff on 429/503 per Crusoe guidance: ~1s, doubling, with jitter (same as the chat route).
  for (let attempt = 0; ; attempt++) {
    const res = await doFetch(`${deps.baseUrl ?? BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${deps.apiKey ?? process.env.CRUSOE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 4000, ...reasoningFields(model, false) }),
      signal: AbortSignal.timeout(120_000),
    });
    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      await sleep(1000 * 2 ** attempt + Math.random() * 400);
      continue;
    }
    return res;
  }
}

/** The first model in `chain` that answers: its content, or the last failure. */
async function complete(chain: string[], messages: Message[], deps: CompileDeps): Promise<{ ok: true; model: string; content: string } | { ok: false; error: string }> {
  let error = "no model to call";
  for (const [i, model] of chain.entries()) {
    let res: Response;
    try {
      res = await post(model, messages, deps, i === 0 ? 2 : 1);
    } catch (e) {
      error = `${model}: ${(e as Error).message}`;
      continue;
    }
    if (!res.ok) {
      error = `${model} returned ${res.status}`;
      continue;
    }
    const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string | null } }[] } | null;
    return { ok: true, model, content: body?.choices?.[0]?.message?.content ?? "" };
  }
  return { ok: false, error };
}

// ---------- validation ----------

const QuestionSchema = z.strictObject({ q: z.string().min(1), options: z.array(z.string().min(1)).min(2).max(3) });
const OutputSchema = z.object({
  rules: z.array(z.unknown()),
  assumptions: z.array(z.string()).default([]),
  questions: z.array(QuestionSchema).max(3).default([]),
});

const LABEL = /^(\*|secret\.(\*|[a-z0-9_]+)|pii\.(\*|[a-z0-9_]+)|owner_private|untrusted|project:\*)$/;
const SINK = /^(\*|model:(\*|crusoe)|trace:(\*|langsmith)|web|email|calendar|api:\*|api:[a-z0-9-]+(\.[a-z0-9-]+)+|memory:(\*|self|global)|project:other|ui|ledger)$/;
const HOST = /^(\*\.)?([a-z0-9-]+\.)+[a-z0-9-]{2,}$/i;
const HOST_OPS = new Set<ArgConstraint["op"]>(["host_in", "host_not_in", "domain_in", "domain_not_in"]);
const KNOWN_TOOLS = [...new Set([...TIERS.flatMap((t) => t.tools), ...Object.keys(TOOL_CATALOG)])];

const argBase = (p: string) => p.split(/[.[]/)[0];
const toolKnown = (p: string) => p === "*" || KNOWN_TOOLS.some((t) => globMatch(p, t) || globMatch(t, p));
/** Arg names of the catalog tools a pattern covers; null when the catalog doesn't describe any of them. */
function argsOf(patterns: string[]): Set<string> | null {
  const entries = Object.entries(TOOL_CATALOG).filter(([t]) => patterns.some((p) => globMatch(p, t) || globMatch(t, p)));
  return entries.length ? new Set(entries.flatMap(([, c]) => c.args.map(argBase))) : null;
}
function argsForSinks(sinks: string[]): Set<string> | null {
  const entries = Object.values(TOOL_CATALOG).filter((c) => c.sinks.some((s) => sinks.some((p) => globMatch(p, s) || globMatch(s, p))));
  return entries.length ? new Set(entries.flatMap((c) => c.args.map(argBase))) : null;
}

function checkRule(r: Rule, at: string, ctx: CompileContext, classifierLabels: Set<string>): string[] {
  const issues: string[] = [];
  const agents = new Set(ctx.agents.map((a) => a.id));
  const projects = new Set(ctx.projects);
  for (const a of r.scope.agents ?? []) if (a !== "*" && !agents.has(a)) issues.push(`${at}.scope.agents: unknown agent "${a}"`);
  for (const p of r.scope.projects ?? []) {
    const ok = p === "*" || p === "dm:*" || projects.has(p) || (p.startsWith("dm:") && agents.has(p.slice(3)));
    if (!ok) issues.push(`${at}.scope.projects: unknown project "${p}"`);
  }
  const label = (l: string, path: string) => {
    const ok = LABEL.test(l) || (l.startsWith("project:") && projects.has(l.slice(8))) || classifierLabels.has(l);
    if (!ok) issues.push(`${path}: unknown label "${l}"`);
  };
  const constraints = (cs: ArgConstraint[] | undefined, path: string, allowed: Set<string> | null) => {
    // Constraints in one rule must ALL hold. The same test on two paths is an any-of written as all-of: it would
    // fire only when every path fails at once, so it almost never fires.
    const seen = new Map<string, string>();
    for (const c of cs ?? []) {
      const test = `${c.op}:${JSON.stringify(c.value)}`;
      const other = seen.get(test);
      if (other && other !== c.path) {
        issues.push(`${path}: "${other}" and "${c.path}" get the same test, and all constraints in a rule must hold together; for "any of them", write one rule per path`);
        break;
      }
      seen.set(test, c.path);
    }
    (cs ?? []).forEach((c, j) => {
      if (allowed && !allowed.has(argBase(c.path))) issues.push(`${path}.${j}.path: "${c.path}" is not an arg of these tools (${[...allowed].join(", ")})`);
      if (HOST_OPS.has(c.op))
        for (const v of [c.value].flat()) if (typeof v !== "string" || !HOST.test(v)) issues.push(`${path}.${j}.value: "${String(v)}" is not a host name like acme.com`);
    });
  };

  if (r.kind === "tool") {
    r.match.tools.forEach((t, j) => toolKnown(t) || issues.push(`${at}.match.tools.${j}: unknown tool "${t}"`));
    constraints(r.args, `${at}.args`, argsOf(r.match.tools));
    for (const [k, set] of [["contextLabels", r.when?.contextLabels], ["argLabels", r.when?.argLabels]] as const)
      for (const l of [...(set?.any ?? []), ...(set?.none ?? [])]) label(l, `${at}.when.${k}`);
  } else if (r.kind === "flow") {
    r.labels.forEach((l, j) => label(l, `${at}.labels.${j}`));
    r.sinks.forEach((s, j) => SINK.test(s) || issues.push(`${at}.sinks.${j}: unknown sink "${s}"`));
    constraints(r.where, `${at}.where`, argsForSinks(r.sinks));
    if (r.action === "allow" && r.labels.some((l) => l.startsWith("secret.") || l === "*"))
      issues.push(`${at}.action: secrets can never be allowed out; r_secr01, r_secr02 and r_secr03 are locked`);
  } else if (r.kind === "grant") {
    if (!toolKnown(r.tool)) issues.push(`${at}.tool: unknown tool "${r.tool}"`);
    constraints(r.args, `${at}.args`, argsOf([r.tool]));
  } else if (r.kind === "budget") {
    (r.match?.tools ?? []).forEach((t, j) => toolKnown(t) || issues.push(`${at}.match.tools.${j}: unknown tool "${t}"`));
  }

  // A grant or an allow can't get around a locked rule that always asks or denies a tool.
  const relaxed = r.kind === "grant" ? [r.tool] : r.kind === "tool" && r.effect === "allow" ? r.match.tools : [];
  for (const t of relaxed) {
    const lock = ctx.rules.find(
      (x) => x.kind === "tool" && x.locked && x.mode !== "shadow" && !x.args && !x.when && x.effect !== "allow" && x.match.tools.some((p) => globMatch(p, t.replace(/\*/g, "x"))),
    );
    if (lock) {
      const why = lock.kind === "tool" && lock.effect === "deny" ? "it is always denied" : "it asks every time and can't be pre-approved";
      issues.push(`${at}.${r.kind === "grant" ? "tool" : "match.tools"}: "${t}" is locked by ${lock.id}: ${why}`);
    }
  }
  return issues;
}

/** Notes for the owner on rules that are valid but worth a second look. */
function warnings(rules: Rule[]): string[] {
  const loud = new Set(TIERS.filter((t) => ["T4", "T5", "T6", "T7"].includes(t.tier)).flatMap((t) => t.tools));
  return rules.flatMap((r) =>
    r.kind === "tool" && r.effect === "allow" && !r.args && r.match.tools.some((t) => [...loud].some((x) => globMatch(t, x) || globMatch(x, t)))
      ? [`Note: ${readBack(r)} There is no limit on where it can go.`]
      : [],
  );
}

function extractJson(content: string): unknown {
  const s = content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object");
  return JSON.parse(s.slice(start, end + 1));
}

const CODE_OWNED = ["id", "createdBy", "source", "mode", "locked"];

function validate(content: string, input: CompileInput, ctx: CompileContext): { ok: true; out: z.infer<typeof OutputSchema> & { rules: Rule[] } } | { ok: false; issues: string[] } {
  let raw: unknown;
  try {
    raw = extractJson(content);
  } catch {
    return { ok: false, issues: ["(root): the reply is not one JSON object"] };
  }
  const wrapper = OutputSchema.safeParse(raw);
  if (!wrapper.success) return { ok: false, issues: issueLines(wrapper.error) };

  const issues: string[] = [];
  const parsedRules: [number, Rule][] = [];
  wrapper.data.rules.forEach((draft, i) => {
    if (!draft || typeof draft !== "object" || Array.isArray(draft)) return void issues.push(`rules.${i}: not a rule object`);
    const owned = Object.fromEntries(Object.entries(draft).filter(([k]) => !CODE_OWNED.includes(k)));
    const parsed = RuleSchema.safeParse({ ...owned, id: newRuleId(), createdBy: "nl-compiler", source: { nl: input.text } });
    if (!parsed.success) issues.push(...issueLines(parsed.error, ["rules", i]));
    else parsedRules.push([i, parsed.data]);
  });
  const rules = parsedRules.map(([, r]) => r);
  const classifierLabels = new Set([...ctx.rules, ...rules].flatMap((r) => (r.kind === "classifier" ? [r.label] : [])));
  for (const [i, r] of parsedRules) issues.push(...checkRule(r, `rules.${i}`, ctx, classifierLabels));
  return issues.length ? { ok: false, issues } : { ok: true, out: { ...wrapper.data, rules } };
}

// ---------- compile ----------

export async function compileRules(input: CompileInput, ctx: CompileContext, deps: CompileDeps = {}): Promise<CompileOutcome> {
  if (!(deps.apiKey ?? process.env.CRUSOE_API_KEY)) return { ok: false, status: 503, error: "No Crusoe key is configured, so rules can't be compiled.", issues: [] };
  const chain = modelChain(MODELS.advisor);
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage(input, ctx) },
  ];

  const first = await complete(chain, messages, deps);
  if (!first.ok) return { ok: false, status: 502, error: `Crusoe couldn't compile the rule right now (${first.error}). Try again in a minute.`, issues: [] };
  let model = first.model;
  let checked = validate(first.content, input, ctx);

  if (!checked.ok) {
    const repair = await complete(chain.slice(chain.indexOf(model)), [...messages, { role: "assistant", content: first.content }, { role: "user", content: repairMessage(checked.issues) }], deps);
    if (!repair.ok) return { ok: false, status: 502, error: `Crusoe couldn't finish the rule right now (${repair.error}). Try again in a minute.`, issues: checked.issues };
    model = repair.model;
    checked = validate(repair.content, input, ctx);
    if (!checked.ok) return { ok: false, status: 422, error: "The compiler's rules didn't pass validation, so nothing was proposed. Try rephrasing.", issues: checked.issues };
  }

  const { rules, assumptions, questions } = checked.out;
  const replay = deps.replay ?? (async () => null);
  return {
    ok: true,
    model,
    result: {
      rules,
      readBack: rules.map(readBack),
      assumptions: [...assumptions, ...warnings(rules)],
      questions,
      conflicts: findConflicts(rules, ctx.rules, ctx.now),
      dryRun: await replay(rules),
    },
  };
}
