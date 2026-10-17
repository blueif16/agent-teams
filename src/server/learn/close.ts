/*
 * The learning step at project close (test-mode design §7b, T11; team-setup §5): when a project closes, the company
 * learns from it, so the next run of the same kind of work is better, faster and cheaper. In order, each a vault
 * commit that cites evidence from the run:
 *   1. Retro: the PM's one model call over code-computed numbers and the feedback → projects/<pid>/state/retro.md.
 *   2. Dream, per member: MEMORY.md ops validated by code, one commit per agent (source dream). Auto-applied (Q8);
 *      Undo is a vault restore of the commit.
 *   3. Skill tuning, per member, only when a failed rubric item or a 🔁 on its work exists: edits to its own copies
 *      under agents/<id>/skills/, one commit per agent.
 *   4. Composition note: the roster, cost and outcome → company/compositions/<kind>/<pid>.md, one commit.
 * Before any learning edit is committed, the leak check runs over the lines it adds (./leak.ts); one leak and nothing
 * for that agent is committed. Cross-project memory (the chief's, which is the company's) is skipped and listed (Q8).
 * Then the project is marked done in runtime.db. A second close is a no-op; a close that failed half way (a model or
 * vault error) leaves the project open, and a retry redoes only the steps whose commit isn't in the vault yet.
 * Server only.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { agentVault, memoryTemplate } from "@/lib/agent-files";
import { HQ } from "@/lib/data";
import { readLedger, type LedgerEvent } from "@/lib/ledger";
import { MODELS } from "@/lib/models";
import type { TrailerInput, VaultAuthor } from "@/lib/vault/types";
import { getServerCache } from "@/server/cache";
import { TOPICS } from "@/server/cache/bus";
import { parseDecisions, parseJournal, parseJson } from "@/server/project-state/format";
import { Dag, type Decision, type JournalLine } from "@/server/project-state/schema";
import { FILES, statePath } from "@/server/project-state/store";
import { getRuntimeDb, MIRA_DM_PROJECT, type ProjectRow, type RuntimeDb } from "@/server/runtime/db";
import { LedgerCallbacks } from "@/server/runtime/ledger-callbacks";
import { crusoe } from "@/server/runtime/models";
import { threadId } from "@/server/runtime/threads";
import { RUNTIME, VaultConflictError, type Vault } from "@/server/runtime/vault";
import { compositionPath, compositionRefs, renderComposition } from "./composition";
import { buildEvidence, renderEvidence, type Evidence, type EvidenceTable, type MemberInfo } from "./evidence";
import { leakProblem, projectFacts } from "./leak";
import { applyOps, dreamSystem, dreamUser, parseMemory, validateOps } from "./memory";
import { isKind, renderRetro, RETRO_SYSTEM, retroUser, validateRetro } from "./retro";
import { skillSystem, skillUser, tuneSkills } from "./skill";
import type { CloseSummary, LearnCommit, LearnStep, RunFeedback, Skipped } from "./types";

export interface CloseOptions {
  /** What the run's owner (or the simulated one) said: failed rubric items, orders, slow phases. */
  feedback?: RunFeedback;
  /** For the model calls (a limiter, the fake model in tests). */
  fetch?: typeof fetch;
  /** The project's facts to keep out of learning: the client's name, competitors, figures from the brief. */
  facts?: string[];
  /** The kind of work, as a slug ("product-launch-kit"); default: the retro's, else "general". */
  kind?: string;
}

/** The project can't be closed as asked: 404 when there is no such project, 400 otherwise. */
export class CloseError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
    this.name = "CloseError";
  }
}

const MAX_TRAILER_REFS = 12;
const locks = new Map<string, Promise<unknown>>();

/** Closes the project and runs the learning step once. Concurrent closes of one project run one after the other. */
export function closeProject(projectId: string, opts: CloseOptions = {}): Promise<CloseSummary> {
  const next = (locks.get(projectId) ?? Promise.resolve()).then(() => close(projectId, opts));
  const settled = next.catch(() => undefined);
  locks.set(projectId, settled);
  void settled.then(() => {
    if (locks.get(projectId) === settled) locks.delete(projectId);
  });
  return next;
}

