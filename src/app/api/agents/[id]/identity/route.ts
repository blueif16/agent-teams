import { connection } from "next/server";
import { readAgentFiles, writeAgentFile, type AgentFile } from "@/lib/agent-files";
import { getAgent } from "@/server/directory";

/**
 * An agent's SOUL.md and MEMORY.md. GET creates them from templates on first read.
 * Served from the file cache, so connection() keeps it at request time under Cache Components.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/agents/[id]/identity">) {
  await connection();
  const { id } = await ctx.params;
  const agent = getAgent(id);
  if (!agent) return Response.json({ error: `Unknown agent "${id}".` }, { status: 404 });
  return Response.json({ type: agent.archetype, ...(await readAgentFiles(id)) });
}

/** Saves one file: { file: "soul" | "memory", content }. */
export async function PUT(req: Request, ctx: RouteContext<"/api/agents/[id]/identity">) {
  const { id } = await ctx.params;
  if (!getAgent(id)) return Response.json({ error: `Unknown agent "${id}".` }, { status: 404 });
  const { file, content } = (await req.json()) as { file: AgentFile; content: string };
  if ((file !== "soul" && file !== "memory") || typeof content !== "string" || !content.trim()) {
    return Response.json({ error: "Send { file: 'soul' | 'memory', content }" }, { status: 400 });
  }
  return Response.json(await writeAgentFile(id, file, content));
}
