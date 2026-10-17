import { describe, expect, it } from "vitest";
import { DELIVERABLES, FACTS, PATHS, edit, fakeContext, read } from "./fixtures";
import { runCheck } from "./fixtures/run";

const COPY = read("copy.md");
const MEMO = read("memo.md");
const PLANS = read("plans.csv");
const LANDING = read("landing.html");

const copy = (text = COPY, facts = FACTS) => fakeContext({ check: DELIVERABLES.copy, files: { copy: { path: PATHS.copy, text } }, facts });
const memo = (text = MEMO) => fakeContext({ check: DELIVERABLES.memo, files: { memo: { path: PATHS.memo, text }, plans: { path: PATHS.plans, text: PLANS } } });
const page = (text = LANDING) => fakeContext({ check: DELIVERABLES.landing, files: { landing: { path: PATHS.landing, text } } });
const lines = (r: { evidence: string[] }) => r.evidence.join("\n");

describe("cites_facts", () => {
  it("passes copy whose numeral sentences are tagged with real facts and whose numbers come from them", () => {
    const r = runCheck("cites_facts", copy(), {});
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toBe("5 sentences with numerals, all tagged; 10 tags, all facts in the brief; 6 numerals, all in the facts");
  });

  it("fails a tag that names no fact in the brief", () => {
    const r = runCheck("cites_facts", copy(edit(COPY, "[F8]", "[F9]")), {});
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/line 31: \[F9\] is not a fact in the brief/);
  });

  it("fails a sentence that states a number without a tag", () => {
    const r = runCheck("cites_facts", copy(edit(COPY, "12 languages. [F5]", "12 languages.")), {});
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/no fact tag on "Notes come out in any of 12 languages\."/);
  });

  it("fails a number that appears in no fact, even when the sentence is tagged", () => {
    const r = runCheck("cites_facts", copy(edit(COPY, "**3.5 hours**", "**4 hours**")), {});
    expect(r.pass).toBe(false);
    expect(r.evidence).toHaveLength(1);
    expect(lines(r)).toMatch(/line 31: 4 is in no fact/);
  });

  it("recognizes only tags matching the tag pattern", () => {
    const r = runCheck("cites_facts", copy(), { tag: "F[1-7]" });
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/no fact tag on "Pilot users saved 3\.5 hours/);
  });
});

describe("prices_supported", () => {
  const params = { table: "plans", column: "usd_month" };

  it("passes when every $ amount is in the column or inside a band its sentence cites", () => {
    const r = runCheck("prices_supported", memo(), params);
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toBe("11 $ amounts: 8 in plans usd_month, 3 inside a cited band");
  });

  it("fails an amount that is neither in the column nor inside a cited band", () => {
    const r = runCheck("prices_supported", memo(edit(MEMO, "Team at $79", "Team at $105")), params);
    expect(r.pass).toBe(false);
    expect(r.evidence).toHaveLength(1);
    expect(lines(r)).toMatch(/\$105 is not in usd_month, and no band its sentence cites holds it/);
  });

  it("fails a band whose ends aren't values in the column, and the amounts that leaned on it", () => {
    const r = runCheck("prices_supported", memo(edit(MEMO, "$24–$49.99 band", "$20–$49.99 band")), params);
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/\$29 is not in usd_month/);
    expect(lines(r)).toMatch(/\$20 is not in usd_month/);
  });

  it("reads a p25–p75 band as the column's interpolated 25th to 75th percentiles", () => {
    // usd_month sorted: 24, 33.33, 49.99, 95, 99, 299.99 → p75 = 95 + 0.75 × (99 − 95) = 98
    const inside = runCheck("prices_supported", memo(edit(MEMO, "Team at $79", "Team at $98")), params);
    const outside = runCheck("prices_supported", memo(edit(MEMO, "Team at $79", "Team at $98.50")), params);
    expect(inside.pass).toBe(true);
    expect(outside.pass).toBe(false);
  });

  it("fails when the table never got written", () => {
    const ctx = fakeContext({ check: DELIVERABLES.memo, files: { memo: { path: PATHS.memo, text: MEMO } } });
    const r = runCheck("prices_supported", ctx, params);
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/"plans" was never written/);
  });
});

describe("mentions", () => {
  it("passes when every phrase appears, ignoring case", () => {
    const r = runCheck("mentions", memo(), { all: ["annual billing", "P25–P75"] });
    expect(r.pass).toBe(true);
  });

  it("fails naming each phrase that's missing", () => {
    const r = runCheck("mentions", memo(), { all: ["annual billing", "usage-based pricing"] });
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(['missing "usage-based pricing"']);
  });
});

describe("excludes", () => {
  it("passes when no phrase appears as a whole word, even inside longer words", () => {
    // "detail" contains "ai", which is not the word "AI".
    const r = runCheck("excludes", copy(), { none: ["AI", "best-in-class"] });
    expect(r.pass).toBe(true);
  });

  it("fails a phrase that appears as a word, ignoring case, quoting where", () => {
    const r = runCheck("excludes", copy(edit(COPY, "Tern records in-person", "Tern's AI records in-person")), { none: ["ai"] });
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/"ai" in "…?.*Tern's AI records/);
  });

  it("reads a page's visible text, not its script", () => {
    expect(runCheck("excludes", page(), { none: ["tern labs"] }).pass).toBe(false);
    expect(runCheck("excludes", page(), { none: ["querySelectorAll"] }).pass).toBe(true);
  });
});

describe("sections", () => {
  it("passes when the ## headings start with each entry, in order, ignoring case", () => {
    const r = runCheck("sections", memo(), { headings: ["Market", "recommendation", "Risks"] });
    expect(r.pass).toBe(true);
  });

  it("fails an entry no ## heading starts with", () => {
    const r = runCheck("sections", memo(), { headings: ["Market", "Pricing"] });
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/no ## heading starting with "Pricing"/);
  });

  it("fails headings in the wrong order", () => {
    const r = runCheck("sections", memo(), { headings: ["Risks", "Market"] });
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/"Market" is out of order/);
  });

  it("counts only level-2 headings", () => {
    const ctx = fakeContext({ check: DELIVERABLES.memo, files: { memo: { path: PATHS.memo, text: "# Plan\n\n## Market\n\n### Detail\n" } } });
    expect(runCheck("sections", ctx, { headings: ["Market"] }).pass).toBe(true);
    expect(runCheck("sections", ctx, { headings: ["Plan"] }).pass).toBe(false);
    expect(runCheck("sections", ctx, { headings: ["Detail"] }).pass).toBe(false);
  });
});

describe("max_words", () => {
  const doc = (text: string) => fakeContext({ check: DELIVERABLES.memo, files: { memo: { path: PATHS.memo, text } } });

  it("passes text at the limit, counting words but not punctuation or markup", () => {
    const r = runCheck("max_words", doc("# Title\n\nOne **two** three, four — five.\n"), { max: 6 });
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toMatch(/^6 words/);
  });

  it("fails text over the limit", () => {
    const r = runCheck("max_words", doc("# Title\n\nOne **two** three, four — five.\n"), { max: 5 });
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(["6 words; the limit is 5"]);
  });

  it("counts a page's visible words, not its tags or styles", () => {
    const ctx = page("<style>.a { color: red }</style><h1>Hello</h1><p>big <b>world</b></p>");
    expect(runCheck("max_words", ctx, { max: 3 }).pass).toBe(true);
    expect(runCheck("max_words", ctx, { max: 2 }).pass).toBe(false);
  });
});
