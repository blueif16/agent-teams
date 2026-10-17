/*
 * Dev only, never imported by app code: seeds a realistic project into a temp DATA_DIR so the state views can be
 * developed and screenshotted against real files (no demo data ships; DECISIONS → Product).
 *
 *   DATA_DIR=$(mktemp -d) node --experimental-transform-types --import ./scripts/dev/register-alias.mjs scripts/dev/seed-state.mts
 *
 * Writes the vault at $DATA_DIR/vault and fixture ledger rows at $DATA_DIR/ledger.jsonl, then prints the env to
 * start a dev server on them. The project: a pricing page relaunch, 12 tasks across 2 milestones (one blocked on
 * an owner question), 3 decisions (one superseded), 2 open items and a resolved one, a 3-member roster, a charter,
 * prefs and a journal.
 *
 * The lead's state tools aren't merged yet, so every change is written the way they write it: one vault writeMany
 * commit per change, source "tool" (or "report" for a worker's report), subject `state(<pid>): …`, trailers Tool,
 * Task, Rev, Project and Agent, every file validated with the state module's zod schemas and rendered with its own
 * formatters. Switch the steps to leadTools/workerTools when they land.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CompactionEvent } from "@/lib/compaction";
import type { CallEvent } from "@/lib/ledger";
import { MODELS } from "@/lib/models";
import type { VaultAuthor } from "@/lib/vault/types";
import {
  Charter as CharterSchema,
  Dag as DagSchema,
  Decision as DecisionSchema,
  Item as ItemSchema,
  journalPath,
  minute,
  OpenItems as OpenSchema,
  Pref as PrefSchema,
  renderCharter,
  renderDecisions,
  renderJournal,
  renderJson,
  renderPrefs,
  reportPath,
  Roster as RosterSchema,
  statePath,
  type Charter,
  type Dag,
  type Decision,
  type Item,
  type JournalLine,
  type Member,
  type OpenItems,
  type Pref,
  type Roster,
  type Task,
} from "@/server/project-state";
import { getVault, setVault, Vault } from "@/server/runtime/vault";

const DATA_DIR = path.resolve(process.env.DATA_DIR || mkdtempSync(path.join(tmpdir(), "agent-teams-state-")));
const PID = process.env.SEED_PID || "pricing";
const LEAD = "juno";
mkdirSync(DATA_DIR, { recursive: true });
setVault(new Vault({ dir: path.join(DATA_DIR, "vault") }));
const vault = getVault();

// The story ends three minutes ago, so relative times read naturally.
const START = Date.now() - 6 * 3_600_000;
const at = (min: number) => new Date(START + min * 60_000).toISOString();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const agent = (id: string, name: string): VaultAuthor => ({ kind: "agent", id, name });
const PM_AUTHOR = agent(LEAD, "Juno");

let rev = 0;
const dag: Dag = { pid: PID, rev: 0, updatedAt: null, tasks: [] };
const roster: Roster = { rev: 0, updatedAt: null, members: [] };
const open: OpenItems = { rev: 0, updatedAt: null, items: [] };
const decisions: Decision[] = [];
const prefs: Pref[] = [];
let charter: Charter | null = null;
const journal: JournalLine[] = [];
/** The last change id of each vault path, for the fixture compactions' file chips. */
const lastChange: Record<string, string> = {};

type FileKey = "dag" | "roster" | "open" | "decisions" | "prefs" | "charter";

function render(key: FileKey): { path: string; content: string } {
  switch (key) {
    case "dag":
      return { path: statePath(PID, "dag.json"), content: renderJson(DagSchema.parse(dag)) };
    case "roster":
      return { path: statePath(PID, "roster.json"), content: renderJson(RosterSchema.parse(roster)) };
    case "open":
      return { path: statePath(PID, "open.json"), content: renderJson(OpenSchema.parse(open)) };
    case "decisions":
      return { path: statePath(PID, "decisions.md"), content: renderDecisions(PID, decisions.map((d) => DecisionSchema.parse(d))) };
    case "prefs":
      return { path: statePath(PID, "prefs.md"), content: renderPrefs(PID, prefs.map((p) => PrefSchema.parse(p))) };
    case "charter":
      return { path: statePath(PID, "charter.md"), content: renderCharter(PID, CharterSchema.parse(charter)) };
  }
}

