# D — Runtime on LangChain Deep Agents JS: implementation design (verified)

Date: 2026-10-17. Scope: the local-first runtime for persistent per-worker agents in `agent-teams`.
Everything below was checked against package source unpacked with `npm pack` into
`/tmp/agent-teams/research/pkg/` (original TypeScript extracted from the published source maps into
`pkg/deepagents-src/`), plus GitHub and Context7 docs. Anything not checked is marked **UNVERIFIED**.

## 0. Versions verified, and what surprised us

| Package | Version checked | Why it matters | Source |
|---|---|---|---|
| `deepagents` | **1.15.0** (lockfile) and **1.15.1** (latest, 2026-10-16) | runtime | `npm pack`; 1.15.1 differs only by a `ContextHubBackend.glob` fix (diffed the sources; CHANGELOG #966) |
| `langchain` | 1.5.18 | `createAgent`, middleware, HITL | lockfile, `npm pack` |
| `@langchain/langgraph` | 1.5.0 (lock), 1.5.1 latest | Pregel, `Command`, stream modes | lockfile, `npm pack` |
| `@langchain/langgraph-checkpoint` | 1.2.0 | `BaseCheckpointSaver`, `BaseStore` | lockfile |
| `@langchain/core` | 1.2.18 | `AsyncCaller` (429 handling) | lockfile |
| `@langchain/openai` | 1.6.2 (latest) | `ChatOpenAI` on Crusoe | lockfile; uses `openai` 7.34.0 |
| `@langchain/langgraph-checkpoint-sqlite` | **1.1.0** (latest, 2026-10-12) | durable checkpointer (to add) | `npm view`, `npm pack` |
| `better-sqlite3` | 12.11.1 (pulled by the above, `^12.10.0`) | native SQLite | `npm view`: engines Node 20–26 |

**Compatibility of the one package we add.** `@langchain/langgraph-checkpoint-sqlite@1.1.0` peers on
`@langchain/core ^1.1.44` (we have 1.2.18) and `@langchain/langgraph-checkpoint ^1.2.0` (we have 1.2.0, the
same copy `@langchain/langgraph@1.5.0` depends on, so `BaseCheckpointSaver` stays one class). It has **no
`langsmith` dependency**, so it does not touch the existing `langsmith` split (deepagents peers
`langsmith >=0.7.1 <0.10.0` and the root has 0.9.0, while `@langchain/core` and `langchain` nest 0.11.0;
lockfile lines 1158, 5970, 6003). Its one dependency, `better-sqlite3`, is a native module: Next.js keeps it
external by default (`packages/next/src/lib/server-external-packages.jsonc:33` on vercel/next.js main), and
`@langchain/openai@1.6.2` already requires Node ≥ 22, which `better-sqlite3@12` supports. **No other new
packages are proposed** (the limiter, queue and scheduler are ~300 lines of our own code).

**Findings that change the design** (each detailed below):
1. **`write_todos` is no longer built in.** Since deepagents 1.12.0 the todo middleware is opt-in (CHANGELOG
   #708, "make todo middleware opt-in"); `createDeepAgent` adds only filesystem, `task`, summarization and
   patch-tool-calls (`deepagents-src/src/agent.ts:488-529`). The plan panel needs `todoListMiddleware()` from
   `langchain` added by hand. The README line "Planning — `write_todos`" is stale.
2. **The `memory` option freezes memory per thread.** `MemoryMiddleware.beforeAgent` skips loading when
   `state.memoryContents` is set (`src/middleware/memory.ts:292-296`), and `memoryContents` is an ordinary,
   checkpointed state key (langchain treats only `_`-prefixed keys as private, `dist/agents/annotation.js:29`).
   On a persistent thread, dreaming's edits to MEMORY.md would never reach the prompt. Skills got a reload
   switch in 1.14.0 (`skillsMetadata: null`); memory did not. We use our own 25-line middleware instead.
3. **Our retry/fallback order is inverted.** Middleware compose "so the first in the list becomes the outermost
   layer" (`langchain dist/agents/utils.js:268`, `nodes/AgentNode.js:197`). `check-deepagents.mts` lists
   `[modelRetryMiddleware, modelFallbackMiddleware]`, so every failed attempt goes straight to GLM-5.3 before
   any backoff, which doubles 429 traffic. Swap the order.
4. **No SQLite `BaseStore` exists for JS.** `@langchain/langgraph-checkpoint-sqlite` exports only `SqliteSaver`
   (`dist/index.d.ts`); `@langchain/langgraph-store-sqlite` is a 404 on npm; the langgraphjs `libs/` folder has
   a Postgres store but no SQLite one. We don't need one: long-term files go on disk through `FilesystemBackend`.
5. **Async/remote sub-agents need an Agent Protocol server.** deepagents' `AsyncSubAgent`
   (`start_async_task`…) and `createCompletionCallbackMiddleware` call `@langchain/langgraph-sdk`'s HTTP
   `Client` (`src/middleware/async_subagents.ts:450`, `completion_callback.ts:174`), and the only local server,
   `@langchain/langgraph-api@1.5.4`, describes itself as an "In-memory implementation of the LangGraph.js API".
   So we build `assign_task` in-process, copying their callback pattern.
6. **Nothing serializes runs on a thread in-process.** `multitaskStrategy` exists only on the server
   (`async_subagents.ts:605`); `SqliteSaver.put` is a plain `INSERT OR REPLACE` (`dist/index.js:277`). Two
   concurrent `invoke`s on one `thread_id` fork the checkpoint chain. We need a per-thread queue.
7. **TPM, not RPM, is the binding Crusoe limit for long threads.** 500K tokens/min per model with no payment
   method (repo `crusoe/…skill.md` §6). One call on a 60K-token thread spends 12% of a minute's TPM; the
   deepagents summarization default for models without a profile triggers at **170,000 tokens**
   (`src/middleware/summarization.ts:178`), and ChatOpenAI has no profile for Crusoe ids
   (`@langchain/openai dist/chat_models/base.js:511`: `PROFILES[this.model] ?? {}`). Lower the trigger.
8. **`ChatOpenAI` drops `reasoning_content` on the way back** (langchainjs issue #10883, open). DeepSeek's own
   API returns 400 for that in thinking mode with tools; Crusoe evidently tolerates it (the smoke test runs with
   thinking on and tools), but the model loses its earlier reasoning between tool calls. Risk, with a fix.

**Empirical check (run, not just read).** `/tmp/agent-teams/research/sandbox/verify.mjs` and `verify2.mjs`
install the exact lockfile versions (deepagents 1.15.0, langchain 1.5.18, @langchain/langgraph 1.5.0,
@langchain/core 1.2.18, checkpoint-sqlite 1.1.0, Node 24.1) in a /tmp sandbox and drive `createDeepAgent` with a
scripted fake chat model and a real `SqliteSaver`. **19/19 checks pass**, plus two extra runs:
| # | Claim | Result |
|---|---|---|
| T0 | default tools are `ls, read_file, write_file, edit_file, delete, glob, grep, task` (no `write_todos`); `todoListMiddleware()` adds it | PASS |
| T1 | `memory` option: after editing MEMORY.md, run 2 on the same thread still sees v1; passing `memoryContents` in the input refreshes it | PASS (finding 2) |
| T2 | our `HomeFiles` middleware sees the fresh file each run, placed after the identity prompt | PASS |
| T3 | `agent.graph.updateState(cfg, { messages: [AIMessage] })` without `asNode`, then a new `invoke` → the model sees the note | PASS |
| T4 | a run that dies in the tools node leaves `next=["tools"]`; `invoke(null, cfg)` resumes and finishes | PASS |
| T5 | a `beforeModel` hook that returns `{ messages: [HumanMessage] }` puts the DM last, right after the ToolMessage | PASS |
| T6 | `[retry, fallback]` (today): primary called **1×** then fallback; `[fallback, retry]`: primary **4×** then fallback | PASS (finding 3) |
| T7 | `stream(…, { streamMode: ["updates","tools","messages"] })` yields `todos` in updates and `on_tool_start` for `write_todos`, `ls` | PASS |
| T8 | `interruptOn` → `__interrupt__` + `getState().tasks[].interrupts[0].value.actionRequests`; approve runs the tool once; reject skips it and leaves a ToolMessage with the message | PASS |
| — | two concurrent `invoke`s on one thread: the final state keeps only `["B"]`, message "A" is lost | confirms finding 6 |
| — | write in one `node` process, `getState` in a new process → history intact | confirms durable SqliteSaver |
| — | `verify3.mjs`: `ChatOpenAI({ configuration: { baseURL, fetch } })` → our `fetch` gets every request with `model`, `chat_template_kwargs`, `max_tokens`; a 429 with no `retry-after` throws `RateLimitCapacityError` with **no** retry; `reasoning_content` lands in `additional_kwargs`; `prompt_tokens_details.cached_tokens` → `usage_metadata.input_token_details.cache_read` | confirms §7 hook and §8 ledger fields |

---

## 1. Persistent agent per worker

**Verified API.**
- `createDeepAgent(params)` from `deepagents`; params include `model, tools, systemPrompt, middleware,
  subagents, contextSchema, checkpointer, store, backend, interruptOn, name, memory, skills, permissions`
  (`dist/agent-rhzpV1Ew.d.ts:3055-3196`). It returns a `ReactAgent` with `recursionLimit: 10_000` and
  `metadata.lc_agent_name = name` (`src/agent.ts:573-591`).
- `SqliteSaver` from `@langchain/langgraph-checkpoint-sqlite@1.1.0`: `new SqliteSaver(db: Database, serde?)`
  or `SqliteSaver.fromConnString(path)` (`dist/index.d.ts:18-19`). First use sets `journal_mode=WAL` and creates
  `checkpoints` and `writes` tables (`dist/index.js:92-133`); `deleteThread(threadId)` exists (`:312`).
- Thread state: use `agent.graph.getState(config)` / `agent.graph.updateState(config, values)`. The same
  methods on `ReactAgent` itself are typed `never` and marked `@internal` (`langchain dist/agents/ReactAgent.d.ts:300-316`),
  while `get graph()` is public (`:62`).
- Resume after a crash: invoke with `null` input. Pregel treats `input === null` on a thread that has a
  checkpoint as resuming (`@langchain/langgraph dist/pregel/loop.js:328-340`).
- `durability: "exit" | "async" | "sync"` (default `"async"`, `dist/pregel/types.d.ts:216-222`). Keep the
  default so a restart resumes from the last superstep.

**Thread model.** One thread per **agent × project**: `thread_id = "a:{agentId}:p:{projectId}"`.
- A small task (Mira calls one expert, the owner works with it in a DM) is a one-member project of kind `dm`:
  `a:pip:p:dm-01JA…`. Every thread is the same shape, so assignment, approvals and dreaming need no special case.
- Mira: `a:mira:p:company`, one long-lived thread. Heartbeats do not run on it (see §4).
- The owner's DM to a worker on a project goes **into that project thread**, tagged
  `additional_kwargs.surface = "dm"`, so "the same agent doing the work" sees it in context. The UI filters a
  thread's messages by `surface` to draw the channel view and the DM view. If an agent is on two live projects,
  the DM goes to the thread of its active (or most recent) run and the DM composer shows which project.
- Rehire (Q3): the agent id, home files and record are kept; a new project only adds a new thread.

**Sketch.**
```ts
import { createDeepAgent } from "deepagents";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { todoListMiddleware, modelCallLimitMiddleware } from "langchain";
export const checkpointer = SqliteSaver.fromConnString(".data/checkpoints.db");
export const threadOf = (agentId: string, projectId: string) => `a:${agentId}:p:${projectId}`;
export const buildWorker = (a: AgentRow, p: ProjectRow) => createDeepAgent({
  name: a.id, model: crusoe(MODELS.main, { maxTokens: 16_384, think: true }), checkpointer,
  systemPrompt: identityPrompt(a, p),                  // stable text first: prefix-cache friendly
  backend: workerBackend(a.id, p.id), permissions: HOME_RULES,       // §2
  contextSchema: z.object({ agentId: z.string(), projectId: z.string() }),
  tools: [assignTask, completeAssignment, checkAssignments, ...toolsFor(a)],   // §5
  middleware: [homeFiles(a.id), inboxDrain(threadOf(a.id, p.id)), todoListMiddleware(),
    modelCallLimitMiddleware({ runLimit: 40, exitBehavior: "end" }), ...resilient(MODELS.main), summarizer],
  interruptOn: a.config.interruptOn,                   // §6
});
```
`modelCallLimitMiddleware({ threadLimit?, runLimit?, exitBehavior: "error"|"end" })` is in langchain 1.5.18
(`dist/agents/middleware/modelCallLimit.d.ts:9-24`); a run cap protects the shared 30 RPM. Compiled agents are
cached per thread id and rebuilt when the agent's config row changes.

**Restart recovery (boot).**
```ts
for (const run of db.runs.byStatus("running")) {           // our table, §10
  const agent = agents.forThread(run.threadId), config = { configurable: { thread_id: run.threadId } };
  const snap = await agent.graph.getState(config);
  const pending = snap.tasks.flatMap((t) => t.interrupts);  // PregelTaskDescription.interrupts, types.d.ts:370-378
  if (pending.length) approvals.capture(run, pending);      // §6
  else if (snap.next.length) queue.enqueue(run.threadId, { kind: "resume", input: null });
  else db.runs.finish(run.id, "done");
}
```

**A DM that arrives mid-run.** LangGraph JS has no in-process "interrupt and rerun" (finding 6), so we split it:
- A per-thread serial queue (`ThreadQueue`) owns every run on a thread. Jobs: `message`, `assignment`,
  `callback`, `resume`, `kickoff`. At most one runs at a time, FIFO.
- Owner DMs **steer** instead of waiting: they go to the thread's `inbox` table, and a `beforeModel` middleware
  drains undelivered DMs into the state as `HumanMessage`s before the next model call. The agent answers at
  its next step (within one tool round-trip) without aborting work. Appending a user message after tool
  messages is valid OpenAI ordering. The hook-returns-`messages` pattern is the one the HITL middleware uses
  (`langchain dist/agents/middleware/hitl.js:686-689`); `beforeModel` is a documented hook (`middleware/types.d.ts:399`).
- If the thread is idle the DM starts a run. If it waits on an approval the DM is held and the approval card is
  shown first. Assignments and callbacks never steer; they queue behind the current run.
- Hard stop (the owner's ✋): pass an `AbortSignal` in the run config (`signal`, used the same way by the
  deepagents ACP server); `patchToolCallsMiddleware` (always in the stack) repairs a tool call that never got a
  result, marking it as an error (deepagents 1.15.0 CHANGELOG #929).

```ts
export const inboxDrain = (threadId: string) => createMiddleware({
  name: "InboxDrain",
  beforeModel: async () => {
    const items = inbox.takeUndelivered(threadId, { kinds: ["dm"] });   // marks delivered
    if (!items.length) return;
    return { messages: items.map((i) => new HumanMessage({ content: i.text,
      additional_kwargs: { surface: "dm", from: "owner", inbox_id: i.id } })) };
  },
});
```

**Open risks.**
- Checkpoint growth: each superstep stores the whole serialized checkpoint (`SqliteSaver.put`,
  `dist/index.js:265-277`), so a long thread costs O(steps × history). Add a nightly prune that keeps the
  newest N checkpoints per thread (and their `writes`); never prune a thread with a pending interrupt.
- An inbox item marked delivered just before a crash may be lost; mark delivery in the same tick as the run
  writes its next checkpoint, or re-deliver anything not seen in `snap.values.messages` on boot.
- Next.js dev HMR re-evaluates modules: keep the runtime on `globalThis` and start it once from
  `src/instrumentation.ts` `register()` with `process.env.NEXT_RUNTIME === "nodejs"` (Next 16.2 docs,
  `docs/01-app/02-guides/instrumentation.mdx`: register "is called once when a new Next.js server instance is
  initiated").

---

## 2. Long-term memory

**Verified API.**
- `CompositeBackend(defaultBackend, routes: Record<string, Backend>)`: longest prefix wins, the prefix is
  stripped before the call reaches the routed backend, routes match on segment boundaries since 1.15.0
  (`src/backends/composite.ts:44-69, 130-143`; CHANGELOG #919).
- `StateBackend()` zero-arg: files live in graph state (checkpointed, per thread) (`src/backends/state.ts:76-99`).
- `FilesystemBackend({ rootDir, virtualMode, maxFileSizeMb = 10 })` (`src/backends/filesystem.ts:78-93`);
  `virtualMode: true` confines paths to `rootDir` and rejects symlinks that escape it (CHANGELOG 1.14.1 #866).
- `StoreBackend({ store?, namespace?: string[] | (ctx) => string[], fileFormat? })` over a LangGraph
  `BaseStore`; keys are file paths; with no namespace it falls back to `[assistant_id, "filesystem"]` then
  `["filesystem"]` (`src/backends/store.ts:138-177, 339-360`). Needs a `BaseStore`; none durable exists for
  SQLite in JS (finding 4). `BaseStore` has one abstract method, `batch(ops)` (`langgraph-checkpoint
  dist/store/base.d.ts:299`), so a `SqliteStore` would be ~100 lines if we ever need it. We don't for v1.
- `permissions: FilesystemPermission[]` = `{ operations: ("read"|"write")[], paths: string[] (absolute globs),
  mode?: "allow"|"deny" }`, first match wins, default allow (`dist/agent-rhzpV1Ew.d.ts:785-817`).
- `memory: string[]` → `createMemoryMiddleware({ backend, sources })`, appended inside `<agent_memory>` with
  ~60 lines of guidance that tells the agent to `edit_file` its memory "immediately"
  (`src/middleware/memory.ts:124-184`), loaded once per thread (finding 2).
- Summarization offloads evicted messages as Markdown to `${historyPathPrefix}/{session}.md` (default
  `/conversation_history`) on the backend (`src/middleware/summarization.ts:27, 328, 396-411`).

**How SOUL.md / MEMORY.md map on.** The files stay where they are today (`agents/<id>/SOUL.md`,
`agents/<id>/MEMORY.md`, written by `src/lib/agent-files.ts`) and are the canonical, human-editable copies.
```ts
export const workerBackend = (agentId: string, projectId: string) =>
  new CompositeBackend(new StateBackend(), {                                  // scratch: per thread
    "/home/": new FilesystemBackend({ rootDir: `agents/${agentId}`, virtualMode: true }),     // SOUL, MEMORY, notes.md
    "/project/": new FilesystemBackend({ rootDir: `.data/projects/${projectId}/files`, virtualMode: true }), // shared
    "/skills/": new FilesystemBackend({ rootDir: "skills", virtualMode: true }),            // SKILL.md library
    "/conversation_history/": new FilesystemBackend({ rootDir: `.data/history/${agentId}/${projectId}`, virtualMode: true }),
  });
export const HOME_RULES = [{ operations: ["write"], paths: ["/home/SOUL.md", "/home/MEMORY.md", "/skills/**"], mode: "deny" }] as const;
```
- The built-in `delete` tool is checked as a `write` (`src/middleware/fs.ts:1600-1615`), so the deny rule also
  stops deletes.
- Workers can **read** their soul and memory and **append** observations to `/home/notes.md` during work (the
  "hot path"). Only dreaming (§3), 📌 orders and the owner's editor write SOUL.md/MEMORY.md. This keeps one
  writer per file and gives dreaming an inbox of candidate memories.
- `/project/` is the shared folder for deliverables and hand-offs between agents (§5).
- `/conversation_history/` puts summarization's evicted transcript on disk, which is dreaming's main input.

**Injecting the home files (replaces the `memory` option).**
```ts
export const homeFiles = (agentId: string) => createMiddleware({
  name: "HomeFiles",
  wrapModelCall: async (req, handler) => {
    const { soul, memory } = await readAgentFiles(agentId);        // src/lib/agent-files.ts (cache by mtime)
    const text = `<soul path="/home/SOUL.md">\n${soul.content}</soul>\n<memory path="/home/MEMORY.md">\n${memory.content}</memory>\nAdd anything worth remembering to /home/notes.md; never edit SOUL.md or MEMORY.md.`;
    const prev = req.systemMessage.content;
    const blocks = typeof prev === "string" ? [{ type: "text" as const, text: prev }] : Array.isArray(prev) ? prev : [];
    return handler({ ...req, systemMessage: new SystemMessage({ content: [...blocks, { type: "text", text }] }) });
  },
});
```
This is the same construction `MemoryMiddleware.wrapModelCall` uses (`memory.ts:317-363`). It reads fresh files
on every model call, so a 📌 takes effect at the next step and a dream lands at the next run. The home block is
last in the system message, after the stable identity and tool prompts, which is the cache-friendly place for
the only part that changes. (Fallback with zero custom code: `memory: ["/home/SOUL.md", "/home/MEMORY.md"]` and
pass a fresh `memoryContents` record in every `invoke` input; it is an input key, so `beforeAgent` then skips
loading. It keeps deepagents' "edit memory immediately" guidance, which fights the single-writer rule.)

**Open risks.** Owner edits mid-run invalidate Crusoe's prefix cache from the system message onward for the
rest of that run (acceptable; rare). If two projects of one agent run at once, both read the same MEMORY.md
(fine) and append to the same `notes.md` (use `O_APPEND` writes through a tiny `append_note` tool rather than
`edit_file` read-modify-write, or accept rare lost lines).

---

## 3. Dreaming (background memory consolidation)

### 3a. How others do it

Status: the table below was written under a time cap from known sources. **The primary-source notes in
`/tmp/agent-teams/research/D-dreaming-notes.md` (docs, `repo/path:line`, papers) supersede it.** Corrections from
those notes:
- **OpenClaw does have dreaming:** a nightly 03:00 job; only its deep phase writes MEMORY.md, for entries scoring
  ≥ 0.75 that were recalled ≥ 3 times by ≥ 3 distinct queries. Each entry carries a `Source: path#Lx-Ly` link, a
  rewrite may remove at most 25% of prior entries, and the old file is saved before each rewrite
  (docs.openclaw.ai/concepts/dreaming, `memory-host-sdk/dreaming.ts`). Its heartbeat now replies `NO_REPLY`;
  `HEARTBEAT.md` is retired.
- **Letta:** the V1 sleep-time frequency was `sleeptime_agent_frequency=5`. Current Letta Code reflects on
  compaction (or every 25 steps) into a git-backed memory folder, merging and retrying on conflict.
- **LangMem:** `ReflectionExecutor.submit(after_seconds)`, where a new message on the same thread cancels the
  pending run. Updates are JSON patches, and deletes accept only existing ids (and are off by default).
- **ChatGPT:** chat-history memory ("dreaming", V3 since 2026-06-04) is a background synthesis shown as an
  editable summary (openai.com/index/chatgpt-memory-dreaming).
- **Claude Code "AutoDream"** and **dots "Dreamer"** are REPORTED only (user issues and build strings; one user
  capture and a leaked prompt), not documented.
- **Mem0:** current code is ADD-only, with memory ids mapped to small integers so the model can't invent them.
Design takeaways folded into §3b: ids the model cannot invent, a cap on how much one rewrite may delete, and
excluding heartbeat sessions from dreaming.

| System | Trigger | Inputs | Outputs | Safe-edit mechanism | Model tier | Source |
|---|---|---|---|---|---|---|
| **Generative Agents** (Park et al. 2023) | When the summed importance scores of recent events pass a threshold (paper: 150, "roughly two or three times a day") | the ~100 most recent memory-stream records | 3 salient questions → retrieve → ~5 insights, stored back in the memory stream as "reflections" (a tree over observations) | each insight cites the records it came from ("because of 1, 5, 3") | same model | arXiv 2304.03442 §4.2; numbers UNVERIFIED this session |
| **MemGPT** | in the hot path: the agent edits its own memory by function calls; a "memory pressure" warning near the context limit (paper: ~70%) and forced eviction + recursive summary at the limit | the live context window | core memory (in-prompt blocks), archival store (vector), recall store (full message log) | edits only via typed functions (append/replace/insert/search); evicted messages stay searchable in recall | same model | arXiv 2310.08560 §2; thresholds UNVERIFIED this session |
| **Letta sleep-time agents** (successor of MemGPT) | a background agent that shares memory blocks with the primary agent and runs every N primary steps (configurable frequency; default UNVERIFIED) | the primary agent's recent messages + shared blocks | rewritten/cleaned memory blocks; the primary loses or keeps few memory tools | block-level edits through memory tools; the primary reads blocks, the sleep-time agent writes them (single writer) | can be a stronger, slower model than the primary | docs.letta.com "sleep-time agents"; arXiv 2504.13171 ("Sleep-time Compute"); tool names UNVERIFIED |
| **LangMem** (LangChain) | hot path (`create_manage_memory_tool`) or background: a memory manager run after a conversation, debounced with a delayed `ReflectionExecutor` (submit with a delay so a burst of turns is processed once) | conversation messages + existing memories retrieved from a `BaseStore` | memories in the store (namespaced), as insert/update/delete | the LLM emits structured ops against existing memory ids; schemas constrain shape | any; configurable | github.com/langchain-ai/langmem (docs "Delayed background memory processing"); exact signatures UNVERIFIED this session |
| **Mem0** | on each `add()` of new conversation text | extracted candidate facts + top-k similar existing memories | memory store rows | the LLM chooses **ADD / UPDATE / DELETE / NOOP** per candidate against retrieved memories (dedup by construction) | configurable | arXiv 2504.19413; UNVERIFIED this session |
| **ChatGPT memory** | "saved memories": written in the hot path when the model decides (or the user asks), shown as "Memory updated"; "reference chat history" (2025): draws on past chats automatically | the current chat; past chats for the history feature | saved-memory list; no user-visible store for history | user can view/delete each saved memory, turn either feature off, or use Temporary Chat | same model (product) | help.openai.com "Memory FAQ"; openai.com/index/memory-and-new-controls-for-chatgpt; details UNVERIFIED this session |
| **OpenClaw** | heartbeat: a periodic agent turn (default every 30 min, UNVERIFIED) that reads `HEARTBEAT.md` and replies `HEARTBEAT_OK` when nothing needs attention (suppressed); a "memory flush" turn before session compaction asks the model to write durable notes | the heartbeat checklist; the session before compaction | daily notes `memory/YYYY-MM-DD.md` and a curated `MEMORY.md` | plain file writes by the agent; the OK token keeps quiet beats out of the chat | same model | docs.openclaw.ai (Heartbeat, Memory); a separate "dreaming" feature: UNVERIFIED |
| **Claude Code** | auto memory: Claude writes notes during sessions to `~/.claude/projects/<project>/memory/MEMORY.md` (+ topic files), the start of MEMORY.md is loaded each session; an automatic "dream"/consolidation pass between sessions: UNVERIFIED | the session | Markdown memory files the user can edit | plain file edits; the user reviews/edits the files (`/memory`) | same model | code.claude.com/docs (memory); dream feature UNVERIFIED |
| **OpenAI dots "dreamer"** | referenced in our own code comments ("like dots' dreamer"); no public source located in this session | — | — | — | — | UNVERIFIED |

**Patterns that recur (and that our design adopts).**
- **Split hot path from background.** The working agent notes or edits little; a separate pass consolidates
  (Letta sleep-time, LangMem background manager, OpenClaw memory flush). One writer per memory file.
- **Trigger on accumulation or idleness, not on every turn**: importance-sum threshold (Generative Agents),
  every N steps (Letta), debounce delay (LangMem), pre-compaction flush (OpenClaw), memory pressure (MemGPT).
- **Edits are typed operations against existing items** (Mem0 ADD/UPDATE/DELETE/NOOP, LangMem insert/update/
  delete, MemGPT append/replace), which is what makes dedup and undo possible.
- **Evidence links** (Generative Agents' cited reflections) are the main defence against invented memories.
- **Bounded in-prompt memory + unbounded searchable archive** (MemGPT core vs recall/archival; OpenClaw
  MEMORY.md vs daily notes; Claude Code loads only the head of MEMORY.md).
- **User-visible, user-editable memory** (ChatGPT, Claude Code, OpenClaw): our SOUL/MEMORY tab already does this.
- **Quiet protocol for periodic checks** (OpenClaw `HEARTBEAT_OK` ≈ our `QUIET`).

### 3b. Our design

**Principle.** Workers note things during work (`append_note` → `/home/notes.md`), and a separate, bounded
background pass turns evidence into memory edits. The pass never writes free text into the file: it proposes
**ops** that code validates and applies. This combines the hot-path/background split (Letta, LangMem, ChatGPT)
with an evidence requirement (Generative Agents' cited reflections) and ADD/UPDATE/DELETE/NOOP ops (Mem0,
LangMem).

**When it runs (triggers, checked by the 60-s scheduler tick).**
| Trigger | Condition | Scope |
|---|---|---|
| `task_end` | an assignment or owner task on the thread ended, and the thread has been idle **10 min** (debounce, so a burst of follow-ups dreams once) | that thread since `threads.last_dream_msg_count` |
| `nightly` | 02:00 local, agent had any run since its last dream | all its threads since last dream + ledger |
| `project_close` | project status → `done` | the whole project → talent profile |
| `pressure` | MEMORY.md over its caps, or `notes.md` > 40 lines | compaction only |
A dream never runs while any thread of that agent is running (per-agent mutex), and only in the limiter's
`background` lane.

**Model tier.** Main (DeepSeek V4.1 Flash), thinking on, `max_tokens` 8,192, temperature 0.3, JSON output.
A cheap **NOOP gate** first on Nemotron 3.5 Lightning (`MODELS.cheap`, its own 30 RPM): "Does this delta
contain an order, an approval/decline, an error, an owner correction, a finished deliverable, or a note? yes/no".
`no` ends the dream with zero main-model calls. Rationale: consolidation errors persist and compound, so the
writer gets the better model; the gate is a classification, which models.ts already assigns to the cheap tier.

**Inputs (assembled by code, each item carrying an id the model must cite).**
- The transcript delta: messages from the checkpoint (`graph.getState(...).values.messages` from the stored
  offset) plus any `/conversation_history/*.md` files written since; each message referenced by
  `msg:{thread}:{index}`.
- Ledger events for the agent since the last dream (`src/lib/ledger.ts` `readLedger()`): orders
  👍/👀/🔁/✋/📌 with the reply they reacted to, approvals/declines, failed calls; referenced by `led:{at}:{t}`.
- Assignment rows done/failed with summaries and files (`asg:{id}`).
- `notes.md` lines (`note:{n}`).
- The current MEMORY.md, parsed into items with their ids (read-only context), SOUL.md (read-only, so the model
  doesn't duplicate standing instructions), and the project brief.
- Numbers come from code (acceptance rate, cost, counts), never from the model.

**Output contract (JSON, validated).**
```ts
type Op =
  | { op: "add"; section: "done" | "mistake" | "approach"; text: string; evidence: string[] }
  | { op: "update"; id: string; text: string; evidence: string[] }      // refine or merge an existing item
  | { op: "retire"; id: string; reason: string; evidence: string[] }    // contradicted or obsolete
  | { op: "propose_soul"; text: string; evidence: string[] }            // never applied directly → approval card
  | { op: "noop" };
```

**Guardrails (enforced in `dream/validate.ts`, not in the prompt).**
1. **No fabricated memories:** every non-noop op needs ≥ 1 evidence id that exists in this dream's input.
   A `mistake` must cite a 🔁, ✋, decline, error or an owner message; an `approach` must cite a 👍, an approval,
   or a completed assignment; `done` must cite a completed assignment or a 👍. Ops failing this are dropped and
   logged in `dreams.rejected_json`.
2. **Dedup:** an `add` whose normalized text has token-Jaccard ≥ 0.8 with an active item in the same section
   becomes an `update` of that item (or a `noop` if no new evidence). Never two items with the same text.
3. **Size caps:** Done ≤ 30 items (oldest roll into one line "Earlier: N tasks, see history"), Mistakes ≤ 15,
   Best approaches ≤ 15, each item ≤ 200 characters, whole file ≤ 6 KB (it rides in every prompt). Over a cap,
   the dream must retire or merge before it may add.
4. **Scope:** the dream writes only MEMORY.md and `notes.md` (truncate consumed lines). SOUL.md changes are
   `propose_soul` → an approval card ("Pip wants to add to its soul: …"); 📌 stays the only direct SOUL writer.
5. **Secrets:** drop ops whose text matches key/token patterns (the deepagents memory prompt has the same rule).
6. **Atomic, reversible apply:** under a per-agent mutex, render the new file, write `MEMORY.md.tmp` then
   `rename`; copy the old file to `agents/<id>/.history/MEMORY.<iso>.md`; record each applied op in `memories`
   (with evidence) and the dream in `dreams`. The UI can show "Pip learned 2 things" with an undo.
7. **Owner edits win:** if MEMORY.md's mtime changed after the dream read it, discard the result and re-run later.
8. **Ids the model can't invent, and bounded deletes** (from Mem0 and OpenClaw): show evidence and items to the
   model as short integers mapped back by code, and refuse a dream that would retire > 25% of active items.
   Heartbeat calls are never dream input.

**MEMORY.md shape.** The current sections stay (Done / Mistakes / Best approaches, newest first); each bullet
gets a trailing id so ops can target it and the owner's editor keeps working:
`- 2026-10-17 · Lead with the cost line in every recommendation this week. [m_7f3a]`.

**Cross-project talent profile (`project_close`).** Writes `agents/<id>/PROFILE.md` (and `memories` rows with
`section: "profile"`, `project_id: null`): domains worked, tools and skills used, the agent's acceptance rate
and cost for that project (computed from the ledger), the 3 approaches that generalize (rewritten without
project names), and the project's mistakes that generalize. The PM's sourcing step (setup flow step 4) reads
PROFILE.md + ledger stats; the project-specific MEMORY.md items are moved into
`agents/<id>/projects/<projectId>.md` so a rehire starts with a lean MEMORY.md.

**Sketch.**
```ts
export async function dream(agentId: string, trigger: DreamTrigger) {
  await agentLock(agentId, async () => {
    const input = await gatherDreamInput(agentId, trigger);          // ids on every item; numbers computed here
    if (!(await noopGate(input))) return db.dreams.log(agentId, trigger, []);   // cheap tier, yes/no
    const ops = await lane.run("background", () => dreamCall(input));  // main tier, JSON ops
    const { applied, rejected } = validateOps(ops, input, parseMemory(input.memoryMd));
    if (input.memoryMtime !== (await mtime(memoryPath(agentId)))) return;       // owner edited meanwhile
    await writeAtomic(memoryPath(agentId), renderMemory(applied, input.memoryMd));
    db.dreams.log(agentId, trigger, applied, rejected); db.threads.markDreamed(input.threadOffsets);
    for (const p of applied.filter((o) => o.op === "propose_soul")) approvals.proposeSoul(agentId, p);
  });
}
```

---

## 4. Heartbeat and scheduling

**Verified.** LangGraph cron exists only on the Agent Server: `CronsClient` in `@langchain/langgraph-sdk`
(`dist/client/crons/index.d.ts:6`) is an HTTP client. In-process LangGraph JS has no scheduler. So the
scheduler is ours, started once from `src/instrumentation.ts` (§1 risk note), using `setInterval(...).unref()`.

**Design.**
- One 60-second tick. Per agent, a schedule from its config row: Mira's heartbeat every 20 min (today's value,
  `DECISIONS.md`); a PM's every 60 min while its project is active; workers have no heartbeat (their wake-ups
  are inbox events: assignments, callbacks, DMs). Add ±2 min jitter so agents don't share a minute's RPM.
- Skip a heartbeat if the agent's thread is running, if the owner is mid-conversation with it, or if the
  target model's limiter bucket is under 50% (background lane, §7).
- The heartbeat is a **single stateless model call**, not a run on Mira's thread: no tools, thinking off,
  `max_tokens` 400, the existing `HEARTBEAT` prompt (`src/lib/chief-prompt.ts:93`) plus the org snapshot built
  **server-side** from our tables and the ledger (today the browser sends it). QUIET protocol: the reply is
  exactly `QUIET` (trimmed) or a ≤ 2-sentence note.
- A non-QUIET note is appended to Mira's thread with `agent.graph.updateState(config, { messages: [new
  AIMessage({ content: note, additional_kwargs: { kind: "heartbeat" } })] })` so the owner can answer it in
  context, and the bus emits a `notify` event (badge + toast). Dedup: store a normalized hash of each note;
  drop a note whose hash matches one from the last 24 h.
- Model: main (DeepSeek V4.1 Flash, thinking off) as today. A cheap pre-filter on Nemotron Lightning is
  possible but the call is already tiny; spend its RPM on status lines instead.

```ts
setInterval(async () => {
  for (const a of db.agents.dueForHeartbeat(Date.now())) {
    if (queue.isBusy(a.homeThread) || !limiter.hasHeadroom(MODELS.main, 0.5)) continue;
    const note = (await heartbeatCall(a, await orgSnapshot())).trim();     // one completion, thinking off
    db.agents.touchHeartbeat(a.id);
    if (note !== "QUIET" && !notes.seenRecently(a.id, note)) await threads.postAgentNote(a.homeThread, note);
  }
  dreams.sweep();                                                           // §3b triggers
  checkpoints.pruneIfNightly();                                             // §1 risk
}, 60_000).unref();
```

**Open risks.** `updateState` without `asNode` followed by a normal `invoke` works on a deepagents graph
(sandbox T3), but writing into Mira's thread while she is running would fork it (finding 6): post the note
through her `ThreadQueue` as a `note` job so it lands between runs. Heartbeat RPM: 3/hour on main, negligible.

---

## 5. Inter-agent assignment

**What deepagents offers, and why we don't use it as-is.**
- `task` tool (sync sub-agents): ephemeral, isolated state, no thread of its own (`EXCLUDED_STATE_KEYS`
  include `messages`, `todos`, `memoryContents`, `src/middleware/subagents.ts:78-91`). Fine for an agent's own
  throwaway helpers (keep the general-purpose one), wrong for persistent workers.
- `AsyncSubAgent { name, description, graphId, url?, headers? }` (`dist/agent-rhzpV1Ew.d.ts:2547-2558`) adds
  `start_async_task / check_async_task / update_async_task / cancel_async_task / list_async_tasks`
  (`:2605`). It creates a **new remote thread per task** (`async_subagents.ts:450`), so even with a server it
  would not reuse a worker's persistent thread.
- `createCompletionCallbackMiddleware({ callbackGraphId, url?, headers? })` (experimental): in `afterAgent`,
  posts `"Completed. Result: <last message, ≤500 chars>"` as a user message to `state.callbackThreadId` via
  `client.runs.create` (`completion_callback.ts` lines 174, 314-336). Same remote-server dependency.
- We copy the **pattern** (callback thread id + completion message) in-process.

**`assign_task` design.**
- `assign_task({ to, title, brief, deliverable, due? })` → inserts an `assignments` row, enqueues an
  `assignment` job on the target thread `a:{to}:p:{projectId}` (queued behind its current run; never steers),
  and returns at once: "Assigned asg_12 to @pip. You'll get a message here when it's done; don't wait."
- The target sees a user message `[assignment asg_12 from @nova] <title>\n<brief>\nDeliver: <deliverable>
  (put files under /project/…)`.
- `complete_assignment({ id, summary, files })` → marks the row done and enqueues a `callback` job on the
  assigner's thread: `[asg_12 done by @pip] <summary> Files: /project/briefs/launch.md`. That wakes the assigner.
- Safety net, like their `afterAgent` hook: if a run started by an assignment ends without
  `complete_assignment`, the runner posts `[asg_12 ended without completing] <last message ≤500 chars>`.
- `check_assignments({ status? })` lists the agent's open assignments (like `list_async_tasks`).
- Results travel as **files in `/project/`** plus a short summary. Long content never goes through messages.
- Guards: no self-assignment; the target must be a member of the same project; ≤ 5 open assignments per
  target; an assignment chain depth ≤ 3 (store `parent_id`) so agents can't ping-pong forever. Assigning to an
  agent outside the project is a PM-only tool behind an approval (§6).

```ts
export const assignTask = tool(async ({ to, title, brief, deliverable }, rt) => {
  const { agentId: from, projectId } = rt.context as { agentId: string; projectId: string };
  if (to === from || !db.projects.hasMember(projectId, to)) return `@${to} isn't on this project.`;
  const a = db.assignments.create({ projectId, from, fromThread: rt.config.configurable!.thread_id, to,
    toThread: threadOf(to, projectId), title, brief, deliverable, parentId: currentAssignment(rt) });
  queue.enqueue(a.toThread, { kind: "assignment", assignmentId: a.id, text: renderBrief(a) });
  return `Assigned ${a.id} to @${to}. You'll get a message in this thread when it's done; don't wait for it.`;
}, { name: "assign_task", description: "Give a teammate a task. Returns at once; the result arrives later as a message.",
     schema: z.object({ to: z.string(), title: z.string(), brief: z.string(), deliverable: z.string() }) });
```
`ToolRuntime` carries `state`, `toolCallId`, `config`, `context`, `store`, `writer` (`@langchain/core
dist/tools/types.d.ts:308-358`); `context` is filled from the run config's `context` field and typed by
`contextSchema` (`createDeepAgent` param; Pregel "static context for the graph run", `pregel/types.d.ts:233`).
deepagents reads the caller's thread id the same way (`async_subagents.ts:410-420`).

**Open risks.** Fan-out against 30 RPM: a PM assigning 5 tasks at once starts 5 runs that share one model's
bucket; the limiter queues them, so throughput is the limit, not correctness. Show "queued" in the UI.

---

## 6. Approvals

**Verified API.**
- `interruptOn?: Record<string, boolean | InterruptOnConfig>` on `createDeepAgent` (`d.ts:3124`), which adds
  `humanInTheLoopMiddleware({ interruptOn })` last in the stack (`src/agent.ts:543`) and passes it to sub-agents
  as `defaultInterruptOn` (`:499`). `InterruptOnConfig = { allowedDecisions: ("approve"|"edit"|"reject"|"respond")[],
  description?: string | fn, argsSchema?, when?: (toolCallRequest) => boolean | Promise<boolean> }`
  (`langchain dist/agents/middleware/hitl.d.ts`). `true` allows all decisions; `when` lets us gate only some
  calls (e.g. writes under `/project/deliverables/**`).
- Mode: deepagents doesn't pass `interruptMode`, so it is `"batched"` (`hitl.js:546`): one interrupt per model
  turn, raised in `afterModel` before any tool runs, with value `HITLRequest = { actionRequests: { name, args,
  description? }[], reviewConfigs: { actionName, allowedDecisions, argsSchema? }[] }` (`hitl.js:653-656`).
- Resume: `new Command({ resume: { decisions } })` with exactly one `Decision` per action request, in order
  (`hitl.js:660-664`): `{type:"approve"}`, `{type:"edit", editedAction:{name,args}}`, `{type:"reject",
  message?}`, `{type:"respond", message}`. A reject or respond jumps back to the model with a synthetic
  ToolMessage. Confirmed by deepagents' own test `libs/deepagents/src/middleware/hitl.int.test.ts` (Context7).
- Reading pending interrupts: `invoke` returns `__interrupt__`; from storage, `(await agent.graph.getState(cfg)).tasks`
  → `PregelTaskDescription.interrupts: Interrupt[]`, `Interrupt = { id?, value?, response_schema? }`
  (`@langchain/langgraph dist/constants.d.ts:170-178`, `pregel/types.d.ts:370-378`).

**Mapping to approval cards.**
- When a run ends interrupted, `approvals.capture` writes one `approvals` row per interrupt with the thread,
  run, `interrupt.id`, `actionRequests` and `reviewConfigs`; thread status becomes `waiting_approval`, agent
  status `needs-you`.
- The card shows each action (tool name, a readable args summary, `description`) and only the buttons in its
  `allowedDecisions`. "Edit" opens the args as a form (schema from `argsSchema` when given).
- `POST /api/approvals/[id] { decisions }` enqueues a `resume` job carrying `Command({ resume: { decisions } })`
  on the thread queue (never invoke directly from the route: the queue keeps one run per thread) and records a
  ledger `approval` event (existing `ApprovalEvent`): `approved` if no decision is a reject, else `declined`.
- Defaults per agent config: `interruptOn: { send_message_external: { allowedDecisions: ["approve","reject"] },
  spend: true, assign_outside_project: true, write_file: { allowedDecisions: ["approve","edit","reject"], when:
  isDeliverablePath } }`. Approvals stay with the owner (Mira's soul says so).

```ts
const snap = await agent.graph.getState({ configurable: { thread_id } });
for (const i of snap.tasks.flatMap((t) => t.interrupts)) {
  const req = i.value as HITLRequest;                       // type exported by "langchain"
  db.approvals.create({ threadId: thread_id, runId, interruptId: i.id, actions: req.actionRequests, configs: req.reviewConfigs });
}
// POST /api/approvals/[id]
queue.enqueue(ap.threadId, { kind: "resume", input: new Command({ resume: { decisions } }) });
await record({ t: "approval", at, team, agent, decision: decisions.some((d) => d.type === "reject") ? "declined" : "approved" });
```

**Open risks.** A card left for hours keeps the thread blocked; show the age and let ✋ cancel (reject all).
Mismatched decision counts throw (`hitl.js:664`): build the decisions array from the stored `actionRequests`.

---

## 7. Rate limiting and resilience

**Verified behaviour today.**
- `ChatOpenAI` builds its `OpenAI` client with `maxRetries: 0` and spreads our `configuration` into it
  (`@langchain/openai dist/chat_models/base.js:317-325`); `openai@7.34.0` `ClientOptions` has `fetch?: Fetch`
  (`client.d.ts:130`). So a custom `fetch` sees **every** HTTP call, including summarization calls and the
  fallback model, and is the only place the `x-ratelimit-*` headers are visible.
- A 429 is stamped retryable (`@langchain/openai dist/utils/client.js:24`), but `@langchain/core`'s
  `AsyncCaller` classifies a 429 **without** `retry-after` as `headerless_429` → throws `RateLimitCapacityError`
  without retrying (`@langchain/core dist/utils/async_caller.js:121-126, 166-170`). That is the "LangChain
  throws on a 429" note in DECISIONS.md, now located.
- `modelRetryMiddleware({ maxRetries=2, retryOn, backoffFactor, initialDelayMs, maxDelayMs, jitter, onFailure })`
  retries anything not marked non-retryable by default and honours an error's `retryAfterMs` as a floor
  (`langchain dist/agents/middleware/constants.js:6-17`, `utils.js:67-84`). `modelFallbackMiddleware(...models)`
  re-calls the handler with each fallback model in turn (`modelFallback.js:36-66`).
- Crusoe: 30 RPM and 500K TPM per model per project without a payment method; every response carries
  `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-limit-tokens`,
  `x-ratelimit-remaining-tokens` (repo `crusoe/crusoe-cv-recursive-agents-hackathon-skill.md` §6, compiled from
  docs.crusoecloud.com/serverless-inference/rate-limits).

**Design.**
1. **One limiter per process, one bucket per model**, RPM and TPM. `acquire(model, estTokens, lane)` waits
   for both. Lanes: `interactive` (an owner message or DM) > `work` (assignments, callbacks) > `background`
   (heartbeat, dream). Background only runs while the bucket is ≥ 50% full. The lane comes from an
   `AsyncLocalStorage` set by the run executor.
2. **Calibrate from headers**: after each response set the bucket to `remaining-requests` / `remaining-tokens`
   when present. On a 429, empty the bucket until the minute window resets (assume 60 s from the first request
   in the window if Crusoe sends no reset header; Crusoe documents none, so **UNVERIFIED**).
3. **Fix the middleware order**: `[modelFallbackMiddleware(...fallbacks), modelRetryMiddleware({ maxRetries: 3,
   initialDelayMs: 1000, backoffFactor: 2, maxDelayMs: 30_000, jitter: true, onFailure: "error" })]`. Retry is
   now inner: the primary gets 4 tries with backoff, then the fallback gets its own 4. Each try waits on the
   limiter, so retries don't stampede.
4. **Lower the summarization trigger** (finding 7): pass `createSummarizationMiddleware({ backend, trigger: {
   type: "tokens", value: 60_000 }, keep: { type: "messages", value: 20 } })`; a custom entry with the same
   name (`"SummarizationMiddleware"`, `summarization.ts:1184`) replaces the default (`mergeMiddlewareStack`,
   `src/middleware/utils.ts:40-77`). The threshold is a guess to tune against `remaining-tokens`.
5. Per-run cap with `modelCallLimitMiddleware({ runLimit: 40, exitBehavior: "end" })` (§1).

```ts
const num = (v: string | null) => (v == null || v === "" ? undefined : Number(v));
export const limitedFetch = (limiter: Limiter): typeof fetch => async (url, init) => {
  const body = typeof init?.body === "string" ? init.body : "";
  const model = body ? (JSON.parse(body).model as string) : "unknown";
  await limiter.acquire(model, Math.ceil(body.length / 4), lane.getStore() ?? "work");   // TPM estimate, corrected below
  const res = await fetch(url, init);
  limiter.observe(model, res.status, {
    remainingRequests: num(res.headers.get("x-ratelimit-remaining-requests")),
    remainingTokens: num(res.headers.get("x-ratelimit-remaining-tokens")),
  });
  return res;
};
// new ChatOpenAI({ model, apiKey, configuration: { baseURL, fetch: limitedFetch(limiter) }, ... })
export const resilient = (m: string) => [
  ...(fallbacksOf(m).length ? [modelFallbackMiddleware(...fallbacksOf(m).map((f) => crusoe(f)))] : []),
  modelRetryMiddleware({ maxRetries: 3, initialDelayMs: 1000, backoffFactor: 2, maxDelayMs: 30_000, jitter: true, onFailure: "error" }),
];
```

**Open risks.** Whether Crusoe counts cached input tokens and `max_tokens` reservations against TPM is
**UNVERIFIED**; the header tells us, so log `remaining-tokens` per call for the first day. The limiter is
per process: never run two dev servers against one key.

---

## 8. Streaming status to the UI

**Verified API.** `StreamMode = "values" | "updates" | "debug" | "messages" | "checkpoints" | "tasks" |
"custom" | "tools"` (`@langchain/langgraph dist/pregel/types.d.ts:19`). With several modes and no subgraphs
each chunk is `[mode, payload]` (`:76-103`). `"tools"` yields `on_tool_start {toolCallId, name, input}`,
`on_tool_event`, `on_tool_end {output}`, `on_tool_error` (`:46-66`). `"custom"` carries `runtime.writer(...)`
payloads from tools. `streamEvents(..., { version: "v3" })` with typed projections (`run.subagents`,
`run.toolCalls`, `run.extensions`) also exists (`pregel/index.d.ts:20-21, 493-494`;
deepagents `DeepAgentRunStream`, `d.ts:3239`), but it is new (`@langchain/protocol@0.0.19`); use `stream` now.

**Mapping.**
| UI element | Source |
|---|---|
| Message text as it's typed | `"messages"` chunks `[AIMessageChunk, metadata]`; `metadata.lc_agent_name` tells lead from `task` helper. `additional_kwargs.reasoning_content` deltas show a "thinking…" shimmer, never text |
| "now" line | `"tools"` `on_tool_start` → a template per tool (`read_file` → "Reading launch.md", `assign_task` → "Briefing @pip", `task` → "Asking a helper"); tools may override with `runtime.writer({ now })` via `"custom"`. No model call, so no RPM |
| Plan (todos) panel | `"updates"`: the tools node's update `{ todos: { content, status: "pending"|"in_progress"|"completed" }[] }` from `todoListMiddleware` (`todoListMiddleware.d.ts:66-87`). Progress = completed / total |
| Approval card | `"updates"` chunk with `__interrupt__`, then §6 |
| Ledger rows | the callbacks already proven in `check-deepagents.mts` (`handleChatModelStart` → model + `lc_agent_name`; `handleLLMEnd` → `usage_metadata.input_tokens`, `input_token_details.cache_read`, `output_tokens`) → `record({ t: "call", kind: "run", … })` with new `thread` and `run` fields |

```ts
const stream = await agent.stream(input, { configurable: { thread_id }, context, signal, runId,
  streamMode: ["messages", "updates", "tools", "custom"], callbacks: [ledgerCallbacks({ thread_id, team, agent })] });
for await (const [mode, c] of stream as AsyncIterable<[string, any]>) {
  if (mode === "messages" && c[0].text) bus.emit(thread_id, { type: "token", text: c[0].text });
  else if (mode === "tools" && c.event === "on_tool_start") bus.emit(thread_id, { type: "now", text: nowLine(c.name, c.input) });
  else if (mode === "custom" && c?.now) bus.emit(thread_id, { type: "now", text: c.now });
  else if (mode === "updates") {
    if ("__interrupt__" in c) bus.emit(thread_id, { type: "approval", interrupts: c.__interrupt__ });
    for (const u of Object.values(c) as any[]) if (u?.todos) bus.emit(thread_id, { type: "plan", todos: u.todos });
  }
}
```
The browser subscribes per agent with `GET /api/threads/[id]/events` (SSE from an in-process `EventEmitter`);
runs are not tied to the HTTP request that started them, so closing the tab does not stop work. On reconnect the
route first sends a snapshot (`getState`: last messages, todos, pending approvals, status) then live events.

**Open risks.** `"messages"` makes ChatOpenAI stream (`stream_options.include_usage` is how usage arrives on
streams; the current smoke test reads usage from callbacks without streaming) — confirm cached-token usage
still arrives on streamed calls in step 5 of §11. LangSmith `runId` per run keeps the trace link the ledger uses.

---

## 9. Model fit: DeepSeek V4.1 Flash via ChatOpenAI on Crusoe

**What is verified.**
- `ChatOpenAI({ model, apiKey, configuration: { baseURL }, temperature, maxTokens, modelKwargs })` with
  `modelKwargs: reasoningFields(model, true)` = `{ chat_template_kwargs: { thinking: true } }` for
  `deepseek-ai/*` (`src/lib/models.ts`) runs a deepagents loop with tools, a sub-agent and a skill on Crusoe
  (`scripts/check-deepagents.mts`, README table). Crusoe verified `chat_template_kwargs.thinking` for V4 Pro and
  rejects DeepSeek's native `thinking: {type:"enabled"}` with 403 (skill file §4.6).
- Thinking tokens count against `max_tokens`; a small budget returns empty content (`finish_reason: "length"`)
  (skill file §7.2; DECISIONS.md).
- `ChatOpenAI` stores incoming `reasoning_content` in `additional_kwargs.reasoning_content`
  (`@langchain/openai dist/converters/completions.js:160-175, 263`) but strips reasoning when it sends messages
  back (`:583`). DeepSeek's docs: with `tools`, "the `reasoning_content` must be fully passed back… If your code
  does not correctly pass back `reasoning_content`, the API will return a 400 error"
  (api-docs.deepseek.com/guides/thinking_mode). DeepSeek's V4 encoder keeps all reasoning when tools are present
  (`drop_thinking` disabled) (huggingface.co/deepseek-ai/DeepSeek-V4-Pro `encoding/README.md`). langchainjs
  #10883 tracks the drop. `@langchain/deepseek@1.1.17` does not fix it (it only parses reasoning on the way in).

**Settings to use.**
| Call | thinking | maxTokens | temperature | Notes |
|---|---|---|---|---|
| Worker / PM / Mira run steps | on | 16,384 | 1.0 (card: 1.0, top_p 0.95 for agentic) or keep 0.6 | Deliverables written with `write_file` are tool-call *arguments*, so they spend output tokens too; 8,192 (smoke test) is tight for a long brief |
| Chat-only replies (no tools) | off | 1,500–2,500 | 0.8 | as in `src/app/api/chat/route.ts` |
| Heartbeat | off | 400 | 0.3 | QUIET or 2 sentences |
| Dream extraction | on | 8,192 | 0.3 | JSON ops (§3b) |
| Summarization | inherits the run's model | — | — | via the replaced `SummarizationMiddleware` |
- Reasoning effort: the card describes a numeric 1–100 budget; on Crusoe try `chat_template_kwargs: { thinking:
  true, reasoning_effort: 40 }` after checking `supported_parameters` in `GET /v1/models` (skill file §4.6).
  **UNVERIFIED** on Crusoe.
- `top_provider.max_completion_tokens` and whether `tool_choice` / `parallel_tool_calls` are in
  `supported_parameters` for V4.1 Flash: **UNVERIFIED** (needs the key: `curl -s
  https://api.inference.crusoecloud.com/v1/models -H "Authorization: Bearer $CRUSOE_API_KEY" | jq '.data[] |
  select(.id=="deepseek-ai/DeepSeek-V4.1-Flash")'`). The skill file also flags the id's casing as "confirm".
- `write_todos` must not run in parallel (its own system prompt says so, `todoListMiddleware.d.ts:6`).
- Optional fix for the reasoning drop: the same `limitedFetch` keeps a map `tool_call_id → reasoning_content`
  from responses and puts it back on outgoing assistant messages with those tool calls. Ship only if an A/B
  (same 6-step task, 5 runs each) shows fewer wasted steps; Crusoe accepts the request either way.
- Fallback GLM-5.3 uses `reasoning_effort` (models.ts) and was at capacity on 2026-10-16 (DECISIONS.md), so
  most fallbacks will fail fast; the limiter's per-model buckets keep that from spending main's RPM.

---

## 10. Module layout and data model

### `src/server/runtime/`
| File | Responsibility |
|---|---|
| `index.ts` | `getRuntime()` singleton on `globalThis`; `start()` from `src/instrumentation.ts`; wires everything below |
| `db.ts` | `better-sqlite3` handle for `.data/runtime.db`, migrations, typed queries for the tables below |
| `checkpointer.ts` | `SqliteSaver` on `.data/checkpoints.db` (separate file, its own schema) + nightly prune |
| `models.ts` | `crusoe(model, { maxTokens, think })`: `ChatOpenAI` with `limitedFetch` and `reasoningFields` |
| `limiter.ts` | per-model RPM/TPM buckets, lanes, header calibration, `hasHeadroom()` |
| `resilience.ts` | `resilient(model)`: fallback → retry order; `modelCallLimitMiddleware`; summarizer config |
| `backends.ts` | `workerBackend(agentId, projectId)` routes and `HOME_RULES` permissions |
| `home-files.ts` | `HomeFiles` middleware (SOUL/MEMORY into the system message, fresh per call) |
| `inbox.ts` | inbox table access + `InboxDrain` `beforeModel` middleware |
| `agents.ts` | `buildAgent(agentRow, projectRow)` → `createDeepAgent` config; compiled-agent cache per thread |
| `threads.ts` | thread id scheme, `ThreadQueue` (one run per thread, FIFO jobs), busy flags |
| `run.ts` | `executeRun(threadId, job)`: lane, `agent.stream`, bus events, run row lifecycle, interrupt capture, assignment safety net |
| `bus.ts` | in-process `EventEmitter` per thread/agent; SSE adapter |
| `ledger-callbacks.ts` | LangChain callbacks → `src/lib/ledger.ts` `record()` (adds `thread`, `run`) |
| `tools/assign.ts` | `assign_task`, `complete_assignment`, `check_assignments` |
| `tools/notes.ts` | `append_note` (append-only to `/home/notes.md`) |
| `approvals.ts` | capture interrupts → `approvals` rows; resume via queue |
| `scheduler.ts` | 60-s tick: heartbeats, dream triggers, prune |
| `heartbeat.ts` | the QUIET check and org snapshot built from the DB |
| `dream/run.ts`, `dream/validate.ts`, `dream/render.ts` | consolidation (§3b): gather inputs, call, validate ops, apply to MEMORY.md |
| `recovery.ts` | boot: resume `running` runs, re-capture interrupts, re-deliver inbox items |
API routes (thin): `POST /api/threads/[id]/messages` (owner message or DM → queue/inbox), `GET
/api/threads/[id]/events` (SSE), `POST /api/approvals/[id]`, `POST /api/projects` (launch → rows + threads +
kickoff job), existing `/api/ledger` and `/api/stats`.

### Data model (`.data/runtime.db`; checkpoints live in `.data/checkpoints.db`)
| Table | Key fields |
|---|---|
| `projects` | `id` (ulid), `kind` (`team`/`dm`/`company`), `channel`, `name`, `goal`, `success_metric`, `due_at`, `status` (`proposed`/`active`/`done`/`archived`), `lead_agent_id`, `spec_md`, `created_at`, `closed_at` |
| `agents` | `id`, `name`, `archetype` (lead/writer/researcher/analyst/engineer/coordinator/chief), `model_tier`, `config_json` (tools, skills, `interruptOn`, budget, heartbeat ms), `home_dir` (`agents/<id>`), `status`, `seeded_from_agent_id` (copy-of, Q3), `last_heartbeat_at`, `created_at`, `retired_at` |
| `project_members` | `project_id`, `agent_id`, `role`, `qualifications_json`, `joined_at`, `left_at` |
| `threads` | `id` (`a:{agent}:p:{project}`), `agent_id`, `project_id`, `status` (`idle`/`running`/`waiting_approval`/`error`), `last_run_at`, `last_dream_at`, `last_dream_msg_count`, `created_at` |
| `runs` | `id` (uuid7 = LangSmith run id), `thread_id`, `trigger` (`message`/`dm`/`assignment`/`callback`/`resume`/`kickoff`), `lane`, `status` (`queued`/`running`/`interrupted`/`done`/`error`/`cancelled`), `assignment_id`, `started_at`, `ended_at`, `calls`, `cost_usd`, `error` |
| `inbox` | `id`, `thread_id`, `kind` (`dm`/`assignment`/`callback`/`order`), `payload_json`, `created_at`, `delivered_run_id`, `delivered_at` |
| `assignments` | `id`, `project_id`, `parent_id`, `from_agent_id`, `from_thread_id`, `to_agent_id`, `to_thread_id`, `title`, `brief`, `deliverable`, `due_at`, `status` (`queued`/`running`/`done`/`failed`/`cancelled`), `result_summary`, `files_json`, `created_at`, `done_at` |
| `approvals` | `id`, `thread_id`, `run_id`, `interrupt_id`, `actions_json`, `review_configs_json`, `status` (`pending`/`decided`/`expired`), `decisions_json`, `created_at`, `decided_at` |
| `memories` | `id` (`m_xxxx`, also printed in MEMORY.md), `agent_id`, `project_id` (null = cross-project), `section` (`done`/`mistake`/`approach`/`standing`/`profile`), `text`, `evidence_json` (run ids, message ids, ledger `at`+`t`), `source` (`dream`/`pin`/`owner`/`seed`), `status` (`active`/`superseded`/`rejected`), `supersedes_id`, `dream_id`, `created_at` |
| `dreams` | `id`, `agent_id`, `trigger` (`task_end`/`nightly`/`project_close`/`pressure`), `input_from`/`input_to` (msg counts or timestamps), `ops_json`, `applied` (n), `rejected_json`, `model`, `cost_usd`, `created_at` |
| `heartbeat_notes` | `agent_id`, `hash`, `text`, `created_at` (24-h dedup) |
The ledger stays JSONL (`.data/ledger.jsonl`, source of truth for stats) with two optional fields added to
`CallEvent`: `thread`, `run`.

---

## 11. Build order (each step independently testable; each test fails if the step is wrong)

1. **Durable thread.** `checkpointer.ts`, `models.ts`, `agents.ts` minimal (no custom middleware).
   *Test:* process A invokes thread `a:test:p:t1` with "Remember the code word is OKAPI-41", exits; process B
   (fresh `node`) asks "What is the code word?" on the same thread → answer contains `OKAPI-41`, and
   `graph.getState` shows ≥ 4 messages. Fails with `MemorySaver` or a wrong thread id.
2. **Home files + backends + permissions.** *Test:* between two runs, append a unique line to
   `agents/test/MEMORY.md`; capture the next request body with a fetch spy → it contains the line (fails with the
   stock `memory` option, finding 2). A `write_file` to `/home/MEMORY.md` returns a permission error and the file
   is unchanged; a write to `/project/x.md` lands in `.data/projects/t1/files/x.md`.
3. **Limiter + middleware order.** Unit tests with a fake `fetch`: (a) 31 requests to one model inside 60 s →
   the 31st waits until the window frees; (b) a response with `x-ratelimit-remaining-requests: 0` blocks the
   next acquire; (c) a missing header is not read as 0; (d) with `resilient()`, a primary that always 429s is
   called 4 times before the fallback is called once (fails with today's order).
4. **Thread queue + DM steering.** Fake model + a tool that sleeps 2 s. Start a run; POST a DM during the sleep.
   *Test:* the model request right after the tool result contains the DM as the last user message; exactly one
   run row exists; the checkpoint parent chain for the thread is linear (no fork).
5. **Streaming bridge.** Fake model that calls `write_todos` then `read_file`. *Test:* the SSE stream yields a
   `plan` event with the todos, a `now` event "Reading …", tokens, and the ledger gets one `run` row per model
   call with `input`, `cached`, `output` > 0 against real Crusoe (cached may be 0 on call 1, > 0 on call 3).
6. **Approvals.** Gate a spy tool with `interruptOn: { spy: { allowedDecisions: ["approve","reject"] } }`.
   *Test:* the run ends `interrupted` with one `approvals` row; POST approve → the spy ran once and the run is
   `done`; on a second thread POST reject → the spy never ran and a ToolMessage carries the reject message.
   Restart between interrupt and decision → the row is still there and approve still works (recovery).
7. **Assignment round-trip.** Two agents with fake models scripted to call `assign_task` / `complete_assignment`.
   *Test:* the target thread receives the brief; after completion the assigner's thread receives
   `[asg_… done by @…]` and a new assigner run starts; the row is `done` with files; self-assign and
   non-member assign are refused; a target run that ends without completing posts the safety-net message.
8. **Scheduler: heartbeat + dreaming.** Injected clock. *Test:* heartbeat returning `QUIET` posts nothing;
   a note posts once to Mira's thread and the same note 10 min later is deduped; the next owner message to Mira
   gets a normal reply (covers the `updateState` risk). Dream: a fixture transcript with a 🔁 order and an error
   yields an `add` to Mistakes whose evidence ids exist; a fixture op citing a nonexistent message id is rejected
   by the validator; a MEMORY.md over the cap is compacted under the cap; SOUL.md is byte-identical after.

---

## Appendix A. UNVERIFIED items (tried; need the API key or a live test)
- Crusoe: `max_completion_tokens`, `tool_choice` / `parallel_tool_calls` support, numeric `reasoning_effort`,
  whether TPM counts cached tokens, any rate-limit reset header (§7, §9).
- Quality impact of the dropped `reasoning_content` on Crusoe (§9; A/B).
- §3a: numbers and tool names for the other systems were not re-fetched in this session (time cap); the
  OpenClaw "dreaming" feature, a Claude Code "dream" pass, and a public source for dots' "dreamer" are unconfirmed.
- Self-check (2026-10-17): coverage items 1–9 each have a verified API with version and source, a ≤ 15-line
  sketch and open risks; §10 layout + data model and §11 build order (8 steps, each with a failing-if-wrong test)
  are present; the only new package (`@langchain/langgraph-checkpoint-sqlite@1.1.0`) has no `langsmith` conflict.

## Appendix B. Source files used
`pkg/deepagents-src/src/{agent.ts, backends/{composite,state,store,filesystem}.ts, middleware/{memory,
summarization,subagents,async_subagents,completion_callback,utils}.ts, profiles/harness/builtins/openai-codex.ts}`
(from deepagents 1.15.0 source maps; 1.15.1 diffed); `pkg/deepagents-1.15.0/package/dist/agent-rhzpV1Ew.d.ts`;
`pkg/deepagents-CHANGELOG.md` (GitHub `libs/deepagents/CHANGELOG.md`); `pkg/langchain-1.5.18/package/dist/agents/
{annotation.js, ReactAgent.{js,d.ts}, utils.js, nodes/AgentNode.js, middleware/{hitl,modelRetry,modelFallback,
modelCallLimit,todoListMiddleware,constants}.*}`; `pkg/langchain-langgraph-1.5.0/package/dist/{pregel/{types,index}.d.ts,
pregel/loop.js, constants.d.ts}`; `pkg/langchain-langgraph-checkpoint-1.2.0/package/dist/store/base.d.ts`;
`pkg/langchain-langgraph-checkpoint-sqlite-1.1.0/package/dist/index.{js,d.ts}`; `pkg/lc-openai/package/dist/
{chat_models/base.js, utils/client.js, converters/completions.js}`; `pkg/lc-core/package/dist/utils/async_caller.js`;
`pkg/openai/package/client.d.ts`; `pkg/lg-sdk/package/dist/client/crons/index.d.ts`; repo files listed in the brief.
