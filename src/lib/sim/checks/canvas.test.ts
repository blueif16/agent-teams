import { describe, expect, it } from "vitest";
import { DELIVERABLES, PATHS, edit, fakeContext, read } from "./fixtures";
import { runCheck } from "./fixtures/run";

const WIREFRAME = read("wireframe.excalidraw");
const COPY = read("copy.md");
const PLANS = read("plans.csv");
const CHART = JSON.parse(read("chart.json"));

const canvas = (text = WIREFRAME) =>
  fakeContext({ check: DELIVERABLES.wireframe, files: { wireframe: { path: PATHS.wireframe, text }, copy: { path: PATHS.copy, text: COPY } } });
const MOBILE = '"name": "Mobile 390"';

describe("frames", () => {
  const params = { widths: [1440, 390], orderFrom: "copy" };

  it("passes frames at each width whose headlines run in the copy's order, ignoring texts outside the frames", () => {
    const r = runCheck("frames", canvas(), params);
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toBe("frames at 1440, 390 px; in each, the ### headlines of copy run top to bottom in order");
  });

  it("counts a frame within 2 px of the width", () => {
    expect(runCheck("frames", canvas(edit(WIREFRAME, '"width": 390, "height": 3800', '"width": 392, "height": 3800')), params).pass).toBe(true);
  });

  it("fails when no frame is near a width", () => {
    const r = runCheck("frames", canvas(edit(WIREFRAME, '"width": 390, "height": 3800', '"width": 393, "height": 3800')), { widths: [1440, 390] });
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(["no frame 390 px wide (frames: 1440, 393)"]);
  });

  it("fails a frame whose headlines are out of the copy's order", () => {
    const moved = edit(WIREFRAME, '"id": "t-m-4", "type": "text", "x": 1620, "y": 2100', '"id": "t-m-4", "type": "text", "x": 1620, "y": 1300');
    const r = runCheck("frames", canvas(moved), params);
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(['frame "Mobile 390": "Press record, put the phone down" is below "Hours back every week"']);
    expect(moved).toContain(MOBILE);
  });
});

describe("chart_matches", () => {
  const params = { table: "plans", unit: "USD", label: "plan", value: "usd_month" };
  const charted = (spec: unknown) =>
    fakeContext({ check: DELIVERABLES.chart, files: { plans: { path: PATHS.plans, text: PLANS } }, charts: [{ agentId: "a-3", spec, t: 120_000 }] });

  it("passes a chart whose unit names USD and whose bars equal the table's label → value pairs, in any order", () => {
    const r = runCheck("chart_matches", charted(CHART), params);
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toBe('chart 1 of 1, by a-3: 6 plan → usd_month pairs equal plans; unit "USD/month"');
  });

  it("fails a chart whose value differs from the table", () => {
    const wrong = { ...CHART, series: [{ name: "Cost", values: [24, 33.33, 59.99, 95, 99, 299.99] }] };
    const r = runCheck("chart_matches", charted(wrong), params);
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(["1 chart, none matches plans; the latest:", '"Pro": chart 59.99, plans 49.99']);
  });

  it("fails a chart whose unit doesn't name the unit", () => {
    const r = runCheck("chart_matches", charted({ ...CHART, unit: "$" }), params);
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(["1 chart, none matches plans; the latest:", 'unit "$" lacks "USD"']);
  });
});
