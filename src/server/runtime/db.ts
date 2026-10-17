/*
 * The runtime's tables (research D §10): projects, agents, project_members, threads, runs and inbox, in
 * <DATA_DIR>/runtime.db. Checkpoints live in their own file (checkpointer.ts); the ledger stays JSONL.
 *
 * node:sqlite, built into Node 24 and typed by @types/node: better-sqlite3 is here only as the checkpointer's
 * transitive dependency, without types, so importing it directly would be an undeclared dependency.
 *
 * Migrations are numbered by PRAGMA user_version and each runs once, in a transaction. Migration 1 also seeds
 * Mira (agent `mira`, archetype chief) with her `dm` project and its thread, so the seed runs once too and
 * later edits to those rows stick. Rows come back camelCase with JSON columns parsed. Server only.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { uuid7 } from "langsmith";
import type { Tier } from "@/lib/models";
import type { Archetype } from "@/lib/policy/types";
import type { Composition } from "@/lib/skills/types";
import type { AgentStatus } from "@/lib/types";
import { dataDir } from "../paths";
import type { Lane } from "./limiter";
import { threadId } from "./threads";

// ------------------------------------------------------------------------------------------- row types

export type ProjectKind = "team" | "dm" | "company";
export type ProjectStatus = "proposed" | "active" | "done" | "archived";

export interface ProjectRow {
  id: string;
  kind: ProjectKind;
  channel: string | null;
  name: string;
  goal: string | null;
  successMetric: string | null;
  /** ISO date or timestamp. */
  dueAt: string | null;
  status: ProjectStatus;
  leadAgentId: string | null;
  specMd: string | null;
  /** Spend cap for the whole project in USD (Q2: warn at 80%, pause at 100%); null = none set. */
  budgetUsd: number | null;
  createdAt: string;
  closedAt: string | null;
}

/** An agent's config (D §10 `config_json`; DECISIONS Q4). Open for the setup flow to extend. */
export interface AgentConfig {
  /** The archetype plus the skills it was composed with for its role. */
  composition?: Composition;
  /** Spend cap in USD (Q2: warn at 80%, pause at 100%). */
  budgetUsd?: number;
  /** Heartbeat period in ms; absent or null means no heartbeat. */
  heartbeatMs?: number | null;
}

export interface AgentRow {
  id: string;
  name: string;
  archetype: Archetype;
  modelTier: Tier;
  config: AgentConfig;
  /** `agents/<id>`, relative to the vault. */
  homeDir: string;
  status: AgentStatus;
  /** Copy-of (Q3 rehire). */
  seededFromAgentId: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  retiredAt: string | null;
}

export interface ProjectMemberRow {
  projectId: string;
  agentId: string;
  role: string | null;
  qualifications: string[];
  joinedAt: string;
  leftAt: string | null;
}

export type ThreadStatus = "idle" | "running" | "waiting_approval" | "error";

export interface ThreadRow {
  /** `a:{agentId}:p:{projectId}`. */
  id: string;
  agentId: string;
  projectId: string;
  status: ThreadStatus;
  lastRunAt: string | null;
  lastDreamAt: string | null;
  lastDreamMsgCount: number;
  createdAt: string;
}

export type RunTrigger = "message" | "dm" | "assignment" | "callback" | "resume" | "kickoff";
export type RunStatus = "queued" | "running" | "interrupted" | "done" | "error" | "cancelled";

export interface RunRow {
  /** uuid7, also the LangSmith run id. */
  id: string;
  threadId: string;
  trigger: RunTrigger;
  lane: Lane;
  status: RunStatus;
  assignmentId: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Model calls made so far. */
  calls: number;
  costUsd: number;
  error: string | null;
}

export type InboxKind = "dm" | "assignment" | "callback" | "order";

export interface InboxRow<P = unknown> {
  /** Increasing: delivery order. */
  id: number;
  threadId: string;
  kind: InboxKind;
  payload: P;
  createdAt: string;
  deliveredRunId: string | null;
  deliveredAt: string | null;
}

export type NewProject = Pick<ProjectRow, "kind" | "name"> & Partial<Omit<ProjectRow, "kind" | "name" | "createdAt" | "closedAt">>;
export type NewAgent = Pick<AgentRow, "id" | "name" | "archetype"> & Partial<Pick<AgentRow, "modelTier" | "config" | "status" | "seededFromAgentId">>;
export type NewMember = Pick<ProjectMemberRow, "projectId" | "agentId"> & Partial<Pick<ProjectMemberRow, "role" | "qualifications">>;
export type NewRun = Pick<RunRow, "threadId" | "trigger" | "lane"> & Partial<Pick<RunRow, "id" | "assignmentId">>;

