import { describe, expect, it } from "vitest";
import { parseThreadId, ThreadQueue, threadId } from "./threads";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe("thread ids", () => {
  it("parse back to their agent and project, and reject anything else", () => {
    expect(parseThreadId(threadId("mira", "dm"))).toEqual({ agentId: "mira", projectId: "dm" });
    expect(parseThreadId("a:mira")).toBeNull();
    expect(parseThreadId("a:mira:p:dm:x")).toBeNull();
  });
});

describe("ThreadQueue", () => {
  it("runs one job per thread at a time, in the order they came", async () => {
    const log: string[] = [];
    let running = 0;
    let overlap = false;
    const q = new ThreadQueue<string>(async (_t, job) => {
      if (++running > 1) overlap = true;
      log.push(`start ${job}`);
      await tick(job === "a" ? 20 : 1);
      log.push(`end ${job}`);
      running--;
    });

    const done = [q.enqueue("t", "a"), q.enqueue("t", "b"), q.enqueue("t", "c")];
    expect(q.isBusy("t")).toBe(true);
    await Promise.all(done);

    expect(overlap).toBe(false);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    expect(q.isBusy("t")).toBe(false);
  });

  it("keeps going after a job throws", async () => {
    const ran: string[] = [];
    const q = new ThreadQueue<string>(async (_t, job) => {
      ran.push(job);
      if (job === "bad") throw new Error("boom");
    });
    await expect(q.enqueue("t", "bad")).rejects.toThrow("boom");
    await q.enqueue("t", "good");
    expect(ran).toEqual(["bad", "good"]);
  });

  it("asks for a follow-up job before going idle, with nothing in between", async () => {
    const ran: string[] = [];
    let owed = 1;
    const q = new ThreadQueue<string>(
      async (_t, job) => {
        ran.push(job);
      },
      () => (owed-- > 0 ? "follow-up" : undefined),
    );
    await q.enqueue("t", "first");
    await q.idle("t");
    expect(ran).toEqual(["first", "follow-up"]);
    expect(q.isBusy("t")).toBe(false);
  });
});
