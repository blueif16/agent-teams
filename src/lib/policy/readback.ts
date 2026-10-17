/*
 * Plain-English read-back of a rule, rendered from its JSON by a fixed template per kind (never by an LLM), so what
 * the owner reads can't disagree with what is enforced (E §5.2 step 5). One sentence per rule. Constraints are
 * worded the way the engine reads them: "any recipient" on a rule that restricts, "every recipient" on one that relaxes.
 */
import { AGENTS } from "../data";
import { RAW_IP_URL } from "./defaults";
import type { Archetype, ArgConstraint, BudgetRule, ClassifierRule, Condition, FlowRule, GrantRule, Label, Rule, Scope, Sink, ToolRule } from "./types";

const TOOL_PHRASES: Record<string, string> = {
  "*": "use any tool",
  read_file: "read files",
  ls: "list files",
  glob: "find files",
  grep: "search files",
  write_todos: "update their todo list",
  model_call: "call the model",
  trace_export: "export traces",
  write_file: "write files",
  edit_file: "edit files",
  task: "hand work to a teammate",
  report: "report on tasks",
  dream_write: "write memory while dreaming",
  propose_soul: "propose SOUL.md changes",
  web_search: "search the web",
  fetch_page: "open web pages",
  web_fetch: "open web pages",
  research: "run research",
  answer: "ask for a cited answer",
  find_skill: "look for skills",
  send_email: "send email",
  post_message: "post messages",
  create_calendar_event: "create calendar events",
  "http_*": "call web APIs",
  "api_*": "call APIs",
  delete_file: "delete files",
  update_calendar_event: "edit calendar events",
  delete_calendar_event: "delete calendar events",
  "purchase_*": "buy things",
  "pay_*": "make payments",
  connect_oauth: "connect accounts",
  read_credential: "read credentials",
  execute: "run shell commands",
  shell: "run shell commands",
};

const ARCHETYPE_PLURAL: Record<Archetype, string> = {
  chief: "the chief",
  lead: "leads",
  writer: "writers",
  researcher: "researchers",
  analyst: "analysts",
  engineer: "engineers",
  coordinator: "coordinators",
};

const PII: Record<string, string> = {
  email: "email addresses",
  phone: "phone numbers",
  credit_card: "card numbers",
  ssn: "social security numbers",
  iban: "bank account numbers",
  ip: "IP addresses",
  person: "names",
  address: "postal addresses",
};

const SINKS: Record<string, string> = {
  "*": "anywhere",
  "model:*": "any model",
  "model:crusoe": "the model",
  "trace:*": "traces",
  "trace:langsmith": "LangSmith traces",
  web: "the web",
  email: "email",
  calendar: "the calendar",
  "api:*": "any API",
  "memory:*": "any memory",
  "memory:self": "the agent's own memory",
  "memory:global": "cross-project memory",
  "project:other": "other projects",
  ui: "your screen",
  ledger: "the ledger",
};

