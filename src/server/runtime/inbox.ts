/*
 * InboxDrain (research D §1): an owner DM sent while the thread is busy waits in the `inbox` table, and this
 * beforeModel hook hands every waiting one to the model as a user message before its next call. The agent
 * answers within one tool round-trip, in the same run, without aborting its work. Appending a user message
 * after a tool result is valid OpenAI ordering; the hook-returns-messages pattern is HITL's.
 */
import { HumanMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import { imageParts } from "@/server/uploads";
import type { RuntimeDb } from "./db";

/** What an owner DM carries in the inbox. */
export interface DmPayload {
  /** The owner's text, with an <attachment> block per text document they attached (src/server/uploads.ts). */
  text: string;
  /** Who sent it: "owner" for now. */
  from: string;
  /** Image upload ids, inlined as image parts when the DM is delivered. */
  images?: string[];
  /** Every upload id the owner attached, so a reloaded thread can show them. */
  uploads?: string[];
}

/** The inbox items as the user messages the model sees, tagged so the UI can tell a DM from other turns. */
export async function dmMessages(items: { id: number; payload: DmPayload }[]): Promise<HumanMessage[]> {
  return Promise.all(
    items.map(async (i) => {
      const { text, from, images = [], uploads } = i.payload;
      // An image deleted since it was attached is dropped rather than failing the run.
      const parts = images.length ? await imageParts(images).catch(() => []) : [];
      const content = parts.length ? [...(text ? [{ type: "text" as const, text }] : []), ...parts] : text;
      // OpenAI-style image_url parts, which ChatOpenAI sends as they are; the v1 content types only list standard blocks.
      return new HumanMessage({ content: content as HumanMessage["content"], additional_kwargs: { surface: "dm", from, inbox_id: i.id, ...(uploads?.length && { uploads }) } });
    }),
  );
}

/** `currentRun` names the run in progress on `threadId`; items are marked delivered to it. */
export function inboxDrain(db: RuntimeDb, threadId: string, currentRun: () => string | undefined) {
  return createMiddleware({
    name: "InboxDrain",
    beforeModel: async () => {
      const runId = currentRun();
      if (!runId) return;
      const items = db.inbox.take<DmPayload>(threadId, runId, ["dm"]);
      if (!items.length) return;
      return { messages: await dmMessages(items) };
    },
  });
}
