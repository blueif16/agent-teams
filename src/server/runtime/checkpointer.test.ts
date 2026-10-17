import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openCheckpointer } from "./checkpointer";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "runtime-checkpointer-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("openCheckpointer", () => {
  it("opens the database at the injected path, creating missing directories", () => {
    const file = path.join(dir, "not", "yet", "there", "checkpoints.db");
    let saver: ReturnType<typeof openCheckpointer> | undefined;
    expect(() => {
      saver = openCheckpointer(file);
    }).not.toThrow();
    expect(existsSync(file)).toBe(true);
    saver?.db.close();
  });

  it("defaults to .data/checkpoints.db under the working directory", () => {
    // A fresh node in a temp cwd, so the default never touches the repo's .data/.
    const entry = fileURLToPath(new URL("./checkpointer.ts", import.meta.url));
    const script = `const { openCheckpointer } = await import(${JSON.stringify(entry)}); openCheckpointer().db.close();`;
    const child = spawnSync(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "-e", script],
      { cwd: dir, encoding: "utf8" },
    );
    expect(existsSync(path.join(dir, ".data", "checkpoints.db")), child.stderr).toBe(true);
  });
});
