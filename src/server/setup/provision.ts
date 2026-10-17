/*
 * Provisioning (setup-flow spec, step 4; design §1 step 7): the option the owner launched becomes a real team.
 *
 *   1. checkPlan: the plan comes back from the browser, so every field is checked again (archetypes, shape, skills
 *      the library can load, rehires that are still free). Then the text documents among the plan's uploads (the
 *      opening DM's files) are copied to <data>/projects/<pid>/files/inputs/, and charter.md lists them under Inputs.
 *   2. One db transaction: agents (new hires), the project (team, or dm for a solo expert), members, threads, and
 *      one kickoff in the lead's inbox (kind `assignment`: the charter plus "write the plan and assign first
 *      tasks"). The runtime's queue drains it; nothing here runs a model. Then `org` is announced.
 *   3. The vault, from the rows: per agent one seed commit with SOUL.md and MEMORY.md (archetype templates) and its
 *      skills/, and the charter at projects/<pid>/state/charter.md. Only missing files are written, so this step
 *      can run again.
 *
 * Idempotent on the client's nonce: the project id is derived from it, so a retried launch finds the project the
 * first attempt made, finishes any vault writes that didn't land, and creates nothing more. Server only.
 */
import { createHash, randomUUID } from "node:crypto";
import { memoryTemplate, soulTemplate } from "@/lib/agent-files";
import { AGENTS } from "@/lib/data";
import {
  clean,
  cleanBudget,
  cleanEta,
  cleanList,
  isStaffable,
  MAX_EXPERTS,
  normalizeCharter,
  type Charter,
  type ProjectKind,
  type StaffableArchetype,
} from "@/lib/project";
import { materializeSkills } from "@/lib/skills/compose";
import { formatBytes } from "@/lib/uploads";
import type { Library } from "@/lib/skills/library";
import type { Composition } from "@/lib/skills/types";
import type { Bus } from "@/server/cache/bus";
import { TOPICS } from "@/server/cache/bus";
import { getAgent } from "@/server/directory";
import type { RuntimeDb } from "@/server/runtime/db";
import { threadId } from "@/server/runtime/threads";
import { RUNTIME, VaultConflictError, type Vault } from "@/server/runtime/vault";
import { copyInputs, UploadError } from "@/server/uploads";
import { agentIdFor, isListedName, pickName } from "./names";
import { liveProjects, loadable, MAX_LIVE_PROJECTS, MAX_SKILLS } from "./plan";

/** The plan can't be launched as sent (400). */
export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

export const KICKOFF = "Write the plan and assign first tasks.";
const NONCE = /^[A-Za-z0-9_-]{8,100}$/;
export const isNonce = (v: unknown): v is string => typeof v === "string" && NONCE.test(v);

/** The project a launch with this nonce creates: the same id on every retry. */
export const projectIdFor = (nonce: string) => `p_${createHash("sha256").update(nonce).digest("hex").slice(0, 16)}`;

interface CheckedMember {
  archetype: StaffableArchetype;
  role: string;
  need: string;
  qualifications: string[];
  skills: string[];
  /** A listed name the card showed, if it's still free. */
  name?: string;
  rehire?: string;
}

export interface CheckedPlan {
  charter: Charter;
  kind: ProjectKind;
  members: CheckedMember[];
  budgetUsd: number;
  option?: { label: string; summary: string; etaDays?: number };
  /** Upload ids, at most MAX_INPUTS, no repeats. */
  uploads: string[];
}

/** Upload ids a launch carries into the project. */
const MAX_INPUTS = 20;

