import { connection } from "next/server";
import { stopRecording } from "@/server/sim/recorder";
import { isTapeId, readTape } from "@/server/sim/tape";

/*
 * One test-mode tape. 404 unless APP_MODE=test; 400 for an id that isn't a tape id.
 *   GET    /api/sim/tapes/[id] → { header, events }
 *   DELETE /api/sim/tapes/[id] → { header }: stops the recording if it is this one (409 if this tape isn't recording)
 */

export async function GET(_req: Request, ctx: RouteContext<"/api/sim/tapes/[id]">) {
  await connection();
  if (process.env.APP_MODE !== "test") return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  if (!isTapeId(id)) return Response.json({ error: "Not a tape id." }, { status: 400 });
  const tape = await readTape(id);
  if (!tape) return Response.json({ error: `No tape ${id}.` }, { status: 404 });
  return Response.json(tape);
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/sim/tapes/[id]">) {
  if (process.env.APP_MODE !== "test") return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  if (!isTapeId(id)) return Response.json({ error: "Not a tape id." }, { status: 400 });
  const header = await stopRecording(id);
  if (header) return Response.json({ header });
  if (!(await readTape(id))) return Response.json({ error: `No tape ${id}.` }, { status: 404 });
  return Response.json({ error: `Tape ${id} isn't recording.` }, { status: 409 });
}
