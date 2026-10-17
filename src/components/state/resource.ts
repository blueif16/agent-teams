import type { Resource } from "@/lib/client-cache";

/** The client-cache resource for one project's state views. */
export const projectState = (pid: string, lead?: string): Resource => ({
  key: `/api/projects/${encodeURIComponent(pid)}/state${lead ? `?lead=${encodeURIComponent(lead)}` : ""}`,
  topic: `state:${pid}`,
});
