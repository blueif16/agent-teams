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
export type AgentType = "lead" | "writer" | "researcher" | "coordinator" | "analyst" | "engineer";

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
  status: AgentStatus;
  /** One line: what the agent is doing right now. */
  task: string;
  progress: number;
  elapsed: string;
  steps: PlanStep[];
  schedule?: string[];
  subAgents?: number;
  artifactId?: string;
  /** Persona notes fed into the system prompt. */
  brief: string;
}

export type ArtifactBody =
  | {
      kind: "slides";
      section: string;
      variants: { label: string; title: string; body: string; cta: string }[];
    }
  | { kind: "doc"; heading: string; sections: { heading?: string; body: string }[] }
  | { kind: "sheet"; columns: string[]; rows: string[][]; note?: string }
  | {
      kind: "code";
      file: string;
      lines: { text: string; type?: "add" | "del" | "meta" }[];
      checks: { label: string; ok: boolean }[];
    }
  | { kind: "browser"; heading: string; items: { title: string; body: string }[] };

export interface Artifact {
  id: string;
  title: string;
  host: string;
  agentId: string;
  teamId: string;
  updated: string;
  body: ArtifactBody;
}

interface MessageBase {
  id: string;
  at: string;
}

export type Message =
  | (MessageBase & {
      kind: "text";
      /** Agent id, or "you". */
      from: string;
      text: string;
      /** Standing instruction or earlier message this one answers. */
      quote?: string;
      mentionsYou?: boolean;
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
  | (MessageBase & { kind: "artifact"; from: string; artifactId: string })
  | (MessageBase & { kind: "status"; text: string })
  | (MessageBase & {
      kind: "proposal";
      /** The chief, who staffs projects. */
      from: string;
      project: Project;
      state: "pending" | "launched";
      /** Set once launched: the new team's id. */
      teamId?: string;
    });

/** A project the chief proposes: an A-team picked from the roster, a goal and a short spec. */
export interface Project {
  name: string;
  channel: string;
  goal: string;
  /** YYYY-MM-DD, when the goal has a date. */
  due?: string;
  leadId: string;
  members: { id: string; assignment: string }[];
  /** Markdown: problem, scope, milestones, success metric, risks. */
  spec: string;
}

export interface Team {
  id: string;
  channel: string;
  name: string;
  goal: string;
  leadId: string;
  agents: Agent[];
  messages: Message[];
  unread: number;
  /** Teams the chief launched at runtime: their spec and each member's assignment. */
  launched?: { spec: string; due?: string; assignments: Record<string, string> };
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
