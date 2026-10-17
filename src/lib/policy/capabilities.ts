import type { Archetype, DataGuard, Permission, Rule } from "./types";

export interface Capability {
  id: string;
  label: string;
  tools: string[];
}

export const CAPABILITIES: Capability[] = [];

export interface ToolsetEntry {
  call: string;
  planned: boolean;
}

export interface AgentContext {
  agentId: string;
  archetype: Archetype;
  projectId: string;
}

export function toolsetOf(_archetype: Archetype): ToolsetEntry[] {
  return [];
}

export function permissionsFor(_agent: AgentContext, _rules: Rule[], _tools: ToolsetEntry[], _now: Date): Permission[] {
  return [];
}

export function dataGuards(_rules: Rule[], _now: Date): DataGuard[] {
  return [];
}
