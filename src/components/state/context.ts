/*
 * A compaction's steps as the chips the context bar's history draws, in the order they ran (src/lib/compaction.ts
 * mirrors F §9.4). The owner sees what was saved before anything was forgotten, and whether recall held.
 */
import type { CompactionEvent } from "@/lib/compaction";

export interface StepChip {
  kind: CompactionEvent["steps"][number]["kind"];
  label: string;
  /** Caution for a recall check that didn't fully pass, or a compaction marked degraded. */
  tone: "ok" | "caution";
  /** For "Saved": each file it saved, and the change it was saved in. */
  files: { name: string; path: string; change: string }[];
}

const LABEL = { filed: "Saved", summarized: "Summarized", rebuilt: "Rebuilt" } as const;

export function compactionSteps(e: CompactionEvent): StepChip[] {
  return e.steps.map((s): StepChip => {
    if (s.kind === "checked") {
      return { kind: s.kind, label: `Checked ${s.passed}/${s.total}`, tone: e.degraded || s.passed < s.total ? "caution" : "ok", files: [] };
    }
    const files = s.kind === "filed" ? s.files.map((f) => ({ name: f.path.split("/").pop() ?? f.path, path: f.path, change: f.change })) : [];
    return { kind: s.kind, label: LABEL[s.kind], tone: "ok", files };
  });
}

/** Words for how full the context is, for screen readers: never a number (owner, 2026-10-17). */
export function fillWords(used: number | null, compactsAt: number): string {
  if (used === null) return "No context used yet";
  if (used >= 1) return "Full; compacting before the next call";
  if (used >= compactsAt) return "Past the mark; compacts when idle";
  if (used >= compactsAt * 0.66) return "Getting close to the mark";
  return used < 0.25 ? "Mostly free" : "Plenty of room";
}
