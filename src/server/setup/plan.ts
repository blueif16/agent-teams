/*
 * Staffing (setup-flow spec, step 2; design §1 steps 4–5, deterministic for now): every option of Mira's proposal
 * becomes a roster. Per role: compose() an archetype plus library skills with a library-only finder (no web calls in
 * this version, so a need the library doesn't cover is listed as "no skill yet"), a name from the archetype's list,
 * and at most one idle agent of the same archetype to rehire (Q3), with its record from the ledger. Server only.
 */
import { AGENTS } from "@/lib/data";
import type { LedgerEvent } from "@/lib/ledger";
import type { LaunchOptions, OptionPlan, Proposal, ProposalOption, ProposalRole, RehireCandidate, RosterEntry } from "@/lib/project";
import { compose, type ComposeDeps } from "@/lib/skills/compose";
import { LIBRARY_THRESHOLD } from "@/lib/skills/find";
import type { Library } from "@/lib/skills/library";
import { createSearchSkills } from "@/lib/skills/search";
import type { SkillEntry, SkillHit } from "@/lib/skills/types";
import { totals } from "@/lib/stats";
import type { AgentRow, RuntimeDb } from "../runtime/db";
import { pickName } from "./names";

/** The card shows 2–4 skill chips per member (Q4: a few skills, not a pile). */
export const MAX_SKILLS = 4;
/** Q3: at most 2 live projects per agent. */
export const MAX_LIVE_PROJECTS = 2;

export interface PlanDeps {
  library: Library;
  db: RuntimeDb;
  events: LedgerEvent[];
}

/** A skill an agent can load today: copied in, scan clean, and no scripts (they wait for a sandbox, tier T7). */
export const loadable = (e: SkillEntry) => e.vendored && e.scan.findings === 0 && !e.scan.executable;

/**
 * compose()'s finder with the library only: loadable hits over the threshold, else a "web" miss with no
 * candidates, which compose() reports as pending and the card lists as "no skill yet". `seen` records each
 * need's hits so a picked skill can say which need it covers.
 */
export function libraryFinder(library: Library, seen = new Map<string, SkillHit[]>()): ComposeDeps["find"] {
  const search = createSearchSkills(library.index.skills);
  return async (need, { archetype }) => {
    const hits = search(need, { archetype, limit: 5 }).filter((h) => h.score >= LIBRARY_THRESHOLD && loadable(h.entry));
    seen.set(need, hits);
    if (hits.length) return { source: "library", need, hits, costUsd: 0 };
    return { source: "web", need, candidates: [], dropped: [], nearMisses: [], costUsd: 0, latencyMs: 0, warnings: ["Library only: web skill-finding comes later."] };
  };
}

/** Projects the agent is live on now. */
export function liveProjects(db: RuntimeDb, agentId: string): string[] {
  return db.threads
    .byAgent(agentId)
    .map((t) => t.projectId)
    .filter((pid) => db.projects.get(pid)?.status === "active" && db.members.has(pid, agentId));
}

/** "12 calls · 80% accepted", or null when the ledger has nothing on the agent. */
export function trackRecord(events: LedgerEvent[], agentId: string): string | null {
  const t = totals(events.filter((e) => e.agent === agentId));
  if (!t.calls && !t.accepted && !t.rejected) return null;
  const parts = [`${t.calls} call${t.calls === 1 ? "" : "s"}`];
  if (t.acceptRate != null) parts.push(`${Math.round(t.acceptRate * 100)}% accepted`);
  return parts.join(" · ");
}

/** The best idle agent of this archetype not already picked: best acceptance, then most calls, then oldest. */
function rehireCandidate(role: ProposalRole, deps: PlanDeps, picked: Set<string>): RehireCandidate | undefined {
  const pool = deps.db.agents
    .list()
    .filter((a: AgentRow) => !AGENTS[a.id] && a.archetype === role.archetype && a.status === "idle" && !picked.has(a.id))
    .filter((a) => liveProjects(deps.db, a.id).length < MAX_LIVE_PROJECTS)
    .map((a) => ({ a, t: totals(deps.events.filter((e) => e.agent === a.id)) }));
  pool.sort((x, y) => (y.t.acceptRate ?? -1) - (x.t.acceptRate ?? -1) || y.t.calls - x.t.calls);
  const best = pool[0];
  return best && { id: best.a.id, name: best.a.name, record: trackRecord(deps.events, best.a.id) };
}

async function staffRole(role: ProposalRole, deps: PlanDeps, names: Set<string>, picked: Set<string>): Promise<RosterEntry> {
  const seen = new Map<string, SkillHit[]>();
  const { composition, pending } = await compose(
    { archetype: role.archetype, role: role.role, qualifications: role.qualifications },
    { library: deps.library, find: libraryFinder(deps.library, seen), maxSkills: MAX_SKILLS },
  );
  const skills = composition.skills.map((id) => {
    const need = [...seen].find(([, hits]) => hits.some((h) => h.entry.id === id))?.[0] ?? role.role;
    return { id, name: deps.library.get(id)?.name ?? id, why: `Covers "${need}"` };
  });
  const name = pickName(role.archetype, names);
  names.add(name);
  const candidate = rehireCandidate(role, deps, picked);
  if (candidate) picked.add(candidate.id);
  return {
    role: role.role,
    archetype: role.archetype,
    need: role.need,
    qualifications: role.qualifications,
    name,
    composition,
    skills,
    uncovered: pending.map((p) => p.need),
    ...(candidate && { candidate, rehire: candidate.id }),
  };
}

async function staffOption(option: ProposalOption, deps: PlanDeps): Promise<OptionPlan> {
  // New names avoid every agent's name; within an option, two roles never get the same name or candidate.
  const names = new Set(deps.db.agents.list().map((a) => a.name));
  const picked = new Set<string>();
  const roster: RosterEntry[] = [];
  for (const role of option.roles) roster.push(await staffRole(role, deps, names, picked));
  return { label: option.label, summary: option.summary, kind: option.kind, etaDays: option.etaDays, budgetUsd: option.budgetUsd, roster };
}

/** Every option staffed, under the shared charter. Local only: the library and the db, no network. */
export async function planOptions(proposal: Proposal, deps: PlanDeps): Promise<LaunchOptions> {
  const { options, ...charter } = proposal;
  const staffed: OptionPlan[] = [];
  for (const o of options) staffed.push(await staffOption(o, deps));
  return { charter, options: staffed };
}
