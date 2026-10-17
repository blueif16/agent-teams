import type { LaunchOptions, Proposal } from "./project";

export type MascotShape =
  | "cloud"
  | "pear"
  | "bean"
  | "heart"
  | "egg"
  | "frog"
  | "blob"
  | "pixel";

export type Accessory =
  | "beret"
  | "glasses"
  | "bowtie"
  | "glasses-bowtie"
  | "cap"
  | "headphones"
  | "flower"
  | "crown"
  | "sprout"
  | "none";

export interface MascotLook {
  shape: MascotShape;
  color: string;
  accessory: Accessory;
  eyes?: "dot" | "diamond";
  cheeks?: boolean;
  /** The Rive character drawn for this look at >= 48 px (public/rive/<rig>.riv). */
  rig?: MascotRig;
}

/** One Rive character per agent type (built in /home/ran/rive/felipe-rig, rive/cast.py). */
export type MascotRig = "felipe" | "alfred" | "dottie" | "pip" | "ledger" | "pixel";
export type AgentType = "lead" | "writer" | "researcher" | "coordinator" | "analyst" | "engineer" | "designer";

export type AgentStatus = "working" | "needs-you" | "idle" | "done";

export interface PlanStep {
  label: string;
  state: "done" | "active" | "todo";
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  teamId: string;
  /** Crusoe Managed Inference model ID used for live replies. */
  model: string;
  look: MascotLook;
  /** Persona notes fed into the system prompt. */
  brief: string;
}

interface MessageBase {
  id: string;
  at: string;
  /** Loaded from the saved transcript (src/lib/transcript.ts), not said on this page: it draws without the entrance. */
  saved?: boolean;
}

export type Message =
  | (MessageBase & {
      kind: "text";
      /** Agent id, or "you". */
      from: string;
      text: string;
      /** Images you attached: ids from POST /api/uploads, shown from /api/uploads/<id>. */
      images?: string[];
      /** Standing instruction or earlier message this one answers. */
      quote?: string;
      /** LangSmith run id of a live reply, so reactions land as feedback on it. */
      traceId?: string;
      /** Set while the reply is still streaming in, so Markdown animates and charts show a skeleton. */
      streaming?: boolean;
    })
  | (MessageBase & {
      kind: "handoff";
      from: string;
      to: string;
      task: string;
      /** You passed this agent's message on, rather than the agent delegating. */
      byYou?: boolean;
    })
  | (MessageBase & {
      kind: "approval";
      from: string;
      title: string;
      detail: string;
      state: "pending" | "approved" | "declined";
    })
  | (MessageBase & { kind: "status"; text: string })
  | (MessageBase & {
      kind: "proposal";
      /** The chief, who proposes the options. */
      from: string;
      /**
       * drafting: her fence is still streaming; planning: parsed, POST /api/projects/plan in flight. Both show only a
       * shimmer line: no card renders until every option has come back staffed (ready).
       */
      state: "drafting" | "planning" | "ready" | "launching" | "launched";
      proposal?: Proposal;
      plan?: LaunchOptions;
      /** The launch's idempotency key, made once per card, so a retried launch can't create a second team. */
      nonce: string;
      /** The option card that's picked. */
      picked: number;
      /** The owner's edits to the shared charter and the budget, folded away under the cards. */
      edits?: { goal?: string; due?: string | null; budgetUsd?: number };
      /** Why the last launch attempt failed. */
      error?: string;
      /** Once launched: the project, its channel (null for a solo DM) and its lead. */
      launched?: { projectId: string; channel: string | null; leadId: string };
    });

export interface Team {
  id: string;
  channel: string;
  name: string;
  goal: string;
  leadId: string;
  agents: Agent[];
  messages: Message[];
  /** Teams the chief launched at runtime: their spec and each member's assignment. */
  launched?: { spec: string; due?: string; assignments: Record<string, string> };
}

/** GET /api/org: what the runtime db adds to the code constants (src/server/directory.ts). */
export interface OrgPayload {
  /** Channels. */
  teams: Team[];
  /** Solo experts' projects, shown as DMs. */
  dms: Team[];
  agents: Agent[];
}

/** Live state of every team, sent to the chief so her answers match what the app shows. */
export interface OrgSnapshot {
  teams: {
    id: string;
    channel: string;
    name: string;
    goal: string;
    leadId: string;
    agents: { id: string; status: AgentStatus; doing: string }[];
    /** Titles of approvals waiting on the owner. */
    pending: string[];
    launched?: boolean;
  }[];
}