interface Change {
  min: number;
  tool: string;
  subject: string;
  /** The journal line (F §3.7): "<agent>: what happened". */
  line: string;
  touch: FileKey[];
  task?: string;
  author?: VaultAuthor;
  source?: "tool" | "report";
  extra?: { path: string; content: string }[];
}

/** One state change = one commit, like the tools: bump the project rev, stamp what changed, add a journal line. */
async function commit(c: Change) {
  rev += 1;
  const when = at(c.min);
  if (c.touch.includes("dag")) Object.assign(dag, { rev, updatedAt: when });
  if (c.touch.includes("roster")) Object.assign(roster, { rev, updatedAt: when });
  if (c.touch.includes("open")) Object.assign(open, { rev, updatedAt: when });
  journal.push({ at: minute(when), rev, text: c.line });
  const files = [...c.touch.map(render), { path: journalPath(PID, 1), content: renderJournal(PID, 1, journal) }, ...(c.extra ?? [])];
  const author = c.author ?? PM_AUTHOR;
  const made = await vault.writeMany({
    files,
    author,
    source: c.source ?? "tool",
    subject: `state(${PID}): ${c.subject}`,
    trailers: { Tool: c.tool, ...(c.task ? { Task: c.task } : {}), Rev: String(rev), Project: PID, Agent: author.id },
  });
  if (made) for (const f of files) lastChange[f.path] = made.change;
}

const task = (id: string) => {
  const t = dag.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`no task ${id}`);
  return t;
};

async function addTask(min: number, t: Pick<Task, "id" | "kind" | "title" | "acceptance"> & Partial<Task>) {
  const when = at(min);
  const deps = t.deps ?? [];
  const ready = deps.every((d) => dag.tasks.find((x) => x.id === d)?.status === "done");
  dag.tasks.push({
    owner: null,
    deps,
    blocker: null,
    evidence: [],
    notes: [],
    reopened: 0,
    source: `msg:pm-${PID}:${10 + dag.tasks.length}`,
    ...t,
    status: t.kind === "milestone" ? "todo" : ready ? "ready" : "todo",
    created: when,
    updated: when,
    rev: rev + 1,
  });
  await commit({ min, tool: "add_task", task: t.id, subject: `add ${t.id}`, line: `pm: added ${t.id} ${t.title}`, touch: ["dag"] });
}

function patchTask(id: string, min: number, patch: Partial<Task>) {
  Object.assign(task(id), patch, { updated: at(min), rev: rev + 1 });
  // todo → ready is computed by code when every dep is done (F §3.1).
  for (const t of dag.tasks) {
    if (t.status === "todo" && t.kind !== "milestone" && t.deps.every((d) => dag.tasks.find((x) => x.id === d)?.status === "done")) t.status = "ready";
  }
}

