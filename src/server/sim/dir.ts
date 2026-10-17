/*
 * Where test mode keeps its files (tapes, run summaries, reports): <data dir>/sim. The test company is just another
 * data dir (`npm run dev:test` sets DATA_DIR=.data/test-company), so its tapes, ledger, vault and agents never mix
 * with the live company's. Read per call, so a test can point DATA_DIR elsewhere.
 */
import path from "node:path";
import { dataDir } from "../paths";

export function simDir(): string {
  return path.join(dataDir(), "sim");
}
