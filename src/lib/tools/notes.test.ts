/*
 * The prompt notes (H §6): constants, short, if-then, one example per op, and nothing that changes per run
 * (ids of real artifacts, revs, dates, project names), so every agent of an archetype shares the prompt prefix.
 */
import { describe, expect, it } from "vitest";
import * as charts from "../charts";
import { CANVAS_NOTE, CHARTS_NOTE, DOC_NOTE } from "./notes";

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const OPS = ["frame", "shape", "text", "note", "image", "connect", "update", "delete"];
/** Every JSON object written on its own line after "- ". */
const examples = (note: string) =>
  note
    .split("\n")
    .filter((l) => l.startsWith("- {"))
    .map((l) => JSON.parse(l.slice(2)) as { op: string });

const RUNTIME_DATA = [
  /\$\{/, // a template slot
  /\{(pid|slug|rev|id)\}/,
  /\b20\d\d\b/, // a year
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d/,
  /\brev(ision)? ?\d/i,
  /projects\//,
];

describe("CHARTS_NOTE", () => {
  it("is the chart module's constant, unchanged", () => {
    expect(CHARTS_NOTE).toBe(charts.CHARTS_NOTE);
  });
});

describe("CANVAS_NOTE", () => {
  it("stays within 180 words", () => {
    expect(words(CANVAS_NOTE)).toBeLessThanOrEqual(180);
  });

  it("shows exactly one JSON example per op, in the schema's order", () => {
    expect(examples(CANVAS_NOTE).map((e) => e.op)).toEqual(OPS);
  });

  it("lists the closed colors and sizes", () => {
    expect(CANVAS_NOTE).toContain("gray, blue, green, yellow, red, violet");
    expect(CANVAS_NOTE).toContain("s, m, l, xl");
  });

  it("gives if-then rules for a failed op, a stale canvas and a finished frame", () => {
    expect(CANVAS_NOTE).toMatch(/If an op fails[^.]*send only/);
    expect(CANVAS_NOTE).toMatch(/If canvas_edit says the canvas changed[^.]*canvas_read/);
    expect(CANVAS_NOTE).toMatch(/When a frame is ready[^.]*request_review/);
  });

  it("keeps ops and canvas JSON out of chat", () => {
    expect(CANVAS_NOTE).toMatch(/never paste ops or canvas JSON into a reply/);
  });

  it("carries no runtime data", () => {
    for (const re of RUNTIME_DATA) expect(CANVAS_NOTE, String(re)).not.toMatch(re);
  });
});

describe("DOC_NOTE", () => {
  it("stays within 180 words", () => {
    expect(words(DOC_NOTE)).toBeLessThanOrEqual(180);
  });

  it("routes creating, suggesting and commenting to their tools", () => {
    expect(DOC_NOTE).toMatch(/doc_write/);
    expect(DOC_NOTE).toMatch(/doc_suggest[^.]*find[^.]*replace[^.]*why/);
    expect(DOC_NOTE).toMatch(/doc_comment/);
  });

  it("says a find must be exact and appear once", () => {
    expect(DOC_NOTE).toMatch(/exact passage that appears once/);
  });

  it("cites with [S1]-style markers from add_source", () => {
    expect(DOC_NOTE).toMatch(/\[S1\][^.]*add_source/);
  });

  it("carries no runtime data", () => {
    for (const re of RUNTIME_DATA) expect(DOC_NOTE, String(re)).not.toMatch(re);
  });
});
