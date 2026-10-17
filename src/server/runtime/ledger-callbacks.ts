/*
 * Every model call of a run → one ledger `call` row of kind "run" with its thread and run (research D §8,
 * §10), the same fields the chat route records: tokens in, cached and out, latency, cost, the model asked vs
 * the one that answered. Summarization and fallback calls are model calls too, so they count.
 */
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import type { LLMResult } from "@langchain/core/outputs";
import { record, type CallEvent } from "@/lib/ledger";
import { costOf } from "@/lib/models";

export interface CallScope {
  thread: string;
  run: string;
  team: string;
  agent: string;
  /** The model the agent runs on; a fallback answering shows as a different `model`. */
  asked: string;
  /** Told about each finished call (the run row counts calls and cost). */
  onCall?: (call: CallEvent) => void;
}

type Usage = { input_tokens?: number; output_tokens?: number; input_token_details?: { cache_read?: number } };

export class LedgerCallbacks extends BaseCallbackHandler {
  name = "LedgerCallbacks";
  private readonly started = new Map<string, { model: string; at: string; t0: number }>();
  /** Rows go to the ledger one after another, so they land in call order. */
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly scope: CallScope) {
    super();
  }

  handleChatModelStart(llm: Serialized, _messages: unknown, runId: string, _parent?: string, extra?: Record<string, unknown>) {
    const model = String((extra?.invocation_params as { model?: string } | undefined)?.model ?? llm.id.at(-1));
    this.started.set(runId, { model, at: new Date().toISOString(), t0: performance.now() });
  }

  handleLLMEnd(output: LLMResult, runId: string) {
    const start = this.take(runId);
    if (!start) return;
    const message = (output.generations[0]?.[0] as { message?: { usage_metadata?: Usage; response_metadata?: { model_name?: string } } } | undefined)?.message;
    const usage = message?.usage_metadata;
    const input = usage?.input_tokens ?? 0;
    const cached = usage?.input_token_details?.cache_read ?? 0;
    const out = usage?.output_tokens ?? 0;
    const model = message?.response_metadata?.model_name || start.model;
    this.write({ model, at: start.at, ms: start.ms, input, cached, output: out, cost: costOf(model, input, cached, out), ok: true });
  }

  handleLLMError(_err: unknown, runId: string) {
    const start = this.take(runId);
    if (!start) return;
    this.write({ model: start.model, at: start.at, ms: start.ms, input: 0, cached: 0, output: 0, cost: 0, ok: false });
  }

  /** Resolves when every row so far is on disk. */
  async flush(): Promise<void> {
    await this.tail;
  }

  private take(runId: string) {
    const s = this.started.get(runId);
    if (!s) return undefined;
    this.started.delete(runId);
    return { ...s, ms: Math.round(performance.now() - s.t0) };
  }

  private write(c: Pick<CallEvent, "model" | "at" | "ms" | "input" | "cached" | "output" | "cost" | "ok">) {
    const { thread, run, team, agent, asked, onCall } = this.scope;
    const event: CallEvent = { t: "call", kind: "run", team, agent, asked, thread, run, ...c };
    onCall?.(event);
    this.tail = this.tail.then(() => record(event)).catch((e) => console.warn("Couldn't record a run call:", (e as Error).message));
  }
}
