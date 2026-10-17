import { AGENTS } from "@/lib/data";
import { agentFilePath, isAgentFileName } from "@/lib/vault/types";
import { VaultConflictError, VaultNotFoundError } from "@/server/runtime/vault";

/** The vault path behind /api/agents/[id]/files/[name], or the 404 to send. */
export function fileOr404(id: string, name: string): string | Response {
  if (!AGENTS[id]) return Response.json({ error: `Unknown agent "${id}".` }, { status: 404 });
  if (!isAgentFileName(name)) return Response.json({ error: `Unknown file "${name}": use soul, memory or notes.` }, { status: 404 });
  return agentFilePath(id, name);
}

/** Maps the vault's own errors to responses; anything else is a real failure and rethrows. */
export function vaultError(e: unknown): Response {
  if (e instanceof VaultNotFoundError) return Response.json({ error: e.message }, { status: 404 });
  if (e instanceof VaultConflictError) return Response.json({ error: e.message }, { status: 409 });
  throw e;
}
