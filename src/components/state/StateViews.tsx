"use client";

/*
 * The PM's project state, as the team panel's tabs and the workspace's full-size tabs. One cached read
 * (GET /api/projects/<pid>/state, topic state:<pid>) feeds every view, so a tab paints what it showed last and
 * refreshes when the PM's tools commit. Read-only in this version.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useCached } from "@/lib/client-cache";
import { isAgentFileName, type AgentFileName } from "@/lib/vault/types";
import { agentHistorySource, HistorySheet, stateHistorySource, type HistorySource } from "../FileHistory";
import { CharterView } from "./CharterView";
import { DecisionsView } from "./DecisionsView";
import { OpenView } from "./OpenView";
import { PlanView } from "./PlanView";
import { PmStrip } from "./PmStrip";
import { projectState } from "./resource";
import { card, StateViewProvider, type HistoryTarget, type StateTab, type StateViewEnv } from "./shared";
import { TeamView } from "./TeamView";
import type { ProjectStateVM } from "./types";

export type { StateTab };

export function useProjectState(pid: string, leadId: string) {
  return useCached<ProjectStateVM>(projectState(pid, leadId));
}

const AGENT_FILE_KEY: Record<string, AgentFileName> = { "SOUL.md": "soul", "MEMORY.md": "memory", "notes.md": "notes" };

/** The History behind a vault path: a project's state file, or an agent's own file. */
function sourceOf(t: HistoryTarget, channel: string): HistorySource | null {
  const state = /^projects\/([^/]+)\/state\/(.+)$/.exec(t.path);
  if (state) return stateHistorySource(state[1], state[2], { task: t.task, owner: `#${channel}` });
  const agent = /^agents\/([^/]+)\/([^/]+)$/.exec(t.path);
  const key = agent && AGENT_FILE_KEY[agent[2]];
  if (agent && key && isAgentFileName(key)) return agentHistorySource(agent[1], key);
  return null;
}

/** Provides the views' env for one team, and the one History sheet they open. */
export function TeamStateEnv({
  pid,
  channel,
  leadId,
  status,
  onOpenAgent,
  onOpenTab,
  onOpenFull,
  onNotify,
  children,
}: Omit<StateViewEnv, "onOpenHistory"> & { channel: string; onNotify: (text: string) => void; children: ReactNode }) {
  const [history, setHistory] = useState<HistoryTarget | null>(null);
  const env = useMemo<StateViewEnv>(
    () => ({ pid, leadId, status, onOpenAgent, onOpenTab, onOpenFull, onOpenHistory: setHistory }),
    [pid, leadId, status, onOpenAgent, onOpenTab, onOpenFull],
  );
  const source = history ? sourceOf(history, channel) : null;
  return (
    <StateViewProvider value={env}>
      {children}
      {source && <HistorySheet open={Boolean(history)} onClose={() => setHistory(null)} source={source} focus={history?.change} onNotify={onNotify} />}
    </StateViewProvider>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the project state" className="mt-6 space-y-2.5">
      {[72, 120, 96].map((h, i) => (
        <div key={i} className={`${card} animate-pulse bg-white`} style={{ height: h, animationDelay: `${i * 110}ms` }} />
      ))}
    </div>
  );
}

function Failed({ error }: { error: string }) {
  return <p className={`${card} mt-6 px-4 py-4 text-center text-[13.5px] text-muted`}>Couldn&apos;t read the project state ({error}).</p>;
}

/** One state tab's body. */
export function StateTabBody({ tab, pid, leadId, full = false }: { tab: StateTab; pid: string; leadId: string; full?: boolean }) {
  const { data, error } = useProjectState(pid, leadId);
  if (!data) return error ? <Failed error={error} /> : <Skeleton />;
  switch (tab) {
    case "plan":
      return <PlanView plan={data.plan} full={full} />;
    case "decisions":
      return <DecisionsView decisions={data.decisions} full={full} />;
    case "open":
      return <OpenView open={data.open} plan={data.plan} />;
    case "team":
      return <TeamView team={data.team} />;
    case "charter":
      return <CharterView charter={data.charter} journal={data.journal} prefs={data.prefs} />;
  }
}

/** The PM status strip for the Overview tab; nothing while the first read is in flight. */
export function PmStatus({ pid, leadId, now }: { pid: string; leadId: string; now?: string }) {
  const { data } = useProjectState(pid, leadId);
  return data ? <PmStrip state={data} now={now} /> : null;
}
