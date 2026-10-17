import { ARCHETYPES } from "@/lib/skills/archetypes";

/*
 * The archetypes: primitive roles with their Inherent bullets, curated tool ids and qualification words.
 *   GET /api/archetypes   ArchetypeDef[] (no skills: a Composition adds those per role)
 */
export async function GET() {
  return Response.json(ARCHETYPES);
}
