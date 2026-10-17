import { describe, expect, it } from "vitest";
import { DELIVERABLES, FETCHED, PATHS, edit, fakeContext, read } from "./fixtures";
import { runCheck } from "./fixtures/run";

const PLANS = read("plans.csv");
const MEMO = read("memo.md");

const plans = (text = PLANS, fetched = FETCHED) => fakeContext({ check: DELIVERABLES.plans, files: { plans: { path: PATHS.plans, text } }, fetched });
const memo = (text = MEMO) => fakeContext({ check: DELIVERABLES.memo, files: { memo: { path: PATHS.memo, text } } });
const lines = (r: { evidence: string[] }) => r.evidence.join("\n");

describe("exists", () => {
  it("passes when a version was written, naming where", () => {
    const r = runCheck("exists", plans(), {});
    expect(r.pass).toBe(true);
    expect(lines(r)).toContain(PATHS.plans);
  });

  it("fails when the deliverable was never written", () => {
    const r = runCheck("exists", fakeContext({ check: DELIVERABLES.plans }), {});
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/plans.*never written/);
  });

  it("counts a posted chart fence as a version of a chart deliverable", () => {
    const ctx = fakeContext({ check: DELIVERABLES.chart, charts: [{ agentId: "a-2", spec: JSON.parse(read("chart.json")), t: 90_000 }] });
    expect(runCheck("exists", ctx, {}).pass).toBe(true);
  });
});

describe("table_rows", () => {
  it("passes a CSV with enough rows and every named column filled", () => {
    const r = runCheck("table_rows", plans(), { min: 6, columns: ["vendor", "plan", "url", "accessed"] });
    expect(r.pass).toBe(true);
    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0]).toMatch(/^6 rows/);
  });

  it("reads the first Markdown table of a doc", () => {
    const r = runCheck("table_rows", memo(), { min: 3, columns: ["Tier", "Features"] });
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toMatch(/^3 rows/);
  });

  it("finds a column whatever its case or padding", () => {
    expect(runCheck("table_rows", plans(), { min: 1, columns: ["URL", " Vendor "] }).pass).toBe(true);
  });

  it("fails a table with fewer rows than the minimum", () => {
    const r = runCheck("table_rows", plans(), { min: 7 });
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/6 rows; at least 7/);
  });

  it("fails when a named column is missing", () => {
    const r = runCheck("table_rows", plans(), { min: 6, columns: ["vendor", "notes"] });
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/no column "notes"/);
  });

  it("fails a blank cell in a named column, naming the row", () => {
    const r = runCheck("table_rows", plans(edit(PLANS, ',2026-10-16,"Starter', ',  ,"Starter')), { min: 6, columns: ["vendor", "accessed"] });
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/row 5 \(n8n\): "accessed" is blank/);
  });

  it("allows blank cells when nonEmpty is false", () => {
    const r = runCheck("table_rows", plans(edit(PLANS, ',2026-10-16,"Starter', ',,"Starter')), { min: 6, columns: ["accessed"], nonEmpty: false });
    expect(r.pass).toBe(true);
  });

  it("passes when a column holds enough different values, counting case variants once", () => {
    const r = runCheck("table_rows", plans(edit(PLANS, "Lindy,Business", "LINDY,Business")), { min: 6, distinct: { column: "vendor", min: 5 } });
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toMatch(/5 different vendor/);
  });

  it("fails when a column holds too few different values", () => {
    const r = runCheck("table_rows", plans(), { min: 6, distinct: { column: "vendor", min: 6 } });
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/"vendor" has 5 different values; at least 6/);
  });
});