const obj =(v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Every field of a plan from the browser, checked against the library and the db. Throws PlanError. */
export function checkPlan(raw: unknown, library: Library, db: RuntimeDb): CheckedPlan {
  const plan = obj(raw);
  const charter = normalizeCharter(plan?.charter);
  if (!plan || !charter) throw new PlanError("The plan needs a charter with a goal.");
  const kind = obj(plan.charter)?.kind;
  if (kind !== "project" && kind !== "solo") throw new PlanError('The charter\'s kind must be "project" or "solo".');
  const roster = Array.isArray(plan.roster) ? plan.roster : [];

  const members: CheckedMember[] = roster.slice(0, 10).map((x, i) => {
    const e = obj(x) ?? {};
    if (!isStaffable(e.archetype)) throw new PlanError(`Role ${i + 1} has an unknown archetype "${String(e.archetype).slice(0, 30)}".`);
    const archetype = e.archetype;
    const composition = obj(e.composition);
    const ids = Array.isArray(composition?.skills) ? composition.skills : [];
    const skills = [...new Set(ids.filter((s): s is string => typeof s === "string"))];
    if (skills.length > MAX_SKILLS) throw new PlanError(`Role ${i + 1} has more than ${MAX_SKILLS} skills.`);
    for (const s of skills) {
      const entry = library.get(s);
      if (!entry || !loadable(entry)) throw new PlanError(`Skill "${s.slice(0, 80)}" isn't in the library or can't be loaded yet.`);
    }
    const role = clean(e.role, 60);
    if (!role) throw new PlanError(`Role ${i + 1} has no role name.`);
    return {
      archetype,
      role,
      need: clean(e.need, 200),
      qualifications: cleanList(e.qualifications, 60),
      skills,
      name: isListedName(archetype, e.name) ? (e.name as string) : undefined,
      rehire: typeof e.rehire === "string" && e.rehire ? e.rehire : undefined,
    };
  });

  if (kind === "solo" && members.length !== 1) throw new PlanError("A solo launch has exactly one expert.");
  if (kind === "project") {
    const experts = members.filter((m) => m.archetype !== "lead").length;
    if (members[0]?.archetype !== "lead" || members.length - experts !== 1) throw new PlanError("A project has one PM, listed first.");
    if (experts < 1 || experts > MAX_EXPERTS) throw new PlanError(`A project launches with 1 to ${MAX_EXPERTS} experts.`);
  }

  const rehired = new Set<string>();
  for (const m of members) {
    if (!m.rehire) continue;
    const a = db.agents.get(m.rehire);
    const free = a && !a.retiredAt && !AGENTS[a.id] && a.archetype === m.archetype && a.status === "idle" && liveProjects(db, a.id).length < MAX_LIVE_PROJECTS;
    if (!free || rehired.has(m.rehire)) throw new PlanError(`${a?.name ?? m.rehire.slice(0, 40)} can't be rehired for ${m.role}.`);
    rehired.add(m.rehire);
  }

  const option = obj(plan.option);
  const uploads = [...new Set(Array.isArray(plan.uploads) ? plan.uploads.filter((u): u is string => typeof u === "string") : [])];
  if (uploads.length > MAX_INPUTS) throw new PlanError(`A launch can carry at most ${MAX_INPUTS} files.`);
  return {
    charter,
    kind,
    members,
    budgetUsd: cleanBudget(plan.budgetUsd),
    option: option ? { label: clean(option.label, 24), summary: clean(option.summary, 140), etaDays: cleanEta(option.etaDays) } : undefined,
    uploads,
  };
}

const bullets = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none given)");

/** charter.md: what the PM reads first, and what the kickoff carries. `inputs`: the owner's files in /project/inputs/. */
export function charterMd(plan: CheckedPlan, team: { agentId: string; name: string }[], inputs: { path: string; bytes: number }[] = []): string {
  const c = plan.charter;
  const o = plan.option;
  const roles = plan.members.map((m, i) => {
    const parts = [`${m.role}: ${team[i].name} (${m.archetype})`];
    if (m.need) parts.push(`Needs to ${m.need.replace(/[.]$/, "")}.`);
    if (m.qualifications.length) parts.push(`Qualifications: ${m.qualifications.join(", ")}.`);
    parts.push(m.skills.length ? `Skills: ${m.skills.join(", ")}.` : "Skills: none yet.");
    return `- ${parts.join(" ")}`;
  });
  return [
    `# ${c.name}`,
    "",
    `Goal: ${c.goal}`,
    c.due ? `Due: ${c.due}` : "Due: not set",
    c.metric ? `Success metric: ${c.metric}` : "Success metric: not set",
    `Budget: $${plan.budgetUsd}`,
    ...(o?.label ? [`Plan: ${o.label}${o.summary ? `, ${o.summary.replace(/[.]$/, "")}` : ""}${o.etaDays ? ` (about ${o.etaDays} days)` : ""}`] : []),
    "",
    "## Scope",
    "",
    "Must:",
    bullets(c.scope.must),
    "",
    "Won't:",
    bullets(c.scope.wont),
    "",
    "## Roles",
    "",
    ...roles,
    "",
    ...(inputs.length
      ? ["## Inputs", "", "The owner's files, in the project folder. Read them before you plan.", "", ...inputs.map((f) => `- ${f.path} (${formatBytes(f.bytes)})`), ""]
      : []),
  ].join("\n");
}

export interface ProvisionDeps {
  db: RuntimeDb;
  library: Library;
  /** The app vault, with the secret scrub and the cache hook (agentVault()). */
  vault: Vault;
  bus: Bus;
}

const composition = (m: CheckedMember, skills = m.skills): Composition => ({
  id: randomUUID(),
  archetype: m.archetype,
  skills,
  role: m.role,
  qualifications: m.qualifications,
  source: "orchestrator",
  createdAt: new Date().toISOString(),
});

