/*
 * Test fixtures for the deliverable checks: a small Tern launch kit (copy, landing page, wireframe) and pricing
 * benchmark (plans table, memo, chart), the brief's facts, the pages the team fetched, and a hand-written fake
 * CheckContext. Failing fixtures are made with edit(), which changes one spot of a good fixture and throws if the
 * spot isn't there, so a failing case can't silently turn into a copy of the passing one.
 */
import { readFileSync } from "node:fs";
import type { Deliverable } from "../../scenario";
import type { CheckContext, DeliverableVersion } from "../types";

export const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

/** Replace the first `from` with `to`; throws if `from` isn't in the text. */
export function edit(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  if (at < 0) throw new Error(`fixture edit: "${from}" not found`);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

export const FACTS: Record<string, string> = {
  F1: "Tern records in-person meetings on the phone.",
  F2: "Notes arrive within 2 minutes of the meeting ending.",
  F3: "Tern works offline and uploads when back online.",
  F4: "Recordings are deleted after 30 days unless pinned.",
  F5: "Notes support 12 languages.",
  F6: "Teams of up to 25 people share one workspace.",
  F7: "The free trial lasts 14 days and needs no card.",
  F8: "Pilot users saved 3.5 hours a week on note-taking.",
};

/** Page text from fetch_page results, as the tools return it (line breaks where the page had blocks). */
export const FETCHED: string[] = [
  "Lindy pricing\nFree\n$0/month\n400 tasks/mo\nPro $49.99/month, billed monthly\n5,000 tasks/mo, 3 agents\nBusiness $299.99/month\n30,000 tasks/mo, 50 agents",
  "Relevance AI pricing\nTeam\n$19 per user/month\n84,000 actions/yr, unlimited users",
  "CrewAI pricing\nBasic: $99/month\n100 executions/mo, 2 live crews",
  'Zapier pricing\nAgents\n"Pro" plan: $33.33/mo, billed annually\n1,500 activities/mo',
  "n8n plans\nStarter $24/month, billed annually\n2,500 executions, 5 active workflows",
];

export const PATHS = {
  copy: "projects/tern/work/docs/copy.md",
  landing: "projects/tern/work/mockups/landing.html",
  wireframe: "projects/tern/work/canvas/wireframe.excalidraw",
  plans: "projects/tern/work/tables/plans.csv",
  memo: "projects/tern/work/docs/memo.md",
};

export const DELIVERABLES = {
  copy: { id: "copy", title: "Landing copy", type: "doc", by: "writer" },
  landing: { id: "landing", title: "Landing page", type: "mockup", by: "designer" },
  wireframe: { id: "wireframe", title: "Wireframes", type: "canvas", by: "designer" },
  plans: { id: "plans", title: "Plans table", type: "table", by: "researcher" },
  memo: { id: "memo", title: "Pricing memo", type: "doc", by: "writer" },
  chart: { id: "chart", title: "Cost chart", type: "chart", by: "analyst" },
} satisfies Record<string, Deliverable>;

export interface FakeRun {
  /** The deliverable under check. */
  check: Deliverable;
  /** Latest text of each deliverable written in the run, by id. */
  files?: Record<string, { path: string; text: string }>;
  facts?: Record<string, string>;
  fetched?: string[];
  charts?: CheckContext["charts"];
}

/** A CheckContext over a fixed set of written deliverables: one version each. */
export function fakeContext(run: FakeRun): CheckContext {
  const version = (id: string): DeliverableVersion | null => {
    const f = run.files?.[id];
    return f ? { version: 1, path: f.path, text: f.text, agentId: "a-1", t: 60_000 } : null;
  };
  return {
    deliverable: run.check,
    current: version,
    versions: (id) => {
      const v = version(id);
      return v ? [v] : [];
    },
    fetched: run.fetched ?? [],
    facts: run.facts ?? {},
    charts: run.charts ?? [],
  };
}
