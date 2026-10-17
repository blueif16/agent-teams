/*
 * The tape writer and reader against a temp DATA_DIR, and playback against a fake sleep that records what it was
 * asked to wait. The monotonic clock is performance.now, stubbed where a test needs exact times.
 */
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TapeEvent } from "@/lib/sim/types";
import { simDir } from "./dir";
import { listTapes, openTape, play, readTape } from "./tape";
import { headerInput } from "./testing";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "tape-"));
  vi.stubEnv("DATA_DIR", root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

/** Makes performance.now return each value in turn (the last one repeats). */
function clock(...values: number[]) {
  let i = 0;
  vi.spyOn(performance, "now").mockImplementation(() => values[Math.min(i++, values.length - 1)]);
}

const tapeFile = (id: string) => path.join(simDir(), "tapes", `${id}.jsonl`);

describe("the tape writer", () => {
  it("numbers events from 1, times them from the open, and they read back in order", async () => {
    clock(1000, 1250, 1600, 1600);
    const tape = openTape(headerInput());
    const a = tape.append({ kind: "marker", label: "a" });
    const b = tape.append({ kind: "msg.delta", msgId: "m1", text: "Hi" }, { agent: "mira" });
    const c = tape.append({ kind: "msg.delta", msgId: "m1", text: " there" }, { agent: "mira" }, { dur: 40 });
    await tape.close();

    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    expect([a.t, b.t, c.t]).toEqual([250, 600, 600]);
    const read = await readTape("tape-1");
    expect(read?.events).toEqual([a, b, c]);
    expect(read?.events[2]).toMatchObject({ agent: "mira", text: " there", dur: 40 });
  });

  it("never lets t go backwards, whether it comes from the clock or the caller", async () => {
    clock(0, 300);
    const tape = openTape(headerInput());
    const ts = [
      tape.append({ kind: "marker", label: "given 500" }, {}, { t: 500 }).t,
      tape.append({ kind: "marker", label: "clock says 300" }).t,
      tape.append({ kind: "marker", label: "given 200" }, {}, { t: 200 }).t,
      tape.append({ kind: "marker", label: "given 900" }, {}, { t: 900 }).t,
    ];
    await tape.close();
    expect(ts).toEqual([500, 500, 500, 900]);
  });

  it("writes durationMs (the last event's t) and the markers into line 1 at close, keeping the events", async () => {
    clock(0, 100, 250, 700, 900);
    const tape = openTape(headerInput());
    tape.marker("kickoff");
    tape.append({ kind: "agent.status", agentId: "mira", status: "working" });
    tape.marker("review");
    tape.append({ kind: "agent.status", agentId: "mira", status: "idle" });
    await tape.close();

    const [line1, ...rest] = (await readFile(tapeFile("tape-1"), "utf8")).trimEnd().split("\n");
    const header = JSON.parse(line1);
    expect(header.durationMs).toBe(900);
    expect(header.markers).toEqual([
      { t: 100, label: "kickoff" },
      { t: 700, label: "review" },
    ]);
    expect(rest.map((l) => JSON.parse(l).seq)).toEqual([1, 2, 3, 4]);
  });

  it("writes a keyframe from the source on append once keyframeEveryMs has passed since the last keyframe", async () => {
    const tape = openTape(headerInput({ keyframeEveryMs: 1000 }));
    let folded = 0;
    tape.setKeyframeSource(() => ({ folded }));
    for (const t of [0, 400, 999, 1000, 1500, 1999, 2100]) {
      folded++;
      tape.append({ kind: "agent.status", agentId: "mira", status: "working" }, {}, { t });
    }
    await tape.close();

    const keyframes = (await readTape("tape-1"))!.events.filter((e) => e.kind === "keyframe");
    expect(keyframes.map((k) => [k.t, k.kind === "keyframe" && k.state])).toEqual([
      [1000, { folded: 4 }],
      [2100, { folded: 7 }],
    ]);
  });

  it("counts an explicit keyframe as the last one", async () => {
    clock(0);
    const tape = openTape(headerInput({ keyframeEveryMs: 1000 }));
    tape.setKeyframeSource(() => "from source");
    tape.keyframe("explicit");
    tape.append({ kind: "marker", label: "x" }, {}, { t: 900 });
    tape.append({ kind: "marker", label: "y" }, {}, { t: 1000 });
    await tape.close();

    const states = (await readTape("tape-1"))!.events.flatMap((e) => (e.kind === "keyframe" ? [[e.t, e.state]] : []));
    expect(states).toEqual([
      [0, "explicit"],
      [1000, "from source"],
    ]);
  });
});

describe("tape ids", () => {
  it("refuses an id that could reach outside the tapes folder", async () => {
    await mkdir(simDir(), { recursive: true });
    await writeFile(path.join(simDir(), "secret.jsonl"), `${JSON.stringify({ ...headerInput(), markers: [] })}\n`);
    await expect(readTape("../secret")).rejects.toThrow(/tape id/i);
    expect(() => openTape(headerInput({ tapeId: "../secret" }))).toThrow(/tape id/i);
  });

  it("won't open a second tape over an existing one", async () => {
    const first = openTape(headerInput());
    first.marker("kept");
    await first.close();
    const before = await readFile(tapeFile("tape-1"), "utf8");

    const second = openTape(headerInput());
    second.marker("must not land");
    await expect(second.flush()).rejects.toThrow();
    expect(await readFile(tapeFile("tape-1"), "utf8")).toBe(before);
  });
});

describe("readTape", () => {
  it("drops a last line cut off mid-write and keeps the rest", async () => {
    const tape = openTape(headerInput());
    const kept = [tape.marker("one"), tape.marker("two")];
    await tape.close();
    await appendFile(tapeFile("tape-1"), '{"seq":3,"t":12,"kind":"msg.del');

    const read = await readTape("tape-1");
    expect(read?.header.tapeId).toBe("tape-1");
    expect(read?.events).toEqual(kept);
  });
});

describe("listTapes", () => {
  it("returns the headers newest first", async () => {
    for (const [tapeId, recordedAt] of [
      ["middle", "2026-10-17T10:00:00.000Z"],
      ["newest", "2026-10-17T11:30:00.000Z"],
      ["oldest", "2026-10-16T09:00:00.000Z"],
    ]) {
      await openTape(headerInput({ tapeId, recordedAt })).close();
    }
    expect((await listTapes()).map((h) => h.tapeId)).toEqual(["newest", "middle", "oldest"]);
  });

  it("is empty before anything was recorded", async () => {
    expect(await listTapes()).toEqual([]);
  });
});

/** An event at `t`; a keyframe when `keyframe` is given. */
const ev = (seq: number, t: number, keyframe?: string): TapeEvent =>
  keyframe === undefined ? { seq, t, kind: "msg.delta", msgId: "m1", text: `#${seq}` } : { seq, t, kind: "keyframe", state: keyframe };

/** Plays `events` with a fake sleep; returns what happened in order: "#<seq>" per event, "wait <ms>" per sleep. */
async function playLog(events: TapeEvent[], o: { speed: number; from?: number; idleCapMs: number }) {
  const log: string[] = [];
  const sleep = async (ms: number) => void log.push(`wait ${ms}`);
  for await (const e of play(events, { ...o, from: o.from ?? 0, signal: new AbortController().signal, sleep })) log.push(`#${e.seq}`);
  return log;
}

describe("play", () => {
  it("at speed 4 waits a quarter of each recorded gap before the event", async () => {
    const events = [ev(1, 0), ev(2, 400), ev(3, 1200), ev(4, 1200), ev(5, 1300)];
    expect(await playLog(events, { speed: 4, idleCapMs: 60_000 })).toEqual(["#1", "wait 100", "#2", "wait 200", "#3", "#4", "wait 25", "#5"]);
  });

  it("shrinks a gap longer than idleCapMs to idleCapMs", async () => {
    const events = [ev(1, 0), ev(2, 30_000), ev(3, 30_500)];
    expect(await playLog(events, { speed: 2, idleCapMs: 2000 })).toEqual(["#1", "wait 1000", "#2", "wait 250", "#3"]);
  });

  it("from a time, starts at the last keyframe at or before it, flushes up to it with no waits, then waits normally", async () => {
    const events = [
      ev(1, 0),
      ev(2, 500, "early"),
      ev(3, 800),
      ev(4, 3000, "late"),
      ev(5, 3200),
      ev(6, 4000),
      ev(7, 4600),
      ev(8, 5000, "after"),
      ev(9, 5100),
    ];
    expect(await playLog(events, { speed: 2, from: 4000, idleCapMs: 60_000 })).toEqual([
      "#4",
      "#5",
      "#6",
      "wait 300",
      "#7",
      "wait 200",
      "#8",
      "wait 50",
      "#9",
    ]);
  });

  it("from a time before any keyframe, flushes from the first event", async () => {
    const events = [ev(1, 0), ev(2, 700), ev(3, 1000, "kf"), ev(4, 1500)];
    expect(await playLog(events, { speed: 1, from: 800, idleCapMs: 60_000 })).toEqual(["#1", "#2", "wait 200", "#3", "wait 500", "#4"]);
  });

  it("at speed Infinity never sleeps, and lets the event loop run every 50 events", async () => {
    const events = Array.from({ length: 120 }, (_, i) => ev(i + 1, i * 1000));
    let loopRan = false;
    setImmediate(() => (loopRan = true));
    const seen: boolean[] = [];
    const sleep = vi.fn(async () => {});
    for await (const e of play(events, { speed: Infinity, from: 0, idleCapMs: 2000, signal: new AbortController().signal, sleep })) {
      void e;
      seen.push(loopRan);
    }
    expect(sleep).not.toHaveBeenCalled();
    expect(seen).toHaveLength(120);
    expect(seen.slice(0, 50).every((ran) => !ran)).toBe(true);
    expect(seen[50]).toBe(true);
  });

  it("stops when the signal aborts", async () => {
    const stop = new AbortController();
    const sleep = async () => {};
    const seen: number[] = [];
    const events = [ev(1, 0), ev(2, 100), ev(3, 200), ev(4, 300)];
    for await (const e of play(events, { speed: 1, from: 0, idleCapMs: 2000, signal: stop.signal, sleep })) {
      seen.push(e.seq);
      if (e.seq === 2) stop.abort();
    }
    expect(seen).toEqual([1, 2]);
  });

  it("cuts its own wait short when the signal aborts", async () => {
    const stop = new AbortController();
    const it = play([ev(1, 0), ev(2, 60_000)], { speed: 1, from: 0, idleCapMs: 60_000, signal: stop.signal });
    expect((await it.next()).value?.seq).toBe(1);
    const started = Date.now();
    setTimeout(() => stop.abort(), 20);
    expect((await it.next()).done).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
