/*
 * The test-mode API, calling the route handlers directly: a Request in, a Response out. The working directory is a
 * temp dir, so the server cache, the ledger and the tapes all live there. APP_MODE is "test" unless a test says not.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as REPLAY } from "@/app/api/sim/replay/[id]/route";
import { POST as APPEND } from "@/app/api/sim/tapes/[id]/events/route";
import { DELETE as STOP, GET as TAPE } from "@/app/api/sim/tapes/[id]/route";
import { GET as LIST, POST as START } from "@/app/api/sim/tapes/route";
import type { TapeEvent, TapeHeader } from "@/lib/sim/types";
import { simDir } from "@/server/sim/dir";
import { activeRecording, stopRecording } from "@/server/sim/recorder";
import { openTape, type Tape } from "@/server/sim/tape";
import { headerInput, recordingInput } from "@/server/sim/testing";

// Outside a Next request, connection() throws; the GET routes only call it to stay dynamic.
vi.mock("next/server", () => ({ connection: async () => {} }));

type Global = { __agentTeamsCache?: { close(): void } };

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "sim-api-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.stubEnv("DATA_DIR", "");
  vi.stubEnv("APP_MODE", "test");
  delete (globalThis as Global).__agentTeamsCache;
});
afterEach(async () => {
  const active = activeRecording();
  if (active) await stopRecording(active.tapeId);
  (globalThis as Global).__agentTeamsCache?.close();
  delete (globalThis as Global).__agentTeamsCache;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const url = (p: string) => `http://localhost/api/sim/${p}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const start = (body: unknown) => START(new Request(url("tapes"), post(body)));
const list = () => LIST();
const getTape = (id: string) => TAPE(new Request(url(`tapes/${id}`)), ctx(id));
const stop = (id: string) => STOP(new Request(url(`tapes/${id}`), { method: "DELETE" }), ctx(id));
const append = (id: string, events: unknown) => APPEND(new Request(url(`tapes/${id}/events`), post({ events })), ctx(id));
const replay = (id: string, query = "", init: RequestInit = {}) => REPLAY(new Request(url(`replay/${id}${query}`), init), ctx(id));

interface Frame {
  id?: string;
  event?: string;
  data?: unknown;
}

/** Splits an SSE body into frames; comment lines are skipped. */
function parseFrames(text: string): Frame[] {
  return text
    .split("\n\n")
    .filter((block) => block.trim())
    .flatMap((block) => {
      const f: Frame = {};
      for (const line of block.split("\n")) {
        const i = line.indexOf(":");
        if (i <= 0) continue;
        const [field, value] = [line.slice(0, i), line.slice(i + 1).replace(/^ /, "")];
        if (field === "id") f.id = value;
        if (field === "event") f.event = value;
        if (field === "data") f.data = JSON.parse(value);
      }
      return f.event || f.data !== undefined ? [f] : [];
    });
}

const tapeSeqs = (frames: Frame[]) => frames.filter((f) => f.event === "tape").map((f) => (f.data as TapeEvent).seq);

/** A finished tape: an owner message, Mira's streamed reply, and a minute's silence before she goes idle. */
async function recordedTape(tapeId = "demo"): Promise<TapeHeader> {
  const w = openTape(headerInput({ tapeId, idleCapMs: 60_000 }));
  w.append({ kind: "owner", action: { kind: "send", place: { kind: "dm", agentId: "mira" }, text: "Plan the launch" }, by: "sim" }, {}, { t: 0 });
  w.append({ kind: "msg.start", msgId: "m1", place: { kind: "dm", agentId: "mira" }, from: "mira" }, { agent: "mira" }, { t: 100 });
  w.append({ kind: "msg.delta", msgId: "m1", text: "On it." }, { agent: "mira" }, { t: 150 });
  w.append({ kind: "msg.end", msgId: "m1", text: "On it." }, { agent: "mira" }, { t: 300, dur: 200 });
  w.append({ kind: "agent.status", agentId: "mira", status: "idle" }, { agent: "mira" }, { t: 60_300 });
  return w.close();
}

describe("outside test mode", () => {
  it.each([undefined, "production", "dev"])("every route answers 404 when APP_MODE is %s, and nothing is written", async (mode) => {
    await recordedTape();
    if (mode === undefined) delete process.env.APP_MODE;
    else vi.stubEnv("APP_MODE", mode);

    const responses = await Promise.all([
      list(),
      start(recordingInput({ tapeId: "fresh" })),
      getTape("demo"),
      stop("demo"),
      append("demo", [{ kind: "marker", label: "x" }]),
      replay("demo", "?speed=inf"),
    ]);
    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404]);
    expect(existsSync(path.join(simDir(), "tapes", "fresh.jsonl"))).toBe(false);
    expect(activeRecording()).toBeUndefined();
  });
});