interface Ctx {
  pid: string;
  project: ProjectRow;
  db: RuntimeDb;
  vault: Vault;
  opts: CloseOptions;
  now: Date;
  facts: string[];
  table: EvidenceTable;
  members: MemberInfo[];
  commits: LearnCommit[];
  skipped: Skipped[];
  usd: number;
  failed: boolean;
}

async function close(pid: string, opts: CloseOptions): Promise<CloseSummary> {
  const db = getRuntimeDb();
  const project = db.projects.get(pid);
  if (!project) throw new CloseError(`No project "${pid.slice(0, 80)}".`, 404);
  if (project.id === MIRA_DM_PROJECT || project.kind === "company") throw new CloseError("Mira's DM and the company aren't projects that close.", 400);
  if (project.status === "done" || project.status === "archived") {
    return { projectId: pid, closed: true, commits: [], skipped: [{ step: "close", reason: `already closed${project.closedAt ? ` at ${project.closedAt}` : ""}; nothing to do` }], usd: 0 };
  }
  if (project.status !== "active") throw new CloseError("This project hasn't launched yet.", 400);

  const vault = await agentVault();
  const now = new Date();
  const run = closeRun(pid);
  const ledger = (await readLedger()).filter((e) => ofProject(e, pid) && !(e.t === "call" && e.run === run));
  const members = membersOf(db, pid);
  const charter = (await readVault(vault, statePath(pid, FILES.charter))) ?? project.specMd ?? "";
  const state = await readStateLoosely(vault, pid);
  const table = buildEvidence({ pid, createdAt: project.createdAt, now, budgetUsd: project.budgetUsd, feedback: opts.feedback, ledger, members, ...state });
  const ctx: Ctx = { pid, project, db, vault, opts, now, facts: projectFacts(charter, opts.facts), table, members, commits: [], skipped: [], usd: 0, failed: false };

  const retro = await retroStep(ctx);
  // The dream already gets the numbers and the evidence; from the retro it needs the PM's judgement only.
  const judgement = /## What went wrong[\s\S]*?(?=\n## Evidence|$)/.exec(retro.text)?.[0].trim() ?? "";
  for (const m of members) await memberSteps(ctx, m, judgement);
  await compositionStep(ctx, retro.kind);

  if (!ctx.failed) {
    db.projects.setStatus(pid, "done");
    getServerCache().bus.emit(TOPICS.org);
  }
  return { projectId: pid, closed: !ctx.failed, commits: ctx.commits, skipped: ctx.skipped, usd: ctx.usd };
}

// ------------------------------------------------------------------------------------------------ inputs

const closeRun = (pid: string) => `close:${pid}`;

/** A ledger row of this project: its team's rows, and any call made on one of its threads (solo projects count to HQ). */
const ofProject = (e: LedgerEvent, pid: string) => e.team === pid || (e.t === "call" && !!e.thread?.endsWith(`:p:${pid}`));

function membersOf(db: RuntimeDb, pid: string): MemberInfo[] {
  return db.members.list(pid).map((m) => {
    const agent = db.agents.get(m.agentId);
    const composition = agent?.config.composition;
    return {
      agentId: m.agentId,
      name: agent?.name ?? m.agentId,
      role: m.role ?? composition?.role ?? agent?.archetype ?? "member",
      archetype: agent?.archetype ?? composition?.archetype ?? "unknown",
      skills: composition?.skills ?? [],
    };
  });
}

