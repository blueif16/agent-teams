/*
 * Client-side rate limiter for Crusoe: one process-wide limiter, one bucket per
 * model (D §7). Crusoe limits each model per minute on requests (RPM) and on
 * tokens (TPM, input plus output); exceeding either returns 429.
 *
 * Each bucket keeps a sliding 60 s log of what was sent. A sliding log never
 * puts more than the limit into any 60 s span, so it stays under the cap
 * whether Crusoe resets on a fixed minute or a rolling one.
 */

export type Lane = "interactive" | "work" | "background";

export type LimiterOptions = {
  /** Requests per minute per model. Crusoe without a payment method: 30. */
  rpm?: number;
  /** Tokens per minute per model. Crusoe without a payment method: 500K. */
  tpm?: number;
  windowMs?: number;
};

/** What a bucket's window holds: one request each, or usage only Crusoe saw (`requests` > 1 or 0). */
type Entry = { at: number; requests: number; tokens: number };

type Waiter = { lane: Lane; tokens: number; resolve: (r: Reservation) => void };

type Bucket = {
  log: Entry[];
  waiters: Waiter[];
  timer?: ReturnType<typeof setTimeout>;
};

/** A granted request; hand it back to `observe` with the response. */
export type Reservation = { readonly bucket: Bucket; readonly entry: Entry };

export class Limiter {
  private readonly rpm: number;
  private readonly tpm: number;
  private readonly windowMs: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(opts: LimiterOptions = {}) {
    this.rpm = opts.rpm ?? 30;
    this.tpm = opts.tpm ?? 500_000;
    this.windowMs = opts.windowMs ?? 60_000;
  }

  /**
   * Wait until `model` has room for one more request of `estTokens`, then count it.
   * A request estimated above the whole TPM limit is counted as the limit, so it
   * goes once the bucket is empty instead of waiting forever.
   */
  acquire(model: string, estTokens: number, lane: Lane = "work"): Promise<Reservation> {
    const b = this.bucket(model);
    return new Promise((resolve) => {
      b.waiters.push({ lane, tokens: Math.min(estTokens, this.tpm), resolve });
      this.pump(b);
    });
  }

  /**
   * Correct the bucket from Crusoe's answer. Its `x-ratelimit-remaining-*` headers
   * count everything on this key, including other processes, so when they report
   * less room than we think, the difference is recorded as used, from the start of
   * our window (D §7 assumes Crusoe's minute starts with the first request in it;
   * Crusoe documents no reset header). A 429 records the whole rest as used.
   */
  observe({ bucket: b }: Reservation, res: { status: number; headers: Headers }) {
    const now = Date.now();
    this.prune(b, now);
    const start = b.log[0]?.at ?? now;
    const used = this.used(b);
    // A 429 means "none left", whatever the headers say: empty the bucket until the window passes.
    const left = (h: string) => (res.status === 429 ? 0 : header(res.headers, h));
    const requests = gap(this.rpm - used.requests, left("x-ratelimit-remaining-requests"));
    const tokens = gap(this.tpm - used.tokens, left("x-ratelimit-remaining-tokens"));
    if (requests || tokens) b.log.unshift({ at: start, requests, tokens });
    this.pump(b);
  }

  private bucket(model: string): Bucket {
    let b = this.buckets.get(model);
    if (!b) this.buckets.set(model, (b = { log: [], waiters: [] }));
    return b;
  }

  /** Drop entries that have left the window. */
  private prune(b: Bucket, now: number) {
    while (b.log.length && b.log[0].at + this.windowMs <= now) b.log.shift();
  }

  private used(b: Bucket) {
    let requests = 0;
    let tokens = 0;
    for (const e of b.log) {
      requests += e.requests;
      tokens += e.tokens;
    }
    return { requests, tokens };
  }

  private fits(b: Bucket, tokens: number): boolean {
    const used = this.used(b);
    return used.requests + 1 <= this.rpm && used.tokens + tokens <= this.tpm;
  }

  /** Admit waiters in order while they fit; otherwise wake up when the oldest entry leaves the window. */
  private pump(b: Bucket) {
    const now = Date.now();
    this.prune(b, now);
    while (b.waiters.length && this.fits(b, b.waiters[0].tokens)) {
      const w = b.waiters.shift()!;
      const entry = { at: now, requests: 1, tokens: w.tokens };
      b.log.push(entry);
      w.resolve({ bucket: b, entry });
    }
    if (b.timer) clearTimeout(b.timer);
    b.timer = undefined;
    if (b.waiters.length && b.log.length) {
      b.timer = setTimeout(() => this.pump(b), b.log[0].at + this.windowMs - now);
    }
  }
}

/**
 * A numeric header, or undefined when it is missing or blank: `Number(null)` and
 * `Number("")` are 0, which would read as "no room left". A garbled value is NaN,
 * which never compares below anything, so it is ignored too.
 */
function header(headers: Headers, name: string): number | undefined {
  const v = headers.get(name)?.trim();
  return v ? Number(v) : undefined;
}

/**
 * How much less room Crusoe reports than we count, or 0. Headers only ever lower
 * the budget: requests still in flight may not be in Crusoe's count yet, so
 * raising our count to match would forget them.
 */
function gap(left: number, remaining: number | undefined): number {
  return remaining !== undefined && remaining < left ? left - remaining : 0;
}

/** The one limiter per process (D §7), kept on globalThis so dev-server module reloads don't make a second one. */
export function getLimiter(): Limiter {
  const g = globalThis as { __agentTeamsLimiter?: Limiter };
  return (g.__agentTeamsLimiter ??= new Limiter());
}

/** The `model` field of a chat-completions body, or "unknown" when the body isn't one. */
function modelOf(body: string): string {
  try {
    const model = (JSON.parse(body) as { model?: unknown }).model;
    return typeof model === "string" ? model : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * A `fetch` for `ChatOpenAI({ configuration: { fetch } })` that waits on the limiter
 * before each request and corrects it from the response. It wraps `baseFetch`
 * rather than calling the global fetch, so it can sit anywhere in a chain of fetch
 * wrappers (a privacy scrubber, say), and it returns the inner response as is.
 */
export function limitFetch(baseFetch: typeof fetch = fetch, limiter: Limiter = getLimiter()): typeof fetch {
  return async (input, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    const reservation = await limiter.acquire(modelOf(body), Math.ceil(body.length / 4));
    const res = await baseFetch(input, init);
    limiter.observe(reservation, res);
    return res;
  };
}