/** Regex values the owner shouldn't have to read. */
const KNOWN_PATTERNS: Record<string, string> = { [RAW_IP_URL]: "points at a raw IP address" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------- pieces ----------

function join(items: string[], word: "and" | "or"): string {
  const xs = [...new Set(items)];
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${word} ${xs[xs.length - 1]}`;
}

/** Long lists (25 paste hosts) show the first three and a count. */
function shortList(values: string[], word: "and" | "or"): string {
  return values.length > 4 ? `${values.slice(0, 3).join(", ")} ${word} ${values.length - 3} more` : join(values, word);
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const agentName = (id: string) => AGENTS[id]?.name ?? capitalize(id);

function toolPhrase(tools: string[]): string {
  return join(
    tools.map((t) => TOOL_PHRASES[t] ?? (t.includes("*") ? `use any ${t} tool` : `use ${t}`)),
    "or",
  );
}

function labelPhrase(l: Label): string {
  if (l === "*") return "any data";
  if (l === "secret.*") return "secrets";
  if (l.startsWith("secret.")) return `secrets (${l.slice(7)})`;
  if (l === "pii.*") return "personal info";
  if (l.startsWith("pii.")) return PII[l.slice(4)] ?? `personal info (${l.slice(4)})`;
  if (l === "owner_private") return "your private data";
  if (l === "project:*") return "project data";
  if (l.startsWith("project:")) return `${l.slice(8)} project data`;
  if (l === "untrusted") return "untrusted content";
  return `${l} data`;
}

const labelsPhrase = (ls: Label[]) => join(ls.map(labelPhrase), "or");

function sinkPhrase(s: Sink): string {
  if (SINKS[s]) return SINKS[s];
  if (s.startsWith("api:")) return `the ${s.slice(4)} API`;
  return s;
}

const sinksPhrase = (ss: Sink[]) => join(ss.map(sinkPhrase), "or");

/** Who a rule is for, or null for everyone. `word` joins several: "Pip and Rex can't…", "before Pip or Rex can…". */
function who(scope: Scope, word: "and" | "or"): string | null {
  const agents = scope.agents?.includes("*") ? undefined : scope.agents;
  const archetypes = (scope.archetypes as string[] | undefined)?.includes("*") ? undefined : scope.archetypes;
  const names = agents?.length ? join(agents.map(agentName), word) : null;
  const kinds = archetypes?.length ? join(archetypes.map((a) => ARCHETYPE_PLURAL[a] ?? a), word) : null;
  if (names && kinds) return `${names} (${kinds} only)`;
  return names ?? kinds;
}

function where(scope: Scope): string {
  const projects = scope.projects?.filter((p) => p !== "*") ?? [];
  if (!projects.length || scope.projects?.includes("*")) return "";
  const items = projects.map((p) => (p === "dm:*" ? "DMs" : p.startsWith("dm:") ? `the DM with ${agentName(p.slice(3))}` : `project ${p}`));
  return ` in ${join(items, "or")}`;
}

function noun(path: string, relaxing: boolean): string {
  const many = /\[\*\]$/.test(path);
  const base = path.replace(/\[\*\]$/, "");
  const q = relaxing ? "every" : "any";
  switch (base) {
    case "to":
    case "cc":
    case "bcc":
    case "recipients":
      return `${q} recipient`;
    case "attendees":
      return `${q} guest`;
    case "url":
      return "the URL";
    case "urls":
      return `${q} URL`;
    case "channel":
      return "the channel";
    case "path":
      return "the path";
    case "query":
      return "the query";
    default:
      return many ? `${q} ${base}` : base;
  }
}

function constraintPhrase(c: ArgConstraint, relaxing: boolean): string {
  const n = noun(c.path, relaxing);
  const values = ([c.value].flat() as unknown[]).map(String);
  const known = (c.op === "matches" || c.op === "not_matches") && values.length === 1 ? KNOWN_PATTERNS[values[0]] : undefined;
  switch (c.op) {
    case "host_in":
      return `${n}'s host is ${shortList(values, "or")}`;
    case "host_not_in":
      return `${n}'s host isn't ${shortList(values, "or")}`;
    case "domain_in":
      return `${n} is on ${shortList(values, "or")}`;
    case "domain_not_in":
      return `${n} is outside ${shortList(values, "or")}`;
    case "path_glob":
      return `${n} matches ${join(values, "or")}`;
    case "path_not_glob":
      return `${n} doesn't match ${join(values, "or")}`;
    case "in":
      return `${n} is ${shortList(values, "or")}`;
    case "not_in":
      return `${n} isn't ${shortList(values, "or")}`;
    case "matches":
      return known ? `${n} ${known}` : `${n} matches the pattern ${join(values, "or")}`;
    case "not_matches":
      return known ? `${n} doesn't ${known.replace(/^points/, "point")}` : `${n} doesn't match the pattern ${join(values, "or")}`;
    case "max_len":
      return `${n} is at most ${values[0]} characters`;
  }
}

function conditionClauses(w: Condition | undefined): string[] {
  if (!w) return [];
  const out: string[] = [];
  if (w.contextLabels?.any) out.push(`the agent has seen ${labelsPhrase(w.contextLabels.any)}`);
  if (w.contextLabels?.none) out.push(`the agent hasn't seen ${labelsPhrase(w.contextLabels.none)}`);
  if (w.argLabels?.any) out.push(`the call contains ${labelsPhrase(w.argLabels.any)}`);
  if (w.argLabels?.none) out.push(`the call contains no ${labelsPhrase(w.argLabels.none)}`);
  if (w.destFromUntrusted === true) out.push("the destination came from untrusted content");
  if (w.destFromUntrusted === false) out.push("the destination didn't come from untrusted content");
  return out;
}

function when(args: ArgConstraint[] | undefined, relaxing: boolean, condition?: Condition): string {
  const clauses = [...(args ?? []).map((c) => constraintPhrase(c, relaxing)), ...conditionClauses(condition)];
  return clauses.length ? ` when ${clauses.join(" and ")}` : "";
}

