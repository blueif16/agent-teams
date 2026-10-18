/*
 * The runtime's approvals on a view (R6, src/server/runtime/approvals.ts): GET /api/approvals?project= through the
 * client cache, refreshed on the `approvals` topic (no polling), drawn as the existing approval cards. Approve and
 * Decline POST /api/approvals/[id], which records the decision and resumes the agent's run.
 */
import { useMemo, useState } from "react";
import { useCached, type Resource } from "@/lib/client-cache";
import type { Message } from "@/lib/types";

type Card = Extract<Message, { kind: "approval" }>;

/** The fields of GET /api/approvals' rows (ApprovalRow) the card shows. */
interface PendingApproval {
  id: string;
  agentId: string;
  title: string;
  detail: string;
  createdAt: string;
}

export const approvalsOf = (project: string): Resource => ({ key: `/api/approvals?project=${encodeURIComponent(project)}`, topic: "approvals" });

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * `project`: the view's runtime project, or null for a view without one (then no cards). Cards the owner decided stay,
 * with their outcome, after they leave the pending list. `decide` answers false for an id that isn't one of them.
 */
export function useApprovals(project: string | null, fallback: string) {
  const { data } = useCached<{ approvals?: PendingApproval[] }>(approvalsOf(project ?? fallback));
  const [decided, setDecided] = useState<Record<string, { project: string; card: Card }>>({});

  const cards = useMemo(() => {
    if (!project) return [];
    const byId = new Map<string, Card>();
    for (const a of data?.approvals ?? [])
      byId.set(a.id, { id: a.id, kind: "approval", at: time(a.createdAt), from: a.agentId, title: a.title, detail: a.detail, state: "pending" });
    for (const [id, d] of Object.entries(decided)) if (d.project === project) byId.set(id, d.card);
    return [...byId.values()];
  }, [project, data, decided]);

  const decide = (id: string, decision: "approved" | "declined"): boolean => {
    const card = cards.find((c) => c.id === id);
    if (!card || !project) return false;
    setDecided((s) => ({ ...s, [id]: { project, card: { ...card, state: decision } } }));
    const undo = () =>
      setDecided((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
    fetch(`/api/approvals/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: decision === "approved" ? "approve" : "decline" }),
    })
      // 409: it was already decided (another tab); the list refresh shows the truth.
      .then((res) => (res.ok || res.status === 409 ? undefined : undo()))
      .catch(undo);
    return true;
  };

  return { cards, decide };
}
