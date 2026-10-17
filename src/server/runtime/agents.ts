/*
 * One persistent Deep Agent per worker × project (DECISIONS.md, research D §1):
 * its own thread on the durable checkpointer, so a run, or a DM to the agent
 * doing the work, picks up the same conversation after a restart.
 *
 * Value imports stay relative (no `@/`) so a plain `node` can load this file;
 * the restart test runs it in fresh processes.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";
// The extension lets a plain `node` resolve it (the restart test); TS allows it (allowImportingTsExtensions).
import { threadId } from "./threads.ts";

export { threadId };

export type AgentSpec = {
  agentId: string;
  projectId: string;
  systemPrompt: string;
  model: BaseChatModel;
  checkpointer: BaseCheckpointSaver;
};

/** The agent, bound to its thread: `invoke`/`stream` without a thread id use `threadId(agentId, projectId)`. */
export function buildAgent({ agentId, projectId, systemPrompt, model, checkpointer }: AgentSpec) {
  const agent = createDeepAgent({ name: agentId, model, systemPrompt, checkpointer });
  // createDeepAgent's own result is a ReactAgent made by withConfig, so this keeps its type.
  return agent.withConfig({ configurable: { thread_id: threadId(agentId, projectId) } }) as typeof agent;
}
