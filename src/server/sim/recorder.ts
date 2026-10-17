/*
 * The test-mode recorder (docs/design/test-mode.md §4): at most one tape records per process. While it does, every
 * ledger row (through tapLedger in ./taps.ts) and every bus change under the TOPICS roots lands on it, and the driver
 * appends the rest through the active writer (POST /api/sim/tapes/[id]/events). With nothing recording, no tap is
 * set and nothing is written.
 *
 * The recording lives on globalThis, like the server cache, so every route's copy of this module sees the same one.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TapeHeader } from "@/lib/sim/types";
import { getServerCache } from "@/server/cache";
import { TOPICS } from "@/server/cache/bus";
import { isTapeId, openTape, type TapeWriter } from "./tape";
import { setLedgerTap } from "./taps";

export class RecordingActiveError extends Error {
  constructor(readonly activeId: string) {
    super(`Tape ${activeId} is recording; stop it first.`);
    this.name = "RecordingActiveError";
  }
}

/** What the caller gives: the header fields only it knows. The recorder sets the rest and mints a tapeId if none. */
export type RecordingInput = Omit<TapeHeader, "kind" | "v" | "clock" | "tapeId" | "recordedAt" | "durationMs" | "markers"> & {
  tapeId?: string;
};

const RecordingInputSchema = z.object({
  tapeId: z.string().refine(isTapeId, "use letters, digits, _ and - only").optional(),
  runId: z.string().min(1),
  scenarioId: z.string().min(1),
  family: z.string().min(1),
  trial: z.number().int().min(1),
  arm: z.enum(["team", "solo"]),
  title: z.string(),
  idleCapMs: z.number().positive(),
  keyframeEveryMs: z.number().positive(),
  app: z.object({ commit: z.string(), promptHash: z.string().optional() }),
  company: z.object({ dir: z.string(), vaultCommit: z.string(), ledgerRows: z.number().int().min(0) }),
  cassette: z.string().optional(),
}) satisfies z.ZodType<RecordingInput>;

/** Checks a request body; unknown fields (durationMs, markers, …) are dropped. */
export function parseRecordingInput(body: unknown): { ok: true; input: RecordingInput } | { ok: false; issues: string[] } {
  const parsed = RecordingInputSchema.safeParse(body);
  if (parsed.success) return { ok: true, input: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
}

interface Recording {
  tapeId: string;
  writer: TapeWriter;
  untap: () => void;
}

type Global = { __agentTeamsRecording?: Recording };
const slot = () => globalThis as Global;

/** The roots of the bus's topic tree ("stats", "files", …), read from TOPICS so a family added there is taped too. */
const busRoots = () => [...new Set(Object.values(TOPICS).map((t) => (typeof t === "function" ? t("_") : t).split(":")[0]))];

/** Opens a tape and starts tapping the ledger and the bus into it. Rejects while another tape records. */
export async function startRecording(input: RecordingInput): Promise<string> {
  const active = slot().__agentTeamsRecording;
  if (active) throw new RecordingActiveError(active.tapeId);
  const { tapeId = randomUUID(), ...rest } = input;
  // Claimed before the first await, so a racing start is refused.
  const writer = openTape({ kind: "header", v: 1, tapeId, ...rest, recordedAt: new Date().toISOString(), clock: "monotonic" });
  const offBus = getServerCache().bus.subscribe(busRoots(), (c) => writer.append({ kind: "bus", topic: c.topic, version: c.version }));
  setLedgerTap((row) => writer.append({ kind: "ledger", row }));
  const rec: Recording = {
    tapeId,
    writer,
    untap: () => {
      offBus();
      setLedgerTap(undefined);
    },
  };
  slot().__agentTeamsRecording = rec;
  try {
    await writer.flush(); // the header is on disk, or the id was taken
  } catch (e) {
    if (slot().__agentTeamsRecording === rec) slot().__agentTeamsRecording = undefined;
    rec.untap();
    throw e;
  }
  return tapeId;
}

export function activeRecording(): { tapeId: string; writer: TapeWriter } | undefined {
  const rec = slot().__agentTeamsRecording;
  return rec && { tapeId: rec.tapeId, writer: rec.writer };
}

/** Stops the taps and closes the tape, returning its final header; undefined if `id` isn't the one recording. */
export async function stopRecording(id: string): Promise<TapeHeader | undefined> {
  const rec = slot().__agentTeamsRecording;
  if (!rec || rec.tapeId !== id) return undefined;
  slot().__agentTeamsRecording = undefined;
  rec.untap();
  return rec.writer.close();
}