describe("tape ids", () => {
  it("rejects an id with ../ on every route that takes one, even when the file it points at exists", async () => {
    await mkdir(simDir(), { recursive: true });
    await writeFile(path.join(simDir(), "secret.jsonl"), `${JSON.stringify({ ...headerInput({ tapeId: "secret" }), markers: [] })}\n`);
    const id = "../secret";
    const responses = await Promise.all([getTape(id), stop(id), append(id, [{ kind: "marker", label: "x" }]), replay(id, "?speed=inf")]);
    expect(responses.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    expect((await start(recordingInput({ tapeId: id }))).status).toBe(400);
  });
});

describe("POST /api/sim/tapes", () => {
  it("starts a recording and returns its tapeId", async () => {
    const res = await start(recordingInput({ tapeId: "trial-1" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ tapeId: "trial-1" });
    expect(activeRecording()?.tapeId).toBe("trial-1");
  });

  it("refuses with 409 while another tape is recording", async () => {
    await start(recordingInput({ tapeId: "trial-1" }));
    const res = await start(recordingInput({ tapeId: "trial-2" }));
    expect(res.status).toBe(409);
    expect(activeRecording()?.tapeId).toBe("trial-1");
  });

  it("refuses with 400 a body missing header fields", async () => {
    const { runId, ...noRun } = recordingInput();
    void runId;
    const res = await start(noRun);
    expect(res.status).toBe(400);
    expect(activeRecording()).toBeUndefined();
  });
});

describe("GET /api/sim/tapes and /api/sim/tapes/[id]", () => {
  it("lists the headers, newest first", async () => {
    await openTape(headerInput({ tapeId: "older", recordedAt: "2026-10-16T10:00:00.000Z" })).close();
    await openTape(headerInput({ tapeId: "newer", recordedAt: "2026-10-17T10:00:00.000Z" })).close();
    const body = (await (await list()).json()) as { tapes: TapeHeader[] };
    expect(body.tapes.map((h) => h.tapeId)).toEqual(["newer", "older"]);
  });

  it("returns a whole tape, and 404 for one that doesn't exist", async () => {
    const header = await recordedTape();
    const body = (await (await getTape("demo")).json()) as Tape;
    expect(body.header).toEqual(header);
    expect(body.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect((await getTape("nope")).status).toBe(404);
  });
});

describe("POST /api/sim/tapes/[id]/events and DELETE /api/sim/tapes/[id]", () => {
  it("appends to the active tape with server-assigned seq and t, and DELETE closes it", async () => {
    await start(recordingInput({ tapeId: "trial-1" }));
    const res = await append("trial-1", [
      { kind: "marker", label: "beat: kickoff" },
      { kind: "msg.delta", msgId: "m1", text: "Hi", agent: "mira", dur: 12, seq: 999, t: -50 },
    ]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ appended: 2 });

    const stopped = await stop("trial-1");
    expect(stopped.status).toBe(200);
    expect(activeRecording()).toBeUndefined();
    const { header, events } = (await (await getTape("trial-1")).json()) as Tape;
    const posted = events.filter((e) => e.kind === "marker" || e.kind === "msg.delta");
    expect(posted).toMatchObject([
      { kind: "marker", label: "beat: kickoff" },
      { kind: "msg.delta", text: "Hi", agent: "mira", dur: 12 },
    ]);
    expect(posted[1].seq).toBe(posted[0].seq + 1);
    expect(posted[1].seq).not.toBe(999);
    expect(posted[1].t).toBeGreaterThanOrEqual(posted[0].t);
    expect(header.markers.map((m) => m.label)).toEqual(["beat: kickoff"]);
  });

  it("refuses with 409 events for a tape that isn't the one recording", async () => {
    await recordedTape();
    await start(recordingInput({ tapeId: "trial-1" }));
    expect((await append("demo", [{ kind: "marker", label: "x" }])).status).toBe(409);
  });

  it("refuses with 400 events that aren't a list of tape bodies", async () => {
    await start(recordingInput({ tapeId: "trial-1" }));
    expect((await append("trial-1", "nope")).status).toBe(400);
    expect((await append("trial-1", [{ label: "no kind" }])).status).toBe(400);
  });

  it("DELETE answers 404 for an unknown tape and 409 for one that isn't recording", async () => {
    await recordedTape();
    expect((await stop("nope")).status).toBe(404);
    expect((await stop("demo")).status).toBe(409);
  });
});

describe("GET /api/sim/replay/[id]", () => {
  it("streams the header, then every event with id: <seq>, then end", async () => {
    const header = await recordedTape();
    const res = await replay("demo", "?speed=inf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);

    const frames = parseFrames(await res.text());
    expect(frames[0]).toMatchObject({ event: "header", data: header });
    const events = frames.slice(1, -1);
    expect(events.map((f) => f.event)).toEqual(["tape", "tape", "tape", "tape", "tape"]);
    expect(events.map((f) => f.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(events.map((f) => String((f.data as TapeEvent).seq))).toEqual(["1", "2", "3", "4", "5"]);
    expect(frames.at(-1)?.event).toBe("end");
  });

  it("resumes after Last-Event-ID", async () => {
    await recordedTape();
    const res = await replay("demo", "?speed=inf", { headers: { "Last-Event-ID": "2" } });
    expect(tapeSeqs(parseFrames(await res.text()))).toEqual([3, 4, 5]);
  });

  it("shrinks gaps to the idleCap param", async () => {
    await recordedTape();
    const started = Date.now();
    const res = await replay("demo", "?speed=1&idleCap=20");
    expect(tapeSeqs(parseFrames(await res.text()))).toEqual([1, 2, 3, 4, 5]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("stops streaming when the client aborts", async () => {
    await recordedTape();
    const client = new AbortController();
    const res = await replay("demo", "?speed=1", { signal: client.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (tapeSeqs(parseFrames(text)).length < 4) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`the stream ended early: ${JSON.stringify(text)}`);
      text += decoder.decode(chunk.value);
    }
    client.abort();
    const started = Date.now();
    while (!(await reader.read()).done);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it.each(["?speed=3", "?speed=fast", "?from=-5", "?from=soon", "?idleCap=0", "?idleCap=x"])("answers 400 for %s", async (query) => {
    await recordedTape();
    expect((await replay("demo", query)).status).toBe(400);
  });

  it("answers 404 for an unknown tape", async () => {
    expect((await replay("nope", "?speed=inf")).status).toBe(404);
  });
});
