import { ARCHETYPES } from "@/lib/policy/schema";
import type { Archetype } from "@/lib/policy/types";
import { createSearchSkills } from "@/lib/skills/search";
import type { SkillHit } from "@/lib/skills/types";
import { skillLibrary } from "@/server/cache";

/*
 * The skill library, searched locally (no network; the web only through find_skill).
 *   GET /api/skills?q=&archetype=&limit=   SkillHit[] best first; archetype boosts its own skills
 *   GET /api/skills                        every scan-clean skill, most starred first (score 0, no why)
 * Skills whose scan found anything are never listed. The library comes from the server cache; an import
 * announces `skills` on GET /api/events.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  const archetype = params.get("archetype") || undefined;
  if (archetype && !ARCHETYPES.includes(archetype as Archetype)) {
    return Response.json({ error: `Unknown archetype "${archetype}".` }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(params.get("limit")) || 20, 1), 200);

  const { index } = await skillLibrary();
  if (!q) {
    const all: SkillHit[] = index.skills
      .filter((s) => s.scan.findings === 0)
      .sort((a, b) => b.source.stars - a.source.stars || a.id.localeCompare(b.id))
      .map((entry) => ({ entry, score: 0, why: "" }));
    return Response.json(all);
  }
  return Response.json(createSearchSkills(index.skills)(q, { archetype: archetype as Archetype | undefined, limit }));
}
