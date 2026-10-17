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

/** One request in a bucket's window, with the tokens it is counted for. */
type Entry = { at: number; tokens: number };

type Waiter = { lane: Lane; tokens: number; resolve: () => void };

type Bucket = {
  log: Entry[];
  waiters: Waiter[];
  timer?: ReturnType<typeof setTimeout>;
};

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
  acquire(model: string, estTokens: number, lane: Lane = "work"): Promise<void> {
    const b = this.bucket(model);
    return new Promise((resolve) => {
      b.waiters.push({ lane, tokens: Math.min(estTokens, this.tpm), resolve });
      this.pump(b);
    });
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

  private fits(b: Bucket, tokens: number): boolean {
    const usedTokens = b.log.reduce((sum, e) => sum + e.tokens, 0);
    return b.log.length + 1 <= this.rpm && usedTokens + tokens <= this.tpm;
  }

  /** Admit waiters in order while they fit; otherwise wake up when the oldest entry leaves the window. */
  private pump(b: Bucket) {
    const now = Date.now();
    this.prune(b, now);
    while (b.waiters.length && this.fits(b, b.waiters[0].tokens)) {
      const w = b.waiters.shift()!;
      b.log.push({ at: now, tokens: w.tokens });
      w.resolve();
    }
    if (b.timer) clearTimeout(b.timer);
    b.timer = undefined;
    if (b.waiters.length && b.log.length) {
      b.timer = setTimeout(() => this.pump(b), b.log[0].at + this.windowMs - now);
    }
  }
}
