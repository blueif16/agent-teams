import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callEvent, nextChange } from "./cache/testing";

/*
 * DATA_DIR moves every on-disk store. The working directory is a second temp dir, so a store that still
 * builds its path from process.cwd() lands there and fails the test instead of touching the repo's .data/.
 */
type Global = { __agentTeamsCache?: { close(): void }; __agentTeamsVault?: unknown };

let data: string;
let cwdDir: string;
let cwd: { mockRestore(): void };
const saved = { DATA_DIR: process.env.DATA_DIR, VAULT_DIR: process.env.VAULT_DIR, POLICY_DIR: process.env.POLICY_DIR };

const reset = () => {
  (globalThis as Global).__agentTeamsCache?.close();
  delete (globalThis as Global).__agentTeamsCache;
  delete (globalThis as Global).__agentTeamsVault;
};

beforeEach(async () => {
  data = await mkdtemp(path.join(tmpdir(), "paths-data-"));
  cwdDir = await mkdtemp(path.join(tmpdir(), "paths-cwd-"));
  cwd = vi.spyOn(process, "cwd").mockReturnValue(cwdDir);
  process.env.DATA_DIR = data;
  delete process.env.VAULT_DIR;
  delete process.env.POLICY_DIR;
  vi.resetModules();
  reset();
});

afterEach(async () => {
  reset();
  cwd.mockRestore();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(data, { recursive: true, force: true });
  await rm(cwdDir, { recursive: true, force: true });
});

describe("dataDir", () => {
  it("is $DATA_DIR when set, else .data under the working directory", async () => {
    const { dataDir } = await import("./paths");
    expect(dataDir()).toBe(data);
    delete process.env.DATA_DIR;
    expect(dataDir()).toBe(path.join(cwdDir, ".data"));
  });
});

describe("DATA_DIR moves", () => {
  it("the checkpointer", async () => {
    const { openCheckpointer } = await import("./runtime/checkpointer");
    openCheckpointer().db.close();
    expect(existsSync(path.join(data, "checkpoints.db"))).toBe(true);
    expect(existsSync(path.join(cwdDir, ".data"))).toBe(false);
  });

  it("the ledger", async () => {
    const { record } = await import("@/lib/ledger");
    await record(callEvent());
    expect(existsSync(path.join(data, "ledger.jsonl"))).toBe(true);
    expect(existsSync(path.join(cwdDir, ".data"))).toBe(false);
  });

  it("the policy store", async () => {
    // policyStore() with no dir reads and writes rules.json here.
    const { defaultPolicyDir } = await import("@/lib/policy/store");
    expect(defaultPolicyDir()).toBe(path.join(data, "policy"));
  });

  it("the vault and the server cache's agent files", async () => {
    const { getVault } = await import("./runtime/vault");
    const { readAgentFiles } = await import("@/lib/agent-files");
    const { getServerCache } = await import("./cache");
    expect(getVault().dir).toBe(path.join(data, "vault"));

    const soul = path.join(data, "vault", "agents", "mira", "SOUL.md");
    await readAgentFiles("mira");
    expect(existsSync(soul)).toBe(true);

    // The cache watches the vault under DATA_DIR: an outside edit there is announced.
    await new Promise((r) => setTimeout(r, 300));
    const changed = nextChange(getServerCache().bus, "files:agent:mira", 5000);
    await writeFile(soul, "# Mira's soul\n\nEdited outside the app.\n");
    await changed;
    expect(existsSync(path.join(cwdDir, ".data"))).toBe(false);
  });

  it("the runtime database", async () => {
    const { openRuntimeDb } = await import("./runtime/db");
    openRuntimeDb().close();
    expect(existsSync(path.join(data, "runtime.db"))).toBe(true);
  });
});
