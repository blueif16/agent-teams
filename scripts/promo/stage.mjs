// Staging for effect captures: we play the agents. Init scripts installed before the app loads:
//   - fetch rules: answer matching requests with JSON or a text stream typed at a chosen speed (POST /api/chat
//     replies to reaction orders stream as text/plain, src/components/AgentTeams.tsx:458-490)
//   - fake EventSource for chosen URLs (/api/runs carries every agent run: start|token|now|done, src/lib/live-runs.ts)
//   - a visible cursor with a press dip and click ripple, driven by real mouse events (headless has no pointer)
// Timers inside the page run on the slowed clock (lib.mjs), so typing speeds stay true in the real-speed clip.

const STAGE = (cfg) => {
  const S = (window.__stage = { rules: [], es: [] });
  const enc = new TextEncoder();

  const streamOf = (text, cps, delayMs) =>
    new ReadableStream({
      start(ctl) {
        const parts = text.match(/\S+\s*|\s+/g) ?? [];
        let i = 0;
        const next = () => {
          if (i >= parts.length) return ctl.close();
          const p = parts[i++];
          ctl.enqueue(enc.encode(p));
          setTimeout(next, (p.length / cps) * 1000);
        };
        setTimeout(next, delayMs);
      },
    });

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    const i = S.rules.findIndex((r) => url.includes(r.url) && (r.method ?? "GET") === method);
    if (i === -1) return realFetch(input, init);
    const r = S.rules[i];
    if (r.once) S.rules.splice(i, 1);
    if (r.kind === "stream") return new Response(streamOf(r.text, r.cps ?? 70, r.delayMs ?? 500), { headers: { "content-type": "text/plain; charset=utf-8" } });
    await new Promise((res) => setTimeout(res, r.delayMs ?? 0));
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  };

  const RealES = window.EventSource;
  class FakeES extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      this.readyState = 0;
      this.onopen = this.onmessage = this.onerror = null;
      S.es.push(this);
      setTimeout(() => {
        this.readyState = 1;
        const ev = new Event("open");
        this.onopen?.(ev);
        this.dispatchEvent(ev);
      }, 0);
    }
    close() {
      this.readyState = 2;
    }
  }
  window.EventSource = function (url, opts) {
    return (cfg.fakeES ?? []).some((p) => String(url).includes(p)) ? new FakeES(url) : new RealES(url, opts);
  };
  S.emit = (urlPart, type, data) => {
    for (const e of S.es.filter((x) => x.url.includes(urlPart))) {
      const ev = new MessageEvent(type, { data: JSON.stringify(data) });
      e.dispatchEvent(ev);
      if (type === "message") e.onmessage?.(ev);
    }
  };
  /** An agent run on /api/runs: start, optional "now" line, the text typed at cps, done. Resolves when done. */
  S.run = (thread, text, { run = "r" + Math.random().toString(36).slice(2), cps = 70, now, delayMs = 400, done = true } = {}) =>
    new Promise((resolve) => {
      S.emit("/api/runs", "start", { type: "start", thread, run });
      if (now) S.emit("/api/runs", "now", { type: "now", thread, run, text: now });
      const parts = text.match(/\S+\s*|\s+/g) ?? [];
      let i = 0;
      const next = () => {
        if (i >= parts.length) {
          if (done) S.emit("/api/runs", "done", { type: "done", thread, run, text });
          return resolve(run);
        }
        const p = parts[i++];
        S.emit("/api/runs", "token", { type: "token", thread, run, text: p });
        setTimeout(next, (p.length / cps) * 1000);
      };
      setTimeout(next, delayMs);
    });

  // Cursor: macOS-style arrow, follows real mouse events; press dips it and drops a ripple (WAAPI, so it slows too).
  const ensure = () => {
    let c = document.getElementById("__cursor");
    if (c || !document.body) return c;
    c = document.createElement("div");
    c.id = "__cursor";
    c.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:26px;height:26px;transform:translate(-100px,-100px);display:" + (cfg.cursor ? "block" : "none");
    c.innerHTML =
      '<svg id="__arrow" width="26" height="26" viewBox="0 0 26 26" style="transform-origin:4px 3px;filter:drop-shadow(0 1.5px 2.5px rgba(0,0,0,.35))"><path d="M4.5 3 L4.5 20.5 L9 16.4 L12.2 23.4 L15.2 22.1 L12.1 15.3 L18.4 15.3 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    return c;
  };
  let x = -100, y = -100;
  addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; const c = ensure(); if (c) c.style.transform = `translate(${x - 4}px,${y - 3}px)`; }, true);
  addEventListener("mousedown", () => {
    if (!cfg.cursor) return;
    document.getElementById("__arrow")?.animate([{ transform: "scale(1)" }, { transform: "scale(.82)" }], { duration: 90, fill: "forwards", easing: "ease-out" });
    const r = document.createElement("div");
    r.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;pointer-events:none;z-index:2147483646;background:rgba(65,102,235,.22);border:2px solid rgba(65,102,235,.55)`;
    document.body.appendChild(r);
    r.animate([{ transform: "scale(.25)", opacity: 1 }, { transform: "scale(1.5)", opacity: 0 }], { duration: 520, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }).onfinish = () => r.remove();
  }, true);
  addEventListener("mouseup", () => {
    document.getElementById("__arrow")?.animate([{ transform: "scale(.82)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }], { duration: 220, fill: "forwards", easing: "ease-out" });
  }, true);
};

export async function installStage(page, cfg = {}) {
  await page.addInitScript(STAGE, { cursor: true, fakeES: ["/api/runs"], ...cfg });
}

/** Adds a fetch rule in the page: {kind:"json"|"stream", url, method, body|text, cps, delayMs, once}. */
export const rule = (page, r) => page.evaluate((r) => window.__stage.rules.push(r), r);

/** One agent run on the fake /api/runs stream; resolves when it's done (page time). */
export const agentRun = (page, thread, text, opts = {}) => page.evaluate(([t, x, o]) => window.__stage.run(t, x, o), [thread, text, opts]);

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Cursor + timeline for one recording. Moves the real mouse (so hover states fire) along an eased, slightly
 * arced path at 60 steps per page-second; every move and click is logged in page time.
 */
export class Director {
  constructor(page, rate) {
    this.page = page;
    this.rate = rate;
    this.pos = { x: 1200, y: 760 };
    this.cursor = [];
    this.marks = [];
    this.clock = () => 0;
  }
  start(rec) {
    this.clock = () => rec.now() * this.rate;
  }
  /** Waits `ms` of page time. */
  wait(ms) {
    return new Promise((r) => setTimeout(r, ms / this.rate));
  }
  mark(what, box) {
    this.marks.push({ atMs: Math.round(this.clock()), what, ...(box ? { box } : {}) });
  }
  async place(x, y) {
    this.pos = { x, y };
    await this.page.mouse.move(x, y);
  }
  async move(x, y, ms = 450) {
    const from = this.pos;
    const steps = Math.max(6, Math.round(ms / 16.7));
    const dx = x - from.x, dy = y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const arc = Math.min(60, len * 0.12);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = ease(t), bow = Math.sin(Math.PI * e) * arc;
      const px = from.x + dx * e + (-dy / len) * bow, py = from.y + dy * e + (dx / len) * bow;
      await this.page.mouse.move(px, py);
      this.cursor.push({ atMs: Math.round(this.clock()), x: Math.round(px), y: Math.round(py) });
      await this.wait(ms / steps);
    }
    this.pos = { x, y };
  }
  /** Box of a locator in CSS px. */
  async box(locator) {
    const b = await locator.boundingBox();
    if (!b) throw new Error("no box for locator");
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  }
  /** Moves onto a locator (at fx, fy of its box) and returns the box. */
  async hover(locator, { ms = 450, fx = 0.5, fy = 0.5 } = {}) {
    const b = await this.box(locator);
    await this.move(b.x + b.w * fx, b.y + b.h * fy, ms);
    return b;
  }
  async click(locator, { ms = 450, fx = 0.5, fy = 0.5, dwell = 140, what } = {}) {
    const b = await this.hover(locator, { ms, fx, fy });
    await this.wait(dwell);
    this.mark(what ?? "click", b);
    this.cursor.push({ atMs: Math.round(this.clock()), x: Math.round(this.pos.x), y: Math.round(this.pos.y), down: true });
    await this.page.mouse.down();
    await this.wait(90);
    await this.page.mouse.up();
    return b;
  }
}
