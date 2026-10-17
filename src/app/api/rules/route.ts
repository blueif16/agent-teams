import { agentType } from "@/lib/agent-files";
import { AGENTS } from "@/lib/data";
import { dataGuards, permissionsFor, toolsetOf } from "@/lib/policy/capabilities";
import { listDetectors } from "@/lib/policy/detectors";
import { globMatch } from "@/lib/policy/engine";
import { readBackAll } from "@/lib/policy/readback";
import { ARCHETYPES } from "@/lib/policy/schema";
import { policyStore, RuleValidationError } from "@/lib/policy/store";
import { TIERS } from "@/lib/policy/tiers";
import type { Archetype, Rule, RulesResponse, Scope } from "@/lib/policy/types";
import { fileRulesFor, filesFor, type FileZoneView } from "@/lib/policy/zones";

/*
 * The privacy and tool rules (design §6) for the Rules tab. Nothing is enforced from here yet; this is the source of
 * truth the enforcement points will read.
 *   GET  /api/rules?agent=&project=   rules in force with read-backs, tiers, detectors and what the flow rules protect
 *                                     (`data`); with `agent`, what it can do per capability (`permissions`; an agent
 *                                     launched at runtime also needs &archetype=) and its Files section (`files`:
 *                                     one row per zone, zones.ts)
 *   POST /api/rules { rules, mode }   save rules from a compile result, in enforce or shadow mode → 201 { rules }
 */

const isArchetype = (v: string | null): v is Archetype => ARCHETYPES.includes(v as Archetype);

/** Whether a rule's scope can match the agent and project asked about; a param not given matches anything. */
function canApply(scope: Scope, q: { agentId?: string; archetype?: Archetype; projectId?: string }): boolean {
  const ok = (list: string[] | undefined, v: string | undefined) => v === undefined || list === undefined || list.some((p) => globMatch(p, v));
  return ok(scope.agents, q.agentId) && ok(scope.archetypes, q.archetype) && ok(scope.projects, q.projectId);
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const agentId = params.get("agent") || undefined;
  const projectId = params.get("project") || undefined;

  let archetype: Archetype | undefined;
  if (agentId) {
    const known = AGENTS[agentId];
    const given = params.get("archetype");
    archetype = known ? agentType(known) : isArchetype(given) ? given : undefined;
    if (!archetype) return Response.json({ error: `Unknown agent "${agentId}". For an agent launched at runtime, add &archetype=.` }, { status: 404 });
  }

  let all: Rule[];
  try {
    all = await policyStore().list();
  } catch (e) {
    const issues = e instanceof RuleValidationError ? e.issues : [];
    return Response.json({ error: `Couldn't read the rules: ${(e as Error).message}`, issues }, { status: 500 });
  }

  const rules = agentId || projectId ? all.filter((r) => canApply(r.scope, { agentId, archetype, projectId })) : all;
  const now = new Date();
  const body: RulesResponse & { files?: FileZoneView[] } = { rules, readBack: readBackAll(rules), tiers: TIERS, detectors: listDetectors(), data: dataGuards(rules, now) };
  if (agentId && archetype) {
    const agent = { agentId, archetype, projectId: projectId ?? "" };
    // Task deliverables come from the PM's assignments once the runtime passes them; until then, the archetype's scope.
    const deliverables: string[] = [];
    // Relevance comes from the registry by archetype for now; resolveToolset(ArchetypeDef, composition) replaces it.
    body.permissions = permissionsFor(agent, [...all, ...fileRulesFor(agent, all, deliverables, now)], toolsetOf(archetype), now);
    body.files = filesFor(agent, all, deliverables, now);
  }
  return Response.json(body);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { rules?: unknown; mode?: unknown } | null;
  const mode = body?.mode ?? "enforce";
  if (!body || !Array.isArray(body.rules) || !body.rules.length || (mode !== "enforce" && mode !== "shadow")) {
    return Response.json({ error: 'Send { rules: Rule[], mode: "enforce" | "shadow" }.' }, { status: 400 });
  }
  try {
    const rules = await policyStore().save(body.rules as Rule[], { mode });
    return Response.json({ rules }, { status: 201 });
  } catch (e) {
    if (e instanceof RuleValidationError) return Response.json({ error: e.message, issues: e.issues }, { status: 400 });
    throw e;
  }
}
