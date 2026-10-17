import { describe, expect, it, vi } from "vitest";
import type { ProjectStateVM } from "@/components/state/types";
import { STATE_FILES } from "@/components/state/types";
import { journalPath, renderCharter, renderDecisions, renderJournal, renderJson, renderPrefs, statePath } from "@/server/project-state";
import { tempProject } from "@/server/project-state/test-kit";
import { getVault, RUNTIME } from "@/server/runtime/vault";
import { GET } from "./route";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/*
 * GET /api/projects/[id]/state: every state file in one response, parsed through the state module's read API and
 * shaped for the views, plus each file's last change from the vault, so the views can open its History.
 */
const PID = "p_42";
const T = "2026-10-17T15:00:00.000Z";
const { git } = tempProject();

const get = (id: string, query = "") => GET(new Request(`http://localhost/api/projects/${id}/state${query}`), { params: Promise.resolve({ id }) });

/** One commit per file, the way the tools write; returns each file's change id read back from git itself. */
async function seed() {
  const files: Record<string, string> = {
    [statePath(PID, "dag.json")]: renderJson({
      pid: PID,
      rev: 3,
      updatedAt: T,
      tasks: [
        { id: "t1", kind: "work", title: "Draft copy", status: "blocked", owner: "ana", deps: [], acceptance: "3 tiers", blocker: { text: "tier names", on: "Q-2", since: T }, evidence: [], notes: [], created: T, updated: T, reopened: 0, rev: 3, source: "tool:add_task" },
      ],
    }),
    [statePath(PID, "roster.json")]: renderJson({ rev: 1, updatedAt: T, members: [{ agentId: "ana", role: "writer", archetype: "writer", state: "blocked", lastCheckIn: T, lastReport: null, blockers: [], pmNote: null }] }),
    [statePath(PID, "open.json")]: renderJson({ rev: 2, updatedAt: T, items: [{ id: "Q-2", kind: "question", askOf: "owner", text: "Final tier names?", raised: T, status: "open", links: ["t1"], source: "msg:pm-p_42:3" }] }),
    [statePath(PID, "decisions.md")]: renderDecisions(PID, [{ id: "D-001", date: "2026-10-17", title: "Three tiers", status: "active", decision: "Three.", why: "Simple.", approvedBy: "pm", proposedBy: "pm-p_42", links: [], source: "tool:record_decision" }]),
    [statePath(PID, "prefs.md")]: renderPrefs(PID, [{ id: "P-1", text: "Calm tone.", source: "msg:pm-p_42:1" }]),
    [statePath(PID, "charter.md")]: renderCharter(PID, { title: "Pricing", goal: "Ship it", metric: "4%", deadline: "2026-10-28", scope: "copy, design", outOfScope: "annual billing", qualifications: "writer — SaaS copy", budget: "$15 model spend", approvalRef: "led:2026-10-17T15:00:00.000Z/approval" }),
    [journalPath(PID, 1)]: renderJournal(PID, 1, [{ at: "2026-10-17T15:01Z", rev: 3, text: "pm: kickoff" }]),
  };
  for (const [p, content] of Object.entries(files)) await getVault().write({ path: p, content, author: RUNTIME, source: "tool", subject: `state(${PID}): write ${p.split("/").pop()}` });
  const changeOf = (p: string) => git("log", "-1", "--format=%(trailers:key=Change,valueonly)", "--", p).trim();
  const atOf = (p: string) => git("log", "-1", "--format=%aI", "--", p).trim();
  return { changeOf, atOf };
}

describe("GET /api/projects/[id]/state", () => {
  it("returns every state file, shaped for the views", async () => {
    await seed();
    const res = await get(PID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProjectStateVM;
    expect(body.pid).toBe(PID);
    expect(body.plan.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(body.team.map((m) => m.id)).toEqual(["ana"]);
    expect(body.open.items.map((i) => i.id)).toEqual(["Q-2"]);
    expect(body.decisions.map((d) => d.id)).toEqual(["D-001"]);
    expect(body.prefs).toEqual([{ id: "P-1", text: "Calm tone." }]);
    expect(body.charter?.title).toBe("Pricing");
    expect(body.journal.map((l) => l.text)).toEqual(["kickoff"]);
    expect(body.pm.waiting.questions).toBe(1);
  });

  it("stamps each file with its last change and when it was made, read from the vault", async () => {
    const { changeOf, atOf } = await seed();
    const body = (await (await get(PID)).json()) as ProjectStateVM;
    expect(Object.keys(body.files).sort()).toEqual([...STATE_FILES].sort());
    for (const f of STATE_FILES) {
      const p = f === "journal" ? journalPath(PID, 1) : statePath(PID, f);
      const stamp = body.files[f];
      expect(stamp, f).not.toBeNull();
      expect(stamp!.path).toBe(p);
      expect(stamp!.change, f).toBe(changeOf(p));
      expect(Date.parse(stamp!.updated), f).toBe(Date.parse(atOf(p)));
    }
  });

  it("gives a file the PM hasn't written yet a null stamp, and an empty view", async () => {
    const body = (await (await get(PID)).json()) as ProjectStateVM;
    expect(body.files["dag.json"]).toBeNull();
    expect(body.plan.tasks).toEqual([]);
    expect(body.charter).toBeNull();
  });

  it("fills the lead's context only when the request names the lead", async () => {
    expect(((await (await get(PID)).json()) as ProjectStateVM).pm.context).toBeNull();
    expect(((await (await get(PID, "?lead=juno")).json()) as ProjectStateVM).pm.context?.agentId).toBe("juno");
  });

  it("names the broken file when one isn't in the tools' format", async () => {
    await getVault().write({ path: statePath(PID, "open.json"), content: "{ not json", author: RUNTIME, source: "tool", subject: `state(${PID}): break open.json` });
    const res = await get(PID);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/open\.json/);
  });

  it("refuses a project id that isn't one", async () => {
    expect((await get("../etc")).status).toBe(400);
  });
});