function date(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function finish(rule: Rule, body: string): string {
  const until = rule.expiresAt && rule.kind !== "grant" ? `, until ${date(rule.expiresAt)}` : "";
  const shadow = rule.mode === "shadow" ? " (shadow mode: logged, not enforced)" : "";
  return `${capitalize(body)}${until}${shadow}.`;
}

// ---------- per kind ----------

function tool(r: ToolRule): string {
  const verb = toolPhrase(r.match.tools);
  const rest = `${where(r.scope)}${when(r.args, r.effect === "allow", r.when)}`;
  if (r.effect === "deny") {
    const subject = who(r.scope, "and");
    return subject ? `${subject} can't ${verb}${rest}` : `no agent can ${verb}${rest}`;
  }
  if (r.effect === "ask") return `${r.locked ? "always ask" : "ask"} you before ${who(r.scope, "or") ?? "any agent"} can ${verb}${rest}`;
  return `${who(r.scope, "and") ?? "any agent"} can ${verb} without asking${rest}`;
}

function flow(r: FlowRule): string {
  const data = labelsPhrase(r.labels);
  const to = sinksPhrase(r.sinks);
  const subject = who(r.scope, "or");
  const rest = `${subject ? ` for ${subject}` : ""}${where(r.scope)}${when(r.where, r.action === "allow")}`;
  switch (r.action) {
    case "block":
      return `block ${data} from going to ${to}${rest}`;
    case "ask":
      return `${r.locked ? "always ask" : "ask"} you before ${data} can go to ${to}${rest}`;
    case "tokenize":
      return `replace ${data} with placeholders before they reach ${to}${rest}`;
    case "redact":
      return `remove ${data} before they reach ${to}${rest}`;
    case "hash":
      return `replace ${data} with a keyed hash before they reach ${to}${rest}`;
    case "mask":
      return `mask ${data} before they reach ${to}${rest}`;
    case "allow":
      return `let ${data} go to ${to}${rest}`;
  }
}

function grant(r: GrantRule): string {
  const left = r.uses?.max !== undefined ? r.uses.max - (r.uses.used ?? 0) : undefined;
  const limit =
    r.grantScope === "once" ? ", once" : left !== undefined ? `, ${left} more ${left === 1 ? "time" : "times"}` : "";
  const until = r.expiresAt ? `, until ${date(r.expiresAt)}` : "";
  return `${who(r.scope, "and") ?? "any agent"} can ${toolPhrase([r.tool])} without asking${where(r.scope)}${when(r.args, true)}${until}${limit}`;
}

const PER: Record<BudgetRule["limit"]["per"], string> = { run: "run", thread: "thread", day: "day", project: "project" };
const ON_EXCEED: Record<BudgetRule["onExceed"], string> = { ask: "ask you", deny: "refuse more", end: "end the run", pause_agent: "pause the agent" };

function budget(r: BudgetRule): string {
  const subject = who(r.scope, "and") ?? "each agent";
  const per = `per ${PER[r.limit.per]}`;
  const then = `, then ${ON_EXCEED[r.onExceed]}`;
  const tools = r.match?.tools;
  const amount = r.limit.amount;
  switch (r.metric) {
    case "calls":
      return tools?.length
        ? `${subject} can ${toolPhrase(tools)} at most ${amount} ${amount === 1 ? "time" : "times"} ${per}${where(r.scope)}${then}`
        : `${subject} can make at most ${amount} tool calls ${per}${where(r.scope)}${then}`;
    case "cost_usd":
      return `${subject} can spend at most $${Number.isInteger(amount) ? amount : amount.toFixed(2)} ${per}${where(r.scope)}${then}`;
    case "egress_bytes":
      return `${subject} can send at most ${amount} bytes out ${per}${where(r.scope)}${then}`;
  }
}

const VALIDATORS: Record<string, string> = { luhn: "a Luhn check", iban_mod97: "an IBAN check", us_ssn: "an SSN check", jwt: "a JWT check" };

function classifier(r: ClassifierRule): string {
  const parts: string[] = [];
  if (r.detect.terms?.length) parts.push(`mentioning ${join(r.detect.terms, "or")}`);
  if (r.detect.regex?.length) parts.push(`matching ${join(r.detect.regex, "or")}`);
  const what = parts.length === 2 ? `${parts[0]}, or ${parts[1]},` : parts[0];
  const extras = [r.detect.caseInsensitive ? "ignoring case" : "", r.detect.validator && VALIDATORS[r.detect.validator] ? `confirmed by ${VALIDATORS[r.detect.validator]}` : ""]
    .filter(Boolean)
    .map((x) => `, ${x}`)
    .join("");
  const subject = who(r.scope, "or");
  return `treat text ${what} as ${labelPhrase(r.label)}${subject ? ` for ${subject}` : ""}${where(r.scope)}${extras}`;
}

export function readBack(rule: Rule): string {
  switch (rule.kind) {
    case "tool":
      return finish(rule, tool(rule));
    case "flow":
      return finish(rule, flow(rule));
    case "grant":
      return finish(rule, grant(rule));
    case "budget":
      return finish(rule, budget(rule));
    case "classifier":
      return finish(rule, classifier(rule));
  }
}

export function readBackAll(rules: Rule[]): Record<string, string> {
  return Object.fromEntries(rules.map((r) => [r.id, readBack(r)]));
}