async function readVault(vault: Vault, p: string): Promise<string | null> {
  try {
    return await readFile(path.join(vault.dir, p), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return null;
  }
}

async function list(vault: Vault, dir: string): Promise<string[]> {
  try {
    return await readdir(path.join(vault.dir, dir));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return [];
  }
}

/**
 * The PM's DAG, journal and decisions, each read on its own: a file that doesn't parse is left out of the evidence
 * rather than failing the close (the charter seeded at launch isn't in the state tools' format, so readState can't be used).
 */
async function readStateLoosely(vault: Vault, pid: string): Promise<{ dag: Dag | null; journal: { window: number; lines: JournalLine[] }[]; decisions: Decision[] }> {
  const soft = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  const dagText = await readVault(vault, statePath(pid, FILES.dag));
  const decisionsText = await readVault(vault, statePath(pid, FILES.decisions));
  const windows = (await list(vault, statePath(pid, "journal")))
    .map((n) => /^([1-9][0-9]*)\.md$/.exec(n)?.[1])
    .filter((n): n is string => !!n)
    .map(Number)
    .sort((a, b) => a - b);
  const journal: { window: number; lines: JournalLine[] }[] = [];
  for (const w of windows) {
    const file = statePath(pid, `journal/${w}.md`);
    const text = await readVault(vault, file);
    if (text !== null) journal.push({ window: w, lines: soft(() => parseJournal(text, file), []) });
  }
  return {
    dag: dagText === null ? null : soft(() => parseJson(statePath(pid, FILES.dag), dagText, Dag), null),
    journal,
    decisions: decisionsText === null ? [] : soft(() => parseDecisions(decisionsText), []),
  };
}

// --------------------------------------------------------------------------------------------- the model

const textOf = (content: BaseMessage["content"]) =>
  typeof content === "string" ? content : content.map((p) => (typeof p === "object" && p && "text" in p ? String(p.text) : "")).join("");

/** The first JSON object in a reply (a code fence or a stray sentence around it is tolerated), or undefined. */
function jsonOf(text: string): unknown {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a === -1 || b < a) return undefined;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return undefined;
  }
}

/**
 * One model call for `agentId`, recorded in the ledger on its thread of this project (run `close:<pid>`) and added to
 * the close's cost. A reply that isn't JSON gets one repair turn. Undefined when the model failed (the close then
 * stays open) or never answered with JSON (the step is skipped).
 */
async function ask(ctx: Ctx, step: LearnStep, agentId: string, system: string, user: string, maxTokens: number): Promise<unknown> {
  const chat = crusoe(MODELS.main, { maxTokens, think: false, fetch: ctx.opts.fetch });
  const ledger = new LedgerCallbacks({
    thread: threadId(agentId, ctx.pid),
    run: closeRun(ctx.pid),
    team: ctx.project.kind === "team" ? ctx.pid : HQ.id,
    agent: agentId,
    asked: MODELS.main,
    onCall: (e) => {
      ctx.usd += e.cost;
    },
  });
  const messages: BaseMessage[] = [new SystemMessage(system), new HumanMessage(user)];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await chat.invoke(messages, { callbacks: [ledger] });
      const text = textOf(reply.content);
      const out = jsonOf(text);
      if (out !== undefined) return out;
      messages.push(new AIMessage(text), new HumanMessage("That wasn't one JSON object. Answer again with only the JSON object the output spec describes."));
    }
    ctx.skipped.push({ step, agentId, reason: "the model didn't answer with JSON" });
    return undefined;
  } catch (e) {
    ctx.failed = true;
    ctx.skipped.push({ step, agentId, reason: `error: the model call failed (${(e as Error).message.slice(0, 160)}); the project stays open, close again to retry` });
    return undefined;
  } finally {
    await ledger.flush();
  }
}

// ------------------------------------------------------------------------------------------------ commits

const refsOf = (table: Map<string, Evidence>, ids: Iterable<string>) => [...new Set([...ids].map((id) => table.get(id)?.ref).filter((r): r is string => !!r))];

const author = (m: Pick<MemberInfo, "agentId" | "name">): VaultAuthor => ({ kind: "agent", id: m.agentId, name: m.name });

/** True when a close of this project already committed this step to the file (so a retry skips it). */
async function learned(vault: Vault, p: string, pid: string, step: LearnStep): Promise<boolean> {
  const { commits } = await vault.history(p);
  return commits.some((c) => c.trailers.Learn?.includes(step) && c.trailers.Project?.includes(pid));
}

interface Write {
  step: LearnStep;
  agentId?: string;
  files: { path: string; content: string; expectedBlob: string | null }[];
  author: VaultAuthor;
  source: "dream" | "tool";
  subject: string;
  refs: string[];
  trailers?: TrailerInput;
}

async function commit(ctx: Ctx, w: Write): Promise<void> {
  const refs = w.refs.slice(0, MAX_TRAILER_REFS);
  try {
    const c = await ctx.vault.writeMany({
      files: w.files,
      author: w.author,
      source: w.source,
      subject: w.subject,
      trailers: { Project: ctx.pid, Run: ctx.opts.feedback?.runId, Learn: w.step, Evidence: refs, ...w.trailers },
    });
    if (c) ctx.commits.push({ step: w.step, agentId: w.agentId, paths: w.files.map((f) => f.path), change: c.change, subject: c.subject, evidence: refs });
  } catch (e) {
    ctx.failed = true;
    const why = e instanceof VaultConflictError ? `${e.path} changed while the close was writing it` : (e as Error).message.slice(0, 160);
    ctx.skipped.push({ step: w.step, agentId: w.agentId, reason: `error: ${why}; the project stays open, close again to retry` });
  }
}