/** Launches `raw` once per nonce. Resolves to the project id and whether this call created it. */
export async function provision(raw: unknown, nonce: string, deps: ProvisionDeps): Promise<{ projectId: string; created: boolean }> {
  const { db } = deps;
  const projectId = projectIdFor(nonce);
  // A retry: the first attempt's rows stand; only finish the vault.
  if (db.projects.get(projectId)) {
    await seedVault(projectId, deps);
    return { projectId, created: false };
  }

  const plan = checkPlan(raw, deps.library, db);
  const taken = new Set(db.agents.list().map((a) => a.name.toLowerCase()));
  const team = plan.members.map((m) => {
    if (m.rehire) return { agentId: m.rehire, name: db.agents.get(m.rehire)!.name };
    const name = m.name && !taken.has(m.name.toLowerCase()) ? m.name : pickName(m.archetype, taken);
    taken.add(name.toLowerCase());
    return { agentId: agentIdFor(name), name };
  });
  // Before any row: an upload id that isn't a stored file refuses the launch, and a retry copies again harmlessly.
  const inputs = await copyInputs(plan.uploads, projectId).catch((e) => {
    throw e instanceof UploadError ? new PlanError(e.message) : e;
  });
  const spec = charterMd(plan, team, inputs);
  const lead = team[0].agentId;

  const created = db.tx(() => {
    // Two launches with one nonce at once: the second waits on BEGIN IMMEDIATE, then finds the first's project.
    if (db.projects.get(projectId)) return false;
    plan.members.forEach((m, i) => {
      const { agentId, name } = team[i];
      if (!m.rehire) {
        db.agents.create({ id: agentId, name, archetype: m.archetype, config: { composition: composition(m) } });
        return;
      }
      // A rehire keeps its identity (Q3); its composition gains this role's skills.
      const row = db.agents.get(agentId)!;
      const skills = [...new Set([...(row.config.composition?.skills ?? []), ...m.skills])];
      db.agents.update(agentId, { config: { ...row.config, composition: composition(m, skills) } });
    });
    let channel: string | null = null;
    if (plan.kind === "project") {
      const used = new Set(db.projects.list({ status: "active", kind: "team" }).map((p) => p.channel));
      channel = plan.charter.channel;
      for (let n = 2; used.has(channel); n++) channel = `${plan.charter.channel}-${n}`;
    }
    db.projects.create({
      id: projectId,
      kind: plan.kind === "solo" ? "dm" : "team",
      channel,
      name: plan.charter.name,
      goal: plan.charter.goal,
      successMetric: plan.charter.metric ?? null,
      dueAt: plan.charter.due ?? null,
      status: "active",
      leadAgentId: lead,
      specMd: spec,
      budgetUsd: plan.budgetUsd,
    });
    plan.members.forEach((m, i) => {
      db.members.add({ projectId, agentId: team[i].agentId, role: m.role, qualifications: m.qualifications });
      db.threads.ensure(team[i].agentId, projectId);
    });
    db.inbox.add(threadId(lead, projectId), "assignment", { from: "mira", projectId, charter: spec, budgetUsd: plan.budgetUsd, instruction: KICKOFF });
    return true;
  });
  if (created) deps.bus.emit(TOPICS.org);
  await seedVault(projectId, deps);
  return { projectId, created };
}

/** Writes whatever of the project's files the vault doesn't have yet: one seed commit per agent, then the charter. */
async function seedVault(projectId: string, { db, library, vault }: ProvisionDeps): Promise<void> {
  const project = db.projects.get(projectId)!;
  for (const m of db.members.list(projectId)) {
    const agent = getAgent(m.agentId);
    if (!agent?.composition) continue;
    const home = `agents/${agent.id}`;
    const files: { path: string; content: () => string }[] = [
      { path: `${home}/SOUL.md`, content: () => soulTemplate(agent) },
      { path: `${home}/MEMORY.md`, content: () => memoryTemplate(agent) },
    ];
    for (const [rel, content] of Object.entries(await materializeSkills(agent.composition, library))) {
      files.push({ path: `${home}${rel}`, content: () => content });
    }
    await writeMissing(vault, files, {
      subject: `agent(${agent.id}): seed home files and ${agent.composition.skills.length} skills from the ${agent.archetype} archetype`,
      trailers: { Archetype: agent.archetype, Project: projectId, ...(agent.composition.skills.length && { Skill: agent.composition.skills }) },
    });
  }
  await writeMissing(vault, [{ path: `projects/${projectId}/state/charter.md`, content: () => project.specMd ?? "" }], {
    subject: `state(${projectId}): seed charter.md from the launch card`,
    trailers: { Project: projectId },
  });
}

/** One seed commit of the files that don't exist yet; a file another writer created meanwhile is left alone. */
async function writeMissing(vault: Vault, files: { path: string; content: () => string }[], commit: { subject: string; trailers: Record<string, string | string[]> }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const missing: typeof files = [];
    for (const f of files) if ((await vault.blob(f.path)) === null) missing.push(f);
    if (!missing.length) return;
    try {
      await vault.writeMany({
        files: missing.map((f) => ({ path: f.path, content: f.content(), expectedBlob: null })),
        author: RUNTIME,
        source: "seed",
        ...commit,
      });
      return;
    } catch (e) {
      if (!(e instanceof VaultConflictError) || attempt === 1) throw e;
    }
  }
}
