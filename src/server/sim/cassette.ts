/*
 * The L1 model cassette (test-mode §4, research K "Cassettes at the HTTP seam"): a VCR at the model
 * `fetch` seam. `record` passes every request through and stores the exchange; `replay` serves stored
 * exchanges and never calls the network; `update` replays what it has and records the rest.
 *
 * An exchange is found by (key, n): the key hashes the method, the path and the JSON body with dates,
 * timestamps and UUIDs masked (never headers), and n counts requests with that key from when each starts,
 * so parallel calls match in any order and retries replay in order. A replay miss fails closed with a 598
 * and a diff against the closest recording.
 *
 * The file is JSONL: a header line, then one entry per finished exchange, appended synchronously so a
 * finished stream is on disk before its caller sees the end. An entry keeps the canonical request and the
 * response as the raw chunks read, each with its gap, so a replay hands parsers the same boundaries.
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

/**
 * Text that changes between runs without changing the answer (research K, Determinism hazards).
 * UUIDs first, then timestamps before bare dates, so a timestamp isn't half-masked as a date.
 */
const VOLATILE: [RegExp, string][] = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>"],
  [/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<TS>"],
  [/\b\d{4}-\d{2}-\d{2}\b/g, "<DATE>"],
  // "Fri, Oct 17, 2026": toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
  [/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}\b/g, "<DATE>"],
];

const mask = (s: string) => VOLATILE.reduce((t, [re, to]) => t.replace(re, to), s);

/** Sorted keys all the way down (so equal requests serialize equally), strings masked when asked. */
function normalize(v: unknown, masking: boolean): unknown {
  if (typeof v === "string") return masking ? mask(v) : v;
  if (Array.isArray(v)) return v.map((x) => normalize(x, masking));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, normalize(o[k], masking)]));
  }
  return v;
}

function bodyText(input: Input, init?: RequestInit): string | undefined {
  const body = init?.body;
  if (typeof body === "string") return body;
  if (body == null && !(input instanceof Request && input.body)) return undefined;
  throw new TypeError("cassette: only string request bodies can be keyed");
}

function canonicalOf(input: Input, init: RequestInit | undefined, hook: CassetteOptions["canonicalize"]) {
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
  const masked = normalize({ method, path: reqPath, body }, true) as CanonicalRequest;
  // Sorted again, in case the hook added keys.
  const canonical = (hook ? normalize(hook(masked), false) : masked) as CanonicalRequest;
  const model = body && typeof body === "object" && typeof (body as { model?: unknown }).model === "string" ? (body as { model: string }).model : null;
  return {
    canonical,
    key: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    request: { method, path: reqPath, model },
  };
}

const linesOf = (c: CanonicalRequest) => JSON.stringify(c, null, 2).split("\n");