const gitBlobOf = async (vault: Vault, p: string) => vault.blob(p);

// ------------------------------------------------------------------------------------------------- 1. retro

async function retroStep(ctx: Ctx): Promise<{ text: string; kind?: string }> {
  const { pid, project, table } = ctx;
  const file = statePath(pid, "retro.md");
  if (await learned(ctx.vault, file, pid, "retro")) return { text: (await readVault(ctx.vault, file)) ?? "" };

  const lead = ctx.members.find((m) => m.agentId === project.leadAgentId) ?? ctx.members[0];
  const leadId = lead?.agentId ?? project.leadAgentId ?? "pm";
  const raw = await ask(ctx, "retro", leadId, RETRO_SYSTEM, retroUser({ pid, leadId, projectName: project.name, goal: project.goal ?? "", evidence: renderEvidence(table.items) }), 1500);
  const retro = validateRetro(raw, table.byId);
  for (const d of retro.dropped) ctx.skipped.push({ step: "retro", agentId: leadId, reason: d.reason, item: d.item });

  const text = renderRetro(pid, ctx.now.toISOString(), table.items, retro);
  const refs = [`ledger:${pid}`, ...refsOf(table.byId, retro.lines.flatMap((l) => l.evidence))];
  await commit(ctx, {
    step: "retro",
    agentId: leadId,
    files: [{ path: file, content: text, expectedBlob: await gitBlobOf(ctx.vault, file) }],
    author: lead ? author(lead) : RUNTIME,
    source: "tool",
    subject: `state(${pid}): write retro.md at the project's close`,
    refs,
  });
  return { text, kind: retro.kind };
}

// ------------------------------------------------------------------------------------------ 2-3. per member

async function memberSteps(ctx: Ctx, m: MemberInfo, retro: string): Promise<void> {
  const { pid, table, vault } = ctx;
  if (m.archetype === "chief") {
    ctx.skipped.push({ step: "dream", agentId: m.agentId, reason: "Q8: the chief's memory is the company's cross-project memory; editing it needs the owner's approval" });
    return;
  }
  const home = `agents/${m.agentId}`;
  const memoryPath = `${home}/MEMORY.md`;

  // Dream.
  let dream: Write | null = null;
  if (!(await learned(vault, memoryPath, pid, "dream"))) {
    const before = (await readVault(vault, memoryPath)) ?? memoryTemplate({ name: m.name });
    const items = parseMemory(before);
    const raw = await ask(ctx, "dream", m.agentId, dreamSystem(m), dreamUser({ agentId: m.agentId, role: m.role, items, evidence: renderEvidence(table.items), retro }), 1200);
    const { ops, dropped } = validateOps(raw, items, table.byId);
    for (const d of dropped) ctx.skipped.push({ step: "dream", agentId: m.agentId, reason: d.reason, item: d.item });
    if (ops.length) {
      const after = applyOps(before, ops, items, { date: ctx.now.toISOString().slice(0, 10), refs: (ids) => refsOf(table.byId, ids) });
      const leak = await leakProblem(before, after, ctx.facts, { prices: true });
      if (leak) {
        ctx.skipped.push({ step: "dream", agentId: m.agentId, reason: `${leak}; nothing of ${m.agentId}'s is committed` });
        return;
      }
      dream = {
        step: "dream",
        agentId: m.agentId,
        files: [{ path: memoryPath, content: after, expectedBlob: await gitBlobOf(vault, memoryPath) }],
        author: author(m),
        source: "dream",
        subject: `memory(${m.agentId}): consolidate MEMORY.md at the close of ${pid}`,
        refs: refsOf(table.byId, ops.flatMap((o) => o.evidence)),
        trailers: { Op: ops.map((o) => (o.op === "add" ? `add ${o.section}` : `${o.op} ${o.item}`)) },
      };
    }
  }

  // Skill tuning: only when the owner's feedback points at this agent's work.
  let skill: Write | null = null;
  const pointers = table.items.filter((e) => e.agentId === m.agentId && (e.kind === "failed" || (e.kind === "order" && e.ref.startsWith("order:redo@"))));
  const copies = await ownCopies(vault, home);
  const done = await Promise.all([...copies.keys()].map((f) => learned(vault, `${home}/skills/${f}/SKILL.md`, pid, "skill")));
  if (pointers.length && copies.size && !done.some(Boolean)) {
    const feedback = renderEvidence(pointers);
    const raw = await ask(ctx, "skill", m.agentId, skillSystem(m), skillUser({ agentId: m.agentId, feedback, skills: copies }), 1500);
    const { files, edits, dropped } = tuneSkills(raw, { agentId: m.agentId, copies, evidence: table.byId, pointers: new Set(pointers.map((p) => p.id)) });
    for (const d of dropped) ctx.skipped.push({ step: "skill", agentId: m.agentId, reason: d.reason, item: d.item });
    for (const [folder, after] of files) {
      const leak = await leakProblem(copies.get(folder)!, after, ctx.facts, { prices: true });
      if (leak) {
        ctx.skipped.push({ step: "skill", agentId: m.agentId, reason: `${leak} (in ${folder}); nothing of ${m.agentId}'s is committed` });
        return;
      }
    }
    if (files.size) {
      const folders = [...files.keys()];
      skill = {
        step: "skill",
        agentId: m.agentId,
        files: await Promise.all(
          [...files].map(async ([folder, content]) => {
            const p = `${home}/skills/${folder}/SKILL.md`;
            return { path: p, content, expectedBlob: await gitBlobOf(vault, p) };
          }),
        ),
        author: author(m),
        source: "dream",
        subject: `skill(${m.agentId}): tune ${folders.length === 1 ? folders[0] : `${folders.length} skills`} at the close of ${pid}`,
        refs: refsOf(table.byId, edits.flatMap((e) => e.evidence)),
        trailers: { Skill: folders },
      };
    }
  }

  // Both edits passed the leak check: commit them, the dream first.
  if (dream) await commit(ctx, dream);
  if (skill) await commit(ctx, skill);
}

