import { describe, expect, it } from "vitest";
import { MAX_EXPERTS, MAX_OPTIONS, openingUploads, parseProject, visibleText } from "./project";

/*
 * Mira's ```project fence, v2 (setup-flow spec, step 1, as changed by the owner on 2026-10-17): a shared charter
 * (goal, due, metric, scope) and 2–3 options, each "project" (a PM plus experts) or "solo" (one expert in a DM),
 * with roles named by archetype. The parser is the gate between a model's text and staffing: tolerant (never
 * throws) and strict about what survives.
 */

const reply = (body: unknown) => `Here are three ways to staff it.\n\n\`\`\`project\n${typeof body === "string" ? body : JSON.stringify(body)}\n\`\`\``;

const designer = {
  archetype: "designer",
  role: "Product designer",
  need: "turn competitor teardowns into two onboarding directions",
  qualifications: ["competitive teardown", "wireframes"],
};
const researcher = { archetype: "researcher", role: "UX researcher", need: "tear down five competitors' onboarding", qualifications: ["competitive analysis"] };

const lean = { label: "Lean", summary: "One researcher gets you the teardown fastest", kind: "solo", roles: [researcher], budgetUsd: 2, etaDays: 4 };
const balanced = { label: "Balanced", summary: "A PM runs research and design in parallel", kind: "project", roles: [designer, researcher], budgetUsd: 6, etaDays: 9 };

const proposal = {
  name: "Onboarding revamp",
  channel: "onboarding-revamp",
  goal: "Ship a new onboarding flow that lifts activation",
  due: "2026-11-20",
  metric: "Day-1 activation from 31% to 40%",
  scope: { must: ["new signup flow"], wont: ["pricing changes"] },
  options: [lean, balanced],
};

