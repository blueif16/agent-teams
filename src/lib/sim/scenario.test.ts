import { describe, expect, it } from "vitest";
import { parseScenario } from "./scenario";

/** The smallest scenario the schema accepts, as a plain object (what YAML parses to). */
const minimal = () => ({
  id: "demo",
  family: "demo",
  title: "Demo",
  summary: "A small scenario for schema tests.",
  story: "story.md",
  brief: "brief.md",
  request: { text: "Hi Mira, please start a project." },
  owner: { persona: "Short and plain.", known: ["Deadline: Friday."] },
  expect: {
    triage: "project",
    maxExperts: 3,
    archetypes: ["writer"],
    deliverables: [{ id: "copy", title: "Landing copy", type: "doc", by: "writer" }],
  },
  rubric: [{ id: "copy-exists", deliverable: "copy", kind: "code", check: "exists", label: "The copy exists" }],
  stop: { when: "all_accepted", maxOwnerActions: 10, maxWallMin: 30, idleMin: 5 },
  budget: { maxUsd: 1, maxTokens: 1_000_000 },
});

const errorOf = (raw: unknown) => {
  const r = parseScenario(raw);
  if (r.ok) throw new Error("expected the scenario to be rejected");
  return r.error;
};

describe("parseScenario", () => {
  it("accepts a minimal scenario and fills the defaults", () => {
    const r = parseScenario(minimal());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenario.trials).toBe(3);
    expect(r.scenario.arms).toEqual(["team"]);
    expect(r.scenario.variant).toBe("base");
    expect(r.scenario.owner.unknownReply.length).toBeGreaterThan(0);
    expect(r.scenario.beats).toEqual([]);
  });

  it("sets an improvement bar by default, so a flat second run stops the series", () => {
    const r = parseScenario(minimal());
    if (!r.ok) throw new Error(r.error);
    expect(r.scenario.improve.minQualityGain).toBeGreaterThan(0);
    expect(r.scenario.improve.minTimeCut).toBeGreaterThan(0);
    expect(r.scenario.improve.minTokenCut).toBeGreaterThan(0);
  });

  it("rejects an improvement bar that asks for nothing", () => {
    const raw = { ...minimal(), improve: { minQualityGain: 0, minTimeCut: 0, minTokenCut: 0 } };
    expect(errorOf(raw)).toMatch(/improve/);
  });

  it("rejects a beat triggered by a deliverable that isn't declared", () => {
    const raw = { ...minimal(), beats: [{ id: "b1", why: "Checks the trigger.", when: { on: "deliverable", id: "mockup" }, do: { send: { place: "channel", to: "lead", text: "Status?" } } }] };
    expect(errorOf(raw)).toMatch(/beats\.0\.when.*mockup/);
  });

  it("rejects a beat triggered by a beat that doesn't exist", () => {
    const raw = { ...minimal(), beats: [{ id: "b1", why: "Checks the trigger.", when: { on: "beat", id: "b0" }, do: { send: { place: "channel", to: "lead", text: "Status?" } } }] };
    expect(errorOf(raw)).toMatch(/beats\.0\.when.*b0/);
  });

  it("rejects a reaction for a deliverable that isn't declared", () => {
    const raw = { ...minimal(), reactions: [{ deliverable: "memo", pass: "go", fail: "redo", maxRedos: 1 }] };
    expect(errorOf(raw)).toMatch(/reactions\.0.*memo/);
  });

  it("rejects a reaction that names a rubric item of another deliverable", () => {
    const base = minimal();
    const raw = {
      ...base,
      expect: { ...base.expect, deliverables: [...base.expect.deliverables, { id: "memo", title: "Memo", type: "doc", by: "writer" }] },
      rubric: [...base.rubric, { id: "memo-exists", deliverable: "memo", kind: "code", check: "exists", label: "The memo exists" }],
      reactions: [{ deliverable: "copy", items: ["memo-exists"], pass: "go", fail: "redo", maxRedos: 1 }],
    };
    expect(errorOf(raw)).toMatch(/reactions\.0\.items.*memo-exists/);
  });

  it("rejects a rubric item that names an unknown check", () => {
    const raw = { ...minimal(), rubric: [{ id: "x", deliverable: "copy", kind: "code", check: "looks_nice", label: "Nice" }] };
    expect(errorOf(raw)).toMatch(/rubric\.0.*looks_nice/);
  });

  it("rejects check params that don't fit the check", () => {
    const raw = { ...minimal(), rubric: [{ id: "rows", deliverable: "copy", kind: "code", check: "table_rows", params: { columns: ["a"] }, label: "Rows" }] };
    expect(errorOf(raw)).toMatch(/rubric\.0\.params/);
  });

  it("rejects duplicate ids", () => {
    const base = minimal();
    const raw = { ...base, rubric: [...base.rubric, { ...base.rubric[0] }] };
    expect(errorOf(raw)).toMatch(/duplicate.*copy-exists/i);
  });

  it("rejects a launch-card script with more revisions than its cap", () => {
    const raw = {
      ...minimal(),
      gates: { launch: { sequence: [{ decision: "revise", note: "Smaller" }, { decision: "revise", note: "Smaller still" }, { decision: "approve" }], maxRevisions: 1 } },
    };
    expect(errorOf(raw)).toMatch(/gates\.launch/);
  });

  it("rejects a launch-card script that doesn't end in approve or decline", () => {
    const raw = { ...minimal(), gates: { launch: { sequence: [{ decision: "revise", note: "Smaller" }], maxRevisions: 2 } } };
    expect(errorOf(raw)).toMatch(/gates\.launch/);
  });

  it("rejects more experts than the launch cap allows", () => {
    const base = minimal();
    expect(errorOf({ ...base, expect: { ...base.expect, maxExperts: 4 } })).toMatch(/expect\.maxExperts/);
  });
});
