/*
 * The L2 app-event tape (docs/design/test-mode.md §4–5, K "App-event tape and playback"): one NDJSON file per run at
 * <sim dir>/tapes/<tapeId>.jsonl. Line 1 is the header, then one event per line. Every event carries `seq` (total
 * order) and `t` (ms since the tape opened, on the monotonic clock), the only field playback schedules on.
 *
 * Writes go through one in-order queue, so appends never wait on the disk and lines land in seq order.
 */
import { appendFile, mkdir, open, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Scope, TapeBody, TapeEvent, TapeHeader } from "@/lib/sim/types";
import { simDir } from "./dir";

/** What the caller knows when a tape opens: every header field but the ones the writer fills in at close. */
export type TapeHeaderInput = Omit<TapeHeader, "durationMs" | "markers">;

export interface Tape {
  header: TapeHeader;
  events: TapeEvent[];
}

export interface TapeWriter {
  readonly tapeId: string;
  /** Times and numbers the event, queues its line, and returns it. `t` defaults to now and never goes backwards. */
  append(body: TapeBody, scope?: Scope, at?: { t?: number; dur?: number }): TapeEvent;
  /** A chapter for the scrubber: a marker event, also listed in the header at close. */
  marker(label: string): TapeEvent;
  keyframe(state: unknown): TapeEvent;
  /** With a source set, an append writes a keyframe of its state when keyframeEveryMs has passed since the last one. */
  setKeyframeSource(fn: (() => unknown) | undefined): void;
  /** Resolves once every line so far is on disk; rejects with the first write error. */
  flush(): Promise<void>;
  /** Writes durationMs and the markers into line 1. */
  close(): Promise<TapeHeader>;
}

/** A tape id is a file name: letters, digits, "_" and "-" only, so no id can reach outside the tapes folder. */
export const isTapeId = (id: string) => /^[A-Za-z0-9_-]+$/.test(id);

const tapesDir = () => path.join(simDir(), "tapes");

function tapeFile(id: string): string {
  if (!isTapeId(id)) throw new Error(`Not a tape id: ${JSON.stringify(id)}.`);
  return path.join(tapesDir(), `${id}.jsonl`);
}

// Tapes can hold private data (owner messages, agent output): only this user may read them.
const PRIVATE = { dir: 0o700, file: 0o600 };

class TapeFile implements TapeWriter {
  readonly tapeId: string;
  private readonly file: string;
  private readonly t0 = performance.now();
  private seq = 0;
  /** t of the last event: the floor for the next one. */
  private last = 0;
  private readonly markers: TapeHeader["markers"] = [];
  /** t of the last keyframe; the tape opens on the empty state, so the first is due keyframeEveryMs in. */
  private lastKeyframe = 0;
  private keyframeSource?: () => unknown;
  private closing?: Promise<TapeHeader>;
  private pending: string[] = [];
  private queue: Promise<void>;
  private error?: Error;

  constructor(private readonly header: TapeHeader) {
    this.tapeId = header.tapeId;
    this.file = tapeFile(header.tapeId);
    this.queue = this.step(async () => {
      await mkdir(tapesDir(), { recursive: true, mode: PRIVATE.dir });
      // "wx": never truncate a tape that already has this id.
      await writeFile(this.file, `${JSON.stringify(header)}\n`, { flag: "wx", mode: PRIVATE.file });
    });
  }

  append(body: TapeBody, scope: Scope = {}, at: { t?: number; dur?: number } = {}): TapeEvent {
    if (this.closing) throw new Error(`Tape ${this.tapeId} is closed.`);
    const t = (this.last = Math.max(this.last, at.t ?? performance.now() - this.t0));
    const event = { seq: ++this.seq, t, wall: Date.now(), ...(at.dur === undefined ? {} : { dur: at.dur }), ...scope, ...body } as TapeEvent;
    this.write(`${JSON.stringify(event)}\n`);
    if (body.kind === "marker") this.markers.push({ t, label: body.label });
    if (body.kind === "keyframe") this.lastKeyframe = t;
    else if (this.keyframeSource && t - this.lastKeyframe >= this.header.keyframeEveryMs) this.keyframe(this.keyframeSource());
    return event;
  }

  marker(label: string): TapeEvent {
    return this.append({ kind: "marker", label });
  }

  keyframe(state: unknown): TapeEvent {
    return this.append({ kind: "keyframe", state });
  }

  setKeyframeSource(fn: (() => unknown) | undefined): void {
    this.keyframeSource = fn;
  }

  async flush(): Promise<void> {
    await this.queue;
    if (this.error) throw this.error;
  }

  close(): Promise<TapeHeader> {
    return (this.closing ??= this.finish());
  }

