/*
 * Test fixture: a throwaway app state. DATA_DIR and the working directory point at fresh temp dirs, and the
 * process-wide singletons (server cache, vault, runtime db, runtime) are dropped before and after, so nothing
 * touches the repo's .data/ and no test sees another's files. Not imported by app code.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { vi } from "vitest";

type Global = {
  __agentTeamsCache?: { close(): void };
  __agentTeamsVault?: unknown;
  __agentTeamsRuntimeDb?: { close(): void };
  __agentTeamsRuntime?: { close(): Promise<void> | void };
};

export interface TempEnv {
  /** DATA_DIR. */
  data: string;
  /** The working directory (no agents/ folder in it, so the vault seeds from templates). */
  cwd: string;
  cleanup(): Promise<void>;
}

async function dropSingletons() {
  const g = globalThis as Global;
  await g.__agentTeamsRuntime?.close();
  delete g.__agentTeamsRuntime;
  g.__agentTeamsRuntimeDb?.close();
  delete g.__agentTeamsRuntimeDb;
  g.__agentTeamsCache?.close();
  delete g.__agentTeamsCache;
  delete g.__agentTeamsVault;
}

export async function tempEnv(): Promise<TempEnv> {
  await dropSingletons();
  const data = await mkdtemp(path.join(tmpdir(), "rt-data-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "rt-cwd-"));
  const spy = vi.spyOn(process, "cwd").mockReturnValue(cwd);
  const saved = {
    DATA_DIR: process.env.DATA_DIR,
    VAULT_DIR: process.env.VAULT_DIR,
    LANGSMITH_TRACING: process.env.LANGSMITH_TRACING,
    CRUSOE_API_KEY: process.env.CRUSOE_API_KEY,
  };
  process.env.DATA_DIR = data;
  delete process.env.VAULT_DIR;
  process.env.LANGSMITH_TRACING = "false";
  // ChatOpenAI wants a key; the fake fetch never sends it anywhere.
  process.env.CRUSOE_API_KEY ||= "test-key";
  return {
    data,
    cwd,
    async cleanup() {
      await dropSingletons();
      spy.mockRestore();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await rm(data, { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    },
  };
}
