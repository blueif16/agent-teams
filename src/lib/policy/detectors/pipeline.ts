/*
 * Scan orchestration behind `scan()`: the local pack in a worker with a timeout, then optionally TypeSafe.
 */
import { createEngine, type RawSpan, type RuleSpec } from "./engine";
import type { ScanOptions, Span } from "./index";
import { PACK_ALLOW, PACK_RULES } from "./pack";
import { scanHosted, typesafeConfigured, type TypesafeEnv } from "./typesafe";
import { ScanWorkerPool, type WorkerRun } from "./worker";

export const DEFAULT_TIMEOUT_MS = 2000;

/** What a scan found, plus how it went (internal: the public `scan()` returns only `spans`). */
export interface ScanResult {
  spans: Span[];
  /** The local scan hit its timeout; `spans` holds what the rules that finished had found. */
  timedOut: boolean;
  /** The worker failed, so the local scan ran in-process (no timeout protection). */
  inProcess?: boolean;
  error?: string;
  /** The hosted provider was asked but did not answer usably; `spans` are the local ones. */
  degraded?: string;
}

export interface LocalScanOptions {
  timeoutMs?: number;
  /** Test hook: rules appended after the pack (e.g. a deliberately pathological pattern). */
  extraRules?: RuleSpec[];
}

const engine = createEngine();
let pool: ScanWorkerPool | null = null;

export function toSpans(raw: RawSpan[]): Span[] {
  return raw.map(({ start, end, label, detector }) => ({ start, end, label, detector }));
}

/** The fallback: checks the deadline between rules, but cannot stop a rule that is already running. */
function scanInProcess(text: string, timeoutMs: number, extraRules: RuleSpec[] = []): { spans: RawSpan[]; timedOut: boolean } {
  const deadline = performance.now() + timeoutMs;
  const lower = text.toLowerCase();
  const spans: RawSpan[] = [];
  for (const rule of engine.prepare([...PACK_RULES, ...extraRules], PACK_ALLOW)) {
    if (performance.now() > deadline) return { spans, timedOut: true };
    spans.push(...engine.runRule(rule, text, lower));
  }
  return { spans, timedOut: false };
}

export async function scanLocal(text: string, opts: LocalScanOptions = {}): Promise<ScanResult> {
  const timeoutMs = Number.isFinite(opts.timeoutMs) && (opts.timeoutMs ?? 0) > 0 ? (opts.timeoutMs as number) : DEFAULT_TIMEOUT_MS;
  let run: WorkerRun;
  try {
    pool ??= new ScanWorkerPool(PACK_RULES, PACK_ALLOW);
    run = await pool.run(text, timeoutMs, opts.extraRules);
  } catch (e) {
    run = { spans: [], timedOut: false, error: `worker unavailable: ${(e as Error).message}` };
  }
  if (run.error && !run.timedOut) {
    // Reporting nothing would let secrets through: scan here instead.
    const local = scanInProcess(text, timeoutMs, opts.extraRules);
    return { spans: toSpans(engine.finalize(local.spans)), timedOut: local.timedOut, inProcess: true, error: run.error };
  }
  return { spans: toSpans(engine.finalize(run.spans)), timedOut: run.timedOut };
}

export interface DetailedScanOptions extends ScanOptions, LocalScanOptions {
  /** Where TYPESAFE_API_KEY and friends come from (default: process.env). */
  env?: TypesafeEnv;
  /** Test hook: the fetch used for TypeSafe. */
  fetch?: typeof fetch;
  /** Budget for the TypeSafe call (default TYPESAFE_TIMEOUT_MS); timeoutMs bounds the local scan. */
  hostedTimeoutMs?: number;
}

/** The local pack, then (when asked and configured) TypeSafe on the text with every local hit replaced. */
export async function scanDetailed(text: string, opts: DetailedScanOptions = {}): Promise<ScanResult> {
  const local = await scanLocal(text, { timeoutMs: opts.timeoutMs, extraRules: opts.extraRules });
  if (!opts.hosted || !typesafeConfigured(opts.env)) return local;
  const hosted = await scanHosted(text, local.spans, { env: opts.env, fetch: opts.fetch, timeoutMs: opts.hostedTimeoutMs });
  const spans = [...local.spans, ...hosted.spans].sort((a, b) => a.start - b.start || a.end - b.end);
  return { ...local, spans, ...(hosted.degraded ? { degraded: hosted.degraded } : {}) };
}
