/*
 * Tests only: a plan shaped like a real kickoff (12 tasks across 2 milestones, one blocked on an owner question).
 * Never imported by app code; no demo data ships (DECISIONS → Product).
 */
import type { PlanVM, TaskStatus, TaskVM, Who } from "./types";

const ana: Who = { kind: "agent", id: "ana", name: "Ana", archetype: "writer" };
const bo: Who = { kind: "agent", id: "bo", name: "Bo", archetype: "designer" };
const cy: Who = { kind: "agent", id: "cy", name: "Cy", archetype: "engineer" };
const pm: Who = { kind: "pm" };

const T = "2026-10-17T15:00:00.000Z";

function task(id: string, title: string, status: TaskStatus, owner: Who, deps: string[], milestone: string | null, extra: Partial<TaskVM> = {}): TaskVM {
  return {
    id,
    kind: owner.kind === "pm" ? "todo" : "work",
    title,
    status,
    owner,
    deps,
    milestone,
    due: null,
    acceptance: `${title}, checked by the PM`,
    detail: null,
    blocker: null,
    evidence: [],
    lastReport: null,
    updated: T,
    reopened: 0,
    needsYou: false,
    ...extra,
  };
}

export function planFixture(): PlanVM {
  const tasks: TaskVM[] = [
    task("t1", "Audit the current pricing page", "done", ana, [], "m1"),
    task("t2", "Scan competitor pricing", "done", ana, [], "m1"),
    task("t3", "Pick the three tiers", "done", pm, ["t1", "t2"], "m1"),
    task("t4", "Page layout in Figma", "in_progress", bo, ["t3"], "m1"),
    task("t5", "Draft pricing page copy", "blocked", ana, ["t3"], "m1", {
      blocker: { text: "needs final tier names", on: "Q-2", since: T },
    }),
    task("t6", "Visual polish pass", "todo", bo, ["t4"], "m1"),
    task("t7", "Copy review", "todo", pm, ["t5"], "m1"),
    task("t8", "Build the page in Next.js", "review", cy, ["t4"], "m2", { needsYou: true }),
    task("t9", "Stripe checkout links", "todo", cy, ["t7", "t8"], "m2"),
    task("t10", "Analytics events", "ready", cy, ["t8"], "m2"),
    task("t11", "Launch checklist", "todo", pm, ["t9", "t10", "t6"], "m2"),
    task("t12", "Announce in the changelog", "todo", ana, ["t11"], null),
  ];
  const work = tasks.filter((t) => t.kind === "work");
  return {
    tasks,
    milestones: [
      { id: "m1", title: "Copy and design", status: "in_progress", due: "2026-10-22", done: 2, total: 5 },
      { id: "m2", title: "Checkout and launch", status: "todo", due: "2026-10-28", done: 0, total: 3 },
    ],
    progress: {
      done: work.filter((t) => t.status === "done").length,
      total: work.length,
      blocked: work.filter((t) => t.status === "blocked").length,
      review: work.filter((t) => t.status === "review").length,
      inProgress: work.filter((t) => t.status === "in_progress").length,
    },
  };
}
