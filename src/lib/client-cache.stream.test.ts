import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Outside a Next request, connection() throws; the route only calls it to stay dynamic.
vi.mock("next/server", () => ({ connection: async () => {} }));

type Global = { __agentTeamsCache?: { close(): void } };

/** The browser's EventSource, answered by the real GET /api/events in this process. */
class RouteEventSource {
  static last?: RouteEventSource;
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  /** Settles once the route is streaming to this source. */
  readonly connected: Promise<void>;
  private readonly client = new AbortController();

  constructor(readonly url: string) {
    RouteEventSource.last = this;
    this.connected = this.connect();
  }

  close() {
    this.client.abort();
  }

  private async connect() {
    const { GET } = await import("@/app/api/events/route");
    const res = await GET(new Request(new URL(this.url, "http://localhost"), { signal: this.client.signal }));
    if (!res.headers.get("content-type")?.startsWith("text/event-stream")) throw new Error(`${this.url} answered ${res.status}`);
    this.onopen?.();
    void this.pump(res.body!.getReader());
  }

  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const chunk = await reader.read().catch(() => ({ done: true as const, value: undefined }));
      if (chunk.done) return;
      text += decoder.decode(chunk.value, { stream: true });
      let end;
      while ((end = text.indexOf("\n\n")) !== -1) {
        for (const line of text.slice(0, end).split("\n")) if (line.startsWith("data:")) this.onmessage?.({ data: line.slice(5).trim() });
        text = text.slice(end + 2);
      }
    }
  }
}

describe("the app's one change stream", () => {
  let root: string;
  let cwd: { mockRestore(): void };
  const fetchMock = vi.fn(async () => Response.json([]));

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "client-stream-"));
    cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.resetModules();
    delete (globalThis as Global).__agentTeamsCache;
    // What client-cache.ts looks for at import to decide it runs in a browser.
    vi.stubGlobal("window", { addEventListener: () => {} });
    vi.stubGlobal("EventSource", RouteEventSource);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  afterEach(async () => {
    RouteEventSource.last?.close();
    RouteEventSource.last = undefined;
    vi.unstubAllGlobals();
    (globalThis as Global).__agentTeamsCache?.close();
    delete (globalThis as Global).__agentTeamsCache;
    cwd.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it("carries a skills announcement to the Skills tab's library, which fetches it again", async () => {
    const { cache } = await import("@/lib/client-cache");
    const { skillLibrary } = await import("@/components/Skills");
    const { getServerCache } = await import("@/server/cache");
    const { TOPICS } = await import("@/server/cache/bus");
    expect(skillLibrary, "Skills.tsx exports the library's Resource").toBeDefined();
    // What useCached does on mount; the first subscriber opens the stream.
    cache.subscribe(skillLibrary.key, () => {}, skillLibrary.topic);
    await RouteEventSource.last!.connected;
    fetchMock.mockClear();

    getServerCache().bus.emit(TOPICS.skills);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(skillLibrary.key));
  });
});
