/*
 * When an agent compacts its context, derived from its model instead of fixed numbers (owner, 2026-10-17).
 *
 * What binds is Crusoe's per-model tokens-per-minute budget, not the context window: every agent on a model shares
 * one TPM bucket, so a long context spends the company's minute (docs/research/F-orchestrator-memory.md §4.2). A
 * role's triggers are a share of that budget per call; the model's window only caps them, so a small-window model
 * still compacts before it overflows. On V4.1 Flash at 500K TPM this gives the design's 64K/96K (lead), 48K/80K
 * (Mira) and 96K/128K (workers).
 */
import { MODELS } from "./models";

/** Context windows in tokens, from Crusoe's model table (crusoe/…-skill.md). Only the models we run. */
export const CONTEXT_WINDOW: Partial<Record<string, number>> = {
  [MODELS.main]: 1_048_576,
  [MODELS.cheap]: 1_048_576,
  [MODELS.advisor]: 1_048_576,
};

/** Crusoe's TPM per model with no payment method on file; 2,000,000 once one is added. */
export const DEFAULT_TPM = 500_000;

export type ContextRole = "lead" | "chief" | "worker";

/** Share of the model's minute budget one call may use at the soft and hard trigger. */
const SHARE: Record<ContextRole, { soft: number; hard: number }> = {
  // The PM coordinates and calls often, so its context stays small.
  lead: { soft: 0.128, hard: 0.192 },
  // Mira's context is mostly owner chat plus project deltas.
  chief: { soft: 0.096, hard: 0.16 },
  // Workers carry tool output and call less often.
  worker: { soft: 0.192, hard: 0.256 },
};

export interface Triggers {
  /** Compact after the turn, while the agent is idle. */
  soft: number;
  /** Compact before the next model call. */
  hard: number;
  /** The model's window, when known. */
  window?: number;
}

export function compactionTriggers(role: ContextRole, opts: { model?: string; window?: number; tpm?: number }): Triggers {
  const tpm = opts.tpm ?? DEFAULT_TPM;
  const window = opts.window ?? (opts.model ? CONTEXT_WINDOW[opts.model] : undefined);
  const k = (n: number) => Math.round(n / 1000) * 1000;
  let soft = k(tpm * SHARE[role].soft);
  let hard = k(tpm * SHARE[role].hard);
  if (window) {
    soft = Math.min(soft, Math.floor(window / 2));
    hard = Math.min(hard, Math.floor((window * 3) / 4));
  }
  return { soft, hard, window };
}

/** For the context bar: how full the context is, as a share of the hard trigger, and where it compacts. No raw numbers. */
export function contextFill(tokens: number, t: Triggers): { used: number; compactsAt: number } {
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return { used: clamp(tokens / t.hard), compactsAt: clamp(t.soft / t.hard) };
}
