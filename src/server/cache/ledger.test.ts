import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bus } from "./bus";
import { LedgerCache } from "./ledger";
import { callEvent, nextChange } from "./testing";

// Every whole-file read, by path, so a test can prove the ledger is read once.
const reads = vi.hoisted(() => [] as string[]);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = ((...args: Parameters<typeof actual.readFile>) => {
    reads.push(String(args[0]));
    return actual.readFile(...args);
  }) as typeof actual.readFile;
  return { ...actual, readFile, default: { ...actual, readFile } };
});
// Outside a Next request, connection() throws; the routes only call it to stay dynamic.
vi.mock("next/server", () => ({ connection: async () => {} }));

const readsOf = (file: string) => reads.filter((p) => p === file).length;
type Global = { __agentTeamsCache?: { close(): void } };

beforeEach(() => {
  reads.length = 0;
});

describe("record() and readLedger() in the app", () => {
  let root: string;
  let file: string;
  let cwd: { mockRestore(): void };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ledger-app-"));
    file = path.join(root, ".data", "ledger.jsonl");
    await mkdir(path.dirname(file));
    await writeFile(file, `${JSON.stringify(callEvent({ output: 10 }))}\n`);
    cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.resetModules();
    delete (globalThis as Global).__agentTeamsCache;
  });

  afterEach(async () => {
    (globalThis as Global).__agentTeamsCache?.close();
    delete (globalThis as Global).__agentTeamsCache;
    cwd.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it("shows a recorded event in readLedger() and /api/stats without reading the file again", async () => {
    const { readLedger, record } = await import("@/lib/ledger");
    const { GET } = await import("@/app/api/stats/route");

    expect(await readLedger()).toHaveLength(1);
    await record(callEvent({ output: 30 }));

    expect(await readLedger()).toHaveLength(2);
    const report = await (await GET(new Request("http://localhost/api/stats?agent=mira"))).json();
    expect(report.calls).toBe(2);
    expect(report.output).toBe(40);
    expect(readsOf(file)).toBe(1);
  });
});

describe("LedgerCache", () => {
  let dir: string;
  let file: string;
  let bus: Bus;
  let ledger: LedgerCache;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ledger-"));
    file = path.join(dir, "ledger.jsonl");
    bus = new Bus();
    ledger = new LedgerCache(file, bus);
  });

  afterEach(async () => {
    ledger.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("picks up a line another process appends and announces stats", async () => {
    await ledger.ready();
    const changed = nextChange(bus, "stats");

    await appendFile(file, `${JSON.stringify(callEvent({ agent: "rex", team: "growth" }))}\n`);
    await changed;

    expect((await ledger.events()).map((e) => e.agent)).toEqual(["rex"]);
    expect(readsOf(file)).toBe(1);
  });

  it("announces stats, the team and the agent when it appends an event", async () => {
    const seen: string[] = [];
    bus.subscribe(["stats"], (c) => seen.push(c.topic));

    await ledger.append(callEvent({ team: "growth", agent: "rex" }));

    expect(seen.sort()).toEqual(["stats", "stats:agent:rex", "stats:team:growth"]);
  });
});
