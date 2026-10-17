import { describe, expect, it } from "vitest";
import { DIGEST_MAX_TOKENS, estimateTokens, parseDecisions, recite, renderDecisions, renderDigest, renderJson } from "./index";
import type { Decision, Item, Member, ProjectState, Task } from "./schema";

/*
 * The window opener's <project_state> digest and the recite line (F §3.1, §4.1): code-rendered, deterministic, and
 * within 4K tokens however full the caps let the state get.
 */
const T0 = "2026-10-17T15:00:00.000Z";

function mkTask(p: Partial<Task> & Pick<Task, "id" | "title" | "status">): Task {
  return { kind: "work", owner: null, deps: [], acceptance: "", blocker: null, evidence: [], notes: [], created: T0, updated: T0, reopened: 0, rev: 1, source: "tool:add_task", ...p };
}
const mkMember = (p: Partial<Member> & Pick<Member, "agentId" | "role">): Member => ({ archetype: p.role, state: "idle", lastCheckIn: null, lastReport: null, blockers: [], pmNote: null, ...p });
const mkItem = (p: Partial<Item> & Pick<Item, "id" | "text">): Item => ({ kind: "question", askOf: "owner", raised: T0, status: "open", links: [], source: "tool:raise_item", ...p });
const mkDecision = (p: Partial<Decision> & Pick<Decision, "id" | "title">): Decision => ({
  date: "2026-10-16",
  status: "active",
  decision: "d",
  why: "w",
  approvedBy: "pm",
  proposedBy: "pm-p_42",
  links: [],
  source: "tool:record_decision",
  ...p,
});

/** The F §4.1 sample project. */
function pricingProject(): ProjectState {
  const tasks: Task[] = [
    mkTask({ id: "m1", kind: "milestone", title: "Copy+design", status: "ready", owner: "pm" }),
    ...[1, 2, 3, 4].map((n) => mkTask({ id: `t${n}`, title: `Done task ${n}`, status: "done", owner: "ana", milestone: "m1", evidence: ["file:projects/p_42/files/x.md"], updated: "2026-10-17T12:00:00.000Z" })),
    mkTask({ id: "t5", title: "Hero section", status: "in_progress", owner: "bo", milestone: "m1" }),
    mkTask({ id: "t6", title: "FAQ copy", status: "todo", owner: "ana", milestone: "m1", deps: ["t7"] }),
    mkTask({
      id: "t7",
      title: "Draft pricing page copy",
      status: "blocked",
      owner: "ana",
      milestone: "m1",
      deps: ["t3"],
      acceptance: "3 tiers",
      blocker: { text: "needs final tier names", on: "Q-2", since: "2026-10-17T17:40:00.000Z" },
      lastReport: { at: "2026-10-17T17:41:00.000Z", by: "ana", status: "blocked", summary: "v1 Pro/Team done; Free blocked", ref: "projects/p_42/files/reports/t7-02.md" },
    }),
    mkTask({ id: "t8", title: "Page layout in Figma", status: "ready", owner: "bo", milestone: "m1" }),
    mkTask({ id: "t9", title: "Stripe checkout links", status: "ready", milestone: "m1" }),
    mkTask({ id: "t11", kind: "todo", title: "Review t3 deliverable", status: "ready", owner: "pm", due: "2026-10-17" }),
  ];
  return {
    pid: "p_42",
    rev: 58,
    dag: { pid: "p_42", rev: 58, updatedAt: "2026-10-17T19:02:11.000Z", tasks },
    roster: {
      rev: 31,
      updatedAt: "2026-10-17T18:55:00.000Z",
      members: [
        mkMember({ agentId: "ana", role: "writer", state: "blocked", lastCheckIn: "2026-10-17T17:41:00.000Z", blockers: [{ text: "tier names", on: "Q-2", task: "t7" }] }),
        mkMember({ agentId: "bo", role: "designer", state: "idle", lastCheckIn: "2026-10-17T18:55:00.000Z" }),
      ],
    },
    open: {
      rev: 12,
      updatedAt: T0,
      items: [
        mkItem({ id: "Q-2", text: "Final names for the three tiers?", raised: "2026-10-17T17:42:00.000Z", due: "2026-10-18", links: ["t7"] }),
        mkItem({ id: "R-1", kind: "risk", askOf: "pm", text: "Stripe test keys not provisioned", severity: "high", links: ["t9"] }),
        mkItem({ id: "Q-1", text: "Which tiers?", status: "resolved", resolution: "three" }),
      ],
    },
    decisions: [
      mkDecision({ id: "D-003", title: "Two tiers", status: "superseded by D-007" }),
      mkDecision({ id: "D-005", title: "Figma not Framer" }),
      mkDecision({ id: "D-007", title: "Three tiers, no annual", approvedBy: "owner", approvalRef: "led:2026-10-16T21:04:11.000Z/approval", supersedes: "D-003" }),
    ],
    prefs: [],
    charter: null,
    journal: { window: 1, lines: [{ at: "2026-10-17T17:41Z", rev: 57, text: "t7 blocked (ana): needs final tier names" }] },
  };
}

