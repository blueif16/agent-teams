// Agent runs on the fake /api/runs stream: events start|now|token|done, data {type, thread:"a:<agent>:p:<project>",
// run, text?} (src/lib/live-runs.ts). Adds window.__stage.run(thread, text, opts) on top of autocap's stage;
// it resolves (page time) when the run is done. Must be installed after the stage (rec.config.mjs prepare).
const RUNS = () => {
  const S = window.__stage;
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
};

export const installRuns = (page) => page.addInitScript(RUNS);
