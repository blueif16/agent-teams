import { describe, expect, it } from "vitest";
import type { CompactionEvent } from "@/lib/compaction";
import { compactionTriggers, contextFill } from "@/lib/context-budget";
import type { CallEvent } from "@/lib/ledger";
import { MODELS } from "@/lib/models";
import type { Dag, Decision, Item, Member, Task } from "@/server/project-state";
import { contextFor, toDecisions, toOpen, toPlan, toTeam, whoResolver } from "./state-view";

/*
 * The adapters from the state module's files to the views' models. What they decide is what the owner reads first:
 * active decisions before superseded ones, each superseded one pointing at its successor; questions waiting on the
 * owner before everything else; and a context bar that follows the agent's real model calls.
 */
const PID = "p_42";
const T = "2026-10-17T15:00:00.000Z";
const who = whoResolver([], "juno");

function decision(id: string, title: string, status: Decision["status"], extra: Partial<Decision> = {}): Decision {
  return { id, date: "2026-10-16", title, status, decision: `${title}.`, why: "Because.", approvedBy: "pm", proposedBy: "pm-p_42", links: [], source: "tool:record_decision", ...extra };
}

describe("toDecisions", () => {
  const out = toDecisions(
    [
      decision("D-001", "Figma, not Framer", "active"),
      decision("D-002", "Two tiers", "superseded by D-004"),
      decision("D-003", "Launch on a Tuesday", "revoked"),
      decision("D-004", "Three tiers", "active", { supersedes: "D-002", approvedBy: "owner", approvalRef: "led:2026-10-16T21:04:11Z/approval" }),
    ],
    who,
  );

  it("lists active decisions first, newest first, then the rest newest first", () => {
    expect(out.map((d) => d.id)).toEqual(["D-004", "D-001", "D-003", "D-002"]);
  });

  it("marks a superseded decision and links it to its successor, and the successor back to it", () => {
    const old = out.find((d) => d.id === "D-002")!;
    expect(old.status).toBe("superseded");
    expect(old.supersededBy).toBe("D-004");
    expect(out.find((d) => d.id === "D-004")!.supersedes).toBe("D-002");
    expect(out.find((d) => d.id === "D-003")!.status).toBe("revoked");
  });

  it("names who approved and who proposed, with the PM's thread id read as the PM", () => {
    expect(out.find((d) => d.id === "D-004")!.approvedBy).toBe("owner");
    expect(out[0].proposedBy).toEqual({ kind: "pm" });
  });
});

function item(id: string, kind: Item["kind"], askOf: string, raised: string, extra: Partial<Item> = {}): Item {
  return { id, kind, askOf, text: `${id} text`, raised, status: "open", links: [], source: "msg:pm-p_42:1", ...extra };
}

const emptyDag: Dag = { pid: PID, rev: 0, updatedAt: null, tasks: [] };

describe("toOpen", () => {
  const out = toOpen(
    {
      rev: 9,
      updatedAt: T,
      items: [
        item("R-1", "risk", "pm", "2026-10-17T09:00:00.000Z", { severity: "low" }),
        item("Q-1", "question", "ana", "2026-10-17T08:00:00.000Z"),
        item("Q-3", "question", "owner", "2026-10-17T12:00:00.000Z"),
        item("R-2", "risk", "pm", "2026-10-17T11:00:00.000Z", { severity: "high" }),
        item("Q-4", "question", "owner", "2026-10-17T07:00:00.000Z", { status: "resolved", resolution: "Yes", resolvedAt: "2026-10-17T07:30:00.000Z" }),
        item("Q-2", "question", "owner", "2026-10-17T10:00:00.000Z"),
      ],
    },
    emptyDag,
    who,
  );

  it("puts open questions to the owner first, the longest waiting first", () => {
    expect(out.items.slice(0, 2).map((i) => i.id)).toEqual(["Q-2", "Q-3"]);
    expect(out.items.slice(0, 2).every((i) => i.group === "you")).toBe(true);
  });

  it("then risks by severity, then the rest, and folds resolved items to the end", () => {
    expect(out.items.map((i) => i.id)).toEqual(["Q-2", "Q-3", "R-2", "R-1", "Q-1", "Q-4"]);
    expect(out.items.map((i) => i.group)).toEqual(["you", "you", "risk", "risk", "other", "resolved"]);
  });

  it("lists review tasks whose acceptance names the owner as approvals waiting on you", () => {
    const review = task("t8", "review", { acceptance: "Owner approves the built page" });
    const pmReview = task("t9", "review", { acceptance: "PM checks the links" });
    const o = toOpen({ rev: 1, updatedAt: T, items: [] }, { ...emptyDag, tasks: [review, pmReview] }, who);
    expect(o.approvals.map((a) => a.id)).toEqual(["t8"]);
  });
});

