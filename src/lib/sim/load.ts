/*
 * Load scenario files from disk (server and tests only): the YAML, validated by parseScenario, plus the files it
 * names. The story and brief are for the harness and the grader; only `inputs` reach the team. `facts` feed
 * cites_facts, `terms` (the brief's "## Terms" list: the client's name and private numbers) feed the leak check,
 * and `hash` locks a series: any change to the requirements starts a new one (design §7).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseScenario, type Scenario } from "./scenario";

export interface LoadedScenario {
  scenario: Scenario;
  file: string;
  /** sha256 of the scenario file and every file it names, in a fixed order. */
  hash: string;
  story: string;
  brief: string;
  facts: Record<string, string>;
  terms: string[];
  inputs: { path: string; label: "owner_private" | "public"; text: string }[];
}

/** "F12. Some fact." lines, by tag. A tag used twice is an error: a claim could cite either. */
export function parseFacts(text: string): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*(F\d+)\.\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    if (facts[m[1]]) throw new Error(`fact ${m[1]} is defined twice`);
    facts[m[1]] = m[2];
  }
  return facts;
}

/** The bullets under "## Terms", up to the next heading. */
export function parseTerms(text: string): string[] {
  const terms: string[] = [];
  let inside = false;
  for (const line of text.split("\n")) {
    if (/^#{1,6}\s/.test(line)) inside = /^##\s+Terms\s*$/i.test(line);
    else if (inside) {
      const m = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
      if (m) terms.push(m[1]);
    }
  }
  return terms;
}

export function loadScenario(file: string): LoadedScenario {
  const name = path.basename(file);
  const raw = readFileSync(file, "utf8");
  const parsed = parseScenario(parseYaml(raw));
  if (!parsed.ok) throw new Error(`${name}: ${parsed.error}`);
  const scenario = parsed.scenario;

  const root = path.dirname(path.resolve(file));
  const read = (rel: string) => {
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) throw new Error(`${name}: ${rel} is outside the scenarios directory`);
    if (!existsSync(abs)) throw new Error(`${name}: ${rel} doesn't exist`);
    return readFileSync(abs, "utf8");
  };

  const story = read(scenario.story);
  const brief = read(scenario.brief);
  const factsText = scenario.facts ? read(scenario.facts) : "";
  const inputs = scenario.inputs.map((i) => ({ path: i.path, label: i.label, text: read(i.path) }));

  const hash = createHash("sha256");
  for (const part of [raw, story, brief, factsText, ...inputs.map((i) => i.text)]) hash.update(part).update("\0");

  return {
    scenario,
    file,
    hash: hash.digest("hex"),
    story,
    brief,
    facts: parseFacts(factsText),
    terms: parseTerms(brief),
    inputs,
  };
}

/** Every *.yaml scenario directly in `dir`. */
export function loadScenarios(dir: string): LoadedScenario[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => loadScenario(path.join(dir, f)));
}