describe("sources_cited", () => {
  it("passes when every row has an http(s) URL and a YYYY-MM-DD access date", () => {
    const r = runCheck("sources_cited", plans(), {});
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toMatch(/^6 rows, all with/);
  });

  it("finds the URL inside a Markdown link in a doc's table", () => {
    const doc = "# Sources\n\n| Source | url | accessed |\n|---|---|---|\n| Lindy | [pricing](https://www.lindy.ai/pricing) | 2026-10-15 |\n";
    const ctx = fakeContext({ check: DELIVERABLES.memo, files: { memo: { path: PATHS.memo, text: doc } } });
    expect(runCheck("sources_cited", ctx, {}).pass).toBe(true);
  });

  it("fails a row whose URL has no http(s) scheme", () => {
    const r = runCheck("sources_cited", plans(edit(PLANS, "https://www.crewai.com/pricing", "crewai.com/pricing")), {});
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/row 3 \(CrewAI\): no http\(s\) URL in "url"/);
  });

  it("fails a row whose access date isn't YYYY-MM-DD", () => {
    const r = runCheck("sources_cited", plans(edit(PLANS, ',2026-10-16,"Starter', ',Oct 16 2026,"Starter')), {});
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/row 5 \(n8n\): no YYYY-MM-DD date in "accessed"/);
  });

  it("fails a date that isn't on the calendar", () => {
    const r = runCheck("sources_cited", plans(edit(PLANS, ',2026-10-16,"Starter', ',2026-02-30,"Starter')), {});
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/row 5 \(n8n\)/);
  });

  it("fails when the named column doesn't exist", () => {
    const r = runCheck("sources_cited", plans(), { urlColumn: "link" });
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/no column "link"/);
  });

  it("fails a table with no rows rather than passing it vacuously", () => {
    const r = runCheck("sources_cited", plans(PLANS.split("\n")[0] + "\n"), {});
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/no rows/);
  });
});

describe("verbatim_quote", () => {
  it("passes when every quote appears in a fetched page, even across the page's line breaks", () => {
    const r = runCheck("verbatim_quote", plans(), { quoteColumn: "quote" });
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toMatch(/^6 quotes/);
  });

  it("fails a quote that differs from the page, naming the row", () => {
    const r = runCheck("verbatim_quote", plans(edit(PLANS, "Basic: $99/month", "Basic: $89/month")), { quoteColumn: "quote" });
    expect(r.pass).toBe(false);
    expect(r.evidence).toHaveLength(1);
    expect(lines(r)).toMatch(/row 3 \(CrewAI\).*Basic: \$89\/month/);
  });

  it("names at most five failing rows, then how many more", () => {
    const r = runCheck("verbatim_quote", plans(PLANS, []), { quoteColumn: "quote" });
    expect(r.pass).toBe(false);
    expect(r.evidence).toHaveLength(6);
    expect(r.evidence[5]).toBe("+1 more");
  });
});

describe("recompute", () => {
  const params = { price: "list_price", quantity: "seats", total: "usd_month" };

  it("passes when every total is price × quantity", () => {
    const r = runCheck("recompute", plans(), params);
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toMatch(/^6 rows/);
  });

  it("accepts a total within the tolerance", () => {
    expect(runCheck("recompute", plans(edit(PLANS, "5,95,", "5,95.9,")), params).pass).toBe(true);
  });

  it("fails a total just outside the tolerance, naming the row", () => {
    const r = runCheck("recompute", plans(edit(PLANS, "5,95,", "5,96,")), params);
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/row 2 \(Relevance AI\): usd_month 96 ≠ 19 × 5 = 95/);
  });

  it("fails a cell that isn't a number", () => {
    const r = runCheck("recompute", plans(edit(PLANS, "Business,299.99,", "Business,Contact sales,")), params);
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/row 6 \(Lindy\): list_price "Contact sales" is not a number/);
  });
});

describe("monotonic_tiers", () => {
  const params = { tier: "Tier", price: "Price (USD/mo)", features: "Features" };
  const TEAM = "| Team     |             79 | recording; notes in 12 languages; offline mode; shared workspace         |";

  it("passes tiers that each cost more and keep every feature of the tier above, ignoring case", () => {
    const r = runCheck("monotonic_tiers", memo(), params);
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toMatch(/^3 tiers \(Solo, Team, Practice\)/);
  });

  it("fails a tier that costs no more than the one above", () => {
    const r = runCheck("monotonic_tiers", memo(edit(MEMO, "| Practice |            149 |", "| Practice |             79 |")), params);
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/Practice \(79\) is not above Team \(79\)/);
  });

  it("fails a tier that drops a feature of the one above", () => {
    const r = runCheck("monotonic_tiers", memo(edit(MEMO, TEAM, TEAM.replace("offline mode; ", ""))), params);
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/Team lacks "offline mode" from Solo/);
  });
});
