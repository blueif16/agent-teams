/*
 * The durable checkpointer: every agent thread's state, saved after each step
 * so a run survives a restart. Its own SQLite file, separate from the runtime
 * tables (see research D §10). Tests pass a temp path.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
// The extension lets a plain `node` load this file (the default-path test runs it in a fresh process).
import { dataDir } from "../paths.ts";

export function openCheckpointer(file = path.join(dataDir(), "checkpoints.db")): SqliteSaver {
  mkdirSync(path.dirname(file), { recursive: true });
  return SqliteSaver.fromConnString(file);
}
