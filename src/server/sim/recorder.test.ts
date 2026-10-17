/*
 * The recorder against the real server cache and ledger in a temp working directory: rows go in through record(),
 * changes through the cache's bus, and the tape is read back from disk.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { record } from "@/lib/ledger";
import { getServerCache } from "@/server/cache";
import { TOPICS } from "@/server/cache/bus";
import { callEvent } from "@/server/cache/testing";
import { simDir } from "./dir";
import { activeRecording, RecordingActiveError, startRecording, stopRecording } from "./recorder";
import { isTapeId, readTape } from "./tape";
import { recordingInput } from "./testing";

type Global = { __agentTeamsCache?: { close(): void } };

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "recorder-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.stubEnv("DATA_DIR", "");
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

const tapeText = (id: string) => readFile(path.join(simDir(), "tapes", `${id}.jsonl`), "utf8");

describe("the recorder", () => {
  it("tapes every ledger row and every bus change under the TOPICS roots while recording", async () => {
    const id = await startRecording(recordingInput({ tapeId: "rec-1" }));
    const row = callEvent({ agent: "nova", team: "launch" });
    await record(row);
    const { bus } = getServerCache();
    bus.emit(TOPICS.rules);
    bus.emit(TOPICS.skills);
    bus.emit(TOPICS.files("nova"));
    bus.emit("elsewhere");
    await stopRecording(id);

    const events = (await readTape(id))!.events;
    expect(events.filter((e) => e.kind === "ledger")).toEqual([expect.objectContaining({ kind: "ledger", row })]);
    const topics = events.flatMap((e) => (e.kind === "bus" ? [e.topic] : []));
    expect(new Set(topics)).toEqual(new Set(["stats", "stats:team:launch", "stats:agent:nova", "rules", "skills", "files:agent:nova"]));
    expect(events.find((e) => e.kind === "bus" && e.topic === "rules")).toMatchObject({ version: 1 });
  });

  it("writes nothing when no recording was ever started", async () => {
    await record(callEvent());
    getServerCache().bus.emit(TOPICS.rules);
    expect(existsSync(simDir())).toBe(false);
  });

  it("writes nothing to a tape once it is stopped", async () => {
    const id = await startRecording(recordingInput({ tapeId: "rec-1" }));
    await stopRecording(id);
    const closed = await tapeText(id);

    await record(callEvent());
    getServerCache().bus.emit(TOPICS.rules);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await tapeText(id)).toBe(closed);
    expect(activeRecording()).toBeUndefined();
  });

  it("refuses a second start while one is recording, and keeps the first", async () => {
    const id = await startRecording(recordingInput({ tapeId: "rec-1" }));
    await expect(startRecording(recordingInput({ tapeId: "rec-2" }))).rejects.toBeInstanceOf(RecordingActiveError);
    expect(activeRecording()?.tapeId).toBe(id);
    expect(existsSync(path.join(simDir(), "tapes", "rec-2.jsonl"))).toBe(false);

    await stopRecording(id);
    expect(await startRecording(recordingInput({ tapeId: "rec-2" }))).toBe("rec-2");
  });

  it("only stops the recording it is asked to stop", async () => {
    const id = await startRecording(recordingInput({ tapeId: "rec-1" }));
    expect(await stopRecording("other")).toBeUndefined();
    expect(activeRecording()?.tapeId).toBe(id);
  });

  it("mints a tape id when none is given and fills in the header's constants", async () => {
    const id = await startRecording(recordingInput());
    expect(isTapeId(id)).toBe(true);
    const header = await stopRecording(id);
    expect(header).toMatchObject({ kind: "header", v: 1, clock: "monotonic", tapeId: id, durationMs: 0, markers: [] });
    expect(Date.parse(header!.recordedAt)).not.toBeNaN();
  });
});