// ------------------------------------------------------------------------------------------ migrations

export const MIRA_ID = "mira";
export const MIRA_DM_PROJECT = "dm";

const MIGRATIONS: ((db: DatabaseSync, now: string) => void)[] = [
  (db, now) => {
    db.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        archetype TEXT NOT NULL,
        model_tier TEXT NOT NULL DEFAULT 'main',
        config_json TEXT NOT NULL DEFAULT '{}',
        home_dir TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        seeded_from_agent_id TEXT REFERENCES agents(id),
        last_heartbeat_at TEXT,
        created_at TEXT NOT NULL,
        retired_at TEXT
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('team', 'dm', 'company')),
        channel TEXT,
        name TEXT NOT NULL,
        goal TEXT,
        success_metric TEXT,
        due_at TEXT,
        status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'done', 'archived')),
        lead_agent_id TEXT REFERENCES agents(id),
        spec_md TEXT,
        created_at TEXT NOT NULL,
        closed_at TEXT
      );
      CREATE TABLE project_members (
        project_id TEXT NOT NULL REFERENCES projects(id),
        agent_id TEXT NOT NULL REFERENCES agents(id),
        role TEXT,
        qualifications_json TEXT NOT NULL DEFAULT '[]',
        joined_at TEXT NOT NULL,
        left_at TEXT,
        PRIMARY KEY (project_id, agent_id)
      );
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        project_id TEXT NOT NULL REFERENCES projects(id),
        status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'waiting_approval', 'error')),
        last_run_at TEXT,
        last_dream_at TEXT,
        last_dream_msg_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE (agent_id, project_id)
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id),
        trigger TEXT NOT NULL CHECK (trigger IN ('message', 'dm', 'assignment', 'callback', 'resume', 'kickoff')),
        lane TEXT NOT NULL CHECK (lane IN ('interactive', 'work', 'background')),
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'interrupted', 'done', 'error', 'cancelled')),
        assignment_id TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        calls INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE INDEX runs_by_thread ON runs (thread_id);
      CREATE INDEX runs_by_status ON runs (status);
      CREATE TABLE inbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL REFERENCES threads(id),
        kind TEXT NOT NULL CHECK (kind IN ('dm', 'assignment', 'callback', 'order')),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_run_id TEXT REFERENCES runs(id),
        delivered_at TEXT
      );
      CREATE INDEX inbox_pending ON inbox (thread_id, id) WHERE delivered_at IS NULL;
    `);
    // The seed: a fresh company is the owner and Mira (src/lib/data.ts), who talks to the owner in her DM.
    db.prepare(`INSERT INTO agents (id, name, archetype, model_tier, home_dir, created_at) VALUES (?, 'Mira', 'chief', 'main', ?, ?)`).run(
      MIRA_ID,
      `agents/${MIRA_ID}`,
      now,
    );
    db.prepare(`INSERT INTO projects (id, kind, name, status, lead_agent_id, created_at) VALUES (?, 'dm', 'Mira', 'active', ?, ?)`).run(
      MIRA_DM_PROJECT,
      MIRA_ID,
      now,
    );
    db.prepare(`INSERT INTO project_members (project_id, agent_id, role, joined_at) VALUES (?, ?, 'chief', ?)`).run(MIRA_DM_PROJECT, MIRA_ID, now);
    db.prepare(`INSERT INTO threads (id, agent_id, project_id, created_at) VALUES (?, ?, ?, ?)`).run(
      threadId(MIRA_ID, MIRA_DM_PROJECT),
      MIRA_ID,
      MIRA_DM_PROJECT,
      now,
    );
  },
  // 2: a project's budget (the launch card sets it).
  (db) => {
    db.exec("ALTER TABLE projects ADD COLUMN budget_usd REAL");
  },
];

// ---------------------------------------------------------------------------------------------- rows

type Raw = Record<string, SQLOutputValue>;
const str = (v: SQLOutputValue) => (v == null ? null : String(v));
const json = <T>(v: SQLOutputValue, fallback: T): T => (typeof v === "string" ? (JSON.parse(v) as T) : fallback);

const toProject = (r: Raw): ProjectRow => ({
  id: String(r.id),
  kind: r.kind as ProjectKind,
  channel: str(r.channel),
  name: String(r.name),
  goal: str(r.goal),
  successMetric: str(r.success_metric),
  dueAt: str(r.due_at),
  status: r.status as ProjectStatus,
  leadAgentId: str(r.lead_agent_id),
  specMd: str(r.spec_md),
  budgetUsd: r.budget_usd == null ? null : Number(r.budget_usd),
  createdAt: String(r.created_at),
  closedAt: str(r.closed_at),
});

const toAgent = (r: Raw): AgentRow => ({
  id: String(r.id),
  name: String(r.name),
  archetype: r.archetype as Archetype,
  modelTier: r.model_tier as Tier,
  config: json<AgentConfig>(r.config_json, {}),
  homeDir: String(r.home_dir),
  status: r.status as AgentStatus,
  seededFromAgentId: str(r.seeded_from_agent_id),
  lastHeartbeatAt: str(r.last_heartbeat_at),
  createdAt: String(r.created_at),
  retiredAt: str(r.retired_at),
});

const toMember = (r: Raw): ProjectMemberRow => ({
  projectId: String(r.project_id),
  agentId: String(r.agent_id),
  role: str(r.role),
  qualifications: json<string[]>(r.qualifications_json, []),
  joinedAt: String(r.joined_at),
  leftAt: str(r.left_at),
});

const toThread = (r: Raw): ThreadRow => ({
  id: String(r.id),
  agentId: String(r.agent_id),
  projectId: String(r.project_id),
  status: r.status as ThreadStatus,
  lastRunAt: str(r.last_run_at),
  lastDreamAt: str(r.last_dream_at),
  lastDreamMsgCount: Number(r.last_dream_msg_count),
  createdAt: String(r.created_at),
});

const toRun = (r: Raw): RunRow => ({
  id: String(r.id),
  threadId: String(r.thread_id),
  trigger: r.trigger as RunTrigger,
  lane: r.lane as Lane,
  status: r.status as RunStatus,
  assignmentId: str(r.assignment_id),
  createdAt: String(r.created_at),
  startedAt: str(r.started_at),
  endedAt: str(r.ended_at),
  calls: Number(r.calls),
  costUsd: Number(r.cost_usd),
  error: str(r.error),
});

const toInbox = <P>(r: Raw): InboxRow<P> => ({
  id: Number(r.id),
  threadId: String(r.thread_id),
  kind: r.kind as InboxKind,
  payload: json<P>(r.payload_json, null as P),
  createdAt: String(r.created_at),
  deliveredRunId: str(r.delivered_run_id),
  deliveredAt: str(r.delivered_at),
});

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** A ulid: 48 bits of ms time + 80 random bits, Crockford base32, sortable by creation. */
export function ulid(now = Date.now()): string {
  let t = now;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32] + out;
    t = Math.floor(t / 32);
  }
  for (const b of crypto.getRandomValues(new Uint8Array(16))) out += CROCKFORD[b % 32];
  return out;
}

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

// ---------------------------------------------------------------------------------------------- db

export class RuntimeDb {
  readonly sql: DatabaseSync;

  constructor(readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.sql = new DatabaseSync(file);
    this.sql.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  close(): void {
    if (this.sql.isOpen) this.sql.close();
  }

  private readonly inboxListeners = new Set<(threadId: string) => void>();

  /**
   * Hear every inbox row added, by its thread id. Called after the synchronous work that added it, so a transaction
   * around the add has committed (or rolled back: check `inbox.pending`). Returns the unsubscribe.
   */
  onInbox(fn: (threadId: string) => void): () => void {
    this.inboxListeners.add(fn);
    return () => void this.inboxListeners.delete(fn);
  }

  /** Runs `fn` in one transaction: all of it lands or none. Not reentrant. */
  tx<T>(fn: () => T): T {
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.sql.exec("COMMIT");
      return out;
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    }
  }

  private migrate(): void {
    const version = Number((this.sql.prepare("PRAGMA user_version").get() as Raw).user_version);
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        MIGRATIONS[v](this.sql, new Date().toISOString());
        this.sql.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  private one<T>(map: (r: Raw) => T, sql: string, ...params: SQLInputValue[]): T | undefined {
    const r = this.sql.prepare(sql).get(...params) as Raw | undefined;
    return r ? map(r) : undefined;
  }

  private all<T>(map: (r: Raw) => T, sql: string, ...params: SQLInputValue[]): T[] {
    return (this.sql.prepare(sql).all(...params) as Raw[]).map(map);
  }

  readonly projects = {
    create: (p: NewProject): ProjectRow => {
      const id = p.id ?? ulid();
      this.sql
        .prepare(
          `INSERT INTO projects (id, kind, channel, name, goal, success_metric, due_at, status, lead_agent_id, spec_md, budget_usd, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          p.kind,
          p.channel ?? null,
          p.name,
          p.goal ?? null,
          p.successMetric ?? null,
          p.dueAt ?? null,
          p.status ?? "proposed",
          p.leadAgentId ?? null,
          p.specMd ?? null,
          p.budgetUsd ?? null,
          new Date().toISOString(),
        );
      return this.projects.get(id)!;
    },
    get: (id: string) => this.one(toProject, "SELECT * FROM projects WHERE id = ?", id),
    list: (filter: { status?: ProjectStatus; kind?: ProjectKind } = {}): ProjectRow[] =>
      // Named parameters: node:sqlite (Node 24.1) can't bind positional values to numbered ones (?1).
      (
        this.sql
          .prepare("SELECT * FROM projects WHERE (:status IS NULL OR status = :status) AND (:kind IS NULL OR kind = :kind) ORDER BY created_at, rowid")
          .all({ status: filter.status ?? null, kind: filter.kind ?? null }) as Raw[]
      ).map(toProject),
    setStatus: (id: string, status: ProjectStatus): void => {
      const closed = status === "done" || status === "archived" ? new Date().toISOString() : null;
      this.sql.prepare("UPDATE projects SET status = ?, closed_at = COALESCE(?, closed_at) WHERE id = ?").run(status, closed, id);
    },
  };

  readonly agents = {
    create: (a: NewAgent): AgentRow => {
      this.sql
        .prepare(
          `INSERT INTO agents (id, name, archetype, model_tier, config_json, home_dir, status, seeded_from_agent_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(a.id, a.name, a.archetype, a.modelTier ?? "main", JSON.stringify(a.config ?? {}), `agents/${a.id}`, a.status ?? "idle", a.seededFromAgentId ?? null, new Date().toISOString());
      return this.agents.get(a.id)!;
    },
    get: (id: string) => this.one(toAgent, "SELECT * FROM agents WHERE id = ?", id),
    list: () => this.all(toAgent, "SELECT * FROM agents WHERE retired_at IS NULL ORDER BY created_at, rowid"),
    /** Sets the fields given; `config` replaces the whole config (read, change, write). Undefined if no such agent. */
    update: (id: string, patch: { config?: AgentConfig; status?: AgentStatus }): AgentRow | undefined => {
      this.sql
        .prepare("UPDATE agents SET config_json = COALESCE(?, config_json), status = COALESCE(?, status) WHERE id = ?")
        .run(patch.config === undefined ? null : JSON.stringify(patch.config), patch.status ?? null, id);
      return this.agents.get(id);
    },
  };

  readonly members = {
    add: (m: NewMember): ProjectMemberRow => {
      this.sql
        .prepare(
          `INSERT INTO project_members (project_id, agent_id, role, qualifications_json, joined_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (project_id, agent_id) DO UPDATE SET role = excluded.role, qualifications_json = excluded.qualifications_json, left_at = NULL`,
        )
        .run(m.projectId, m.agentId, m.role ?? null, JSON.stringify(m.qualifications ?? []), new Date().toISOString());
      return this.one(toMember, "SELECT * FROM project_members WHERE project_id = ? AND agent_id = ?", m.projectId, m.agentId)!;
    },
    list: (projectId: string) => this.all(toMember, "SELECT * FROM project_members WHERE project_id = ? AND left_at IS NULL ORDER BY joined_at, rowid", projectId),
    has: (projectId: string, agentId: string): boolean =>
      this.sql.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND agent_id = ? AND left_at IS NULL").get(projectId, agentId) !== undefined,
  };

  readonly threads = {
    /** The thread of `agentId` on `projectId`, created idle if it isn't there yet. */
    ensure: (agentId: string, projectId: string): ThreadRow => {
      const id = threadId(agentId, projectId);
      this.sql.prepare("INSERT INTO threads (id, agent_id, project_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING").run(id, agentId, projectId, new Date().toISOString());
      return this.threads.get(id)!;
    },
    get: (id: string) => this.one(toThread, "SELECT * FROM threads WHERE id = ?", id),
    byAgent: (agentId: string) => this.all(toThread, "SELECT * FROM threads WHERE agent_id = ? ORDER BY created_at, rowid", agentId),
    setStatus: (id: string, status: ThreadStatus): void => {
      const ran = status === "running" ? new Date().toISOString() : null;
      this.sql.prepare("UPDATE threads SET status = ?, last_run_at = COALESCE(?, last_run_at) WHERE id = ?").run(status, ran, id);
    },
  };

  readonly runs = {
    create: (r: NewRun): RunRow => {
      const id = r.id ?? uuid7();
      this.sql
        .prepare("INSERT INTO runs (id, thread_id, trigger, lane, assignment_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, r.threadId, r.trigger, r.lane, r.assignmentId ?? null, new Date().toISOString());
      return this.runs.get(id)!;
    },
    get: (id: string) => this.one(toRun, "SELECT * FROM runs WHERE id = ?", id),
    byThread: (threadId: string) => this.all(toRun, "SELECT * FROM runs WHERE thread_id = ? ORDER BY rowid", threadId),
    byStatus: (status: RunStatus) => this.all(toRun, "SELECT * FROM runs WHERE status = ? ORDER BY rowid", status),
    start: (id: string): void => {
      this.sql.prepare("UPDATE runs SET status = 'running', started_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    },
    /** One model call made by the run, at `costUsd`. */
    addCall: (id: string, costUsd: number): void => {
      this.sql.prepare("UPDATE runs SET calls = calls + 1, cost_usd = cost_usd + ? WHERE id = ?").run(costUsd, id);
    },
    finish: (id: string, status: Exclude<RunStatus, "queued" | "running">, error?: string): void => {
      this.sql.prepare("UPDATE runs SET status = ?, ended_at = ?, error = ? WHERE id = ?").run(status, new Date().toISOString(), error ?? null, id);
    },
  };

  readonly inbox = {
    add: <P>(threadId: string, kind: InboxKind, payload: P): InboxRow<P> => {
      const { lastInsertRowid } = this.sql
        .prepare("INSERT INTO inbox (thread_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)")
        .run(threadId, kind, JSON.stringify(payload), new Date().toISOString());
      const row = this.one(toInbox<P>, "SELECT * FROM inbox WHERE id = ?", lastInsertRowid)!;
      queueMicrotask(() => {
        for (const fn of [...this.inboxListeners]) {
          try {
            fn(threadId);
          } catch (e) {
            console.warn(`An inbox listener failed on ${threadId}:`, (e as Error).message);
          }
        }
      });
      return row;
    },
    /** Threads with undelivered items, in the order their oldest one arrived. */
    pendingThreads: (): string[] =>
      (this.sql.prepare("SELECT thread_id FROM inbox WHERE delivered_at IS NULL GROUP BY thread_id ORDER BY MIN(id)").all() as Raw[]).map((r) => String(r.thread_id)),
    /** Whether the thread ever got an item of `kind`, delivered or not. */
    has: (threadId: string, kind: InboxKind): boolean =>
      this.sql.prepare("SELECT 1 FROM inbox WHERE thread_id = ? AND kind = ? LIMIT 1").get(threadId, kind) !== undefined,
    /** Undelivered items, oldest first (only `kinds` when given). */
    pending: <P = unknown>(threadId: string, kinds?: InboxKind[]): InboxRow<P>[] => {
      const only = kinds?.length ? ` AND kind IN (${placeholders(kinds.length)})` : "";
      return this.all(toInbox<P>, `SELECT * FROM inbox WHERE thread_id = ? AND delivered_at IS NULL${only} ORDER BY id`, threadId, ...(kinds ?? []));
    },
    /** Takes the pending items for delivery in `runId`: marks them delivered and returns them, oldest first. */
    take: <P = unknown>(threadId: string, runId: string, kinds?: InboxKind[]): InboxRow<P>[] =>
      this.tx(() => {
        const items = this.inbox.pending<P>(threadId, kinds);
        if (!items.length) return [];
        const at = new Date().toISOString();
        const ids = items.map((i) => i.id);
        this.sql.prepare(`UPDATE inbox SET delivered_run_id = ?, delivered_at = ? WHERE id IN (${placeholders(ids.length)})`).run(runId, at, ...ids);
        return items.map((i) => ({ ...i, deliveredRunId: runId, deliveredAt: at }));
      }),
  };
}

/** Opens (creating and migrating as needed) the runtime database at `file`. */
export function openRuntimeDb(file = path.join(dataDir(), "runtime.db")): RuntimeDb {
  return new RuntimeDb(file);
}

const G = globalThis as { __agentTeamsRuntimeDb?: RuntimeDb };

/** The app's runtime database, opened once per process (kept on globalThis across dev reloads). */
export function getRuntimeDb(): RuntimeDb {
  return (G.__agentTeamsRuntimeDb ??= openRuntimeDb());
}

/** Replace the app's runtime database (a temp one in tests); null closes nothing and resets to the default. */
export function setRuntimeDb(db: RuntimeDb | null): void {
  G.__agentTeamsRuntimeDb = db ?? undefined;
}