/** The agent's own skill copies, by folder: `agents/<id>/skills/<folder>/SKILL.md` (never the shared library). */
async function ownCopies(vault: Vault, home: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const folder of (await list(vault, `${home}/skills`)).sort()) {
    if (folder.startsWith(".")) continue;
    const md = await readVault(vault, `${home}/skills/${folder}/SKILL.md`).catch(() => null);
    if (md !== null) out.set(folder, md);
  }
  return out;
}

// ------------------------------------------------------------------------------------------ 4. composition

async function compositionStep(ctx: Ctx, retroKind?: string): Promise<void> {
  const { pid, table } = ctx;
  let kind = isKind(ctx.opts.kind) ? ctx.opts.kind : (retroKind ?? "general");
  // The kind names a folder every later project reads: it must not carry this client's facts either.
  if (await leakProblem("", kind, ctx.facts, { prices: true })) kind = "general";
  const file = compositionPath(kind, pid);
  if ((await gitBlobOf(ctx.vault, file)) !== null) return;

  const refs = compositionRefs(pid, table.items);
  const note = renderComposition({
    pid,
    kind,
    closedAt: ctx.now.toISOString(),
    members: ctx.members,
    project: table.project,
    perAgent: table.perAgent,
    wallMs: table.wallMs,
    budgetUsd: ctx.project.budgetUsd,
    dag: (await readStateLoosely(ctx.vault, pid)).dag,
    feedback: ctx.opts.feedback,
    refs,
  });
  const leak = await leakProblem("", note, ctx.facts, { prices: false });
  if (leak) {
    ctx.skipped.push({ step: "composition", reason: leak });
    return;
  }
  const archetypes = [...new Set(ctx.members.map((m) => m.archetype))];
  const skills = [...new Set(ctx.members.flatMap((m) => m.skills))];
  await commit(ctx, {
    step: "composition",
    files: [{ path: file, content: note, expectedBlob: null }],
    author: RUNTIME,
    source: "tool",
    subject: `company(compositions): note the ${kind} roster of ${pid}`,
    refs,
    trailers: { Archetype: archetypes, ...(skills.length && { Skill: skills }) },
  });
}
