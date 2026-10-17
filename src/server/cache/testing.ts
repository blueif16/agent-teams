/* Test helpers for the server cache. Not imported by app code. */
import type { CallEvent } from "@/lib/ledger";
import type { Bus, Change } from "./bus";

/** One model call by Mira, as the chat route records it. */
export function callEvent(over: Partial<CallEvent> = {}): CallEvent {
  return {
    t: "call",
    kind: "reply",
    at: "2026-10-17T10:00:00.000Z",
    team: "company",
    agent: "mira",
    model: "deepseek-ai/DeepSeek-V4.1-Flash",
    asked: "deepseek-ai/DeepSeek-V4.1-Flash",
    input: 1000,
    cached: 256,
    output: 20,
    ms: 900,
    cost: 0.0004,
    ok: true,
    ...over,
  };
}

/** Resolves with the next change on exactly `topic`; rejects after `ms`. */
export function nextChange(bus: Bus, topic: string, ms = 3000): Promise<Change> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`no "${topic}" change within ${ms} ms`));
    }, ms);
    const off = bus.subscribe([topic], (c) => {
      if (c.topic !== topic) return;
      clearTimeout(timer);
      off();
      resolve(c);
    });
  });
}
