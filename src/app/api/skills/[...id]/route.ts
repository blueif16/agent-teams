import { skillLibrary } from "@/server/cache";

/*
 * One skill for the Skills tab's detail view.
 *   GET /api/skills/<publisher>/<folder>   { entry, skillMd } (skillMd null when listed with a link only)
 * 404 for an unknown skill and for one whose scan found anything. Served from the server cache.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string[] }> }) {
  const id = (await params).id.map(decodeURIComponent).join("/");
  const library = await skillLibrary();
  const entry = library.get(id);
  if (!entry || entry.scan.findings > 0) return Response.json({ error: `Unknown skill "${id}".` }, { status: 404 });
  const skillMd = entry.vendored ? ((await library.readFiles(id))["SKILL.md"] ?? null) : null;
  return Response.json({ entry, skillMd });
}
