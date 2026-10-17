/*
 * The scenario file schema (docs/design/test-mode.md §2). A scenario is everything one trial needs, fixed before
 * the first run: the opening request, what the simulated owner knows, the scripted beats, how gates and reactions
 * are decided, the deliverables and their rubric, the stop rules, the budget and the bar the next run must clear.
 *
 * Every field is read by code. parseScenario also checks the cross-references (a beat names a real deliverable,
 * a rubric item names a real check with fitting params), so a broken file fails at load, not mid-run.
 */
import { z } from "zod";

const ARCHETYPES = ["chief", "lead", "writer", "researcher", "analyst", "engineer", "designer", "coordinator"] as const;
const ORDER_KEYS = ["go", "dig", "redo", "hold", "pin"] as const;
const ARTIFACT_TYPES = ["canvas", "mockup", "doc", "sources", "table", "diff", "plan", "dashboard", "inbox", "files", "tests"] as const;

const Archetype = z.enum(ARCHETYPES);
const OrderKey = z.enum(ORDER_KEYS);
/** Resolved against the live roster: Mira, the project's lead, any expert, anyone, or the member of an archetype. */
const Who = z.enum(["mira", "lead", "any-expert", "any", ...ARCHETYPES]);

/**
 * The deliverable checks a rubric can name, with their params. src/lib/sim/checks/ implements each one under the
 * same name. What each checks, on the deliverable's final accepted version unless noted:
 * - exists: at least one version of the deliverable was written.
 * - table_rows: a table/CSV with ≥ min rows; with `columns`, those columns exist and (nonEmpty) no cell is blank;
 *   with `distinct`, column `distinct.column` holds ≥ `distinct.min` different values.
 *   In a doc, the table is the first Markdown table in the text.
 * - sources_cited: every row has an http(s) URL and an access date (YYYY-MM-DD) in the named columns.
 * - verbatim_quote: every row's quote column appears verbatim in text the team fetched during the run (tool results).
 * - cites_facts: every sentence that states a claim carries a fact tag (F1…Fn) that exists in the brief, and every
 *   numeral in the text appears in the brief's facts.
 * - verbatim_in: every unit (headline or line) of deliverable `from` appears verbatim in this deliverable.
 * - no_foreign_text: no visible text run longer than `minRun` characters is absent from deliverable `source`.
 * - single_cta: exactly one primary call-to-action label, repeated identically.
 * - offline: no external URL in any src/href (renders with zero network requests).
 * - frames: canvas frames exist at each width in `widths`; with `orderFrom`, their section order equals that
 *   deliverable's section order.
 * - recompute: in every row, column `total` equals `price` × `quantity` within `tolerance` (a fraction of total).
 * - chart_matches: a ```chart fence whose unit label contains `unit`, and whose label → value pairs equal the
 *   `label` and `value` columns of deliverable `table`.
 * - prices_supported: every $ amount in the text appears in column `column` of deliverable `table`, or lies inside
 *   a band (min–max of that column) that the same sentence cites.
 * - monotonic_tiers: rows in table order: each tier's `price` is higher than the row above, and its `features`
 *   (";"-separated) include every feature of the row above.
 * - mentions: the text contains every phrase in `all` (case-insensitive); used to check a new requirement landed.
 * - excludes: the text contains none of the phrases in `none` (case-insensitive, whole words).
 * - sections: the doc's level-2 headings include, in order, one starting with each entry of `headings`
 *   (case-insensitive prefix).
 *
 * Doc conventions the scenarios ask the team for: in copy, `## S1 Hero` names a section and the `###` heading under
 * it is that section's headline; so `verbatim_in` with unit `headline` and `frames.orderFrom` use `###` headings.
 * - max_words: the text has at most `max` words.
 */
