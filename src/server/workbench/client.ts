/*
 * workbenchTools: start one project's workbench, a stdio MCP server whose one tool (bash) runs every command
 * inside srt, and return its tools as LangChain tools for a Deep Agent.
 *
 * The server gets only PATH, HOME, LANG and TMPDIR from this process (plus the MCP SDK's own short default list),
 * so the host's .env.local values never reach it.
 */
import { mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { MAX_TIMEOUT_MS } from "./policy.ts";

export type { BashResult, Violation } from "./policy.ts";

const SERVER = fileURLToPath(new URL("./server.mts", import.meta.url));

export type WorkbenchOptions = {
  projectId: string;
  /** The one directory commands may write (plus a per-run temp dir). Created if missing. */
  workspace: string;
  /** Hosts commands may reach; anything else goes to the ask callback, which denies for now. */
  allowedDomains?: string[];
  /** More paths commands may not read, on top of the built-in secret paths. */
  extraDenyRead?: string[];
};

function serverEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ["PATH", "HOME", "LANG", "TMPDIR"]) {
    const v = process.env[k];
    if (v) env[k] = v;
  }
  return env;
}

export async function workbenchTools({ projectId, workspace, allowedDomains = [], extraDenyRead = [] }: WorkbenchOptions): Promise<{
  tools: StructuredToolInterface[];
  close: () => Promise<void>;
}> {
  mkdirSync(workspace, { recursive: true });
  const args = [
    // The server is TypeScript run by node's type stripping; its warnings would only be noise on our stderr.
    "--disable-warning=ExperimentalWarning",
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    SERVER,
    "--project",
    projectId,
    "--workspace",
    realpathSync(workspace),
    ...allowedDomains.flatMap((d) => ["--allow-domain", d]),
    ...extraDenyRead.flatMap((p) => ["--deny-read", p]),
  ];
  const client = new MultiServerMCPClient({
    mcpServers: { workbench: { transport: "stdio", command: process.execPath, args, env: serverEnv() } },
    prefixToolNameWithServerName: false,
    // The server kills a command at its own timeout; the MCP request must outlive the longest one it allows.
    defaultToolTimeout: MAX_TIMEOUT_MS + 15_000,
    onConnectionError: "throw",
  });
  try {
    return { tools: await client.getTools(), close: () => client.close() };
  } catch (error) {
    await client.close();
    throw error;
  }
}
