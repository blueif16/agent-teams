/*
 * The owner driver's only way into the app (docs/design/test-mode.md §3): a stream of tape events, owner actions,
 * the driver's own decision notes, and a read of the vault files the team wrote (deliverable text is in the vault,
 * not on the tape). Adapters: FakeApp below (tests) and the runtime's threads API (when the agent SDK lands).
 *
 * FakeApp is a scripted world. Each rule answers one kind of owner action with agent events: after the first send
 * to Mira, a proposal card; after the approval, team.created, then messages and artifacts. It writes everything
 * (agent events, the owner's actions, the driver's notes) to one tape, as the real recorder would, so the same
 * run can be scored by the claims afterwards.
 */
import type { OwnerAction, Place, Scope, SimNote, TapeBody, TapeEvent } from "./types";

export interface AppPort {
  events(): AsyncIterable<TapeEvent>;
  act(action: OwnerAction): Promise<void>;
  note(note: SimNote): void;
  /** The text of a vault file at a commit (the latest without one); null if there is no such file. */
  read(path: string, commit?: string): Promise<string | null>;
}

type ArtifactBody = Extract<TapeBody, { kind: "artifact" }>;

/** What a script rule emits: any tape body, a whole message, or an artifact with the file text read() returns. */
export type FakeEmit =
  | (TapeBody & Scope)
  | { kind: "say"; from: string; place: Place; text: string; msgId?: string; error?: string }
  | (ArtifactBody & { text: string });

export interface FakeRule {
  when: (action: OwnerAction) => boolean;
  then: FakeEmit[] | ((action: OwnerAction, app: FakeApp) => FakeEmit[]);
  /** Answer every matching action, not only the first. */
  repeat?: boolean;
}

export class FakeApp implements AppPort {
  /** Everything that happened, in seq order: agent events, owner actions, sim notes. */
  readonly tape: TapeEvent[] = [];
  readonly acted: OwnerAction[] = [];
  readonly notes: SimNote[] = [];
  private readonly files = new Map<string, string>();
  private readonly used = new Set<FakeRule>();
  private queue: TapeEvent[] = [];
  private wake?: () => void;
  private closed = false;
  /** A beat note waiting for the action it explains, so the owner event can name its beat. */
  private beat?: string;
  private msgs = 0;

  constructor(private readonly opts: { clock: () => number; script?: FakeRule[] }) {}

  /** Agent events now, in order. Tests also call this for events no owner action caused. */
  emit(...items: FakeEmit[]): void {
    for (const it of items) {
      if (it.kind === "say") {
        const msgId = it.msgId ?? `m${++this.msgs}`;
        this.push({ kind: "msg.start", msgId, place: it.place, from: it.from });
        this.push({ kind: "msg.end", msgId, text: it.text, ...(it.error ? { error: it.error } : {}) });
      } else if (it.kind === "artifact" && "text" in it) {
        const { text, ...body } = it;
        this.files.set(this.fileKey(body.path, body.commit), text);
        this.files.set(this.fileKey(body.path), text);
        this.push(body);
      } else {
        this.push(it as TapeBody & Scope);
      }
    }
  }

  events(): AsyncIterable<TapeEvent> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<TapeEvent>> => {
          for (;;) {
            const e = this.queue.shift();
            if (e) return { value: e, done: false };
            if (this.closed) return { value: undefined, done: true };
            await new Promise<void>((r) => (this.wake = r));
          }
        },
        return: async (): Promise<IteratorResult<TapeEvent>> => {
          this.close();
          return { value: undefined, done: true };
        },
      }),
    };
  }

  async act(action: OwnerAction): Promise<void> {
    this.acted.push(action);
    this.push({ kind: "owner", action, by: "sim", ...(this.beat ? { beat: this.beat } : {}) });
    this.beat = undefined;
    if (action.kind === "stop") return this.close();
    if (action.kind === "decide") this.push({ kind: "card.decided", cardId: action.cardId, decision: action.decision, by: "sim", ...(action.note ? { note: action.note } : {}) });
    for (const rule of this.opts.script ?? []) {
      if ((!rule.repeat && this.used.has(rule)) || !rule.when(action)) continue;
      this.used.add(rule);
      this.emit(...(typeof rule.then === "function" ? rule.then(action, this) : rule.then));
      break;
    }
  }

  note(note: SimNote): void {
    this.notes.push(note);
    this.push({ kind: "sim", note });
    if (note.what === "beat") this.beat = note.beat;
  }

  async read(path: string, commit?: string): Promise<string | null> {
    return this.files.get(this.fileKey(path, commit)) ?? null;
  }

  /** End the stream, as the app going away would. */
  close(): void {
    this.closed = true;
    this.wake?.();
  }

  private fileKey(path: string, commit?: string): string {
    return commit ? `${path}@${commit}` : path;
  }

  private push(body: TapeBody & Scope): void {
    const e = { seq: this.tape.length, t: this.opts.clock(), ...body } as TapeEvent;
    this.tape.push(e);
    this.queue.push(e);
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }
}

/**
 * A test clock. sleep() resolves on the next macrotask and only then moves time, so every event already queued
 * (all microtask work) is handled before the clock advances: time passes only while the world is quiet.
 */
export function fakeTime(start = 0) {
  let now = start;
  return {
    clock: () => now,
    sleep: (ms: number) =>
      new Promise<void>((r) =>
        setImmediate(() => {
          now += ms;
          r();
        }),
      ),
    advance: (ms: number) => {
      now += ms;
    },
  };
}