/** Reverses every object's key order, so a renderer that relies on insertion order shows it. */
function reverseKeys<T>(v: T): T {
  if (Array.isArray(v)) return v.map(reverseKeys) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) as T;
  return v;
}

describe("the digest", () => {
  it("shows t7 as blocked under ana, on Q-2, with its last report", () => {
    const d = renderDigest(pricingProject());
    expect(d.startsWith('<project_state rev="58" as_of="2026-10-17T19:02Z">\n')).toBe(true);
    expect(d).toMatch(/^- t7 \[blocked\] Draft pricing page copy — ana — on Q-2 since 17:40 — last 17:41 "v1 Pro\/Team done; Free blocked"$/m);
    expect(d).toMatch(/^PLAN m1 "Copy\+design" 4\/9 done · 1 blocked · 2 ready$/m);
    expect(d).toMatch(/^TODOS \(pm\): t11 \[ready\] Review t3 deliverable \(due 10-17\)$/m);
    expect(d).toMatch(/^DECISIONS \(active\): D-007 Three tiers, no annual \(owner\) \| D-005 Figma not Framer \(pm\)$/m);
    expect(d).not.toContain("D-003");
    expect(d).not.toContain("Q-1");
    expect(d.endsWith("</project_state>")).toBe(true);
  });

  it("renders the same state byte for byte, whatever order its keys arrive in", () => {
    const a = renderDigest(pricingProject());
    expect(renderDigest(pricingProject())).toBe(a);
    expect(renderDigest(reverseKeys(pricingProject()))).toBe(a);
    const shuffled = pricingProject();
    shuffled.dag.tasks.reverse();
    shuffled.decisions.reverse();
    expect(renderDigest(shuffled)).toBe(a);
  });

  it("stays within 4K tokens with 60 open tasks at full field lengths, keeping every open task, owner, blocker and item id", () => {
    const long = (n: number, tag: string) => `${tag} ${"lorem ipsum dolor sit amet ".repeat(30)}`.slice(0, n).trim();
    const statuses = ["blocked", "in_progress", "review", "ready", "todo"] as const;
    const tasks: Task[] = Array.from({ length: 60 }, (_, i) =>
      mkTask({
        id: `t${i + 1}`,
        kind: i % 6 === 0 ? "todo" : "work",
        title: long(120, `T${i + 1}`),
        status: statuses[i % 5],
        owner: `agent-${(i % 12) + 1}`,
        deps: statuses[i % 5] === "todo" ? [`t${i}`] : [],
        due: "2026-10-28",
        acceptance: long(400, "acc"),
        blocker: statuses[i % 5] === "blocked" ? { text: long(200, "blocker"), on: `Q-${(i % 20) + 1}`, since: T0 } : null,
        lastReport: { at: T0, by: `agent-${(i % 12) + 1}`, status: "progress", summary: long(300, "summary"), ref: "projects/p_42/files/reports/t1-01.md" },
      }),
    );
    const state: ProjectState = {
      ...pricingProject(),
      dag: { pid: "p_42", rev: 999, updatedAt: T0, tasks },
      roster: { rev: 1, updatedAt: T0, members: Array.from({ length: 12 }, (_, i) => mkMember({ agentId: `agent-${i + 1}`, role: long(80, "role"), state: "blocked", lastCheckIn: T0, blockers: [{ text: long(200, "b"), on: "Q-1" }] })) },
      open: { rev: 1, updatedAt: T0, items: Array.from({ length: 20 }, (_, i) => mkItem({ id: `Q-${i + 1}`, text: long(300, "question"), due: "2026-10-20", links: ["t1", "t2", "t3"] })) },
      decisions: Array.from({ length: 25 }, (_, i) => mkDecision({ id: `D-${String(i + 1).padStart(3, "0")}`, title: long(120, "decision") })),
      journal: { window: 1, lines: Array.from({ length: 30 }, (_, i) => ({ at: "2026-10-17T17:41Z", rev: i + 1, text: long(400, "journal") })) },
    };

    const d = renderDigest(state);

    expect(estimateTokens(d)).toBeLessThanOrEqual(DIGEST_MAX_TOKENS);
    expect(d.length).toBeLessThanOrEqual(DIGEST_MAX_TOKENS * 3);
    // One entry per task: a line, or one " | " segment of a joined line such as TODOS.
    const entries = d.split(/\n| \| /);
    for (const t of tasks) {
      const row = entries.find((l) => new RegExp(`(^|[ :])${t.id} \\[`).test(l));
      expect(row, `${t.id} is in the digest`).toBeDefined();
      expect(row).toContain(t.owner!);
      if (t.blocker) expect(row).toContain(`on ${t.blocker.on}`);
    }
    for (const q of state.open.items) expect(d).toMatch(new RegExp(`\\b${q.id}\\b`));
  });

  it("estimates tokens conservatively: never fewer than a chars/4 count, and one per non-ASCII glyph", () => {
    expect(estimateTokens("a".repeat(400))).toBeGreaterThanOrEqual(100);
    expect(estimateTokens("·—→".repeat(10))).toBeGreaterThanOrEqual(30);
  });
});

