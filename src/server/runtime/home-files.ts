/*
 * HomeFiles (research D §2, replacing deepagents' `memory` option): the agent's SOUL.md and MEMORY.md go into
 * the system message on every model call, read through readAgentFiles (the vault, via the server cache: a
 * memory read, not a disk read, unless the file changed). So a 📌, an owner edit or a dream reaches the agent
 * at its next step. The stock option loads them once per thread into checkpointed state and never again
 * (D §0 finding 2).
 *
 * The block goes last in the system message, after the stable identity and tool prompts, so a change to the
 * files only invalidates Crusoe's prefix cache from there on. Put this middleware last in the agent's list:
 * the innermost wrapModelCall appends last.
 */
import { createMiddleware } from "langchain";
import { readAgentFiles } from "@/lib/agent-files";

type ReadHome = (agentId: string) => Promise<{ soul: { content: string }; memory: { content: string } }>;

const RULE = "These are your home files, read-only to you at /home/. Follow SOUL.md; use MEMORY.md as what you've learned. The owner edits them; never try to.";

export function homeBlock(soul: string, memory: string): string {
  return `<soul path="/home/SOUL.md">\n${soul.trimEnd()}\n</soul>\n<memory path="/home/MEMORY.md">\n${memory.trimEnd()}\n</memory>\n${RULE}`;
}

export function homeFiles(agentId: string, read: ReadHome = readAgentFiles) {
  return createMiddleware({
    name: "HomeFiles",
    wrapModelCall: async (request, handler) => {
      const { soul, memory } = await read(agentId);
      return handler({ ...request, systemMessage: request.systemMessage.concat(`\n\n${homeBlock(soul.content, memory.content)}`) });
    },
  });
}
