/*
 * Threads: one per agent × project (research D §1); a DM task is a one-member project.
 *
 * No imports, so a plain `node` can load it (agents.ts re-exports threadId for the restart test).
 */

/** `a:{agentId}:p:{projectId}`. */
export function threadId(agentId: string, projectId: string): string {
  return `a:${agentId}:p:${projectId}`;
}

/** The agent and project of a thread id, or null when it isn't one. */
export function parseThreadId(id: string): { agentId: string; projectId: string } | null {
  const m = /^a:([^:]+):p:([^:]+)$/.exec(id);
  return m ? { agentId: m[1], projectId: m[2] } : null;
}