describe("the recite line", () => {
  it("restates the plan in one line, as F §3.1 describes", () => {
    expect(recite(pricingProject())).toBe("DAG r58 · 4/9 done · blocked: t7(ana→Q-2) · ready: t8(bo), t9(unassigned) · todos: t11");
  });

  it("stays one bounded line however many tasks are open", () => {
    const s = pricingProject();
    s.dag.tasks = Array.from({ length: 60 }, (_, i) => mkTask({ id: `t${i + 1}`, title: "x", status: "ready", owner: "ana" }));
    const r = recite(s);
    expect(r).not.toContain("\n");
    expect(r.length).toBeLessThanOrEqual(300);
    expect(r).toMatch(/\+\d+ more/);
  });
});

describe("file formats", () => {
  it("serializes JSON with sorted keys, so the same state is the same bytes", () => {
    const s = pricingProject();
    const a = renderJson(s.dag);
    expect(renderJson(reverseKeys(s.dag))).toBe(a);
    expect(JSON.parse(a)).toEqual(s.dag);
    expect(a.endsWith("}\n")).toBe(true);
  });

  it("writes decisions.md as ADR entries that parse back to the same decisions", () => {
    const ds = pricingProject().decisions;
    const md = renderDecisions("p_42", ds);
    expect(md).toContain("## D-007 · 2026-10-16 · Three tiers, no annual\n- Status: active\n");
    expect(md).toContain("- Approved by: owner (led:2026-10-16T21:04:11.000Z/approval) · proposed by pm-p_42\n");
    expect(parseDecisions(md)).toEqual(ds);
  });
});
