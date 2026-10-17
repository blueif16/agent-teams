import { describe, expect, it, vi } from "vitest";
import { tempProject } from "@/server/project-state/test-kit";
import { getServerCache } from "@/server/cache";
import { RUNTIME } from "@/server/runtime/vault";
import { agentVault } from "./agent-files";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/*
 * The state views refresh on `state:<pid>` (client cache topic): the app vault announces it after any commit that
 * touches projects/<pid>/state/, the way agent files announce files:agent:<id>.
 */
tempProject();

function listen() {
  const heard: string[] = [];
  const off = getServerCache().bus.subscribe(["state", "files"], (c) => heard.push(c.topic));
  return { heard, off };
}

describe("state topic", () => {
  it("announces state:<pid> after a commit under projects/<pid>/state/", async () => {
    const vault = await agentVault();
    const { heard, off } = listen();
    await vault.write({ path: "projects/p_42/state/dag.json", content: "{}\n", author: RUNTIME, source: "tool", subject: "state(p_42): add t1" });
    await vault.write({ path: "projects/p_42/state/journal/2.md", content: "# Journal\n", author: RUNTIME, source: "tool", subject: "state(p_42): open window 2" });
    off();
    // The file watcher may add files:* noise of its own; only state topics matter here.
    expect(heard.filter((t) => t.startsWith("state"))).toEqual(["state:p_42", "state:p_42"]);
  });

  it("stays quiet about state for agent files and project files outside state/", async () => {
    const vault = await agentVault();
    const { heard, off } = listen();
    await vault.write({ path: "agents/mira/notes.md", content: "x\n", author: RUNTIME, source: "tool" });
    await vault.write({ path: "projects/p_42/files/reports/t1-01.md", content: "r\n", author: RUNTIME, source: "report", subject: "state(p_42): report t1" });
    off();
    expect(heard.filter((t) => t.startsWith("state"))).toEqual([]);
    expect(heard).toContain("files:agent:mira");
  });
});
