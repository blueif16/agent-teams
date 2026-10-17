/*
 * Where the app keeps its local state: `$DATA_DIR`, else `.data` under the working directory. Every on-disk store
 * (runtime tables, checkpoints, ledger, policy rules, the vault, project files) lives under it, so one variable
 * moves them all (a test, a second checkout, a mounted volume). Read on every call, never cached.
 */
import path from "node:path";

export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), ".data"));
}
