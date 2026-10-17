import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createClientCache } from "@/lib/client-cache";
import { transcriptOf, viewMessages, type SavedPage, type SavedRow } from "@/lib/transcript";
import { Conversation } from "./Conversation";

/*
 * A refresh: the page's memory is gone, and what's left is the cache's last snapshot in sessionStorage. A fresh
 * cache over that storage, before the network answers, has to paint Mira's whole DM, in order, images included.
 */
const noop = () => {};
const IMG = `${"c".repeat(64)}.png`;
const T = "a:mira:p:dm";

const rows: SavedRow[] = [
  { id: 1, threadId: T, runId: "r1", role: "owner", author: "owner", text: "Size the US market for Tern", uploads: [], ref: "o1", at: "2026-10-16T15:41:00.000Z" },
  { id: 2, threadId: T, runId: "r1", role: "agent", author: "mira", text: "About **$2.1B**, mostly mid-size fleets.", uploads: [], ref: null, at: "2026-10-16T15:42:00.000Z" },
  { id: 3, threadId: T, runId: null, role: "owner", author: "owner", text: "Does this layout work?", uploads: [IMG], ref: "o3", at: "2026-10-17T09:00:00.000Z" },
  { id: 4, threadId: T, runId: null, role: "agent", author: "mira", text: "The header is crowded; drop the second CTA.", uploads: [], ref: "r3", at: "2026-10-17T09:01:00.000Z" },
];

function refreshedPage() {
  const resource = transcriptOf("dm");
  const stored = new Map([[`agent-teams:cache:${resource.key}`, JSON.stringify({ messages: rows, more: false } satisfies SavedPage)]]);
  const storage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) };
  // The network never answers: whatever shows came from the snapshot.
  const cache = createClientCache({ fetcher: () => new Promise(() => {}), storage });
  const page = cache.snapshot<SavedPage>(resource.key).data;
  const messages = viewMessages(page?.messages ?? [], [], [], [T]);
  return renderToStaticMarkup(
    createElement(Conversation, {
      view: { kind: "dm", agentId: "mira" },
      messages,
      typingAgentId: null,
      status: {},
      doing: {},
      prefill: null,
      reactions: {},
      handlers: { onOrder: noop, onHandOff: noop, onAsk: noop, onCopy: noop },
      onSend: noop,
      onDecide: noop,
      onOpenAgent: noop,
      onOpenTeam: noop,
      onMessageAgent: noop,
      onOpenChannel: noop,
      onLaunchProject: noop,
      onEditProposal: noop,
      onRequestChanges: noop,
    }),
  );
}

describe("Mira's DM after a refresh", () => {
  it("paints every saved message from the cache, in the order it was said", () => {
    const html = refreshedPage();
    const at = ["Size the US market for Tern", "mostly mid-size fleets", "Does this layout work?", "drop the second CTA"].map((s) => html.indexOf(s));
    expect(at.every((i) => i >= 0), `missing one of the messages: ${at}`).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("shows the image the owner attached again", () => {
    expect(refreshedPage()).toContain(`src="/api/uploads/${IMG}"`);
  });
});
