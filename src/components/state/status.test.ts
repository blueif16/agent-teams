import { describe, expect, it } from "vitest";
import type { TaskStatus } from "./types";
import { BOARD_COLUMNS, statusMeta, TONE } from "./status";

/*
 * One mapping from a task's status to its colour and its board column, shared by the graph, the board, the
 * drawer and the status strip (spec: blocked = danger, review = caution, done = muted with a check, in progress
 * = accent; colours from our tokens only).
 */
const ALL: TaskStatus[] = ["todo", "ready", "in_progress", "review", "blocked", "done", "failed", "dropped"];

describe("statusMeta", () => {
  it("colours blocked as danger, review as caution, in progress as accent and done as muted with a check", () => {
    expect(statusMeta("blocked").tone).toBe("danger");
    expect(statusMeta("review").tone).toBe("caution");
    expect(statusMeta("in_progress").tone).toBe("accent");
    expect(statusMeta("done").tone).toBe("muted");
    expect(statusMeta("done").check).toBe(true);
    expect(statusMeta("in_progress").check).toBe(false);
  });

  it("puts todo and ready under Up next, and each other open status in its own column", () => {
    expect(statusMeta("todo").column).toBe("next");
    expect(statusMeta("ready").column).toBe("next");
    expect(statusMeta("in_progress").column).toBe("doing");
    expect(statusMeta("blocked").column).toBe("blocked");
    expect(statusMeta("review").column).toBe("review");
    expect(statusMeta("done").column).toBe("done");
  });

  it("keeps failed and dropped out of Done", () => {
    expect(statusMeta("failed").column).toBe("closed");
    expect(statusMeta("dropped").column).toBe("closed");
    expect(statusMeta("failed").tone).toBe("danger");
  });

  it("gives every status a column the board draws, in the board's order", () => {
    const keys = BOARD_COLUMNS.map((c) => c.key);
    for (const s of ALL) expect(keys, s).toContain(statusMeta(s).column);
    expect(keys).toEqual(["next", "doing", "blocked", "review", "done", "closed"]);
  });

  it("draws each tone with our theme tokens, not ad-hoc colours", () => {
    expect(TONE.danger.dot).toContain("bg-danger");
    expect(TONE.caution.dot).toContain("bg-amber");
    expect(TONE.accent.dot).toContain("bg-accent");
    expect(TONE.danger.chip).toContain("bg-danger-wash");
    expect(TONE.caution.chip).toContain("bg-caution-wash");
    for (const t of Object.values(TONE)) expect(`${t.dot} ${t.chip}`).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
