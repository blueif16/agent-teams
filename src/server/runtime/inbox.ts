/*
 * InboxDrain (research D §1): an owner DM sent while the thread is busy waits in the `inbox` table, and this
 * beforeModel hook hands every waiting one to the model as a user message before its next call. The agent
 * answers within one tool round-trip, in the same run, without aborting its work. Appending a user message
 * after a tool result is valid OpenAI ordering; the hook-returns-messages pattern is HITL's.
 */
import { HumanMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import type { RuntimeDb } from "./db";

/** What an owner DM carries in the inbox. */
export interface DmPayload {
  text: string;
  /** Who sent it: "owner" for now. */
  from: string;
}

/** The inbox items as the user messages the model sees, tagged so the UI can tell a DM from other turns. */
export function dmMessages(items: { id: number; payload: DmPayload }[]): HumanMessage[] {
  return items.map(
    (i) => new HumanMessage({ content: i.payload.text, additional_kwargs: { surface: "dm", from: i.payload.from, inbox_id: i.id } }),
  );
}

/** `currentRun` names the run in progress on `threadId`; items are marked delivered to it. */
export function inboxDrain(db: RuntimeDb, threadId: string, currentRun: () => string | undefined) {
  return createMiddleware({
    name: "InboxDrain",
    beforeModel: () => {
      const runId = currentRun();
      if (!runId) return;
      const items = db.inbox.take<DmPayload>(threadId, runId, ["dm"]);
      if (!items.length) return;
      return { messages: dmMessages(items) };
    },
  });
}
