import { describe, expect, it } from "vitest";
import { MAX_EXPERTS, parseProject, visibleText } from "./project";

/*
 * Mira's ```project fence, v2 (setup-flow spec, step 1): she triages to "project" (a PM plus experts) or "solo" (one
 * expert in a DM) and names roles by archetype. The parser is the gate between a model's text and staffing, so it
 * is tolerant (never throws) and strict about what survives.
 */

const reply = (body: unknown) => `I'd staff this as a small team.\n\n\`\`\`project\n${typeof body === "string" ? body : JSON.stringify(body)}\n\`\`\``;

const designer = {
  archetype: "designer",
  role: "Product designer",
  need: "turn competitor teardowns into two onboarding directions",
  qualifications: ["competitive teardown", "wireframes"],
};
const researcher = { archetype: "researcher", role: "UX researcher", need: "tear down five competitors' onboarding", qualifications: ["competitive analysis"] };

const project = {
  kind: "project",
  name: "Onboarding revamp",
  channel: "onboarding-revamp",
  goal: "Ship a new onboarding flow that lifts activation",
  due: "2026-11-20",
  metric: "Day-1 activation from 31% to 40%",
  scope: { must: ["new signup flow"], wont: ["pricing changes"] },
  roles: [designer, researcher],
  budgetUsd: 5,
};

describe("parseProject (v2 fence)", () => {
  it("reads a project proposal and puts a PM first when Mira left the lead out", () => {
    const p = parseProject(reply(project))!;
    expect(p).toMatchObject({
      kind: "project",
      name: "Onboarding revamp",
      channel: "onboarding-revamp",
      goal: "Ship a new onboarding flow that lifts activation",
      due: "2026-11-20",
      metric: "Day-1 activation from 31% to 40%",
      scope: { must: ["new signup flow"], wont: ["pricing changes"] },
      budgetUsd: 5,
    });
    expect(p.roles.map((r) => r.archetype)).toEqual(["lead", "designer", "researcher"]);
    expect(p.roles[1]).toEqual(designer);
  });

  it("keeps Mira's own PM role, moved first, and never adds a second one", () => {
    const pm = { archetype: "lead", role: "Launch PM", need: "run the launch", qualifications: ["planning"] };
    const p = parseProject(reply({ ...project, roles: [designer, pm, { ...pm, role: "Second PM" }] }))!;
    expect(p.roles.map((r) => r.role)).toEqual(["Launch PM", "Product designer"]);
  });

  it("gives a solo proposal exactly one role and no PM", () => {
    const p = parseProject(reply({ ...project, kind: "solo", roles: [researcher, designer] }))!;
    expect(p.kind).toBe("solo");
    expect(p.roles).toEqual([researcher]);
  });

  it("drops roles whose archetype isn't one of the staffable archetypes, chief included", () => {
    const p = parseProject(
      reply({ ...project, roles: [{ ...designer, archetype: "wizard" }, { ...designer, archetype: "chief" }, { ...designer, archetype: "coordinator" }, researcher] }),
    )!;
    expect(p.roles.map((r) => r.archetype)).toEqual(["lead", "researcher"]);
  });

  it(`trims more than 8 roles to a PM and at most ${MAX_EXPERTS} experts`, () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...designer, role: `Designer ${i + 1}` }));
    const p = parseProject(reply({ ...project, roles: many }))!;
    expect(p.roles).toHaveLength(1 + MAX_EXPERTS);
    expect(p.roles.map((r) => r.role)).toEqual(["PM", "Designer 1", "Designer 2", "Designer 3"]);
  });

  it("refuses a proposal with no goal", () => {
    expect(parseProject(reply({ ...project, goal: "   " }))).toBeNull();
    const { goal: _, ...noGoal } = project;
    expect(parseProject(reply(noGoal))).toBeNull();
  });

  it("refuses a proposal with no staffable role", () => {
    expect(parseProject(reply({ ...project, roles: [{ ...designer, archetype: "wizard" }] }))).toBeNull();
    expect(parseProject(reply({ ...project, roles: "a designer" }))).toBeNull();
  });

  it("returns null, never throws, on a broken or missing fence", () => {
    expect(parseProject("Sure, here's the plan.")).toBeNull();
    expect(parseProject(reply('{"kind": "project", "goal": "x", "roles": ['))).toBeNull();
    expect(parseProject(reply("[1, 2, 3]"))).toBeNull();
    expect(parseProject(reply("null"))).toBeNull();
  });

  it("trims and caps every string and list", () => {
    const long = "x".repeat(5000);
    const p = parseProject(
      reply({
        ...project,
        name: `  ${long}  `,
        goal: `  Lift activation  `,
        channel: "Onboarding Revamp!!",
        scope: { must: Array.from({ length: 20 }, (_, i) => ` must ${i} `), wont: [long, 7, null] },
        roles: [{ archetype: " designer ", role: ` ${long} `, need: long, qualifications: [...Array.from({ length: 20 }, (_, i) => ` q${i} `), 3, ""] }],
      }),
    )!;
    expect(p.goal).toBe("Lift activation");
    expect(p.name.length).toBeLessThanOrEqual(60);
    expect(p.channel).toBe("onboarding-revamp");
    expect(p.scope.must[0]).toBe("must 0");
    expect(p.scope.must.length).toBeLessThanOrEqual(6);
    expect(p.scope.wont).toHaveLength(1);
    expect(p.scope.wont[0].length).toBeLessThanOrEqual(160);
    const [, role] = p.roles;
    expect(role.archetype).toBe("designer");
    expect(role.role.length).toBeLessThanOrEqual(60);
    expect(role.need.length).toBeLessThanOrEqual(200);
    expect(role.qualifications[0]).toBe("q0");
    expect(role.qualifications.length).toBeLessThanOrEqual(6);
  });

  it("drops a due date that isn't a real YYYY-MM-DD and defaults a bad budget", () => {
    const p = parseProject(reply({ ...project, due: "2026-13-45", budgetUsd: -3 }))!;
    expect(p.due).toBeUndefined();
    expect(p.budgetUsd).toBe(5);
    expect(parseProject(reply({ ...project, budgetUsd: 1e9 }))!.budgetUsd).toBeLessThanOrEqual(1000);
  });
});

describe("visibleText", () => {
  it("shows only the sentence before the fence while it streams", () => {
    expect(visibleText(reply(project))).toBe("I'd staff this as a small team.");
  });
});
