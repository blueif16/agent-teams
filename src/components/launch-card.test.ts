import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LaunchOptions, OptionPlan, Proposal, RosterEntry } from "@/lib/project";
import type { Message } from "@/lib/types";
import { LaunchCard } from "./Chief";

/*
 * Owner, 2026-10-17: "Don't even bring up the card if you don't even have all the steps." Mira's option cards render
 * only once her fence has closed and every option has come back staffed; until then only a quiet shimmer line shows.
 * Rendered to static markup, so this checks what the owner would see, not component internals.
 */
type Card = Extract<Message, { kind: "proposal" }>;
const noop = () => {};
const render = (m: Card) => renderToStaticMarkup(createElement(LaunchCard, { m, onEdit: noop, onLaunch: noop, onRequestChanges: noop, onOpen: noop }));

const charter = { name: "Onboarding revamp", channel: "onboarding-revamp", goal: "Lift day-1 activation to 40%", due: "2026-11-20", scope: { must: [], wont: [] } };
const proposal: Proposal = {
  ...charter,
  options: [
    { label: "Lean", summary: "One researcher", kind: "solo", roles: [{ archetype: "researcher", role: "UX researcher", need: "teardown", qualifications: [] }], budgetUsd: 2 },
    { label: "Balanced", summary: "PM plus two", kind: "project", roles: [{ archetype: "designer", role: "Product designer", need: "flows", qualifications: [] }], budgetUsd: 6 },
  ],
};
const entry = (archetype: RosterEntry["archetype"], role: string, name: string): RosterEntry => ({
  role,
  archetype,
  need: "",
  qualifications: [],
  name,
  composition: { id: "c", archetype, skills: ["obra/writing-plans"], role, qualifications: [], source: "orchestrator", createdAt: "" },
  skills: [{ id: "obra/writing-plans", name: "writing-plans", why: "" }],
  uncovered: [],
});
const options: OptionPlan[] = [
  { label: "Lean", summary: "One researcher", kind: "solo", budgetUsd: 2, etaDays: 4, roster: [entry("researcher", "UX researcher", "Scout")] },
  { label: "Balanced", summary: "PM plus two", kind: "project", budgetUsd: 6, etaDays: 9, roster: [entry("lead", "PM", "Compass"), entry("designer", "Product designer", "Swatch")] },
];
const plan: LaunchOptions = { charter, options };
const base: Card = { id: "card-1", kind: "proposal", from: "mira", at: "9:41", state: "drafting", nonce: "nonce-0001", picked: 1 };

const CARD_MARKS = /Staffing options|Launch|>Pick<|Picked|Request changes|Lean|Balanced/;

describe("LaunchCard", () => {
  it("shows only the shimmer line while Mira's fence is still streaming", () => {
    const html = render(base);
    expect(html).toContain("Staffing the options");
    expect(html).not.toMatch(CARD_MARKS);
  });

  it("shows only the shimmer line while the options are being staffed", () => {
    const html = render({ ...base, state: "planning", proposal });
    expect(html).toContain("Staffing the options");
    expect(html).not.toMatch(CARD_MARKS);
  });

  it("draws nothing card-like for a proposal whose plan never came back, whatever its state says", () => {
    expect(render({ ...base, state: "ready", proposal })).not.toMatch(CARD_MARKS);
  });

  it("draws one card per option and one Launch for the picked option once every option is staffed", () => {
    const html = render({ ...base, state: "ready", proposal, plan });
    expect(html).toContain('aria-label="Staffing options"');
    expect(html.match(/aria-pressed="(true|false)"/g)).toHaveLength(2);
    expect(html).toContain("Launch Balanced");
    for (const name of ["Scout", "Compass", "Swatch"]) expect(html).toContain(name);
    expect(html).not.toContain("Staffing the options");
  });
});
