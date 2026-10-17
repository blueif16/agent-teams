/*
 * InboxDrain (research D §1): whatever reaches a thread waits in the `inbox` table, and this beforeModel hook hands
 * every waiting item to the model as a user message before its next call: an owner DM sent while the thread is busy,
 * the kickoff of a launched project, a brief from the PM, a report's `<state_delta>` for the PM. The agent answers
 * within one tool round-trip, in the same run, without aborting its work. Appending a user message after a tool
 * result is valid OpenAI ordering; the hook-returns-messages pattern is HITL's.
 *
 * A thread with a `context` (the PM's: its project digest) gets it once more after every batch it is handed, so
 * each wake sees the state as it is now.
 */
import { HumanMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import type { InboxKind, RuntimeDb } from "./db";

/** What a DM carries in the inbox: from the owner, or from another agent (the PM's brief to an expert). */
export interface DmPayload {
  text: string;
  /** Who sent it: "owner", or the sending agent's id. */
  from: string;
}

/** A launched project's kickoff on its lead's thread (setup/provision.ts). */
export interface KickoffPayload {
  from: string;
  projectId: string;
  charter: string;
  budgetUsd: number | null;
  instruction: string;
}

/** A report's state delta on the PM's thread (`text` is the `<state_delta>` line). */
export interface CallbackPayload extends DmPayload {
  taskId: string;
  rev: number;
}

/** The text the model sees for one inbox item. */
export function inboxText(kind: InboxKind, payload: unknown): string {
  const p = (payload && typeof payload === "object" ? payload : {}) as Partial<DmPayload & KickoffPayload>;
  if (kind === "assignment" && typeof p.instruction === "string") return [p.instruction, p.charter?.trim()].filter(Boolean).join("\n\n");
  return typeof p.text === "string" ? p.text : JSON.stringify(payload);
}

/** The inbox items as the user messages the model sees, tagged so the UI can tell a DM from other turns. */
export function inboxMessages(items: { id: number; kind: InboxKind; payload: unknown; append?: string }[]): HumanMessage[] {
  return items.map((i) => {
    const from = (i.payload as { from?: unknown } | null)?.from;
    return new HumanMessage({
      content: [inboxText(i.kind, i.payload), i.append].filter(Boolean).join("\n\n"),
      additional_kwargs: { surface: i.kind, from: typeof from === "string" ? from : "owner", inbox_id: i.id },
    });
  });
}

export interface DrainOptions {
  /** Added after each batch, as one more user message; null or a throw adds nothing. */
  context?: () => Promise<string | null>;
}

/** `currentRun` names the run in progress on `threadId`; items are marked delivered to it. */
export function inboxDrain(db: RuntimeDb, threadId: string, currentRun: () => string | undefined, opts: DrainOptions = {}) {
  return createMiddleware({
    name: "InboxDrain",
    beforeModel: async () => {
      const runId = currentRun();
      if (!runId) return;
      const items = db.inbox.take(threadId, runId);
      if (!items.length) return;
      const context = await opts.context?.().catch((e: unknown) => {
        console.warn(`[runtime] no context for ${threadId}:`, (e as Error).message);
        return null;
      });
      // One message for the batch: of several returned at once only the last reaches the model.
      const [first, ...rest] = inboxMessages(items.map((i, n) => (n === items.length - 1 && context ? { ...i, append: context } : i)));
      if (!rest.length) return { messages: [first] };
      const content = [first, ...rest].map((m) => m.content as string).join("\n\n");
      return { messages: [new HumanMessage({ content, additional_kwargs: { ...first.additional_kwargs, inbox_ids: items.map((i) => i.id) } })] };
    },
  });
}
