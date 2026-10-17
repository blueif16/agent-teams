/*
 * parseTable round trip: any table, written as RFC 4180 CSV, reads back as the same columns and rows. The alphabet
 * is small and full of the characters that break CSV readers (commas, quotes, CR, LF, spaces), so cases hit quoting
 * often; each property also checks that enough of its cases needed quoting.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseTable } from "./parse";

const RUNS = 400;
const NASTY = ["a", "b", "1", " ", ",", '"', "\n", "\r", "|", "-", ":", "$"];

const cellOf = (chars: string[]) => fc.string({ unit: fc.constantFrom(...chars), maxLength: 12 });

interface Sample {
  columns: string[];
  rows: string[][];
  eol: string;
}

/**
 * Quote a field only when it must be, as most writers do. In a one-column table an empty field would make a blank
 * line, which readers skip, so it is quoted too.
 */
function toCsv({ columns, rows, eol }: Sample): string {
  const field = (s: string) => (/[",\r\n]/.test(s) || (s === "" && columns.length === 1) ? `"${s.replace(/"/g, '""')}"` : s);
  return [columns, ...rows].map((r) => r.map(field).join(",")).join(eol) + eol;
}

/** Unique, non-empty column names and rows of the same width. */
const arbTable = (chars: string[]): fc.Arbitrary<Sample> =>
  fc.uniqueArray(cellOf(chars).filter((s) => s !== ""), { minLength: 1, maxLength: 5 }).chain((columns) =>
    fc.record({
      columns: fc.constant(columns),
      rows: fc.array(fc.array(cellOf(chars), { minLength: columns.length, maxLength: columns.length }), { maxLength: 6 }),
      eol: fc.constantFrom("\n", "\r\n"),
    }),
  );

const asRecords = ({ columns, rows }: Sample) => rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));

describe("parseTable round trip", () => {
  it("reads back any table serialized to CSV, read as CSV", () => {
    let quoted = 0;
    fc.assert(
      fc.property(arbTable(NASTY), (t) => {
        const text = toCsv(t);
        if (text.includes('"')) quoted++;
        const parsed = parseTable(text, "csv");
        expect(parsed.columns).toEqual(t.columns);
        expect(parsed.rows).toEqual(asRecords(t));
      }),
      { numRuns: RUNS },
    );
    expect(quoted).toBeGreaterThan(RUNS / 4);
  });

  it("reads back a table with no pipes serialized to CSV, format detected", () => {
    let quoted = 0;
    fc.assert(
      fc.property(arbTable(NASTY.filter((c) => c !== "|")), (t) => {
        const text = toCsv(t);
        if (text.includes('"')) quoted++;
        const parsed = parseTable(text);
        expect(parsed.columns).toEqual(t.columns);
        expect(parsed.rows).toEqual(asRecords(t));
      }),
      { numRuns: RUNS },
    );
    expect(quoted).toBeGreaterThan(RUNS / 4);
  });
});
