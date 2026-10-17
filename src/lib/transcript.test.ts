import { describe, expect, it } from "vitest";
import type { Message } from "./types";
import { liveReplies, mergeTimeline, savedMessages, transcriptOf, type LiveReply, type SavedRow } from "./transcript";

/*
 * The client side of the transcript: saved rows become the messages a view shows, merged with what this page
 * holds only locally (a status line, an option card, a message still on its way) and with replies still streaming.
 */
const IMG = `${"b".repeat(64)}.png`;
let n = 0;
const row = (r: Partial<SavedRow> & Pick<SavedRow, "role" | "text">): SavedRow => ({
  id: ++n,
  threadId: "a:mira:p:dm",
  runId: null,
  author: r.role === "owner" ? "owner" : "mira",
  uploads: [],
  ref: null,
  at: "2026-10-17T15:41:00.000Z",
  ...r,
});
const text = (m: Message) => (m.kind === "text" ? m.text : m.kind);

describe("transcriptOf", () => {
  it("names a project's messages and the topic that announces them", () => {
    expect(transcriptOf("p1")).toEqual({ key: "/api/projects/p1/messages", topic: "messages:project:p1" });
    expect(transcriptOf("p1", 40).key).toBe("/api/projects/p1/messages?before=40");
  });
});

describe("savedMessages", () => {
  it("draws the owner's rows as their bubbles, with images, and each agent's as that agent", () => {
    const msgs = savedMessages([
      row({ role: "owner", text: "Match this", uploads: [IMG] }),
      row({ role: "agent", author: "pat", text: "On it.", threadId: "a:pat:p:p1" }),
    ]);
    expect(msgs).toMatchObject([
      { kind: "text", from: "you", text: "Match this", images: [IMG], saved: true },
      { kind: "text", from: "pat", text: "On it.", saved: true },
    ]);
  });

  it("shows a reply's sentence before its project block, not the block", () => {
    const msgs = savedMessages([row({ role: "agent", text: "Here are two ways to run it.\n\n```project\n{\"name\":\"Tern\"}\n```" })]);
    expect(msgs.map(text)).toEqual(["Here are two ways to run it."]);
  });

  it("ids a row by the sender's ref, else by its run (an answer), else by its row", () => {
    const ids = savedMessages([
      row({ role: "owner", text: "a", ref: "o1", runId: "r9" }),
      row({ role: "agent", text: "b", runId: "r9" }),
      row({ role: "agent", text: "c", ref: "x2" }),
      row({ role: "owner", text: "d", id: 77 }),
    ]).map((m) => m.id);
    expect(ids).toEqual(["o1", "run:r9", "x2", "m:77"]);
  });
});

describe("mergeTimeline", () => {
  const saved = (id: string, t: string): Message => ({ id, kind: "text", from: "you", at: "", text: t, saved: true });
  const local = (id: string, t: string): Message => ({ id, kind: "text", from: "you", at: "", text: t });
  const status = (id: string, t: string): Message => ({ id, kind: "status", at: "", text: t });

  it("puts this page's local messages where they were said among the saved ones", () => {
    const out = mergeTimeline(
      [saved("m:1", "old"), saved("o2", "hi"), saved("run:r2", "hello"), saved("o3", "next")],
      [local("o2", "hi"), status("s1", "You launched #tern"), local("o3", "next"), local("o4", "sending…")],
    );
    // "hello" came from elsewhere (another tab), saved after "hi": it goes there, and the status line after it.
    expect(out.map(text)).toEqual(["old", "hi", "hello", "status", "next", "sending…"]);
  });

  it("keeps the local copy of a message both have, so its state on this page sticks", () => {
    const out = mergeTimeline([saved("o2", "hi")], [local("o2", "hi")]);
    expect(out.map((m) => [m.id, m.saved])).toEqual([["o2", undefined]]);
  });

  it("is the saved messages alone after a refresh", () => {
    expect(mergeTimeline([saved("m:1", "a"), saved("m:2", "b")], []).map(text)).toEqual(["a", "b"]);
  });
});

describe("liveReplies", () => {
  const live = (r: Partial<LiveReply> & Pick<LiveReply, "run">): LiveReply => ({ thread: "a:pat:p:p1", text: "", ...r });

  it("streams a run in flight on one of the view's threads as its agent's reply so far", () => {
    const out = liveReplies([live({ run: "r1", text: "Sizing the" })], ["a:pat:p:p1", "a:rae:p:p1"], new Set());
    expect(out).toMatchObject([{ id: "run:r1", kind: "text", from: "pat", text: "Sizing the", streaming: true }]);
  });

  it("leaves out runs on other threads, runs that haven't said anything, and runs already saved", () => {
    const out = liveReplies(
      [live({ run: "r1", text: "x", thread: "a:mira:p:dm" }), live({ run: "r2" }), live({ run: "r3", text: "y" })],
      ["a:pat:p:p1"],
      new Set(["run:r3"]),
    );
    expect(out).toEqual([]);
  });
});
