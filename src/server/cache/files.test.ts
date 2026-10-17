import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bus } from "./bus";
import { FileCache } from "./files";
import { nextChange } from "./testing";

// Every whole-file read, by path, so a test can prove a read was served from memory.
const reads = vi.hoisted(() => [] as string[]);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = ((...args: Parameters<typeof actual.readFile>) => {
    reads.push(String(args[0]));
    return actual.readFile(...args);
  }) as typeof actual.readFile;
  return { ...actual, readFile, default: { ...actual, readFile } };
});

const readsOf = (file: string) => reads.filter((p) => p === file).length;
type Global = { __agentTeamsCache?: { close(): void } };

beforeEach(() => {
  reads.length = 0;
});

describe("agent files saved through agent-files.ts", () => {
  let root: string;
  let cwd: { mockRestore(): void };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "files-app-"));
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

  it("a SOUL.md save updates the cache and announces files:agent:<id>", async () => {
    const { readAgentFiles, writeAgentFile } = await import("@/lib/agent-files");
    const { getServerCache } = await import("@/server/cache");
    const soul = path.join(root, "agents", "mira", "SOUL.md");
    await readAgentFiles("mira");
    const changed = nextChange(getServerCache().bus, "files:agent:mira");

    await writeAgentFile("mira", "soul", "# Mira's soul\n\nShip on Fridays.");
    await changed;
    const before = readsOf(soul);

    expect((await readAgentFiles("mira")).soul.content).toBe("# Mira's soul\n\nShip on Fridays.\n");
    expect(readsOf(soul)).toBe(before);
  });
});

describe("FileCache", () => {
  let root: string;
  let soul: string;
  let bus: Bus;
  let files: FileCache;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "files-"));
    soul = path.join(root, "mira", "SOUL.md");
    await mkdir(path.dirname(soul));
    await writeFile(soul, "v1");
    bus = new Bus();
    files = new FileCache({ bus, roots: [root], debounceMs: 20 });
  });

  afterEach(async () => {
    files.close();
    await rm(root, { recursive: true, force: true });
  });

  it("an edit made outside the app invalidates the cached file and announces it", async () => {
    files.watch();
    expect((await files.read(soul)).content).toBe("v1");
    const changed = nextChange(bus, "files:agent:mira");

    await writeFile(soul, "v2");
    await changed;

    expect((await files.read(soul)).content).toBe("v2");
  });

  it("set() serves content from memory, and invalidate() sends the next read to disk", async () => {
    const seen: string[] = [];
    bus.subscribe(["files"], (c) => seen.push(c.topic));

    files.set(soul, "from the vault");
    expect((await files.read(soul)).content).toBe("from the vault");
    expect(readsOf(soul)).toBe(0);

    files.invalidate(soul);
    expect((await files.read(soul)).content).toBe("v1");
    expect(readsOf(soul)).toBe(1);
    expect(seen).toEqual(["files:agent:mira", "files:agent:mira"]);
  });
});
