/*
 * Approvals (R6; docs/design/team-setup.md §6): the tool gate on every worker, and the durable pause it puts a run in.
 *
 * - Before any tool runs, the gate decide()s the call against the rules in force and the tool tiers (policy/engine.ts):
 *     deny  → an error result the model reads, with the reason; the tool never runs;
 *     ask   → an approval row, then LangGraph's interrupt() from wrapToolCall (the primitive langchain's
 *             humanInTheLoopMiddleware uses in its "per_call" mode): the run stops, its state safe in the SQLite
 *             checkpointer, and the tool waits;
 *     allow → the tool runs.
 *   A tool with a card in ASKS (research: its tier and list price) asks every time, whatever the rules allow.
 * - Runtime.decide() records the decision (the row, the ledger, the events, the `approvals` topic) and queues a resume
 *   run. That run resumes each paused call whose approval is decided (Command({ resume }) keyed by interrupt id), and the
 *   gate runs again: it reads the decision from the db, never from the resume value. Approved → the tool runs. Declined
 *   → the model reads "declined by the owner: <note>". Still pending → it waits again. Nothing here approves by itself.
 * - Both halves are files (runtime.db, checkpoints.db), so a decision made after a restart resumes the run.
 * - While a thread waits, owner messages park in its inbox (index.ts) and reach the model in the resumed run.
 *
 * Not yet: labels on args (detectors) and the context, so flow rules see no spans here; decision transforms (redact,
 * tokenize) aren't applied; grants from "approve and allow" aren't minted.
 * Server only.
 */
import { ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { Command, interrupt } from "@langchain/langgraph";
import { createMiddleware, type AgentMiddleware } from "langchain";
import { HQ } from "@/lib/data";
import { record as ledgerRecord, type LedgerEvent } from "@/lib/ledger";
import { explain } from "@/lib/policy/engine";
import { readBack } from "@/lib/policy/readback";
import { policyStore } from "@/lib/policy/store";
import { tierOf, TOOL_CATALOG } from "@/lib/policy/tiers";
import type { PolicyEvent, Rule } from "@/lib/policy/types";
import { getArchetype } from "@/lib/skills/archetypes";
import { resolveToolset } from "@/lib/tools/resolve";
import { getServerCache } from "@/server/cache";
import { TOPICS } from "@/server/cache/bus";
import type { AgentRow, ApprovalRow, ProjectRow, RuntimeDb } from "./db";
import type { ThreadEvents } from "./events";
import { researchApproval, researchTool, type ResearchToolDeps } from "./tools/research";
import type { Worker } from "./worker";

/** How a tool's approval card reads, from its args. */
export type Card = (args: Record<string, unknown>) => { title: string; detail: string; estUsd: number | null };

/** Tools that ask every time, with their cards. */
export const ASKS: Record<string, Card> = { research: researchApproval };

export type Decision = "approve" | "decline";

/** What the paused call's interrupt carries (and what a client reading the checkpoint sees). */
export interface ApprovalInterrupt {
  type: "approval";
  approvalId: string;
  tool: string;
  title: string;
}

export class UnknownApprovalError extends Error {
  constructor(readonly approvalId: string) {
    super(`There is no approval ${approvalId}`);
    this.name = "UnknownApprovalError";
  }
}

export class ApprovalDecidedError extends Error {
  constructor(readonly approval: ApprovalRow) {
    super(`Approval ${approval.id} is already ${approval.state}`);
    this.name = "ApprovalDecidedError";
  }
}

/** The stats team a thread's ledger rows count toward: a team project, or the company (Mira's HQ) for DMs. */
const statsTeam = (project: ProjectRow) => (project.kind === "team" ? project.id : HQ.id);

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
};

/** Why the rules gave `outcomes` for this call, one line per rule (or the tier default). */
function reasons(e: PolicyEvent, rules: Rule[], now: Date, outcomes: string[]): string[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const lines = explain(e, rules, [], now)
    .contributions.filter((c) => outcomes.includes(c.outcome))
    .map((c) => {
      const rule = c.ruleId ? byId.get(c.ruleId) : undefined;
      if (rule) return rule.reason ?? readBack(rule);
      const tier = tierOf(e.tool);
      return tier ? `${tier.name} (${tier.tier}) ${c.outcome === "ask" ? "asks first" : "is off"}` : "This tool is in no tier yet, so it asks first";
    });
  return [...new Set(lines)];
}

export interface GateOptions {
  db: RuntimeDb;
  agent: AgentRow;
  project: ProjectRow;
  threadId: string;
  /** The run in progress on the thread. */
  currentRun: () => string | undefined;
  rules: () => Promise<Rule[]>;
  /** A new approval was created. */
  onAsk: (approval: ApprovalRow) => void;
  now?: () => Date;
}

