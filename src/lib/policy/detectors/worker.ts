/*
 * Runs the local pack in worker_threads so a runaway regex can be stopped (E §3: V8 backtracks where Go's RE2 is
 * linear). The worker is started from source text (`createEngine.toString()`), so no bundler has to find a worker file.
 * It posts each rule's spans as soon as that rule finishes; on timeout the host terminates it and keeps what arrived.
 */
import { Worker } from "node:worker_threads";
import { createEngine, type RawSpan, type RuleSpec, type SetAllowlists } from "./engine";

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const engine = (${createEngine.toString()})();
const prepared = engine.prepare(workerData.rules, workerData.allow);
parentPort.on("message", ({ id, text, extraRules }) => {
  try {
    const rules = extraRules && extraRules.length ? prepared.concat(engine.prepare(extraRules, {})) : prepared;
    const lower = text.toLowerCase();
    for (const rule of rules) {
      const spans = engine.runRule(rule, text, lower);
      if (spans.length) parentPort.postMessage({ id, type: "spans", spans });
    }
    parentPort.postMessage({ id, type: "done" });
  } catch (e) {
    parentPort.postMessage({ id, type: "error", message: String((e && e.message) || e) });
  }
});
`;

type Message = { id: number; type: "spans"; spans: RawSpan[] } | { id: number; type: "done" } | { id: number; type: "error"; message: string };

export interface WorkerRun {
  spans: RawSpan[];
  timedOut: boolean;
  /** Set when the worker could not run the scan (it failed to start or threw). */
  error?: string;
}

/** Idle workers kept for reuse; more than this are terminated when they finish. */
const MAX_IDLE = 2;

export class ScanWorkerPool {
  private idle: Worker[] = [];
  private nextId = 1;

  constructor(
    private readonly rules: RuleSpec[],
    private readonly allow: SetAllowlists,
  ) {}

  private spawn(): Worker {
    const w = new Worker(WORKER_SOURCE, { eval: true, workerData: { rules: this.rules, allow: this.allow } });
    w.unref();
    return w;
  }

  run(text: string, timeoutMs: number, extraRules: RuleSpec[] = []): Promise<WorkerRun> {
    const worker = this.idle.pop() ?? this.spawn();
    const id = this.nextId++;
    const spans: RawSpan[] = [];
    return new Promise<WorkerRun>((resolve) => {
      let settled = false;
      const finish = (result: WorkerRun, reusable: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.off("message", onMessage);
        worker.off("error", onError);
        worker.off("exit", onExit);
        if (reusable && this.idle.length < MAX_IDLE) this.idle.push(worker);
        else void worker.terminate();
        resolve(result);
      };
      const onMessage = (m: Message) => {
        if (m.id !== id) return;
        if (m.type === "spans") spans.push(...m.spans);
        else if (m.type === "done") finish({ spans, timedOut: false }, true);
        else finish({ spans, timedOut: false, error: m.message }, true);
      };
      const onError = (e: Error) => finish({ spans, timedOut: false, error: `worker error: ${e.message}` }, false);
      const onExit = (code: number) => finish({ spans, timedOut: false, error: `worker exited (${code})` }, false);
      const timer = setTimeout(() => finish({ spans, timedOut: true }, false), timeoutMs);
      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.on("exit", onExit);
      worker.postMessage({ id, text, extraRules });
    });
  }
}
