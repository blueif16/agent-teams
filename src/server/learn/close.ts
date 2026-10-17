import type { CloseSummary, RunFeedback } from "./types";

export interface CloseOptions {
  feedback?: RunFeedback;
  fetch?: typeof fetch;
  facts?: string[];
  kind?: string;
}

export async function closeProject(projectId: string, opts: CloseOptions = {}): Promise<CloseSummary> {
  void opts;
  return { projectId, closed: false, commits: [], skipped: [], usd: 0 };
}
