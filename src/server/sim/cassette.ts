/*
 * The L1 model cassette (test-mode §4, research K "Cassettes at the HTTP seam"): a VCR at the model
 * `fetch` seam. `record` passes every request through and stores the exchange; `replay` serves stored
 * exchanges and never calls the network; `update` replays what it has and records the rest.
 *
 * The file is JSONL: a header line, then one entry per finished exchange. An entry keeps the canonical
 * request (no host, no headers) and the response as raw chunks with their timing.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type CassetteMode = "record" | "replay" | "update";

/** What the key is built from: no host, no headers, volatile text masked. */
export interface CanonicalRequest {
  method: string;
  /** URL path and query, without the host (the base URL differs between machines). */
  path: string;
  /** The parsed JSON body (or the raw text if it isn't JSON), volatile text masked. */
  body: unknown;
}

export interface CassetteChunk {
  /** ms since the previous chunk; the first chunk's is since the request started. */
  dt: number;
  /** The raw bytes as read, base64. */
  b64: string;
}

export interface CassetteEntry {
  v: 1;
  key: string;
  /** The n-th request with this key in the recording, from 1. */
  n: number;
  canonical: CanonicalRequest;
  request: { method: string; path: string; model: string | null };
  response: {
    status: number;
    /** content-type only. */
    headers: Record<string, string>;
    ttfbMs: number;
    chunks: CassetteChunk[];
    /** The caller cancelled the body before it ended. */
    partial?: true;
  };
  recordedAt: string;
}

export interface CassetteMiss {
  key: string;
  n: number;
  request: CassetteEntry["request"];
  /** The recorded entry most like this request (same path and model), if any. */
  closest: { key: string; n: number } | null;
  /** Up to ~20 differing lines, `- recorded` / `+ this request`. */
  diff: string[];
}

export interface CassetteOptions {
  file: string;
  mode: CassetteMode;
  /** Replay pace: 1 = as recorded, 4 = four times faster; Infinity (default) = no waiting. */
  speed?: number;
  /** Where record and update send requests; the global fetch by default. */
  upstream?: typeof fetch;
  /** A last rewrite of the canonical request before it is hashed, for project-specific volatile text. */
  canonicalize?: (canonical: CanonicalRequest) => CanonicalRequest;
}

export interface Cassette {
  fetch: typeof fetch;
  misses(): readonly CassetteMiss[];
  entries(): readonly CassetteEntry[];
}

type Input = string | URL | Request;

/** Sorted keys all the way down, so equal requests serialize equally. */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
  }
  return v;
}

function bodyText(input: Input, init?: RequestInit): string | undefined {
  const body = init?.body;
  if (typeof body === "string") return body;
  if (body == null && !(input instanceof Request && input.body)) return undefined;
  throw new TypeError("cassette: only string request bodies can be keyed");
}

function canonicalOf(input: Input, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const text = bodyText(input, init);
  let body: unknown = text ?? null;
  try {
    if (text !== undefined) body = JSON.parse(text);
  } catch {
    // Not JSON: key on the text.
  }
  const reqPath = url.pathname + url.search;
  const canonical = sortKeys({ method, path: reqPath, body }) as CanonicalRequest;
  const model = body && typeof body === "object" && typeof (body as { model?: unknown }).model === "string" ? (body as { model: string }).model : null;
  return {
    canonical,
    key: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    request: { method, path: reqPath, model },
  };
}

function load(file: string): CassetteEntry[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((l) => l.kind !== "cassette") as CassetteEntry[];
}

function replay(entry: CassetteEntry): Response {
  const { status, headers, chunks } = entry.response;
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= chunks.length) return c.close();
      c.enqueue(new Uint8Array(Buffer.from(chunks[i++].b64, "base64")));
    },
  });
  return new Response(chunks.length ? body : null, { status, headers });
}

/**
 * Hands the caller each chunk the moment it is read (never buffers), timing it as it goes, and calls
 * `save` once: when the body ends, or with `partial` when the caller cancels or the read fails. The body
 * is read even if the caller never reads it (a 429 before a retry), so every exchange is saved.
 */
function record(res: Response, started: number, save: (response: CassetteEntry["response"]) => void): Response {
  const type = res.headers.get("content-type");
  const head = { status: res.status, headers: type ? { "content-type": type } : {}, ttfbMs: Math.round(performance.now() - started) };
  const chunks: CassetteChunk[] = [];
  let saved = false;
  const finish = (partial: boolean) => {
    if (saved) return false;
    saved = true;
    save({ ...head, chunks, ...(partial && { partial: true as const }) });
    return true;
  };
  if (!res.body) {
    finish(false);
    return res;
  }
  const reader = res.body.getReader();
  // Rounded times since the request, so the gaps add up to the recorded total.
  let last = 0;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const at = Math.round(performance.now() - started);
            chunks.push({ dt: at - last, b64: Buffer.from(value).toString("base64") });
            last = at;
            c.enqueue(value);
          }
          // Saved before the caller sees the end, so a finished stream is always on disk.
          if (finish(false)) c.close();
        } catch (e) {
          if (finish(true)) c.error(e);
        }
      })();
    },
    cancel(reason) {
      finish(true);
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

export function createCassette(opts: CassetteOptions): Cassette {
  const { file, mode } = opts;
  const upstream = opts.upstream ?? ((input: Input, init?: RequestInit) => globalThis.fetch(input, init));
  const all: CassetteEntry[] = [];

  if (mode === "record") {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ v: 1, kind: "cassette", createdAt: new Date().toISOString() })}\n`);
  } else {
    all.push(...load(file));
  }

  const append = (entry: CassetteEntry) => {
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
    all.push(entry);
  };

  const cassetteFetch = async (input: Input, init?: RequestInit): Promise<Response> => {
    const started = performance.now();
    const { canonical, key, request } = canonicalOf(input, init);
    if (mode !== "record") {
      const hit = all.find((e) => e.key === key);
      if (hit) return replay(hit);
    }
    const res = await upstream(input, init);
    return record(res, started, (response) =>
      append({ v: 1, key, n: 1, canonical, request, response, recordedAt: new Date().toISOString() }),
    );
  };

  return {
    fetch: cassetteFetch as typeof fetch,
    misses: () => [],
    entries: () => [...all],
  };
}
