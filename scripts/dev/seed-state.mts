/*
 * Dev only, never imported by app code: seeds a realistic project into a temp DATA_DIR, through the lead's REAL
 * state tools, so the state views can be developed and screenshotted against real files (no demo data ships;
 * DECISIONS → Product).
 *
 *   DATA_DIR=$(mktemp -d) node --experimental-transform-types --import ./scripts/dev/register-alias.mjs scripts/dev/seed-state.mts
 *
 * Writes the vault at $DATA_DIR/vault and the ledger at $DATA_DIR/ledger.jsonl (the owner approvals the tools check,
 * plus fixture model calls and compactions for the context bars), then prints the env to start a dev server on them.
 * The project: a pricing page relaunch, 12 tasks across 2 milestones (one blocked on an owner question), 3
 * decisions (one superseded), 2 open items and a resolved one, a 3-member roster, a charter, prefs and a journal.
 * The worker `report` tool isn't merged yet, so no task has a lastReport.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CompactionEvent } from "@/lib/compaction";
import type { ApprovalEvent, CallEvent, LedgerEvent } from "@/lib/ledger";
import { MODELS } from "@/lib/models";
import { addMember, leadTools, statePath } from "@/server/project-state";
import { getVault, setVault, Vault } from "@/server/runtime/vault";

const DATA_DIR = path.resolve(process.env.DATA_DIR || mkdtempSync(path.join(tmpdir(), "agent-teams-state-")));
const PID = process.env.SEED_PID || "pricing";
const LEAD = "juno";
mkdirSync(DATA_DIR, { recursive: true });
setVault(new Vault({ dir: path.join(DATA_DIR, "vault") }));

// The story spans the last six hours and ends a few minutes ago, so relative times read naturally.
const START = Date.now() - 6 * 3_600_000;
let clock = 0;
const at = (min = clock) => new Date(START + min * 60_000).toISOString();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const ledger: LedgerEvent[] = [];
const deps = { now: () => new Date(at()), ledger: async () => ledger, dispatch: () => undefined };
const tools = Object.fromEntries(leadTools(PID, LEAD, deps).map((t) => [t.name, t]));
let rev = 0;

/** Calls one tool at minute `min`; any refusal stops the seed. */
async function use(min: number, name: string, args: Record<string, unknown>): Promise<string | undefined> {
  clock = min;
  const out = JSON.parse(String(await tools[name].invoke(args))) as { id?: string; rev: number; error?: string; message?: string };
  if (out.error) throw new Error(`${name} ${JSON.stringify(args)} → ${out.error}: ${out.message}`);
  rev = out.rev;
  return out.id;
}

/** An owner approval in the ledger, as the approval card writes it; returns its ref. */
function approve(min: number): string {
  const e: ApprovalEvent = { t: "approval", at: at(min), team: PID, agent: LEAD, decision: "approved" };
  ledger.push(e);
  return `led:${e.at}/approval`;
}

const changeOf = async (file: string) => (await getVault().history(statePath(PID, file))).commits[0]?.change ?? "";
const filed: Record<number, { path: string; change: string }[]> = {};
async function snapshotFor(window: number, files: string[]) {
  filed[window] = await Promise.all(files.map(async (f) => ({ path: statePath(PID, f), change: await changeOf(f) })));
}

// ------------------------------------------------------------------------------------------------- story

await use(0, "set_charter", {
  title: "Pricing page relaunch",
  goal: "Ship a new pricing page with three clear tiers before the October launch.",
  metric: "Trial-to-paid conversion of at least 4% over the first 14 days.",
  deadline: day(11),
  scope: "pricing copy, page design, Stripe checkout links, launch analytics",
  outOfScope: "annual billing, enterprise tier, a new checkout flow",
  qualifications: "writer — SaaS pricing copy, short and calm; designer — Figma, responsive layouts; engineer — Next.js and Stripe Checkout",
  budget: "$15 model spend; your gates: brief, staffing, launch",
  approvalRef: approve(-2),
});

clock = 2;
for (const m of [
  { agentId: "ana", role: "Copywriter", archetype: "writer" },
  { agentId: "bo", role: "Product designer", archetype: "designer" },
  { agentId: "cy", role: "Frontend engineer", archetype: "engineer" },
]) {
  await addMember(PID, { ...m, thread: `${m.agentId}-${PID}` }, deps);
}

