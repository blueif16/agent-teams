/*
 * Every agent run as the page sees it, from one EventSource on GET /api/runs (every thread's events, each tagged
 * with its thread, opening with a `live` snapshot of the runs in flight). One record per run: the answer typed so
 * far, its "now" line, and how it ended. Views draw streaming replies from it (src/lib/transcript.ts liveReplies),
 * the sidebar and panels draw who's working, and send() follows the run its message started.
 * A page that loads or reconnects mid-run picks the run up from the snapshot, so nothing polls. Client only; on
 * the server the store stays empty.
 */
import { useSyncExternalStore } from "react";

export interface RunState {
  thread: string;
  run: string;
  /** The answer so far; its final text once done. */
  text: string;
  /** What it's doing ("Reading brief.md"). */
  now?: string;
  done?: boolean;
  /** Set when it failed. */
  error?: string;
  /** Its answer's transcript row id. */
  message?: number;
  /** It ended while the stream was down: `text` may be partial, the transcript has the answer. */
  lost?: boolean;
}

export type Runs = Record<string, RunState>;

export type RunEvent = { type: string; thread: string; run: string; text?: string; message?: unknown };

const KEEP = 200;
const settled = (r: RunState) => Boolean(r.done || r.error);

/** One event from GET /api/runs folded into the runs. Returns `runs` itself when nothing changed. */
export function applyRunEvent(runs: Runs, e: RunEvent): Runs {
  const prev = runs[e.run] ?? { thread: e.thread, run: e.run, text: "" };
  let next: RunState;
  switch (e.type) {
    case "live":
      next = { ...prev, text: e.text ?? "" };
      break;
    case "start":
      if (runs[e.run]) return runs;
      next = prev;
      break;
    case "token":
      next = { ...prev, text: prev.text + (e.text ?? "") };
      break;
    case "now":
      next = { ...prev, now: e.text };
      break;
    case "done":
      next = { ...prev, text: e.text || prev.text, done: true, message: typeof e.message === "number" ? e.message : undefined };
      break;
    case "error":
      next = { ...prev, error: typeof e.message === "string" && e.message ? e.message : "The run failed." };
      break;
    default:
      return runs;
  }
  const out = { ...runs, [e.run]: next };
  // Past KEEP, the oldest settled runs go: their answers are in the transcript by then.
  let extra = Object.keys(out).length - KEEP;
  for (const id of Object.keys(out)) {
    if (extra <= 0) break;
    if (settled(out[id])) {
      delete out[id];
      extra--;
    }
  }
  return out;
}

/** Runs still going, oldest first. */
export function inFlight(runs: Runs): RunState[] {
  return Object.values(runs).filter((r) => !settled(r));
}

// ------------------------------------------------------------------------------------------- the store

const EMPTY: Runs = {};
const TYPES = ["live", "start", "token", "now", "done", "error"];
let runs: Runs = EMPTY;
const listeners = new Set<() => void>();
let ready: Promise<void> | undefined;

function set(next: Runs) {
  if (next === runs) return;
  runs = next;
  for (const fn of [...listeners]) fn();
}

/** Opens the stream once; resolves when it's connected, so a message posted after it misses nothing. */
export function connectRuns(): Promise<void> {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return Promise.resolve();
  return (ready ??= new Promise<void>((resolve) => {
    const source = new EventSource("/api/runs");
    let opened = false;
    source.onopen = () => {
      if (opened) {
        // Back after a drop: what's still running comes again in the snapshot; the rest ended meanwhile.
        const next: Runs = { ...runs };
        for (const r of inFlight(runs)) next[r.run] = { ...r, done: true, lost: true };
        set(next);
      }
      opened = true;
      resolve();
    };
    for (const type of TYPES) {
      source.addEventListener(type, (m) => {
        try {
          set(applyRunEvent(runs, JSON.parse((m as MessageEvent<string>).data) as RunEvent));
        } catch {
          // not ours
        }
      });
    }
  }));
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  void connectRuns();
  return () => {
    listeners.delete(fn);
  };
}

/** Every run the page has heard of, by run id. */
export function useRuns(): Runs {
  return useSyncExternalStore(
    subscribe,
    () => runs,
    () => EMPTY,
  );
}

/** Calls `onChange` with the run as it streams; resolves when it's done, rejects when it fails. */
export function followRun(runId: string, onChange?: (r: RunState) => void): Promise<RunState> {
  return new Promise((resolve, reject) => {
    let last: RunState | undefined;
    const check = () => {
      const r = runs[runId];
      if (!r || r === last) return;
      last = r;
      onChange?.(r);
      if (r.done) {
        listeners.delete(check);
        resolve(r);
      } else if (r.error) {
        listeners.delete(check);
        reject(new Error(r.error));
      }
    };
    listeners.add(check);
    check();
  });
}
