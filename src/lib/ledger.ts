/*
 * The performance ledger: one JSON line per model call, paid tool call, order or approval.
 * It is the source of truth for the Performance tabs and for the HR agent;
 * LangSmith keeps the full traces (`trace` links a call to its run).
 * Server only: append-only file at .data/ledger.jsonl (/tmp on Vercel), read
 * once and kept in memory by the server cache (src/server/cache).
 */
import { getServerCache } from "@/server/cache";
import type { OrderKey } from "./orders";

interface Base {
  /** ISO timestamp. */
  at: string;
  team: string;
  agent: string;
}

export interface CallEvent extends Base {
  t: "call";
  /** "reply" is a chat reply; "run" is a model call inside an agent run. */
  kind: "reply" | "run";
  /** The model that answered (or the last one tried, on failure). */
  model: string;
  /** The model the request asked for; differs when a fallback or vision route ran. */
  asked: string;
  /** Prompt tokens, cached included. */
  input: number;
  cached: number;
  output: number;
  ms: number;
  /** USD at Crusoe list prices. */
  cost: number;
  ok: boolean;
  vision?: boolean;
  /** LangSmith run id. */
  trace?: string;
  /** For kind "run": the agent's thread (`a:{agent}:p:{project}`) and the runtime run the call was part of. */
  thread?: string;
  run?: string;
}

export interface OrderEvent extends Base {
  t: "order";
  order: OrderKey;
  /** LangSmith run id of the reply the order reacted to. */
  trace?: string;
}

export interface ApprovalEvent extends Base {
  t: "approval";
  decision: "approved" | "declined";
}

/** One paid tool call by an agent (web search, page fetch), refused ones included. Not a model call. */
export interface ToolEvent extends Base {
  t: "tool";
  /** The tool the agent called, e.g. "web_search". */
  tool: string;
  /** The provider endpoint, e.g. "ydc-index.io/v1/search"; absent when the call was refused before going out. */
  endpoint?: string;
  ms: number;
  /** USD at the provider's list price. */
  cost: number;
  ok: boolean;
  /** Why it failed, in a few words. */
  error?: string;
}

export type LedgerEvent = CallEvent | OrderEvent | ApprovalEvent | ToolEvent;

/** Appends to the file and to memory, and announces the change to stats listeners. */
export async function record(event: LedgerEvent): Promise<void> {
  await getServerCache().ledger.append(event);
}

/** Every event so far, from memory. */
export async function readLedger(): Promise<LedgerEvent[]> {
  return [...(await getServerCache().ledger.events())];
}
