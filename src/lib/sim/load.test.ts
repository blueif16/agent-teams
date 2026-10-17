import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScenario, loadScenarios, parseFacts, parseTerms } from "./load";

const SCENARIOS = path.join(process.cwd(), "scenarios");

/** A scenario directory on disk with one valid scenario; `edit` changes files before it's returned. */
function fixture(edit: (dir: string) => void = () => {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "sim-load-"));
  mkdirSync(path.join(dir, "clients", "acme"), { recursive: true });
  writeFileSync(path.join(dir, "studio.md"), "# Studio\n");
  writeFileSync(path.join(dir, "clients", "acme", "brief.md"), "# Acme\n\n## Terms\n\n- Acme\n- $24\n");
  writeFileSync(path.join(dir, "clients", "acme", "facts.md"), "# Facts\n\nF1. Acme sells anvils.\nF2. 90% of buyers are coyotes.\n");
  writeFileSync(
    path.join(dir, "demo.yaml"),
    [
      "id: demo",
      "family: demo",
      "title: Demo",
      "summary: A scenario for loader tests.",
      "story: studio.md",
      "brief: clients/acme/brief.md",
      "facts: clients/acme/facts.md",
      "inputs: [{ path: clients/acme/facts.md }]",
      "request: { text: Hi Mira }",
      "owner: { persona: Short., known: [Due Friday.] }",
      "expect: { triage: project, maxExperts: 3, archetypes: [writer], deliverables: [{ id: copy, title: Copy, type: doc, by: writer }] }",
      "rubric: [{ id: copy-exists, deliverable: copy, kind: code, check: exists, label: Copy exists }]",
      "stop: { when: all_accepted, maxOwnerActions: 5, maxWallMin: 10, idleMin: 2 }",
      "budget: { maxUsd: 1, maxTokens: 100000 }",
    ].join("\n"),
  );
  edit(dir);
  return dir;
}

describe("parseFacts", () => {
  it("reads numbered fact lines by tag", () => {
    expect(parseFacts("# Facts\n\nF1. One.\nF12. Twelve, with 3 numbers 4.\n")).toEqual({ F1: "One.", F12: "Twelve, with 3 numbers 4." });
  });

  it("refuses a tag used twice", () => {
    expect(() => parseFacts("F1. One.\nF1. Again.\n")).toThrow(/F1/);
  });
});

describe("parseTerms", () => {
  it("reads the bullets under ## Terms and nothing else", () => {
    expect(parseTerms("# X\n\n- not a term\n\n## Terms\n\n- Acme\n- $24 draft price\n\n## Other\n\n- nope\n")).toEqual(["Acme", "$24 draft price"]);
  });
});

describe("loadScenario", () => {
  it("loads a scenario with its story, brief, facts, terms and inputs", () => {
    const dir = fixture();
    const s = loadScenario(path.join(dir, "demo.yaml"));
    expect(s.scenario.id).toBe("demo");
    expect(s.facts.F2).toBe("90% of buyers are coyotes.");
    expect(s.terms).toEqual(["Acme", "$24"]);
    expect(s.inputs[0].text).toContain("Acme sells anvils");
    expect(s.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names the file and the missing path when a referenced file doesn't exist", () => {
    const dir = fixture((d) => writeFileSync(path.join(d, "demo.yaml"), readDemo(d).replace("story: studio.md", "story: nowhere.md")));
    expect(() => loadScenario(path.join(dir, "demo.yaml"))).toThrow(/demo\.yaml.*nowhere\.md/);
  });

  it("names the file and the field when the scenario is invalid", () => {
    const dir = fixture((d) => writeFileSync(path.join(d, "demo.yaml"), readDemo(d).replace("maxExperts: 3", "maxExperts: 5")));
    expect(() => loadScenario(path.join(dir, "demo.yaml"))).toThrow(/demo\.yaml.*expect\.maxExperts/);
  });

  it("refuses a referenced file outside the scenarios directory", () => {
    const dir = fixture((d) => writeFileSync(path.join(d, "demo.yaml"), readDemo(d).replace("story: studio.md", "story: ../../etc/hosts")));
    expect(() => loadScenario(path.join(dir, "demo.yaml"))).toThrow(/outside/);
  });

  it("gives a different hash when the requirements change", () => {
    const a = loadScenario(path.join(fixture(), "demo.yaml")).hash;
    const dir = fixture((d) => writeFileSync(path.join(d, "demo.yaml"), readDemo(d).replace("maxOwnerActions: 5", "maxOwnerActions: 6")));
    expect(loadScenario(path.join(dir, "demo.yaml")).hash).not.toBe(a);
  });
});

describe("the committed scenarios", () => {
  it("all load, with facts and terms", () => {
    const all = loadScenarios(SCENARIOS);
    expect(all.map((s) => s.scenario.id).sort()).toEqual(["launch-kit", "market-report"]);
    for (const s of all) {
      expect(Object.keys(s.facts).length).toBeGreaterThan(0);
      expect(s.terms.length).toBeGreaterThan(0);
    }
  });

  it("never hand the team a grader-only or story file", () => {
    for (const s of loadScenarios(SCENARIOS)) {
      for (const input of s.inputs) {
        expect(input.path).not.toBe(s.scenario.story);
        expect(input.path).not.toBe(s.scenario.brief);
      }
    }
  });
});

function readDemo(dir: string) {
  return readFileSync(path.join(dir, "demo.yaml"), "utf8");
}