/** The gate: decide() before every tool call (see the header). */
export function toolGate({ db, agent, project, threadId, currentRun, rules: loadRules, onAsk, now = () => new Date() }: GateOptions): AgentMiddleware {
  return createMiddleware({
    name: "ToolGate",
    wrapToolCall: async (request, handler) => {
      const call = request.toolCall;
      const args = (call.args ?? {}) as Record<string, unknown>;
      const event: PolicyEvent = {
        agentId: agent.id,
        archetype: agent.archetype,
        projectId: project.id,
        tool: call.name,
        args,
        argSpans: [],
        contextLabels: [],
        sinks: TOOL_CATALOG[call.name]?.sinks ?? [],
      };
      const rules = await loadRules();
      const at = now();
      const { effect } = explain(event, rules, [], at).decision;
      const card = ASKS[call.name];

      if (effect === "block" || effect === "deny") {
        const why = reasons(event, rules, at, ["block", "deny"]).join("; ");
        return new ToolMessage({
          content: `${call.name} is blocked by the owner's rules: ${why}. It didn't run. Don't retry it; work without it, or tell the owner why you need it.`,
          name: call.name,
          tool_call_id: call.id ?? "",
          status: "error",
        });
      }
      if (effect !== "ask" && !card) return handler(request);

      if (!call.id) throw new Error(`Tool call ${call.name} has no id, so its approval can't be matched to it.`);
      const shown = card
        ? card(args)
        : {
            title: capital(call.name.replace(/_/g, " ")),
            detail: [reasons(event, rules, at, ["ask"]).join("; "), oneLine(JSON.stringify(args), 400)].filter(Boolean).join("\n"),
            estUsd: null,
          };
      const { approval, created } = db.approvals.ask({
        threadId,
        runId: currentRun() ?? null,
        agentId: agent.id,
        projectId: project.id,
        tool: call.name,
        toolCallId: call.id,
        args,
        ...shown,
      });
      if (created) onAsk(approval);

      // The db holds the decision. interrupt() pauses on the first pass and returns on resume; each later call in
      // the same pass pauses again, so a resume that finds the approval still pending waits once more.
      const pause: ApprovalInterrupt = { type: "approval", approvalId: approval.id, tool: approval.tool, title: approval.title };
      for (;;) {
        const row = db.approvals.get(approval.id)!;
        if (row.state === "approved") return handler(request);
        if (row.state === "declined")
          return new ToolMessage({ content: `declined by the owner: ${row.note ?? "no reason given"}`, name: call.name, tool_call_id: call.id, status: "error" });
        interrupt(pause);
      }
    },
  });
}

export interface ApprovalsOptions {
  db: RuntimeDb;
  events: ThreadEvents;
  /** The rules in force; default the policy store (defaults, then the owner's). */
  rules?: () => Promise<Rule[]>;
  /** For the research tool: You.com key, fetch, ledger (tests pass a fake). */
  research?: ResearchToolDeps;
  /** Default: the ledger's record(). */
  record?: (e: LedgerEvent) => Promise<void>;
  /** Tell open views the approvals changed; default the server cache's `approvals` topic. */
  announce?: () => void;
}

/** The runtime's side of approvals: the per-worker hook, decisions, and what a resume run resumes. */
export class Approvals {
  private readonly rules: () => Promise<Rule[]>;
  private readonly record: (e: LedgerEvent) => Promise<void>;
  private readonly announce: () => void;

  constructor(private readonly o: ApprovalsOptions) {
    const store = o.rules ? undefined : policyStore();
    this.rules = o.rules ?? (() => store!.list());
    this.record = o.record ?? ledgerRecord;
    this.announce = o.announce ?? (() => void getServerCache().bus.emit(TOPICS.approvals));
  }

  /** R6 hook for one worker: the gated tools its toolset grants (research), and the gate over every tool. */
  forWorker(agent: AgentRow, project: ProjectRow, threadId: string, currentRun: () => string | undefined): { tools: StructuredToolInterface[]; middleware: AgentMiddleware } {
    const archetype = getArchetype(agent.archetype);
    const granted = archetype ? resolveToolset(archetype, agent.config.composition, { sandbox: false }).tools.map((d) => d.id) : [];
    const tools = granted.includes("research") ? [researchTool({ agentId: agent.id, team: statsTeam(project) }, this.o.research)] : [];
    const middleware = toolGate({
      db: this.o.db,
      agent,
      project,
      threadId,
      currentRun,
      rules: this.rules,
      onAsk: (approval) => this.changed(approval, approval.runId ?? currentRun() ?? ""),
    });
    return { tools, middleware };
  }

  /** The thread has a call waiting on the owner. */
  waiting(threadId: string): boolean {
    return this.o.db.approvals.pending({ thread: threadId }).length > 0;
  }

  /** Records the owner's decision: the row, one ledger row, the events. The caller resumes the run. */
  async decide(id: string, decision: Decision, note?: string): Promise<ApprovalRow> {
    const { db } = this.o;
    const before = db.approvals.get(id);
    if (!before) throw new UnknownApprovalError(id);
    const approval = db.approvals.decide(id, decision === "approve" ? "approved" : "declined", note);
    if (!approval) throw new ApprovalDecidedError(db.approvals.get(id)!);
    const project = db.projects.get(approval.projectId);
    try {
      await this.record({
        t: "approval",
        at: approval.decidedAt ?? new Date().toISOString(),
        team: project ? statsTeam(project) : HQ.id,
        agent: approval.agentId,
        decision: approval.state as "approved" | "declined",
      });
    } catch (e) {
      console.warn(`approvals: ledger write failed: ${(e as Error).message}`);
    }
    this.changed(approval, approval.runId ?? "");
    return approval;
  }

  /** What a resume run passes the agent: a resume for each paused call whose approval is decided, or null if none is. */
  async resumeCommand(worker: Worker, threadId: string): Promise<Command | null> {
    const state = await worker.graph.getState({ configurable: { thread_id: threadId } });
    const resume: Record<string, { approvalId: string }> = {};
    for (const task of state.tasks ?? [])
      for (const i of task.interrupts ?? []) {
        const v = i.value as Partial<ApprovalInterrupt> | undefined;
        const row = v?.type === "approval" && v.approvalId ? this.o.db.approvals.get(v.approvalId) : undefined;
        if (i.id && row && row.state !== "pending") resume[i.id] = { approvalId: row.id };
      }
    return Object.keys(resume).length ? new Command({ resume }) : null;
  }

  private changed(approval: ApprovalRow, run: string) {
    this.o.events.emit(approval.threadId, { type: "approval", run, approval });
    try {
      this.announce();
    } catch (e) {
      console.warn(`approvals: announce failed: ${(e as Error).message}`);
    }
  }
}