async function assign(min: number, id: string, owner: string) {
  patchTask(id, min, { owner, status: "in_progress", brief: `${task(id).title}. Acceptance: ${task(id).acceptance}` });
  member(owner, { state: "working", lastCheckIn: at(min) });
  await commit({ min, tool: "assign_task", task: id, subject: `assign ${id} to ${owner}`, line: `pm: assigned ${id} to ${cap(owner)}`, touch: ["dag", "roster"] });
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function member(id: string, patch: Partial<Member>) {
  const m = roster.members.find((x) => x.agentId === id);
  if (!m) throw new Error(`no member ${id}`);
  Object.assign(m, patch);
}

let reportN = 0;
async function report(min: number, id: string, status: "progress" | "blocked" | "review" | "done", summary: string, more: { evidence?: string[]; blocker?: Task["blocker"]; line?: string } = {}) {
  const t = task(id);
  const by = t.owner!;
  reportN += 1;
  const ref = reportPath(PID, id, reportN);
  const nextStatus = status === "progress" ? "in_progress" : status;
  patchTask(id, min, {
    status: nextStatus,
    evidence: [...t.evidence, ...(more.evidence ?? [])],
    blocker: status === "blocked" ? (more.blocker ?? null) : null,
    lastReport: { at: at(min), by, status, summary, ref },
  });
  member(by, {
    state: status === "blocked" ? "waiting_owner" : status === "done" ? "idle" : "working",
    lastCheckIn: at(min),
    lastReport: `${id} ${summary}`.slice(0, 300),
    blockers: status === "blocked" && more.blocker ? [{ text: more.blocker.text, on: more.blocker.on, task: id }] : [],
  });
  const body = `# ${id} report ${reportN}\n\nStatus: ${status}\n\n${summary}\n`;
  await commit({
    min,
    tool: "report",
    task: id,
    subject: `report ${id} ${status}`,
    line: more.line ?? `${by}: ${id} ${status === "progress" ? "progress" : status} — ${summary}`,
    touch: ["dag", "roster"],
    author: agent(by, cap(by)),
    source: "report",
    extra: [{ path: ref, content: body }],
  });
}

async function raise(min: number, item: Omit<Item, "raised" | "status" | "source">, line: string) {
  open.items.push(ItemSchema.parse({ ...item, raised: at(min), status: "open", source: `msg:pm-${PID}:${40 + open.items.length}` }));
  await commit({ min, tool: "raise_item", subject: `raise ${item.id}`, line, touch: ["open"] });
}

async function decide(min: number, d: Omit<Decision, "date" | "status" | "source" | "proposedBy" | "links"> & { links?: string[] }) {
  if (d.supersedes) {
    const old = decisions.find((x) => x.id === d.supersedes)!;
    old.status = `superseded by ${d.id}`;
  }
  decisions.push({ links: [], ...d, date: at(min).slice(0, 10), status: "active", source: `msg:pm-${PID}:${60 + decisions.length}`, proposedBy: LEAD });
  await commit({ min, tool: "record_decision", subject: `record ${d.id}`, line: `pm: decided ${d.id} ${d.title}${d.approvedBy === "owner" ? " (you approved)" : ""}`, touch: ["decisions"] });
}

// ------------------------------------------------------------------------------------------------- story

charter = {
  title: "Pricing page relaunch",
  goal: "Ship a new pricing page with three clear tiers before the October launch.",
  metric: "Trial-to-paid conversion of at least 4% over the first 14 days.",
  deadline: day(11),
  scope: "pricing copy, page design, Stripe checkout links, launch analytics",
  outOfScope: "annual billing, enterprise tier, a new checkout flow",
  qualifications: "writer — SaaS pricing copy, short and calm; designer — Figma, responsive layouts; engineer — Next.js and Stripe Checkout",
  budget: "$15 model spend; your gates: brief, staffing, launch",
  approvalRef: `led:${at(-2)}/approval`,
};
await commit({ min: 0, tool: "set_charter", subject: "set the charter", line: "pm: charter approved by you", touch: ["charter"] });

roster.members.push(
  { agentId: "ana", role: "Copywriter", archetype: "writer", thread: `ana-${PID}`, state: "idle", lastCheckIn: null, lastReport: null, blockers: [], pmNote: "Fast; asks before guessing." },
  { agentId: "bo", role: "Product designer", archetype: "designer", thread: `bo-${PID}`, state: "idle", lastCheckIn: null, lastReport: null, blockers: [], pmNote: null },
  { agentId: "cy", role: "Frontend engineer", archetype: "engineer", thread: `cy-${PID}`, state: "idle", lastCheckIn: null, lastReport: null, blockers: [], pmNote: "Knows Stripe Checkout well." },
);
await commit({ min: 2, tool: "add_member", subject: "staff ana, bo and cy", line: "pm: staffed Ana, Bo and Cy", touch: ["roster"] });

prefs.push({ id: "P-1", text: "Short copy; no exclamation marks.", source: `msg:pm-${PID}:4` }, { id: "P-2", text: "Tone: calm, a little playful.", source: `msg:pm-${PID}:6` });
await commit({ min: 3, tool: "note_owner_pref", subject: "note P-1 and P-2", line: "pm: noted your preferences P-1 and P-2", touch: ["prefs"] });

await addTask(5, { id: "m1", kind: "milestone", title: "Copy and design", acceptance: "Copy and layout approved", owner: "pm", due: day(4) });
await addTask(6, { id: "m2", kind: "milestone", title: "Checkout and launch", acceptance: "Live with checkout links", owner: "pm", due: day(11) });
await addTask(7, { id: "t1", kind: "work", title: "Audit the current pricing page", acceptance: "One page: what converts, what confuses, with screenshots", milestone: "m1" });
await addTask(8, { id: "t2", kind: "work", title: "Scan competitor pricing", acceptance: "Five competitors, tiers and prices in one table, dated", milestone: "m1" });
await addTask(9, { id: "t3", kind: "todo", title: "Pick the three tiers", acceptance: "Tier names and prices, with your approval", owner: "pm", deps: ["t1", "t2"], milestone: "m1" });
await addTask(10, { id: "t4", kind: "work", title: "Page layout in Figma", acceptance: "Desktop and mobile frames, three tiers side by side", deps: ["t3"], milestone: "m1" });
await addTask(11, { id: "t5", kind: "work", title: "Draft pricing page copy", acceptance: "3 tiers, at most 120 words each, your tone (P-1, P-2)", deps: ["t3"], milestone: "m1" });
await addTask(12, { id: "t6", kind: "work", title: "Visual polish pass", acceptance: "Spacing, contrast and focus states checked", deps: ["t4"], milestone: "m1" });
await addTask(13, { id: "t7", kind: "todo", title: "Copy review", acceptance: "PM checks the copy against the prefs", owner: "pm", deps: ["t5"], milestone: "m1" });
await addTask(14, { id: "t8", kind: "work", title: "Build the page in Next.js", acceptance: "Owner approves the built page on the preview link", deps: ["t4"], milestone: "m2" });
await addTask(15, { id: "t9", kind: "work", title: "Stripe checkout links", acceptance: "One test-mode link per paid tier, checked end to end", deps: ["t7", "t8"], milestone: "m2" });
await addTask(16, { id: "t10", kind: "work", title: "Analytics events", acceptance: "View, tier click and checkout start tracked", deps: ["t8"], milestone: "m2" });
await addTask(17, { id: "t11", kind: "todo", title: "Launch checklist", acceptance: "Every launch gate ticked, your sign-off asked for", owner: "pm", deps: ["t6", "t9", "t10"], milestone: "m2" });
await addTask(18, { id: "t12", kind: "work", title: "Announce in the changelog", acceptance: "Short entry in your tone, links the page", deps: ["t11"] });

await decide(20, { id: "D-001", title: "Figma, not Framer", decision: "Design in Figma; hand off frames to the build.", why: "Bo and Cy both work in Figma; Framer adds a second source of truth.", approvedBy: "pm" });
await decide(22, { id: "D-002", title: "Two tiers: Free and Pro", decision: "Launch with Free and Pro only.", why: "A simpler page while the Team tier's limits are unclear.", approvedBy: "pm" });

patchTask("m1", 24, { status: "in_progress" });
await assign(25, "t1", "ana");
await report(60, "t1", "done", "Audit done: the old table hides the yearly price and the CTA sits below the fold", { evidence: [`file:projects/${PID}/files/audit.md`] });
await assign(62, "t2", "ana");
await report(95, "t2", "done", "Five competitors scanned; all show three tiers, two hide enterprise prices", { evidence: [`file:projects/${PID}/files/competitors.md`] });

await raise(100, { id: "Q-1", kind: "question", askOf: "owner", text: "Should the Team tier's price be public?", due: day(0), links: ["t3"] }, "pm: asked you Q-1 about the Team price");
Object.assign(open.items.find((i) => i.id === "Q-1")!, { status: "resolved", resolution: "Yes, show it.", resolvedAt: at(112) });
await commit({ min: 112, tool: "resolve_item", subject: "resolve Q-1", line: "pm: Q-1 resolved: show the Team price", touch: ["open"] });

await decide(118, { id: "D-003", title: "Three tiers (Free / Pro / Team)", decision: "Launch with three tiers; no annual plan in v1.", why: "You want a simple page; annual billing adds work past the deadline.", approvedBy: "owner", approvalRef: `led:${at(117)}/approval`, supersedes: "D-002", links: ["t3", "Q-1"] });
patchTask("t3", 120, { status: "done", evidence: [`led:${at(117)}/approval`] });
await commit({ min: 120, tool: "update_task", task: "t3", subject: "t3 done", line: "pm: t3 done — three tiers, you approved", touch: ["dag"] });

await assign(124, "t4", "bo");
await assign(126, "t5", "ana");
await report(200, "t4", "progress", "Desktop layout done; mobile next", { evidence: [`file:projects/${PID}/files/layout-desktop.png`] });
await raise(226, { id: "Q-2", kind: "question", askOf: "owner", text: "Final names for the three tiers?", due: day(1), links: ["t5"] }, "pm: asked you Q-2 about the tier names");
await report(228, "t5", "blocked", "v1 done for Pro and Team; Free tier copy waits on the final names", {
  blocker: { text: "needs the final tier names", on: "Q-2", since: at(228) },
  line: "ana: t5 blocked — needs the final tier names (Q-2)",
});
await raise(240, { id: "R-1", kind: "risk", askOf: "pm", text: "Stripe test keys aren't provisioned yet; that blocks t9.", severity: "high", links: ["t9"] }, "pm: flagged R-1, Stripe test keys");
patchTask("m2", 249, { status: "in_progress" });
await assign(250, "t8", "cy");
await report(330, "t8", "review", "Page built behind a flag; the preview link is in the report", { evidence: [`file:projects/${PID}/files/preview.md`] });
await commit({ min: 352, tool: "log_progress", subject: "log progress", line: "pm: waiting on you for Q-2 and the t8 review", touch: [] });

// ------------------------------------------------------------------------------------------ ledger (fixture)

const d = statePath(PID, "decisions.md");
const p = statePath(PID, "prefs.md");
const g = statePath(PID, "dag.json");
const o = statePath(PID, "open.json");
const call = (min: number, who: string, input: number, cost: number): CallEvent => ({
  t: "call", kind: "run", at: at(min), team: PID, agent: who, model: MODELS.main, asked: MODELS.main, input, cached: Math.round(input * 0.7), output: 900, ms: 2400, cost, ok: true,
});
const compaction = (min: number, window: number, before: number, after: number, files: string[], passed: number, degraded = false): CompactionEvent => ({
  t: "compaction", at: at(min), agent: LEAD, project: PID, thread: `pm-${PID}`, window, trigger: "soft", before, after,
  steps: [
    { kind: "filed", files: files.map((f) => ({ path: f, change: lastChange[f] })), items: files.length + 1 },
    { kind: "summarized" },
    { kind: "rebuilt" },
    { kind: "checked", passed, total: 4 },
  ],
  degraded, ms: 4200, usd: 0.02,
});
const rows: (CallEvent | CompactionEvent)[] = [];
for (let i = 0; i < 24; i++) rows.push(call(10 + i * 14, LEAD, 18_000 + ((i * 7_919) % 46_000), 0.09));
for (let i = 0; i < 10; i++) rows.push(call(30 + i * 20, "ana", 30_000 + i * 4_000, 0.11), call(130 + i * 12, "bo", 12_000 + i * 2_000, 0.07));
for (let i = 0; i < 6; i++) rows.push(call(255 + i * 13, "cy", 60_000 + i * 9_000, 0.16));
rows.push(call(354, LEAD, 51_000, 0.1), call(356, "cy", 109_000, 0.18));
// File chips point at the change each file had when the compaction filed it, so History opens on that version.
rows.push(compaction(122, 1, 0.71, 0.18, [d, o], 4));
rows.push(compaction(241, 2, 0.69, 0.21, [d, p, g], 3, true));
rows.push(compaction(334, 3, 0.7, 0.17, [g, o], 4));
rows.sort((a, b) => (a.at < b.at ? -1 : 1));
writeFileSync(path.join(DATA_DIR, "ledger.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

console.log(`Seeded project "${PID}" (rev ${rev}, ${dag.tasks.length} tasks) in ${DATA_DIR}`);
console.log(`Run the app on it:  DATA_DIR=${DATA_DIR} VAULT_DIR=${DATA_DIR}/vault npx next dev --port 3500`);
console.log(`(Until DATA_DIR moves the ledger too, link it: ln -sfn ${DATA_DIR} .data)`);