function task(id: string, status: Task["status"], extra: Partial<Task> = {}): Task {
  return {
    id, kind: "work", title: `${id} title`, status, owner: "ana", deps: [], acceptance: "x", blocker: null, evidence: [], notes: [],
    created: T, updated: T, reopened: 0, rev: 1, source: "tool:add_task", ...extra,
  };
}

describe("toPlan", () => {
  it("counts progress over work only, and keeps milestones out of the task list", () => {
    const plan = toPlan(
      {
        ...emptyDag,
        tasks: [
          task("m1", "in_progress", { kind: "milestone", owner: "pm", title: "Copy and design" }),
          task("t1", "done", { milestone: "m1" }),
          task("t2", "blocked", { milestone: "m1", blocker: { text: "tier names", on: "Q-2", since: T } }),
          task("t3", "done", { kind: "todo", owner: "pm" }),
          task("t4", "in_progress"),
        ],
      },
      who,
    );
    expect(plan.tasks.map((t) => t.id)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(plan.progress).toEqual({ done: 1, total: 3, blocked: 1, review: 0, inProgress: 1 });
    expect(plan.milestones).toEqual([{ id: "m1", title: "Copy and design", status: "in_progress", due: null, done: 1, total: 2 }]);
  });
});

function call(agent: string, team: string, input: number, at: string, model: string = MODELS.main): CallEvent {
  return { t: "call", kind: "run", at, team, agent, model, asked: model, input, cached: 0, output: 10, ms: 100, cost: 0.001, ok: true };
}

function compaction(agent: string, project: string, at: string, window: number): CompactionEvent {
  return {
    t: "compaction", at, agent, project, thread: `${agent}-${project}`, window, trigger: "soft", before: 0.8, after: 0.2,
    steps: [{ kind: "filed", files: [], items: 0 }, { kind: "summarized" }, { kind: "rebuilt" }, { kind: "checked", passed: 4, total: 4 }],
    degraded: false, ms: 900, usd: 0.01,
  };
}

describe("contextFor", () => {
  const events = [
    call("juno", PID, 20_000, "2026-10-17T10:00:00.000Z"),
    call("juno", PID, 48_000, "2026-10-17T11:00:00.000Z"),
    call("juno", "other-project", 90_000, "2026-10-17T12:00:00.000Z"),
    call("ana", PID, 70_000, "2026-10-17T12:30:00.000Z"),
    compaction("juno", PID, "2026-10-17T08:00:00.000Z", 1),
    compaction("juno", PID, "2026-10-17T09:00:00.000Z", 2),
    compaction("juno", "other-project", "2026-10-17T09:30:00.000Z", 1),
    compaction("juno", PID, "2026-10-17T10:30:00.000Z", 3),
    compaction("juno", PID, "2026-10-17T11:30:00.000Z", 4),
  ];

  it("fills the bar from the agent's latest model call on this project, against its role's triggers", () => {
    const c = contextFor(events, "juno", PID, "lead");
    const expected = contextFill(48_000, compactionTriggers("lead", { model: MODELS.main }));
    expect(c.used).toBeCloseTo(expected.used, 6);
    expect(c.compactsAt).toBeCloseTo(expected.compactsAt, 6);
    expect(c.used).not.toBeCloseTo(contextFill(48_000, compactionTriggers("worker", { model: MODELS.main })).used, 3);
  });

  it("keeps the last three compactions on this project, newest first", () => {
    expect(contextFor(events, "juno", PID, "lead").compactions.map((c) => c.window)).toEqual([4, 3, 2]);
  });

  it("has no fill before the agent's first model call, and no made-up compactions", () => {
    const c = contextFor(events, "bo", PID, "worker");
    expect(c.used).toBeNull();
    expect(c.compactions).toEqual([]);
    expect(c.compactsAt).toBeGreaterThan(0);
  });
});

describe("toTeam", () => {
  const member = (agentId: string, extra: Partial<Member> = {}): Member => ({
    agentId, role: "writer", archetype: "writer", state: "working", lastCheckIn: T, lastReport: null, blockers: [], pmNote: null, ...extra,
  });

  it("derives each member's current task and load from the plan, never from the roster", () => {
    const dag = { ...emptyDag, tasks: [task("t1", "done"), task("t2", "blocked"), task("t3", "in_progress"), task("t4", "todo", { owner: "bo" })] };
    const [ana] = toTeam({ rev: 1, updatedAt: T, members: [member("ana")] }, dag, () => ({ agentId: "ana", used: null, compactsAt: 0.6, compactions: [] }));
    expect(ana.current).toEqual({ id: "t3", title: "t3 title", status: "in_progress" });
    expect(ana.load).toEqual({ open: 2, done: 1 });
  });
});
