/*
 * What a run looks like from the outside (research D §8): typed events per thread, in-process. The SSE route
 * GET /api/threads/[id]/events relays them; runs aren't tied to the request that started them, so closing the
 * tab doesn't stop work.
 *   token  answer text as it's typed (never reasoning)
 *   now    the one-line "what it's doing" ("Reading brief.md"), from tool starts or a tool's own writer
 *   plan   the todo list after write_todos
 *   tool   a tool call starting, ending or failing
 *   done     the run finished; `text` is its final answer (or, when it stopped to wait on an approval, its text so far)
 *   error    the run failed
 *   approval a gated tool call asked the owner, or the owner decided (approvals.ts); `run` is the run that asked
 * Every event carries its run id.
 */
import type { ApprovalRow } from "./db";

export type TodoStatus = "pending" | "in_progress" | "completed";

export type ThreadEvent =
  | { type: "token"; run: string; text: string }
  | { type: "now"; run: string; text: string }
  | { type: "plan"; run: string; todos: { content: string; status: TodoStatus }[] }
  | { type: "tool"; run: string; phase: "start" | "end" | "error"; id: string; name: string; input?: unknown; output?: string }
  | { type: "done"; run: string; text: string }
  | { type: "error"; run: string; message: string }
  | { type: "approval"; run: string; approval: ApprovalRow };

export type ThreadEventType = ThreadEvent["type"];

type Listener = (event: ThreadEvent) => void;

export class ThreadEvents {
  private readonly subs = new Map<string, Set<Listener>>();

  /** Hear every event on `threadId`. Returns the unsubscribe. */
  subscribe(threadId: string, fn: Listener): () => void {
    const set = this.subs.get(threadId) ?? new Set<Listener>();
    set.add(fn);
    this.subs.set(threadId, set);
    return () => {
      set.delete(fn);
      if (!set.size) this.subs.delete(threadId);
    };
  }

  emit(threadId: string, event: ThreadEvent): void {
    for (const fn of [...(this.subs.get(threadId) ?? [])]) {
      try {
        fn(event);
      } catch (e) {
        // One broken listener mustn't stop the others, or the run.
        console.warn(`A ${threadId} listener failed:`, (e as Error).message);
      }
    }
  }

  listenerCount(threadId: string): number {
    return this.subs.get(threadId)?.size ?? 0;
  }
}

const base = (p: unknown) => {
  const s = typeof p === "string" ? p : "";
  return s.split("/").filter(Boolean).at(-1) ?? s;
};

/** The "now" line for a tool call starting (D §8): a template per tool, never a model call. */
export function nowLine(name: string, input: unknown): string {
  let args: Record<string, unknown> = {};
  if (typeof input === "string") {
    try {
      args = JSON.parse(input) as Record<string, unknown>;
    } catch {
      args = {};
    }
  } else if (input && typeof input === "object") args = input as Record<string, unknown>;
  const file = base(args.file_path ?? args.path);
  switch (name) {
    case "read_file":
      return file ? `Reading ${file}` : "Reading a file";
    case "write_file":
      return file ? `Writing ${file}` : "Writing a file";
    case "edit_file":
      return file ? `Editing ${file}` : "Editing a file";
    case "ls":
      return file ? `Looking in ${file}` : "Looking at the files";
    case "glob":
    case "grep":
      return "Searching the files";
    case "write_todos":
      return "Planning";
    default:
      return `Using ${name.replace(/_/g, " ")}`;
  }
}
