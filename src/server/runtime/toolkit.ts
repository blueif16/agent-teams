/*
 * The tools each agent gets beyond its archetype's file tools; the runtime builds them with every worker.
 *   lead    the project-state tools (leadTools): assign_task delivers the brief to the expert's thread, which wakes it
 *   expert  report (workerTools): the state delta goes to the PM's inbox, which wakes the PM; bash when the registry
 *           gives its archetype the sandboxed shell
 *   chief   search_skills and find_skill (Mira)
 *   all     web_search and fetch_page
 * Server only.
 */
import type { StructuredToolInterface } from "@langchain/core/tools";
import { HQ } from "@/lib/data";
import { getArchetype } from "@/lib/skills/archetypes";
import { resolveToolset } from "@/lib/tools/resolve";
import { leadTools, workerTools, type DispatchRequest } from "@/server/project-state";
import type { AgentRow, ProjectRow, RuntimeDb } from "./db";
import type { CallbackPayload } from "./inbox";
import { threadId } from "./threads";
import { skillTools } from "./tools/skills";
import { webTools, type WebToolsDeps } from "./tools/web";

export interface ToolkitDeps {
  /** Delivers a message to a thread and wakes it (Runtime.send). Throws for a thread that doesn't exist. */
  send(threadId: string, message: { text: string; from: string }): unknown;
  /** Rows added here wake their thread (the runtime listens). */
  inbox: RuntimeDb["inbox"];
  /** The project's bash tools, its workbench started on first use (Workbenches). */
  bash(projectId: string): Promise<StructuredToolInterface[]>;
  web?: WebToolsDeps;
}

export interface Toolkit {
  tools: StructuredToolInterface[];
  /** bash is bound, so the worker resolves its toolset with the sandbox (and the shell's prompt note). */
  sandbox: boolean;
}

/** What the expert reads when the PM assigns it a task: the brief with its task id. */
export function briefText(r: DispatchRequest, pmName: string): string {
  return [
    `${pmName}, your PM, assigned you ${r.taskId}: ${r.title}`,
    r.brief,
    `Acceptance: ${r.acceptance}`,
    `When it's done, ready for review or blocked, call report with taskId "${r.taskId}".`,
  ].join("\n\n");
}

/** The registry gives this agent's archetype the sandboxed shell. */
function wantsBash(agent: AgentRow): boolean {
  const archetype = getArchetype(agent.archetype);
  return !!archetype && resolveToolset(archetype, agent.config.composition, { sandbox: true }).tools.some((t) => t.id === "bash");
}

export async function agentTools(agent: AgentRow, project: ProjectRow, deps: ToolkitDeps): Promise<Toolkit> {
  // The ledger's team, as the run's: a DM or company thread counts toward the company.
  const web = webTools({ agentId: agent.id, projectId: project.kind === "team" ? project.id : HQ.id }, deps.web);

  if (agent.archetype === "chief") return { tools: [...skillTools(), ...web], sandbox: false };

  if (agent.archetype === "lead") {
    const dispatch = (r: DispatchRequest) => void deps.send(threadId(r.agentId, r.projectId), { text: briefText(r, agent.name), from: agent.id });
    return { tools: [...leadTools(project.id, agent.id, { dispatch }), ...web, ...skillTools()], sandbox: false };
  }

  const report = workerTools(project.id, agent.id, {
    notifyLead: (delta) => {
      const lead = project.leadAgentId;
      // A solo expert is its own lead: there is nobody to wake.
      if (!lead || lead === agent.id) return;
      deps.inbox.add<CallbackPayload>(threadId(lead, project.id), "callback", { text: delta.line, from: agent.id, taskId: delta.taskId, rev: delta.rev });
    },
  });
  let bash: StructuredToolInterface[] = [];
  if (wantsBash(agent)) {
    try {
      bash = await deps.bash(project.id);
    } catch (e) {
      console.warn(`[runtime] ${agent.id} works without bash: the workbench didn't start (${(e as Error).message})`);
    }
  }
  return { tools: [...report, ...web, ...bash], sandbox: bash.length > 0 };
}
