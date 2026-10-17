import { connection } from "next/server";
import { parseRecordingInput, RecordingActiveError, startRecording } from "@/server/sim/recorder";
import { listTapes } from "@/server/sim/tape";

/*
 * Test-mode tapes (docs/design/test-mode.md §4). Only the test-mode server (APP_MODE=test) answers: tapes can hold
 * private data, so anywhere else these routes don't exist.
 *   GET  /api/sim/tapes                  → { tapes: TapeHeader[] }, newest first
 *   POST /api/sim/tapes { header fields } → 201 { tapeId }: starts recording; 409 while another tape records
 * connection() keeps the GET at request time; under Cache Components it would otherwise be prerendered.
 */

export async function GET() {
  await connection();
  if (process.env.APP_MODE !== "test") return new Response(null, { status: 404 });
  return Response.json({ tapes: await listTapes() });
}

export async function POST(req: Request) {
  if (process.env.APP_MODE !== "test") return new Response(null, { status: 404 });
  const parsed = parseRecordingInput(await req.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: "Send the tape header's fields.", issues: parsed.issues }, { status: 400 });
  try {
    return Response.json({ tapeId: await startRecording(parsed.input) }, { status: 201 });
  } catch (e) {
    if (e instanceof RecordingActiveError) return Response.json({ error: e.message, active: e.activeId }, { status: 409 });
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return Response.json({ error: `Tape ${parsed.input.tapeId} already exists.` }, { status: 409 });
    throw e;
  }
}