describe("parseProject (v2 fence with options)", () => {
  it("reads the shared charter and every option", () => {
    const p = parseProject(reply(proposal))!;
    expect(p).toMatchObject({
      name: "Onboarding revamp",
      channel: "onboarding-revamp",
      goal: "Ship a new onboarding flow that lifts activation",
      due: "2026-11-20",
      metric: "Day-1 activation from 31% to 40%",
      scope: { must: ["new signup flow"], wont: ["pricing changes"] },
    });
    expect(p.options.map((o) => [o.label, o.summary, o.kind, o.budgetUsd, o.etaDays])).toEqual([
      ["Lean", "One researcher gets you the teardown fastest", "solo", 2, 4],
      ["Balanced", "A PM runs research and design in parallel", "project", 6, 9],
    ]);
  });

  it(`caps the options at ${MAX_OPTIONS}`, () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...balanced, label: `Option ${i + 1}` }));
    const p = parseProject(reply({ ...proposal, options: many }))!;
    expect(p.options.map((o) => o.label)).toEqual(["Option 1", "Option 2", "Option 3"]);
  });

  it("puts a PM first in a project option when Mira left the lead out", () => {
    const [, opt] = parseProject(reply(proposal))!.options;
    expect(opt.roles.map((r) => r.archetype)).toEqual(["lead", "designer", "researcher"]);
    expect(opt.roles[1]).toEqual(designer);
  });

  it("keeps Mira's own PM, moved first, and never adds a second one", () => {
    const pm = { archetype: "lead", role: "Launch PM", need: "run the launch", qualifications: ["planning"] };
    const p = parseProject(reply({ ...proposal, options: [{ ...balanced, roles: [designer, pm, { ...pm, role: "Second PM" }] }] }))!;
    expect(p.options[0].roles.map((r) => r.role)).toEqual(["Launch PM", "Product designer"]);
  });

  it("gives a solo option exactly one role and no PM", () => {
    const p = parseProject(reply({ ...proposal, options: [{ ...lean, roles: [researcher, designer] }] }))!;
    expect(p.options[0].kind).toBe("solo");
    expect(p.options[0].roles).toEqual([researcher]);
  });

  it("drops roles whose archetype isn't staffable (chief included), and options left with none", () => {
    const wizard = { ...designer, archetype: "wizard" };
    const p = parseProject(
      reply({
        ...proposal,
        options: [
          { ...balanced, roles: [wizard, { ...designer, archetype: "chief" }, { ...designer, archetype: "coordinator" }, researcher] },
          { ...lean, label: "Magic", roles: [wizard] },
        ],
      }),
    )!;
    expect(p.options.map((o) => o.label)).toEqual(["Balanced"]);
    expect(p.options[0].roles.map((r) => r.archetype)).toEqual(["lead", "researcher"]);
  });

  it(`trims more than 8 roles to a PM and at most ${MAX_EXPERTS} experts`, () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...designer, role: `Designer ${i + 1}` }));
    const p = parseProject(reply({ ...proposal, options: [{ ...balanced, roles: many }] }))!;
    expect(p.options[0].roles.map((r) => r.role)).toEqual(["PM", "Designer 1", "Designer 2", "Designer 3"]);
  });

  it("refuses a proposal with no goal", () => {
    expect(parseProject(reply({ ...proposal, goal: "   " }))).toBeNull();
    const noGoal: Record<string, unknown> = { ...proposal };
    delete noGoal.goal;
    expect(parseProject(reply(noGoal))).toBeNull();
  });

  it("refuses a proposal with no usable option", () => {
    expect(parseProject(reply({ ...proposal, options: [{ ...balanced, roles: [{ ...designer, archetype: "wizard" }] }] }))).toBeNull();
    expect(parseProject(reply({ ...proposal, options: "a designer" }))).toBeNull();
    expect(parseProject(reply({ ...proposal, options: [] }))).toBeNull();
  });

  it("rejects the old roster fence that picked agent ids", () => {
    const v1 = {
      name: "Onboarding revamp",
      channel: "onboarding",
      goal: "Ship onboarding by Nov 20",
      due: "2026-11-20",
      leadId: "felipe",
      members: [{ id: "felipe", assignment: "Lead" }, { id: "dottie", assignment: "Research" }],
      spec: "## Problem\nActivation is low.",
    };
    expect(parseProject(reply(v1))).toBeNull();
  });

  it("returns null, never throws, on a broken or missing fence", () => {
    expect(parseProject("Sure, here's the plan.")).toBeNull();
    expect(parseProject(reply('{"goal": "x", "options": ['))).toBeNull();
    expect(parseProject(reply("[1, 2, 3]"))).toBeNull();
    expect(parseProject(reply("null"))).toBeNull();
  });

  it("trims and caps every string and list", () => {
    const long = "x".repeat(5000);
    const p = parseProject(
      reply({
        ...proposal,
        name: `  ${long}  `,
        goal: `  Lift activation  `,
        channel: "Onboarding Revamp!!",
        scope: { must: Array.from({ length: 20 }, (_, i) => ` must ${i} `), wont: [long, 7, null] },
        options: [
          {
            label: ` ${long} `,
            summary: long,
            kind: "project",
            roles: [{ archetype: " designer ", role: ` ${long} `, need: long, qualifications: [...Array.from({ length: 20 }, (_, i) => ` q${i} `), 3, ""] }],
          },
        ],
      }),
    )!;
    expect(p.goal).toBe("Lift activation");
    expect(p.name.length).toBeLessThanOrEqual(60);
    expect(p.channel).toBe("onboarding-revamp");
    expect(p.scope.must[0]).toBe("must 0");
    expect(p.scope.must.length).toBeLessThanOrEqual(6);
    expect(p.scope.wont).toHaveLength(1);
    expect(p.scope.wont[0].length).toBeLessThanOrEqual(160);
    const [opt] = p.options;
    expect(opt.label.length).toBeLessThanOrEqual(24);
    expect(opt.summary.length).toBeLessThanOrEqual(140);
    const [, role] = opt.roles;
    expect(role.archetype).toBe("designer");
    expect(role.role.length).toBeLessThanOrEqual(60);
    expect(role.need.length).toBeLessThanOrEqual(200);
    expect(role.qualifications[0]).toBe("q0");
    expect(role.qualifications.length).toBeLessThanOrEqual(6);
  });

  it("drops a due date that isn't a real date, and defaults a bad budget or ETA", () => {
    const p = parseProject(reply({ ...proposal, due: "2026-13-45", options: [{ ...balanced, budgetUsd: -3, etaDays: "soon" }] }))!;
    expect(p.due).toBeUndefined();
    expect(p.options[0].budgetUsd).toBe(5);
    expect(p.options[0].etaDays).toBeUndefined();
    expect(parseProject(reply({ ...proposal, options: [{ ...balanced, budgetUsd: 1e9 }] }))!.options[0].budgetUsd).toBeLessThanOrEqual(1000);
  });
});

describe("visibleText", () => {
  it("shows only the sentence before the fence while it streams", () => {
    expect(visibleText(reply(proposal))).toBe("Here are three ways to staff it.");
  });
});

describe("openingUploads", () => {
  const you = (id: string, images?: string[]) => ({ id, at: "", kind: "text" as const, from: "you", text: "", images });
  const card = (id: string, state: "ready" | "launched") => ({ id, at: "", kind: "proposal" as const, from: "mira", state, nonce: "n", picked: 0 });

  it("takes the owner's uploads since the last launched card, up to this card, once each", () => {
    const msgs = [
      you("m1", ["old-spec"]),
      card("c1", "launched"),
      you("m2", ["spec", "shot"]),
      { id: "r", at: "", kind: "text" as const, from: "mira", text: "", images: ["not-the-owners"] },
      you("m3", ["facts", "spec"]),
      card("c2", "ready"),
      you("m4", ["after-the-card"]),
    ];

    expect(openingUploads(msgs, "c2")).toEqual(["spec", "shot", "facts"]);
  });
});