await use(3, "note_owner_pref", { text: "Short copy; no exclamation marks.", sourceRef: `msg:pm-${PID}:4` });
await use(4, "note_owner_pref", { text: "Tone: calm, a little playful.", sourceRef: `msg:pm-${PID}:6` });

const m1 = await use(5, "add_task", { kind: "milestone", title: "Copy and design", acceptance: "Copy and layout approved", owner: "pm", due: day(4) });
const m2 = await use(6, "add_task", { kind: "milestone", title: "Checkout and launch", acceptance: "Live with checkout links", owner: "pm", due: day(11) });
const add = (min: number, a: Record<string, unknown>) => use(min, "add_task", { kind: "work", ...a });
const t1 = await add(7, { title: "Audit the current pricing page", acceptance: "One page: what converts, what confuses, with screenshots", milestone: m1 });
const t2 = await add(8, { title: "Scan competitor pricing", acceptance: "Five competitors, tiers and prices in one table, dated", milestone: m1 });
const t3 = await add(9, { kind: "todo", owner: "pm", title: "Pick the three tiers", acceptance: "Tier names and prices, with your approval", deps: [t1, t2], milestone: m1 });
const t4 = await add(10, { title: "Page layout in Figma", acceptance: "Desktop and mobile frames, three tiers side by side", deps: [t3], milestone: m1 });
const t5 = await add(11, { title: "Draft pricing page copy", acceptance: "3 tiers, at most 120 words each, your tone (P-1, P-2)", deps: [t3], milestone: m1 });
const t6 = await add(12, { title: "Visual polish pass", acceptance: "Spacing, contrast and focus states checked", deps: [t4], milestone: m1 });
const t7 = await add(13, { kind: "todo", owner: "pm", title: "Copy review", acceptance: "PM checks the copy against your preferences", deps: [t5], milestone: m1 });
const t8 = await add(14, { title: "Build the page in Next.js", acceptance: "Owner approves the built page on the preview link", deps: [t3], milestone: m2 });
const t9 = await add(15, { title: "Stripe checkout links", acceptance: "One test-mode link per paid tier, checked end to end", deps: [t7, t8], milestone: m2 });
const t10 = await add(16, { title: "Analytics events", acceptance: "View, tier click and checkout start tracked", deps: [t8], milestone: m2 });
const t11 = await add(17, { kind: "todo", owner: "pm", title: "Launch checklist", acceptance: "Every launch gate ticked, your sign-off asked for", deps: [t6, t9, t10], milestone: m2 });
await add(18, { title: "Announce in the changelog", acceptance: "Short entry in your tone, links the page", deps: [t11] });

await use(20, "record_decision", { title: "Figma, not Framer", decision: "Design in Figma and hand off frames to the build.", why: "Bo and Cy both work in Figma; Framer adds a second source of truth.", approvedBy: "pm" });
const d2 = await use(22, "record_decision", { title: "Two tiers: Free and Pro", decision: "Launch with Free and Pro only.", why: "A simpler page while the Team tier's limits are unclear.", approvedBy: "pm" });

const status = (min: number, id: string | undefined, a: Record<string, unknown>) => use(min, "update_task", { id, expectedRev: rev, ...a });
await status(24, m1, { status: "in_progress" });
await use(25, "assign_task", { id: t1, agentId: "ana", brief: "Audit the current pricing page: what converts, what confuses. Screenshots in files/." });
await status(60, t1, { status: "done", evidence: [`file:projects/${PID}/files/audit.md`], note: "The old table hides the yearly price; the CTA sits below the fold." });
await use(62, "assign_task", { id: t2, agentId: "ana", brief: "Scan five competitors' pricing pages into one dated table." });
await status(95, t2, { status: "done", evidence: [`file:projects/${PID}/files/competitors.md`], note: "All five show three tiers; two hide enterprise prices." });

const q1 = await use(100, "raise_item", { kind: "question", askOf: "owner", text: "Should the Team tier's price be public?", due: day(0), links: [t3] });
await use(112, "resolve_item", { id: q1, resolution: "Yes, show it." });
await use(118, "record_decision", {
  title: "Three tiers (Free / Pro / Team)",
  decision: "Launch with three tiers; no annual plan in v1.",
  why: "You want a simple page; annual billing adds work past the deadline.",
  approvedBy: "owner",
  approvalRef: approve(117),
  supersedes: d2,
  links: [t3!, q1!],
});
await status(119, t3, { status: "in_progress" });
await status(120, t3, { status: "done", evidence: [`led:${at(117)}/approval`] });
await snapshotFor(1, ["decisions.md", "open.json"]);

