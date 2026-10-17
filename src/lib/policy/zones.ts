/*
 * File zones (stub: the interface the tests are written against).
 */
import type { AgentContext } from "./capabilities";
import type { Archetype, PolicyEvent, Rule, ToolRule } from "./types";

export type Severity = "open" | "shared" | "deliverable" | "protected" | "forbidden";

export interface Zone {
  id: string;
  label: string;
  paths: string[];
  severity: Severity;
  reason: string;
}

export type FileAccess = "edit" | "ask" | "read" | "protected" | "never";

export interface FileZoneView extends Zone {
  access: FileAccess;
  locked: boolean;
  ruleIds: string[];
}

export const ZONES: Zone[] = [];
export const WRITE_SCOPES = {} as Record<Archetype, string[]>;

export function scopeRules(agentId: string, archetype: Archetype, projectId: string, deliverables: string[] = []): ToolRule[] {
  void agentId, archetype, projectId, deliverables;
  return [];
}

export function fileRulesFor(agent: AgentContext, rules: Rule[], deliverables: string[], now: Date): ToolRule[] {
  void rules, now;
  return scopeRules(agent.agentId, agent.archetype, agent.projectId, deliverables);
}

export function fileEvent(agent: AgentContext, tool: string, args: Record<string, unknown>): PolicyEvent {
  return { ...agent, tool, args, argSpans: [], contextLabels: [], sinks: [] };
}

export function deliverableProblem(path: string): string | null {
  void path;
  return null;
}

export function filesFor(agent: AgentContext, rules: Rule[], deliverables: string[], now: Date): FileZoneView[] {
  void agent, rules, deliverables, now;
  return [];
}
