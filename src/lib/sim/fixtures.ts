/*
 * Test fixtures for the simulated owner: a small launch-kit scenario (Pip leads, Wren writes the copy, Ada builds
 * the price table and its chart) and helpers that turn tape bodies into timed events. Used by the state, driver
 * and claims tests only.
 */
import type { CheckContext, CheckRegistry } from "./checks/types";
import { CHECKS, parseScenario, type Scenario, type ScenarioInput } from "./scenario";
import type { Member, Place, TapeBody, TapeEvent } from "./types";

export const MIRA_DM: Place = { kind: "dm", agentId: "mira" };
export const TEAM = "t-kit";
export const CH: Place = { kind: "channel", teamId: TEAM };

export const PIP: Member = { agentId: "pip", name: "Pip", archetype: "lead", rehired: false };
export const WREN: Member = { agentId: "wren", name: "Wren", archetype: "writer", rehired: true };
export const ADA: Member = { agentId: "ada", name: "Ada", archetype: "analyst", rehired: false };
export const ROSTER = [PIP, WREN, ADA];

export const teamCreated = (members: Member[] = ROSTER): TapeBody => ({
  kind: "team.created",
  teamId: TEAM,
  channel: "#kit",
  name: "Kit",
  goal: "Ship the launch kit",
  leadId: "pip",
  members,
});

/** The base scenario as YAML would give it; `over` replaces top-level fields. */
export function scenarioInput(over: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    id: "kit",
    family: "kit",
    title: "Launch kit",
    summary: "A landing page copy and a price table for Tern.",
    story: "story.md",
    brief: "brief.md",
    request: { text: "Hi Mira, I need a launch kit for Tern: landing copy and a price table." },
    owner: {
      persona: "Brief and friendly.",
      known: ["The launch is on 2026-11-02.", "The budget for ads is $500.", "Tern's buyers are field sales teams."],
      unknownReply: "I don't know. Your call.",
    },
    expect: {
      triage: "project",
      maxExperts: 3,
      archetypes: ["writer", "analyst"],
      deliverables: [
        { id: "copy", title: "Landing copy", type: "doc", by: "writer", path: "*copy*" },
        { id: "prices", title: "Price table", type: "table", by: "analyst" },
        { id: "chart", title: "Price chart", type: "chart", by: "analyst" },
      ],
    },
    rubric: [
      { id: "copy-tern", deliverable: "copy", kind: "code", check: "mentions", params: { all: ["Tern"] }, label: "The copy names Tern" },
      { id: "copy-short", deliverable: "copy", kind: "code", check: "max_words", params: { max: 50 }, label: "The copy is at most 50 words" },
      { id: "copy-clear", deliverable: "copy", kind: "judge", question: "Does the copy say who Tern is for?", label: "The copy names the buyer" },
      { id: "prices-rows", deliverable: "prices", kind: "code", check: "table_rows", params: { min: 2 }, label: "The table has 2 rows" },
      { id: "chart-exists", deliverable: "chart", kind: "code", check: "exists", label: "The chart exists" },
    ],
    stop: { when: "all_accepted", maxOwnerActions: 40, maxWallMin: 60, idleMin: 10 },
    budget: { maxUsd: 5, maxTokens: 2_000_000 },
    ...over,
  };
}

export function scenario(over: Partial<ScenarioInput> = {}): Scenario {
  const r = parseScenario(scenarioInput(over));
  if (!r.ok) throw new Error(r.error);
  return r.scenario;
}

/** Bodies → events with seq 0, 1, 2… and t 1000 ms apart (or `at` when a body sets it). */
export function stamp(bodies: (TapeBody & { at?: number })[]): TapeEvent[] {
  return bodies.map(({ at, ...b }, i) => ({ seq: i, t: at ?? i * 1000, ...b }) as TapeEvent);
}

/** A whole message: msg.start then msg.end. */
export const say = (msgId: string, from: string, place: Place, text: string, error?: string): TapeBody[] => [
  { kind: "msg.start", msgId, place, from },
  { kind: "msg.end", msgId, text, ...(error ? { error } : {}) },
];

/**
 * A small stand-in for the real deliverable checks (another module implements those): the four the fixture rubric
 * uses, each reading the version the context calls current. Any other check throws, so a test can't lean on it.
 */
export function fakeChecks(): CheckRegistry {
  const unused = (name: string) => () => {
    throw new Error(`fake check "${name}" is not implemented`);
  };
  const text = (ctx: CheckContext) => ctx.current(ctx.deliverable.id)?.text ?? null;
  const registry = Object.fromEntries(Object.keys(CHECKS).map((k) => [k, unused(k)])) as unknown as CheckRegistry;
  return {
    ...registry,
    exists: (ctx) => (ctx.current(ctx.deliverable.id) ? { pass: true, evidence: ["written"] } : { pass: false, evidence: ["never written"] }),
    mentions: (ctx, p) => {
      const t = (text(ctx) ?? "").toLowerCase();
      const missing = p.all.filter((w) => !t.includes(w.toLowerCase()));
      return { pass: missing.length === 0, evidence: missing.length ? missing.map((w) => `missing "${w}"`) : ["all present"] };
    },
    max_words: (ctx, p) => {
      const n = (text(ctx) ?? "").split(/\s+/).filter(Boolean).length;
      return { pass: n <= p.max, evidence: [`${n} words`] };
    },
    table_rows: (ctx, p) => {
      const rows = Math.max(0, (text(ctx) ?? "").trim().split("\n").filter(Boolean).length - 1);
      return { pass: rows >= p.min, evidence: [`${rows} rows`] };
    },
  };
}
