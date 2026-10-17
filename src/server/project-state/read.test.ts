import { describe, expect, it, vi } from "vitest";
import { getVault, OWNER } from "@/server/runtime/vault";
import { readState, renderCharter, renderDecisions, renderJournal, renderJson, renderPrefs, StateFileError, type Decision } from "./index";
import { tempProject } from "./test-kit";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/*
 * The read side the UI and the window opener use: every state file from the vault's projects/<pid>/state/, parsed and
 * zod-validated, as one typed snapshot.
 */
const PID = "p_42";
const S = (f: string) => `projects/${PID}/state/${f}`;
tempProject();

const put = (p: string, content: string) => getVault().write({ path: p, content, author: OWNER, source: "owner" });
const T = "2026-10-17T15:00:00.000Z";

describe("readState", () => {
  it("reads a project with no state yet as empty files at rev 0", async () => {
    const s = await readState(PID);
    expect(s).toEqual({
      pid: PID,
      rev: 0,
      dag: { pid: PID, rev: 0, updatedAt: null, tasks: [] },
      roster: { rev: 0, updatedAt: null, members: [] },
      open: { rev: 0, updatedAt: null, items: [] },
      decisions: [],
      prefs: [],
      charter: null,
      journal: { window: 1, lines: [] },
    });
  });

  it("reads every state file back from the vault, typed, with the project rev of the newest write", async () => {
    const task = { id: "t1", kind: "work", title: "Copy", status: "ready", owner: "ana", deps: [], acceptance: "x", blocker: null, evidence: [], notes: [], created: T, updated: T, reopened: 0, rev: 5, source: "tool:add_task" };
    await put(S("dag.json"), renderJson({ pid: PID, rev: 5, updatedAt: T, tasks: [task] }));
    await put(S("roster.json"), renderJson({ rev: 3, updatedAt: T, members: [{ agentId: "ana", role: "writer", archetype: "writer", state: "idle", lastCheckIn: null, lastReport: null, blockers: [], pmNote: null }] }));
    await put(S("open.json"), renderJson({ rev: 4, updatedAt: T, items: [] }));
    const decision: Decision = { id: "D-001", date: "2026-10-17", title: "Tiers", status: "active", decision: "Three.", why: "Simple.", approvedBy: "pm", proposedBy: "pm-p_42", links: [], source: "tool:record_decision" };
    await put(S("decisions.md"), renderDecisions(PID, [decision]));
    await put(S("prefs.md"), renderPrefs(PID, [{ id: "P-1", text: "Calm tone.", source: "msg:pm-p_42:40" }]));
    const charter = { title: "Pricing", goal: "g", metric: "m", deadline: "2026-10-28", scope: "s", outOfScope: "o", qualifications: "q", budget: "b", approvalRef: "led:2026-10-17T15:00:00.000Z/approval" };
    await put(S("charter.md"), renderCharter(PID, charter));
    await put(S("journal/1.md"), renderJournal(PID, 1, [{ at: "2026-10-17T15:01Z", rev: 7, text: "pm: kickoff" }]));

    const s = await readState(PID);

    expect(s.rev).toBe(7);
    expect(s.dag.tasks).toEqual([task]);
    expect(s.roster.members.map((m) => m.agentId)).toEqual(["ana"]);
    expect(s.decisions).toEqual([decision]);
    expect(s.prefs).toEqual([{ id: "P-1", text: "Calm tone.", source: "msg:pm-p_42:40" }]);
    expect(s.charter).toEqual(charter);
    expect(s.journal).toEqual({ window: 1, lines: [{ at: "2026-10-17T15:01Z", rev: 7, text: "pm: kickoff" }] });
  });

  it("refuses a state file that isn't in the tools' format, naming the file", async () => {
    await put(S("dag.json"), renderJson({ pid: PID, rev: 1, updatedAt: T, tasks: [{ id: "t1", title: "no status" }] }));
    await expect(readState(PID)).rejects.toBeInstanceOf(StateFileError);
    await expect(readState(PID)).rejects.toThrow(/dag\.json/);
  });

  it("reads the newest journal window", async () => {
    await put(S("journal/1.md"), renderJournal(PID, 1, [{ at: "2026-10-17T15:01Z", rev: 1, text: "pm: one" }]));
    await put(S("journal/2.md"), renderJournal(PID, 2, [{ at: "2026-10-17T15:02Z", rev: 2, text: "pm: two" }]));
    const s = await readState(PID);
    expect(s.journal).toEqual({ window: 2, lines: [{ at: "2026-10-17T15:02Z", rev: 2, text: "pm: two" }] });
    expect(s.rev).toBe(2);
  });
});