await use(124, "assign_task", { id: t4, agentId: "bo", brief: "Desktop and mobile frames in Figma, three tiers side by side (D-003)." });
await use(126, "assign_task", { id: t5, agentId: "ana", brief: "Draft the copy for the three tiers, at most 120 words each, in the owner's tone (P-1, P-2)." });
const q2 = await use(226, "raise_item", { kind: "question", askOf: "owner", text: "Final names for the three tiers?", due: day(1), links: [t5] });
await status(228, t5, { status: "blocked", blocker: { text: "needs the final tier names", on: q2 }, note: "v1 done for Pro and Team; Free waits on the names." });
await use(229, "update_member", { agentId: "ana", pmNote: "Fast; asks before guessing.", blocker: { text: "the final tier names", on: q2 } });
await use(240, "raise_item", { kind: "risk", askOf: "pm", text: "Stripe test keys aren't provisioned yet; that blocks t9.", severity: "high", links: [t9] });
await snapshotFor(2, ["decisions.md", "prefs.md", "dag.json"]);

await status(249, m2, { status: "in_progress" });
await use(250, "assign_task", { id: t8, agentId: "cy", brief: "Build the page behind a flag from the tier decision (D-003); post a preview link." });
await use(251, "update_member", { agentId: "cy", pmNote: "Knows Stripe Checkout well." });
await status(330, t8, { status: "review", evidence: [`file:projects/${PID}/files/preview.md`], note: "Built behind a flag; the preview link is in files/preview.md." });
await snapshotFor(3, ["dag.json", "open.json"]);
await use(352, "log_progress", { line: "Waiting on you for Q-2 and the t8 review." });

// ------------------------------------------------------------------------------------------ ledger (fixture)

const call = (min: number, who: string, input: number, cost: number): CallEvent => ({
  t: "call", kind: "run", at: at(min), team: PID, agent: who, model: MODELS.main, asked: MODELS.main, input, cached: Math.round(input * 0.7), output: 900, ms: 2400, cost, ok: true,
});
const compaction = (min: number, window: number, before: number, after: number, passed: number, degraded = false): CompactionEvent => ({
  t: "compaction", at: at(min), agent: LEAD, project: PID, thread: `pm-${PID}`, window, trigger: "soft", before, after,
  // The file chips point at the change each file had when this compaction filed it, so History opens on that version.
  steps: [{ kind: "filed", files: filed[window], items: filed[window].length + 1 }, { kind: "summarized" }, { kind: "rebuilt" }, { kind: "checked", passed, total: 4 }],
  degraded, ms: 4200, usd: 0.02,
});
const rows: unknown[] = [...ledger];
for (let i = 0; i < 24; i++) rows.push(call(10 + i * 14, LEAD, 18_000 + ((i * 7_919) % 46_000), 0.09));
for (let i = 0; i < 10; i++) rows.push(call(30 + i * 20, "ana", 30_000 + i * 4_000, 0.11), call(130 + i * 12, "bo", 12_000 + i * 2_000, 0.07));
for (let i = 0; i < 6; i++) rows.push(call(255 + i * 13, "cy", 60_000 + i * 9_000, 0.16));
rows.push(call(354, LEAD, 51_000, 0.1), call(356, "cy", 109_000, 0.18));
rows.push(compaction(122, 1, 0.71, 0.18, 4), compaction(241, 2, 0.69, 0.21, 3, true), compaction(334, 3, 0.7, 0.17, 4));
rows.sort((a, b) => ((a as { at: string }).at < (b as { at: string }).at ? -1 : 1));
writeFileSync(path.join(DATA_DIR, "ledger.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

console.log(`Seeded project "${PID}" through the state tools (rev ${rev}) in ${DATA_DIR}`);
console.log(`Run the app on it:  DATA_DIR=${DATA_DIR} VAULT_DIR=${DATA_DIR}/vault npx next dev --port 3500`);
console.log(`(Until DATA_DIR moves the ledger too, link it: ln -sfn ${DATA_DIR} .data)`);
process.exit(0);
