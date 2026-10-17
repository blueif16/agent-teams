import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/types";
import { Conversation } from "./Conversation";

/*
 * The owner's own messages are drawn as their bubbles, whoever they wrote to (owner, 2026-10-17: "not seeing my own
 * message bubbles"). Rendered to static markup, so this checks what the owner sees.
 */
const noop = () => {};
const render = (messages: Message[]) =>
  renderToStaticMarkup(
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

describe("Conversation", () => {
  it("draws the owner's message as a bubble", () => {
    const html = render([{ id: "m1", kind: "text", from: "you", at: "3:41 PM", text: "Size the US market for Tern" }]);
    expect(html).toContain("Size the US market for Tern");
  });
});
