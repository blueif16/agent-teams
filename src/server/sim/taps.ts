/*
 * The ledger's tap into a test-mode recording. record() in src/lib/ledger.ts calls tapLedger() after each row is
 * written; the recorder (./recorder.ts) sets the sink while a tape records. With no sink it returns at once, so
 * outside a recording nothing is written and the ledger behaves exactly as before.
 *
 * The sink lives on globalThis, like the server cache, so every route's copy of this module sees the same one. It
 * imports nothing at runtime, so the ledger can call it without pulling the recorder in.
 */
import type { LedgerEvent } from "@/lib/ledger";

type Sink = (row: LedgerEvent) => void;
type Global = { __agentTeamsLedgerTap?: Sink };

export function setLedgerTap(sink: Sink | undefined): void {
  (globalThis as Global).__agentTeamsLedgerTap = sink;
}

export function tapLedger(row: LedgerEvent): void {
  const sink = (globalThis as Global).__agentTeamsLedgerTap;
  if (!sink) return;
  try {
    sink(row);
  } catch (e) {
    // A recording problem must never fail the write it was watching.
    console.warn("Couldn't tape a ledger row:", (e as Error).message);
  }
}
