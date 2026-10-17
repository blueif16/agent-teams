// Stub: the tests in research.test.ts fail against it; the real tool replaces it.
import { tool } from "langchain";
import { z } from "zod";
import type { ToolEvent } from "../../../lib/ledger";
import type { YouClientOptions } from "./web";

export const RESEARCH_URL = "";

export interface ResearchToolDeps extends YouClientOptions {
  record?: (e: ToolEvent) => Promise<void>;
  pollMs?: number;
}

export function researchApproval(args: Record<string, unknown>): { title: string; detail: string; estUsd: number | null } {
  void args;
  return { title: "", detail: "", estUsd: null };
}

export function researchTool(who: { agentId: string; team: string }, deps: ResearchToolDeps = {}) {
  void who;
  void deps;
  return tool(async () => "", { name: "research_stub", description: "stub", schema: z.object({}).passthrough() });
}