export const CHECKS = {
  exists: z.strictObject({}),
  table_rows: z.strictObject({
    min: z.int().min(1),
    columns: z.array(z.string()).optional(),
    nonEmpty: z.boolean().default(true),
    distinct: z.strictObject({ column: z.string(), min: z.int().min(1) }).optional(),
  }),
  sources_cited: z.strictObject({ urlColumn: z.string().default("url"), dateColumn: z.string().default("accessed") }),
  verbatim_quote: z.strictObject({ quoteColumn: z.string() }),
  cites_facts: z.strictObject({ tag: z.string().default("F\\d+") }),
  verbatim_in: z.strictObject({ from: z.string(), unit: z.enum(["headline", "line"]) }),
  no_foreign_text: z.strictObject({ source: z.string(), minRun: z.int().min(1).default(40) }),
  single_cta: z.strictObject({}),
  offline: z.strictObject({}),
  frames: z.strictObject({ widths: z.array(z.int().positive()).min(1), orderFrom: z.string().optional() }),
  recompute: z.strictObject({ price: z.string(), quantity: z.string(), total: z.string(), tolerance: z.number().positive().default(0.01) }),
  chart_matches: z.strictObject({ table: z.string(), unit: z.string(), label: z.string(), value: z.string() }),
  prices_supported: z.strictObject({ table: z.string(), column: z.string() }),
  monotonic_tiers: z.strictObject({ tier: z.string(), price: z.string(), features: z.string() }),
  mentions: z.strictObject({ all: z.array(z.string().min(1)).min(1) }),
  excludes: z.strictObject({ none: z.array(z.string().min(1)).min(1) }),
  sections: z.strictObject({ headings: z.array(z.string().min(1)).min(1) }),
  max_words: z.strictObject({ max: z.int().positive() }),
} as const;
export type CheckName = keyof typeof CHECKS;
/** Check params that name another deliverable; parseScenario confirms each one exists. */
const DELIVERABLE_PARAMS = ["from", "source", "orderFrom", "table"] as const;

/** Things that must happen in a good run, and things that must not; claims.ts checks each from the tape. */
export const MUST_HAPPEN = ["triage", "pm_created", "charter", "launch_card", "launch", "kickoff_by_pm", "post_by_each_expert", "all_accepted", "project_closed", "learned"] as const;
export const MUST_NOT_HAPPEN = ["work_before_launch", "launch_without_approval", "extra_gate_before_kickoff", "relay_by_pm", "over_cap", "order_ignored", "error_stop", "facts_in_learning"] as const;

const Trigger = z.discriminatedUnion("on", [
  z.strictObject({ on: z.literal("team.created") }),
  z.strictObject({ on: z.literal("card"), card: z.enum(["proposal", "launch", "approval"]) }),
  /** The nth message (counted per trigger) from `from`, optionally only in DMs or channels, optionally containing text. */
  z.strictObject({ on: z.literal("message"), from: Who, place: z.enum(["dm", "channel"]).optional(), nth: z.int().min(1).default(1), contains: z.string().optional() }),
  /** A version of a deliverable landed (1 = the first draft). */
  z.strictObject({ on: z.literal("deliverable"), id: z.string(), version: z.int().min(1).default(1) }),
  /** The owner accepted a deliverable (👍). */
  z.strictObject({ on: z.literal("accepted"), id: z.string() }),
  z.strictObject({ on: z.literal("beat"), id: z.string(), afterSec: z.number().min(0).default(0) }),
  /** No agent event for `sec` seconds. */
  z.strictObject({ on: z.literal("idle"), sec: z.number().positive() }),
]);

const BeatDo = z.union([
  /** A message. In a channel, `to` is @mentioned (the lead answers when it's the lead); in a DM it's the recipient. */
  z.strictObject({ send: z.strictObject({ place: z.enum(["dm", "channel"]), to: Who, text: z.string().min(1) }) }),
  /** An order on `on`'s latest message; 📌 pins `note` (or the message) as a standing instruction. */
  z.strictObject({ order: z.strictObject({ on: Who, order: OrderKey, note: z.string().optional() }) }),
  z.strictObject({ advance: z.enum(["heartbeat", "dream", "close"]) }),
]);

const Beat = z.strictObject({
  id: z.string().min(1),
  /** What this beat tests, shown in the director strip. */
  why: z.string().min(1),
  when: Trigger,
  do: BeatDo,
});

const LaunchStep = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("approve") }),
  z.strictObject({ decision: z.literal("decline"), note: z.string().optional() }),
  z.strictObject({ decision: z.literal("revise"), note: z.string().min(1) }),
]);

const Gates = z.strictObject({
  /** The launch card: decided in this order, one step per card shown. */
  launch: z
    .strictObject({
      sequence: z.array(LaunchStep).min(1),
      maxRevisions: z.int().min(0).default(1),
      /** A card past the end of the sequence: decline it, or fail the run. */
      onExtra: z.enum(["decline", "fail"]).default("fail"),
    })
    .default({ sequence: [{ decision: "approve" }], maxRevisions: 1, onExtra: "fail" }),
  /** Approval cards during the project: first matching rule wins (title regex, optional spend cap), else the default. */
  approval: z
    .strictObject({
      default: z.enum(["approve", "decline"]).default("approve"),
      rules: z.array(z.strictObject({ match: z.string().min(1), decision: z.enum(["approve", "decline"]), maxUsd: z.number().positive().optional(), note: z.string().optional() })).default([]),
    })
    .default({ default: "approve", rules: [] }),
});

