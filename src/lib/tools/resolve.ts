/*
 * An agent's toolset, from its archetype (docs/research/H-archetype-toolsets.md §5). Pure: the runtime calls it at
 * hire and on every run, the launch card calls it with includePlanned to show the full design.
 *
 * Order is prompt order: the base set (registry order), the archetype's ids (its order), then the composition's
 * approved extras. Notes depend only on that order, never on the composition's skills or role, so every agent of
 * one archetype gets byte-identical notes and the prompt prefix caches.
 */
import type { ArchetypeDef, Composition } from "../skills/types";
import { getTool, REGISTRY } from "./registry";
import type { ResolvedToolset, ToolDef } from "./types";

/** H §5: a composition adds at most this many tools beyond its archetype's set. */
export const MAX_EXTRA_TOOLS = 3;

const BASE_IDS = REGISTRY.filter((d) => d.archetypes.includes("*")).map((d) => d.id);

export function resolveToolset(
  archetype: ArchetypeDef,
  composition: Composition | undefined,
  opts: { sandbox: boolean; includePlanned?: boolean },
): ResolvedToolset {
  const tools: ToolDef[] = [];
  const dropped: ResolvedToolset["dropped"] = [];
  const seen = new Set<string>();

  const add = (id: string) => {
    const def = getTool(id);
    // Shell stays denied without a sandbox whatever the status; planned tools only on request.
    if (!def) dropped.push({ id, reason: "unknown" });
    else if (def.tier === "T7" && !opts.sandbox) dropped.push({ id, reason: "needs_sandbox" });
    else if (def.status === "planned" && !opts.includePlanned) dropped.push({ id, reason: "planned" });
    else tools.push(def);
  };

  for (const id of [...BASE_IDS, ...archetype.tools]) {
    if (seen.has(id)) continue;
    seen.add(id);
    add(id);
  }

  let extras = 0;
  for (const { id } of composition?.extraTools ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (++extras > MAX_EXTRA_TOOLS) dropped.push({ id, reason: "not_approved" });
    else add(id);
  }

  return { tools, notes: tools.flatMap((d) => (d.note ? [d.note] : [])), dropped };
}