/** How alike two line lists are: shared lines (as a multiset) over all lines, 0–1. */
function likeness(a: string[], b: string[]): number {
  const left = new Map<string, number>();
  for (const l of a) left.set(l, (left.get(l) ?? 0) + 1);
  let shared = 0;
  for (const l of b) {
    const k = left.get(l);
    if (k) {
      shared++;
      left.set(l, k - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

/** The first `max` lines only in `a` (`- `) or only in `b` (`+ `), in order, by longest common subsequence. */
function lineDiff(a: string[], b: string[], max = 20): string[] {
  // Prompts share most of their lines, so trim the common ends before the quadratic part.
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const x = a.slice(s, ea);
  const y = b.slice(s, eb);
  const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while ((i < x.length || j < y.length) && out.length < max) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      i++;
      j++;
    } else if (j >= y.length || (i < x.length && lcs[i + 1][j] >= lcs[i][j + 1])) out.push(`- ${x[i++].trim()}`);
    else out.push(`+ ${y[j++].trim()}`);
  }
  return out;
}

function load(file: string): CassetteEntry[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((l) => l.kind !== "cassette") as CassetteEntry[];
}

const abortReason = (signal: AbortSignal): unknown => signal.reason ?? new DOMException("This operation was aborted", "AbortError");

/** Waits ms (none if ≤ 0), rejecting with the signal's reason if it aborts first or already has. */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The recorded response at the recorded pace divided by `speed`: headers after ttfbMs, each chunk at its
 * recorded time since the request. Each chunk is made only when read (highWaterMark 0), and its wait
 * rejects on abort, so an aborted signal errors the body with an AbortError at the next or pending read.
 */
async function replay(entry: CassetteEntry, t0: number, speed: number, signal?: AbortSignal | null): Promise<Response> {
  const { status, headers, ttfbMs, chunks } = entry.response;
  // Deadlines from the request start, so time spent by the reader doesn't add up.
  const until = (ms: number) => sleep(t0 + ms / speed - performance.now(), signal);
  await until(ttfbMs);
  if (!chunks.length) return new Response(null, { status, headers });
  let i = 0;
  let due = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(c) {
        if (i >= chunks.length) return c.close();
        due += chunks[i].dt;
        await until(due);
        c.enqueue(new Uint8Array(Buffer.from(chunks[i++].b64, "base64")));
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { status, headers });
}

/**
 * Hands the caller each chunk the moment it is read (never buffers), timing it as it goes, and calls
 * `save` once: when the body ends, or with `partial` when the caller cancels or the read fails. The body
 * is read even if the caller never reads it (a 429 before a retry), so every exchange is saved.
 */
function record(res: Response, started: number, save: (response: CassetteEntry["response"]) => void): Response {
  const type = res.headers.get("content-type");
  const headers: Record<string, string> = type ? { "content-type": type } : {};
  const head = { status: res.status, headers, ttfbMs: Math.round(performance.now() - started) };
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
  const { file, mode, speed = Infinity } = opts;
  if (!(speed > 0)) throw new RangeError(`cassette: speed must be above 0, got ${speed}`);
  const upstream = opts.upstream ?? ((input: Input, init?: RequestInit) => globalThis.fetch(input, init));
  const all: CassetteEntry[] = [];
  const byId = new Map<string, CassetteEntry>();
  /** Requests started per key in this instance. */
  const started = new Map<string, number>();
  const id = (key: string, n: number) => `${key}#${n}`;

  const keep = (entry: CassetteEntry) => {
    all.push(entry);
    byId.set(id(entry.key, entry.n), entry);
  };
  // record starts the file over (a recording is one run, never patched); update adds to it; replay only reads.
  if (mode === "record" || (mode === "update" && !existsSync(file))) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ v: 1, kind: "cassette", createdAt: new Date().toISOString() })}\n`);
  } else {
    load(file).forEach(keep);
  }
  const append = (entry: CassetteEntry) => {
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
    keep(entry);
  };

  const missed: CassetteMiss[] = [];
  /** Fails closed: a 598 naming the request and how it differs from the closest recording. */
  const miss = (key: string, n: number, canonical: CanonicalRequest, request: CassetteEntry["request"]): Response => {
    const mine = linesOf(canonical);
    let best: { entry: CassetteEntry; lines: string[]; score: number } | undefined;
    for (const entry of all) {
      if (entry.request.path !== request.path || entry.request.model !== request.model) continue;
      const lines = linesOf(entry.canonical);
      const score = likeness(lines, mine);
      if (!best || score > best.score) best = { entry, lines, score };
    }
    const closest = best ? { key: best.entry.key, n: best.entry.n } : null;
    const diff = best ? lineDiff(best.lines, mine) : [];
    missed.push({ key, n, request, closest, diff });
    return Response.json({ error: "cassette miss", key, n, closest, diff }, { status: 598 });
  };

  const cassetteFetch = async (input: Input, init?: RequestInit): Promise<Response> => {
    const t0 = performance.now();
    const { canonical, key, request } = canonicalOf(input, init, opts.canonicalize);
    // Before any await, so the n-th call to start is the n-th occurrence whatever finishes first.
    const n = (started.get(key) ?? 0) + 1;
    started.set(key, n);
    if (mode !== "record") {
      const hit = byId.get(id(key, n));
      if (hit) return replay(hit, t0, speed, init?.signal);
      if (mode === "replay") return miss(key, n, canonical, request);
    }
    const res = await upstream(input, init);
    return record(res, t0, (response) => append({ v: 1, key, n, canonical, request, response, recordedAt: new Date().toISOString() }));
  };

  return {
    fetch: cassetteFetch as typeof fetch,
    misses: () => [...missed],
    entries: () => [...all],
  };
}
