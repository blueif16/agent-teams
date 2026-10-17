/*
 * `team_stats`: per-team performance numbers for Mira (and later the HR agent), to compare teams and draw a chart.
 * Read-only: it sums the ledger's model-call and paid-tool rows per team, adds the team's name, and, in test mode,
 * the run summary of the run that made the team (trial, quality, time to done). Owner orders and approvals are
 * signals, not team activity, so they move neither the totals nor the times.
 *
 * Every source is injected (the ledger, the name lookup, the run summaries), so the tool itself touches no file,
 * network or model. The result is a compact JSON string, capped at 20 teams and about 2,000 tokens.
 *
 * Value imports stay relative (no `@/`) so a plain `node` can load this file, like ./web.ts.
 */
import { tool } from "langchain";
import { z } from "zod";
import { HQ } from "../../../lib/data";
import type { CallEvent, LedgerEvent, ToolEvent } from "../../../lib/ledger";
import type { RunSummary } from "../../../lib/sim/types";
import { totals } from "../../../lib/stats";

export const MAX_TEAMS = 20;
/** About 2,000 tokens, in the runtime's rough measure of ~4 characters per token. */
export const MAX_OUTPUT_CHARS = 8000;

export interface TeamStatsDeps {
  /** The ledger, e.g. readLedger() from src/lib/ledger.ts. */
  readLedger: () => Promise<LedgerEvent[]>;
  /** A team's display name, e.g. (id) => getTeam(id)?.name. */
  teamName?: (id: string) => string | undefined;
  /** Test mode: every run summary so far. */
  runSummaries?: () => Promise<RunSummary[]>;
  /** Test mode: the project (team) a run created. */
  projectOf?: (runId: string) => string | undefined;
}

export interface TeamStats {
  team: string;
  name?: string;
  /** Prompt tokens, cached included. */
  tokensIn: number;
  cached: number;
  tokensOut: number;
  /** Model spend, USD. */
  usd: number;
  calls: number;
  /** Paid tool spend (web search, page fetch), USD. */
  toolUsd: number;
  /** First and last model or tool call; null with none. */
  firstAt: string | null;
  lastAt: string | null;
  /** firstAt to lastAt, minutes. */
  wallMin: number;
  /** Test mode, from the run that made the team: its trial, quality score (0–1) and minutes to done (null: never). */
  trial?: number;
  quality?: number;
  timeToDoneMin?: number | null;
}

const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;
const NAME_MAX = 60;
const clip = (s: string) => (s.length <= NAME_MAX ? s : `${s.slice(0, NAME_MAX - 1)}…`);

/** The team's model and tool calls, ledger order. */
type Activity = CallEvent | ToolEvent;

function statsOf(team: string, name: string | undefined, rows: Activity[]): TeamStats {
  const t = totals(rows);
  const firstAt = rows.reduce<string | null>((min, e) => (min === null || e.at < min ? e.at : min), null);
  const toolUsd = rows.reduce((s, e) => (e.t === "tool" ? s + e.cost : s), 0);
  const wallMs = firstAt && t.lastAt ? Date.parse(t.lastAt) - Date.parse(firstAt) : 0;
  return {
    team,
    ...(name ? { name: clip(name) } : {}),
    tokensIn: t.input,
    cached: t.cached,
    tokensOut: t.output,
    usd: round(t.cost, 4),
    calls: t.calls,
    toolUsd: round(toolUsd, 4),
    firstAt,
    lastAt: t.lastAt,
    wallMin: round(wallMs / 60_000, 1),
  };
}

/** Run summaries by the team their run made; a later summary for the same team wins. */
async function summariesByTeam(deps: TeamStatsDeps): Promise<Map<string, RunSummary>> {
  const byTeam = new Map<string, RunSummary>();
  for (const s of (await deps.runSummaries?.()) ?? []) {
    const own = (s as RunSummary & { projectId?: unknown }).projectId;
    const team = deps.projectOf?.(s.runId) ?? (typeof own === "string" ? own : undefined);
    if (team) byTeam.set(team, s);
  }
  return byTeam;
}

const testFields = (s: RunSummary) => ({
  trial: s.trial,
  quality: s.quality.score,
  timeToDoneMin: s.timeToDoneMs === null ? null : round(s.timeToDoneMs / 60_000, 1),
});

export function teamStatsTool(deps: TeamStatsDeps) {
  return tool(
    async ({ teams }) => {
      // Map keeps first-seen order, which is first-call order in an append-only ledger.
      const byTeam = new Map<string, Activity[]>();
      for (const e of await deps.readLedger()) {
        if (e.t !== "call" && e.t !== "tool") continue;
        const rows = byTeam.get(e.team) ?? [];
        rows.push(e);
        byTeam.set(e.team, rows);
      }
      const ids = teams?.length ? [...new Set(teams)] : [...byTeam.keys()].filter((id) => id !== HQ.id);
      const runs = await summariesByTeam(deps);
      const entries = ids.slice(0, MAX_TEAMS).map((id) => {
        const run = runs.get(id);
        return { ...statsOf(id, deps.teamName?.(id), byTeam.get(id) ?? []), ...(run ? testFields(run) : {}) };
      });
      const out = () => JSON.stringify({ teams: entries, ...(ids.length > entries.length ? { more: ids.length - entries.length } : {}) });
      // Entries are bounded, so this only bites on absurdly long team ids.
      while (entries.length > 1 && out().length > MAX_OUTPUT_CHARS) entries.pop();
      return out();
    },
    {
      name: "team_stats",
      description:
        "Per-team performance numbers from the ledger. Use it when comparing teams' token use, cost, time and quality, " +
        "e.g. to rank teams or draw a comparison chart. Read-only and free: it changes nothing. Returns JSON, one entry " +
        "per team (at most 20, first-active first): tokensIn (cached included), cached, tokensOut, usd (model spend), " +
        "calls, toolUsd (paid tools such as web search), firstAt and lastAt (first and last call), wallMin (minutes " +
        "between them); in test mode also trial, quality (0-1) and timeToDoneMin (null: never done). " +
        'Unknown team ids come back with zeros; "more" counts the teams left out.',
      schema: z.object({
        teams: z.array(z.string()).optional().describe("Team ids to compare, in the order you want them. Default: every team."),
      }),
    },
  );
}