  /** Rewrites line 1 through a temp file and a rename, so a crash leaves the old header or the new one, never half. */
  private async finish(): Promise<TapeHeader> {
    await this.flush();
    const header: TapeHeader = { ...this.header, durationMs: this.last, markers: this.markers };
    const text = await readFile(this.file, "utf8");
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(header)}\n${text.slice(text.indexOf("\n") + 1)}`, { mode: PRIVATE.file });
    await rename(tmp, this.file);
    return header;
  }

  /** Lines wait in `pending`; one drain per batch writes them all, after everything queued before it. */
  private write(line: string) {
    if (this.error) return;
    this.pending.push(line);
    if (this.pending.length === 1) this.queue = this.step(() => this.drain());
  }

  private async drain() {
    const chunk = this.pending.join("");
    this.pending = [];
    await appendFile(this.file, chunk);
  }

  /** Runs `fn` after the queue. After the first failure nothing more is written, so a broken tape isn't patched. */
  private step(fn: () => Promise<void>): Promise<void> {
    return (this.queue ?? Promise.resolve()).then(async () => {
      if (this.error) return;
      try {
        await fn();
      } catch (e) {
        this.error = e as Error;
        this.pending = [];
      }
    });
  }
}

export function openTape(header: TapeHeaderInput): TapeWriter {
  return new TapeFile({ ...header, markers: [] });
}

/** The tape `id`, or undefined if there is none. */
export async function readTape(id: string): Promise<Tape | undefined> {
  let text: string;
  try {
    text = await readFile(tapeFile(id), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  const lines = text.split("\n").filter((l) => l.trim());
  // A crash mid-append leaves a partial last line: drop it. A bad line anywhere else means the file is damaged.
  const last = lines.length - 1;
  const parsed = lines.flatMap((line, i) => {
    try {
      return [JSON.parse(line) as TapeHeader | TapeEvent];
    } catch (e) {
      if (i === last && i > 0) return [];
      throw new Error(`Tape ${id} line ${i + 1} isn't JSON: ${(e as Error).message}`);
    }
  });
  const [header, ...events] = parsed;
  return { header: header as TapeHeader, events: events as TapeEvent[] };
}

/** Every tape's header, newest first. Reads only line 1 of each file. */
export async function listTapes(): Promise<TapeHeader[]> {
  let names: string[];
  try {
    names = await readdir(tapesDir());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const headers: TapeHeader[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue; // temp files from close() end in .tmp
    try {
      const header = JSON.parse(await firstLine(path.join(tapesDir(), name))) as TapeHeader;
      if (header.kind === "header") headers.push(header);
    } catch {
      console.warn(`Skipped ${name}: its first line isn't a tape header.`);
    }
  }
  return headers.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

async function firstLine(file: string): Promise<string> {
  const fh = await open(file, "r");
  try {
    const chunks: Buffer[] = [];
    for (let pos = 0; ; ) {
      const buf = Buffer.alloc(64 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      const end = buf.subarray(0, bytesRead).indexOf(0x0a);
      chunks.push(buf.subarray(0, end === -1 ? bytesRead : end));
      if (end !== -1 || bytesRead === 0) break;
      pos += bytesRead;
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await fh.close();
  }
}

export interface PlayOptions {
  /** 1, 2, 4, 8, 16, or Infinity for instant. */
  speed: number;
  /** Start here (ms on the tape). */
  from: number;
  /** Any gap longer than this plays as this long. */
  idleCapMs: number;
  signal: AbortSignal;
  /** Waits `ms`, returning early on abort. Injectable for tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Instant playback still lets the event loop run this often, so I/O and an abort get through. */
const TURN_EVERY = 50;

/**
 * Plays a tape's events in time (rrweb's seek [K]): the last keyframe at or before `from`, then every later event up
 * to `from` with no delay, then the rest, each after `min(gap, idleCapMs) / speed`. Ends when the signal aborts.
 */
export async function* play(events: readonly TapeEvent[], o: PlayOptions): AsyncGenerator<TapeEvent> {
  const sleep = o.sleep ?? wait;
  let start = 0;
  for (let i = 0; i < events.length && events[i].t <= o.from; i++) if (events[i].kind === "keyframe") start = i;
  // Gaps count from `from`, so everything at or before it plays at once (ms <= 0).
  let prev = o.from;
  for (let i = start, n = 0; i < events.length; i++, n++) {
    if (n > 0 && n % TURN_EVERY === 0) await new Promise((resolve) => setImmediate(resolve));
    if (o.signal.aborted) return;
    const e = events[i];
    const ms = Math.min(e.t - prev, o.idleCapMs) / o.speed;
    if (ms > 0) {
      await sleep(ms, o.signal);
      if (o.signal.aborted) return;
    }
    prev = Math.max(prev, e.t);
    yield e;
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}
