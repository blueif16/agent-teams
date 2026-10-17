/*
 * The performance ledger: one JSON line per model call, order or approval.
 * It is the source of truth for the Performance tabs and for the HR agent;
 * LangSmith keeps the full traces (`trace` links a call to its run).
 * Server only: append-only file at .data/ledger.jsonl. On Vercel the disk is
 * read-only except /tmp, so it lives there and lasts only as long as the instance.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OrderKey } from "./orders";

const DIR = process.env.VERCEL ? path.join(tmpdir(), "agent-teams") : path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "ledger.jsonl");

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

export type LedgerEvent = CallEvent | OrderEvent | ApprovalEvent;

export async function record(event: LedgerEvent): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await appendFile(FILE, `${JSON.stringify(event)}\n`);
}

export async function readLedger(): Promise<LedgerEvent[]> {
  let text: string;
  try {
    text = await readFile(FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerEvent);
}
