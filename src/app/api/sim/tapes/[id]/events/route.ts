import type { TapeBody } from "@/lib/sim/types";
import { activeRecording } from "@/server/sim/recorder";
import { isTapeId } from "@/server/sim/tape";

/*
 * Events from outside the server (the owner driver, a client before the runtime streams) onto the recording tape.
 *   POST /api/sim/tapes/[id]/events { events: (TapeBody & Scope & { dur? })[] } → { appended }
 * The server assigns seq and t (any sent are dropped), so one clock orders everything. 409 unless this tape is the
 * one recording; 404 unless APP_MODE=test.
 */

type Item = Record<string, unknown> & { kind: string };

const isItem = (v: unknown): v is Item => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const { kind, dur } = v as Record<string, unknown>;
  return typeof kind === "string" && kind !== "header" && (dur === undefined || (typeof dur === "number" && dur >= 0));
};

export async function POST(req: Request, ctx: RouteContext<"/api/sim/tapes/[id]/events">) {
  if (process.env.APP_MODE !== "test") return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  if (!isTapeId(id)) return Response.json({ error: "Not a tape id." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { events?: unknown } | null;
  const items = body?.events;
  if (!Array.isArray(items) || !items.every(isItem)) {
    return Response.json({ error: "Send { events: [{ kind, …, run?, agent?, team?, cause?, dur? }] }." }, { status: 400 });
  }
  const rec = activeRecording();
  if (rec?.tapeId !== id) return Response.json({ error: `Tape ${id} isn't recording.` }, { status: 409 });

  for (const item of items) {
    const { seq, t, wall, dur, run, agent, team, cause, ...event } = item;
    void [seq, t, wall];
    const scope = { run, agent, team, cause } as { run?: string; agent?: string; team?: string; cause?: number };
    rec.writer.append(event as TapeBody, scope, { dur: dur as number | undefined });
  }
  await rec.writer.flush();
  return Response.json({ appended: items.length });
}
