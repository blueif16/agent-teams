import { connection } from "next/server";
import { orgPayload } from "@/server/directory";

/*
 * GET /api/org → { teams, dms, agents }: what the runtime db adds to the code constants (Mira and the company stay in
 * src/lib/data.ts; the client merges them back in). Teams are channels; dms are solo experts' projects. The client
 * caches it and refreshes on the `org` topic, which a launch announces. connection() keeps it at request time: the
 * db is read synchronously, which prerendering would otherwise capture.
 */
export async function GET() {
  await connection();
  return Response.json(orgPayload());
}
