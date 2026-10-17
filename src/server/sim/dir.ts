/*
 * Where test mode keeps its files (tapes, and later runs and snapshots): <data dir>/sim. Read per call, so a test or
 * the test-mode server can point DATA_DIR elsewhere. Moves onto dataDir() from src/server/paths.ts when that lands.
 */
import path from "node:path";

export function simDir(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "sim");
}
