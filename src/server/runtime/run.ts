/*
 * One run on a thread (research D §8, §10 run.ts): the run row's lifecycle around one streamed pass of the
 * agent, bridged to the thread's events, with a ledger row per model call. The queue guarantees nothing else
 * runs on the thread meanwhile. Input is empty: the run's messages arrive through InboxDrain, before its first
 * model call and before each one after.
 */
import { AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import type { RuntimeDb } from "./db";
import { nowLine, type ThreadEvent, type ThreadEvents, type TodoStatus } from "./events";
import { LedgerCallbacks } from "./ledger-callbacks";
import { withLane } from "./limiter";
import type { Worker } from "./worker";

export interface RunContext {
  db: RuntimeDb;
  worker: Worker;
  events: ThreadEvents;
  /** Marks `runId` as the run in progress on the thread (InboxDrain delivers to it); returns the undo. */
  activate(runId: string): () => void;
  /** Tells the app the thread's transcript has a new row. */
  announce?(threadId: string): void;
  /** Ledger fields: the stats team, the agent, and the model it runs on. */
  ledger: { team: string; agent: string; asked: string };
}

const MODES = ["messages", "updates", "tools", "custom"] as const;
const clip = (v: unknown, n = 500) => {
  const s = typeof v === "string" ? v : v && typeof v === "object" && "content" in v ? String((v as { content: unknown }).content) : JSON.stringify(v);
  return (s ?? "").length > n ? `${s.slice(0, n - 1)}…` : (s ?? "");
};

/** One stream chunk → the events it means (D §8 mapping). */
function bridge(mode: string, chunk: unknown, run: string): ThreadEvent[] {
  if (mode === "messages") {
    const [msg] = chunk as [BaseMessage, unknown];
    // Answer text only: reasoning rides in additional_kwargs, tool results are ToolMessages.
    return AIMessageChunk.isInstance(msg) && msg.text ? [{ type: "token", run, text: msg.text }] : [];
  }
  if (mode === "tools") {
    const c = chunk as { event: string; toolCallId?: string; name: string; input?: unknown; output?: unknown; error?: unknown };
    const id = c.toolCallId ?? "";
    if (c.event === "on_tool_start")
      return [
        { type: "now", run, text: nowLine(c.name, c.input) },
        { type: "tool", run, phase: "start", id, name: c.name, input: c.input },
      ];
    if (c.event === "on_tool_end") return [{ type: "tool", run, phase: "end", id, name: c.name, output: clip(c.output) }];
    if (c.event === "on_tool_error") return [{ type: "tool", run, phase: "error", id, name: c.name, output: clip(c.error) }];
    return [];
  }
  if (mode === "custom") {
    const now = (chunk as { now?: unknown } | null)?.now;
    return typeof now === "string" ? [{ type: "now", run, text: now }] : [];
  }
  if (mode === "updates" && chunk && typeof chunk === "object") {
    const out: ThreadEvent[] = [];
    for (const update of Object.values(chunk as Record<string, unknown>)) {
      const todos = (update as { todos?: unknown } | null)?.todos;
      if (Array.isArray(todos)) out.push({ type: "plan", run, todos: todos as { content: string; status: TodoStatus }[] });
    }
    return out;
  }
  return [];
}

export async function executeRun(ctx: RunContext, threadId: string, runId: string): Promise<void> {
  const { db, worker, events } = ctx;
  const run = db.runs.get(runId);
  if (!run) throw new Error(`No run ${runId}`);
  db.runs.start(runId);
  db.threads.setStatus(threadId, "running");
  const deactivate = ctx.activate(runId);
  const ledger = new LedgerCallbacks({ thread: threadId, run: runId, ...ctx.ledger, onCall: (c) => db.runs.addCall(runId, c.cost) });
  const emit = (e: ThreadEvent) => events.emit(threadId, e);
  emit({ type: "start", run: runId });
  try {
    await withLane(run.lane, async () => {
      // runId (the LangSmith root run) is a RunnableConfig field the agent passes through but doesn't type.
      const config = { streamMode: [...MODES], callbacks: [ledger], runId } as { streamMode: (typeof MODES)[number][]; callbacks: [LedgerCallbacks] };
      const stream = await worker.stream({ messages: [] }, config);
      for await (const [mode, chunk] of stream as AsyncIterable<[string, unknown]>) for (const e of bridge(mode, chunk, runId)) emit(e);
    });
    await ledger.flush();
    const state = await worker.graph.getState({ configurable: { thread_id: threadId } });
    const last = (state.values as { messages?: BaseMessage[] }).messages?.at(-1);
    const text = last?.getType() === "ai" ? last.text : "";
    // The answer goes to the transcript now, as said: compaction may rewrite the working context later.
    const saved = text ? db.messages.add({ threadId, runId, role: "agent", author: ctx.ledger.agent, text }) : undefined;
    db.runs.finish(runId, "done");
    db.threads.setStatus(threadId, "idle");
    if (saved) ctx.announce?.(threadId);
    emit({ type: "done", run: runId, text, ...(saved && { message: saved.id }) });
  } catch (e) {
    await ledger.flush();
    const message = (e as Error).message || String(e);
    db.runs.finish(runId, "error", message);
    db.threads.setStatus(threadId, "error");
    emit({ type: "error", run: runId, message });
    throw e;
  } finally {
    deactivate();
  }
}