/** Judge-driven reactions: when a deliverable version lands, check it and order `pass` or `fail` (with the failed items). */
const Reaction = z.strictObject({
  deliverable: z.string(),
  /** Rubric items to apply; default: every item of the deliverable. */
  items: z.array(z.string()).optional(),
  pass: OrderKey.default("go"),
  fail: OrderKey.default("redo"),
  /** After this many redos, accept what's there and note it. */
  maxRedos: z.int().min(0).default(1),
});

const RubricItem = z.discriminatedUnion("kind", [
  z.strictObject({
    id: z.string().min(1),
    deliverable: z.string(),
    kind: z.literal("code"),
    check: z.string(),
    params: z.record(z.string(), z.unknown()).default({}),
    label: z.string().min(1),
    gating: z.boolean().default(true),
  }),
  z.strictObject({
    id: z.string().min(1),
    deliverable: z.string(),
    kind: z.literal("judge"),
    /** One yes/no question; the judge sees only the deliverable and this line. */
    question: z.string().min(1),
    label: z.string().min(1),
    gating: z.boolean().default(false),
  }),
]);

const Deliverable = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  /** An artifact type, or "chart" for a ```chart fence in a message. */
  type: z.enum([...ARTIFACT_TYPES, "chart"]),
  /** The archetype expected to make it (the claim "experts post their own work" uses this). */
  by: Archetype,
  /** Optional glob on the vault path, when the type alone is ambiguous. */
  path: z.string().optional(),
});

const ScenarioSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
    /** Runs of one family are compared run over run. */
    family: z.string().min(1),
    variant: z.string().default("base"),
    title: z.string().min(1),
    summary: z.string().min(1),
    /** Markdown files next to the scenario: the owner's studio, and the client with its facts F1…Fn. */
    story: z.string().min(1),
    brief: z.string().min(1),
    /** Files handed to the team at the start (relative to the scenario), with data labels. */
    inputs: z.array(z.strictObject({ path: z.string().min(1), label: z.enum(["owner_private", "public"]).default("public"), note: z.string().optional() })).default([]),
    /** Grader-only notes; never shown to an agent or the owner model. */
    grader: z.string().optional(),
    request: z.strictObject({ text: z.string().min(1) }),
    owner: z.strictObject({
      /** Tone only. */
      persona: z.string().min(1),
      /** Facts the owner may give when asked. Anything else gets unknownReply. */
      known: z.array(z.string().min(1)).min(1),
      unknownReply: z.string().min(1).default("I don't know. Your call."),
    }),
    expect: z.strictObject({
      triage: z.enum(["project", "solo"]),
      /** Q6: at most 3 experts at launch. */
      maxExperts: z.int().min(1).max(3),
      archetypes: z.array(Archetype).min(1),
      deliverables: z.array(Deliverable).min(1),
      mustHappen: z.array(z.enum(MUST_HAPPEN)).default(["triage", "pm_created", "launch_card", "launch", "kickoff_by_pm", "post_by_each_expert", "all_accepted"]),
      mustNotHappen: z.array(z.enum(MUST_NOT_HAPPEN)).default([...MUST_NOT_HAPPEN]),
    }),
    beats: z.array(Beat).default([]),
    gates: Gates.default({ launch: { sequence: [{ decision: "approve" }], maxRevisions: 1, onExtra: "fail" }, approval: { default: "approve", rules: [] } }),
    reactions: z.array(Reaction).default([]),
    rubric: z.array(RubricItem).min(1),
    stop: z.strictObject({
      when: z.enum(["all_accepted", "project_closed"]),
      maxOwnerActions: z.int().positive(),
      maxWallMin: z.number().positive(),
      idleMin: z.number().positive(),
    }),
    budget: z.strictObject({ maxUsd: z.number().positive(), maxTokens: z.int().positive() }),
    /**
     * The bar run N+1 must clear against run N of the same series, or the series stops for a rethink:
     * quality (rubric pass rate) up by minQualityGain, or held once at qualityCeiling; time to done and total
     * tokens each down by at least the given fraction.
     */
    improve: z
      .strictObject({
        minQualityGain: z.number().min(0).max(1).default(0.1),
        qualityCeiling: z.number().min(0).max(1).default(0.95),
        minTimeCut: z.number().min(0).max(1).default(0.2),
        minTokenCut: z.number().min(0).max(1).default(0.15),
      })
      .default({ minQualityGain: 0.1, qualityCeiling: 0.95, minTimeCut: 0.2, minTokenCut: 0.15 }),
    trials: z.int().min(1).default(3),
    arms: z.array(z.enum(["team", "solo"])).min(1).default(["team"]),
    models: z.strictObject({ owner: z.enum(["main", "advisor"]).default("main"), judge: z.enum(["main", "advisor"]).default("advisor") }).default({ owner: "main", judge: "advisor" }),
    /** After each trial: close the project, then dream and tune skills, so the next trial can learn. */
    close: z.strictObject({ learn: z.boolean().default(true) }).default({ learn: true }),
  })
  .superRefine((s, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message, input: s });

    for (const [list, items] of [["expect.deliverables", s.expect.deliverables], ["beats", s.beats], ["rubric", s.rubric]] as const) {
      const seen = new Set<string>();
      for (const it of items) {
        if (seen.has(it.id)) issue(list.split("."), `duplicate id "${it.id}" in ${list}`);
        seen.add(it.id);
      }
    }

    const deliverables = new Set(s.expect.deliverables.map((d) => d.id));
    const beats = new Set(s.beats.map((b) => b.id));
    s.beats.forEach((b, i) => {
      const w = b.when;
      if ((w.on === "deliverable" || w.on === "accepted") && !deliverables.has(w.id)) issue(["beats", i, "when"], `no deliverable "${w.id}"`);
      if (w.on === "beat" && !beats.has(w.id)) issue(["beats", i, "when"], `no beat "${w.id}"`);
      if (w.on === "beat" && w.id === b.id) issue(["beats", i, "when"], `beat "${b.id}" waits on itself`);
    });

    const reacted = new Set<string>();
    s.reactions.forEach((r, i) => {
      if (!deliverables.has(r.deliverable)) issue(["reactions", i, "deliverable"], `no deliverable "${r.deliverable}"`);
      if (reacted.has(r.deliverable)) issue(["reactions", i, "deliverable"], `a second reaction for "${r.deliverable}"`);
      reacted.add(r.deliverable);
      for (const id of r.items ?? []) {
        const item = s.rubric.find((it) => it.id === id);
        if (!item || item.deliverable !== r.deliverable) issue(["reactions", i, "items"], `"${id}" is not a rubric item of "${r.deliverable}"`);
      }
    });

    s.rubric.forEach((it, i) => {
      if (!deliverables.has(it.deliverable)) issue(["rubric", i, "deliverable"], `no deliverable "${it.deliverable}"`);
      if (it.kind !== "code") return;
      if (!Object.hasOwn(CHECKS, it.check)) return issue(["rubric", i, "check"], `unknown check "${it.check}"`);
      const params = CHECKS[it.check as CheckName].safeParse(it.params);
      if (!params.success) {
        for (const p of params.error.issues) issue(["rubric", i, "params", ...p.path.map((k) => (typeof k === "symbol" ? String(k) : k))], p.message);
        return;
      }
      for (const key of DELIVERABLE_PARAMS) {
        const ref = (params.data as Record<string, unknown>)[key];
        if (typeof ref === "string" && !deliverables.has(ref)) issue(["rubric", i, "params", key], `no deliverable "${ref}"`);
      }
    });

    const launch = s.gates.launch;
    const revisions = launch.sequence.filter((st) => st.decision === "revise").length;
    if (revisions > launch.maxRevisions) issue(["gates", "launch"], `${revisions} revisions in the script but maxRevisions is ${launch.maxRevisions}`);
    const last = launch.sequence[launch.sequence.length - 1];
    if (last.decision === "revise") issue(["gates", "launch"], "the launch-card script must end in approve or decline");
    if (launch.sequence.slice(0, -1).some((st) => st.decision !== "revise")) issue(["gates", "launch"], "only the last launch-card step may approve or decline");

    s.gates.approval.rules.forEach((r, i) => {
      try {
        new RegExp(r.match);
      } catch {
        issue(["gates", "approval", "rules", i, "match"], `"${r.match}" is not a valid regex`);
      }
    });

    const imp = s.improve;
    if (imp.minQualityGain === 0 && imp.minTimeCut === 0 && imp.minTokenCut === 0) issue(["improve"], "the improvement bar asks for nothing");
  });

export type Scenario = z.output<typeof ScenarioSchema>;
export type ScenarioInput = z.input<typeof ScenarioSchema>;
export type Beat = Scenario["beats"][number];
export type Trigger = Beat["when"];
export type RubricItem = Scenario["rubric"][number];
export type Deliverable = Scenario["expect"]["deliverables"][number];
export type MustHappen = (typeof MUST_HAPPEN)[number];
export type MustNotHappen = (typeof MUST_NOT_HAPPEN)[number];

export type ParseResult = { ok: true; scenario: Scenario } | { ok: false; error: string };

/** Validate one scenario (the parsed YAML). Errors name the field path: "beats.0.when: no deliverable "mockup"". */
export function parseScenario(raw: unknown): ParseResult {
  const r = ScenarioSchema.safeParse(raw);
  if (r.success) return { ok: true, scenario: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("; ") };
}
