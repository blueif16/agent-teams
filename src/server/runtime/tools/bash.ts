/*
 * bash for the experts (registry id "bash", T7): one workbench per project (src/server/workbench), a stdio MCP server
 * whose one tool runs every command inside srt (Seatbelt on macOS). It starts the first time an agent of the project
 * is built with it, every agent there shares it, and it closes with the runtime or when the process exits (the
 * server also stops by itself when its stdin closes, which an exiting process always does).
 *
 * The workspace is <DATA_DIR>/projects/<pid>/files, the folder /project/ maps to (backends.ts), so bash and the file
 * tools see the same files. The network reaches only the package registries. Server only.
 */
import path from "node:path";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { dataDir } from "../../paths";
import { workbenchTools, type WorkbenchOptions } from "../../workbench/client";

/** pip and npm installs work; every other host is refused. */
export const WORKBENCH_DOMAINS = ["pypi.org", "files.pythonhosted.org", "registry.npmjs.org"];

/** Where a project's bash runs: the same folder as its /project/. */
export const projectFiles = (projectId: string) => path.join(dataDir(), "projects", projectId, "files");

type Bench = { tools: StructuredToolInterface[]; close: () => Promise<void> };

const open = new Set<Workbenches>();
let hooked = false;

/** The workbenches one runtime started, by project. */
export class Workbenches {
  private readonly benches = new Map<string, Promise<Bench>>();
  private readonly started: Bench[] = [];

  constructor(private readonly start: (o: WorkbenchOptions) => Promise<Bench> = workbenchTools) {
    open.add(this);
    if (!hooked) {
      hooked = true;
      process.once("exit", () => {
        for (const w of open) for (const b of w.started) void b.close().catch(() => {});
      });
    }
  }

  /** The project's bash tools, starting its workbench the first time. A start that fails is tried again next time. */
  tools(projectId: string): Promise<StructuredToolInterface[]> {
    let bench = this.benches.get(projectId);
    if (!bench) {
      bench = this.start({ projectId, workspace: projectFiles(projectId), allowedDomains: WORKBENCH_DOMAINS }).then((b) => {
        this.started.push(b);
        return b;
      });
      this.benches.set(projectId, bench);
      bench.catch(() => this.benches.delete(projectId));
    }
    return bench.then((b) => b.tools);
  }

  async close(): Promise<void> {
    open.delete(this);
    const all = [...this.benches.values()];
    this.benches.clear();
    this.started.length = 0;
    await Promise.all(all.map((b) => b.then((x) => x.close()).catch(() => {})));
  }
}
