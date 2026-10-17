/*
 * The durable checkpointer: every agent thread's state, saved after each step
 * so a run survives a restart. Its own SQLite file, separate from the runtime
 * tables (see research D §10). Tests pass a temp path.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

export function openCheckpointer(file = path.join(process.cwd(), ".data", "checkpoints.db")): SqliteSaver {
  mkdirSync(path.dirname(file), { recursive: true });
  return SqliteSaver.fromConnString(file);
}
