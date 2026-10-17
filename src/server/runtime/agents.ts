/** One thread per agent × project (research D §1); a DM task is a one-member project. */
export function threadId(agentId: string, projectId: string): string {
  return `a:${agentId}:p:${projectId}`;
}
