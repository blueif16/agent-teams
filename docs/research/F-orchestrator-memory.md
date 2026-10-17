# F. Orchestrator memory: durable project state + auto-compaction for the PM (lead) and Mira

Research agent F, 2026-10-17. Scope: what the orchestrators (each project's PM, and Mira over all projects) keep in
durable files, how their threads compact, how they reload state after compaction, and how compaction differs from
dreaming. General runtime wiring (D), prompt patterns (B) and privacy (E) are covered elsewhere; this report only
touches them where compaction depends on them. D's mappings (`/home/`, `/project/`, `/conversation_history/` on disk,
the `HomeFiles` middleware, the dreaming triggers) are taken as given and reused.

**Sources and versions.**
- `deepagents@1.15.1` (npm `latest`, 2026-10-17) and `langchain@1.5.18`. I ran `npm pack` into
  `/tmp/agent-teams/research/pkg-compaction/` and pulled the TypeScript sources out of the tarballs' source maps
  (`sourcesContent`). Deep Agents sources are in `pkg-compaction/deepagents-src/src/**`; the copy is byte-identical
  to D's `pkg/deepagents-src-1.15.1` (checked with `diff -rq`). LangChain middleware sources are in
  `pkg-compaction/langchain-1.5.18/src-extract/*.ts`. In this report `DA:` means `deepagents@1.15.1 src/` and `LC:`
  means `langchain@1.5.18 src/agents/middleware/`.
- `openai/codex` at commit `ce0323f` (main, 2026-10-17T04:02Z), fetched with `gh api`, copied to
  `pkg-compaction/codex/`. In this report `CX:` means `codex-rs/`.
- The leaks repo `system_prompts_leaks` at `dfa2e28` (2026-10-16). I read only compaction, summary, progress and
  task-list prompts. `LK:` means a path inside that repo.
- Web pages were fetched on 2026-10-17 with Exa. Anything I did **not** re-read this session is marked
  *(recalled, not re-fetched)*.

---

## 1. How Deep Agents JS compacts today (verified from source)

### 1.1 Wiring
- `createDeepAgent` always installs `createSummarizationMiddleware({ backend })` in its core stack:
  `[filesystem, subagents, summarization, patchToolCalls]` (DA:`agent.ts:488-529`). Sub-agents get their own copy
  (`agent.ts:307-329`).
- To replace it, pass a middleware with the same `name: "SummarizationMiddleware"` (DA:`summarization.ts:1184`).
  `mergeMiddlewareStack` swaps a same-name entry in place (DA:`middleware/utils.ts:47-77`, used at
  `agent.ts:546-550`). Middleware with a new name goes *between* the core and tail stacks. That means it runs
  **inside** summarization: summarization runs first and does not see what inner middleware adds (see 1.6).
- **`write_todos` is not built in.** It has been opt-in since 1.12.0 (CHANGELOG #708; D finding 1). You add
  `todoListMiddleware()` from `langchain` yourself.

### 1.2 Trigger
- Option shape: `trigger?: ContextSize | ContextSize[]`, where `ContextSize = {type:"messages"|"tokens"|"fraction",
  value}`. If you pass an array, **any** entry firing triggers summarization (OR) (`summarization.ts:467-495`). This
  differs from base LangChain, where several keys inside one object are ANDed (LC:`summarization.ts:161-171`).
- Defaults are computed from the model profile when the first call resolves the model (`summarization.ts:186-226,
  357-380`):
  - **with** `profile.maxInputTokens`: trigger at `fraction 0.85`, keep `fraction 0.10`, truncate-args
    `0.85 / 0.10`;
  - **without** a profile: trigger at `tokens 170_000`, keep `messages 6`, truncate-args trigger at 20 messages,
    keep 20 (`:178-183`).
  - `ChatOpenAI` pointed at Crusoe ids has no profile (D finding 7), so **we get the 170K / 6-message fallback**.
    If you pass `trigger` but leave out `keep`, keep is 20 messages (`:336-339`).
- Tokens are counted with `countTokensApproximately` over system message + messages + tool schemas
  (`:686-706`). After a `ContextOverflowError` the middleware learns a multiplier (`observedRatio*1.1`) and uses it
  from then on (`:385-390, 1146-1151, 1259-1264`). If the provider still overflows, it falls back to emergency
  summarization (`:1248-1267`).

### 1.3 What it keeps, summarizes and writes
- **Cutoff.** Keep the last N messages, or walk back from the end until the token/fraction budget is used up
  (`:584-616`). `findSafeCutoffPoint` never splits an AI tool call from its results. It moves the cut back to the
  AIMessage, unless that would move it more than half the distance, in which case it moves forward past the
  ToolMessages (`:511-575`).
- **Arg truncation, a pre-pass.** In messages older than the truncate-keep window, `write_file`/`edit_file`
  string arguments over 2,000 chars become `first 20 chars + "...(argument truncated)"` (`:779-845`). No other
  tool's arguments are touched. Our structured state tools (section 3) are therefore never truncated.
- **Offload.** The span being summarized, minus earlier summary messages, is appended as Markdown
  (`## Summarized at <ISO>` + `getBufferString`) to `${historyPathPrefix}/${sessionId}.md`, default
  `/conversation_history/`, on the agent's backend (`:854-937`).
  - The doc comment says `{thread_id}.md` (`:27`), but the code uses `state._summarizationSessionId` or a random
    `session_<8 hex>` (`:395-411`). On disk the file is **not** named after the thread.
- **Summary call.** `chatModel.invoke([new HumanMessage(summaryPrompt.replace("{conversation}",
  getBufferString(msgs)))])` (`:942-972`).
  - This is a fresh one-message request: none of the agent's system prompt, tools or message prefix is reused, so it
    gets **no prefix-cache hit**.
  - `getBufferString` flattens tool calls into text.
  - No input trimming unless `trimTokensToSummarize` is set (1.12.3, #732).
- **Default prompt** (`:227-237`): "You are a conversation summarizer… captures: 1. The main topics discussed 2. Key
  decisions or conclusions reached 3. Any important context… Keep the summary focused… Conversation to summarize:
  {conversation} Summary:". It has no sections for owners, open tasks or user instructions. (Base LangChain's
  default is the longer "Context Extraction Assistant" prompt, LC:`summarization.ts:36-62`.)
- **Where the summary goes.** It becomes a `HumanMessage`, tagged `additional_kwargs.lc_source="summarization"`,
  whose body is "You are in the middle of a conversation that has been summarized. The full conversation history
  has been saved to {path}… <summary>…</summary>" (`:977-1002`).
  - The message is stored in private state, `_summarizationEvent = {cutoffIndex, summaryMessage, filePath}`
    (`:247-271, 1171-1180`).
  - **State `messages` are never rewritten.** Every call rebuilds `effective = [summaryMessage,
    ...messages.slice(cutoffIndex)]` (`getEffectiveMessages`, `:290-306`). The checkpoint keeps the full raw
    history, which helps dreaming, but the checkpoint grows without bound.
  - Base LangChain does rewrite state instead, with `RemoveMessage(REMOVE_ALL_MESSAGES)` (LC:`summarization.ts:
    478-484`).
- **Degenerate cases.**
  - If the cut would keep zero messages, it first tries truncating every ToolMessage to an equal share of 70% of
    the window (`compactToolResults`, `:720-774, 1087-1111`).
  - If the summarized request still overflows, it re-summarizes *everything* into a single message
    (`:1139-1169`).

### 1.4 Large tool-result eviction (filesystem middleware)
- Tool results over `toolTokenLimitBeforeEvict = 20_000` tokens (×4 chars, about 80 KB) are written to
  `/large_tool_results/<tool_call_id>.txt`. The message is replaced by "Tool result too large… saved… at this
  path… read only part… offset and limit" plus a head/tail preview (DA:`middleware/fs.ts:384-397, 1985-1988,
  2215-2216, 2326-2368`).
- `ls, read_file, write_file, edit_file, delete, glob, grep` are exempt; `execute` and every custom tool are
  checked (`fs.ts:84-130, 2600-2620`).
- HumanMessages over 50K tokens are evicted the same way (`fs.ts:2216, 2394-2435`).

### 1.5 What survives summarization
| Item | Survives in graph state? | Visible to the model after compaction? |
|---|---|---|
| System prompt (incl. the `memory` / HomeFiles block appended by middleware) | not a message | **Yes.** Summarization only touches `messages`; the system message is a separate request field (`summarization.ts:1187-1211`). |
| `files` (StateBackend) and on-disk files | yes (separate channel) | Only if the agent reads them again. |
| `todos` from `todoListMiddleware` | yes (`LC:todoListMiddleware.ts:249-251`) | **No.** The middleware only appends a *static* prompt (`:334-340`). The list itself shows up only in the `write_todos` ToolMessage text "Updated todo list to […]" (`:307-320`). Once that message is cut, the model has lost its plan unless the summary repeats it. |
| `memoryContents` (`memory` option) | yes, frozen per thread | yes, but stale (D finding 2) |
| Sub-agent boundary | `_summarizationEvent`, `_summarizationSessionId`, `todos`, `memoryContents` are not passed in or out of sub-agents (`DA:middleware/subagents.ts:78-91`) | n/a |

### 1.6 What we can customize, and what's missing
- **Configurable:** `model`, `backend`, `trigger`, `keep`, `summaryPrompt` (placeholder `{conversation}`),
  `trimTokensToSummarize`, `historyPathPrefix`, `truncateArgsSettings` (`summarization.ts:122-172`).
- **Missing hooks** we need:
  - (a) inject a code-rendered state digest into the summary message;
  - (b) run the summary *inside* the cached conversation;
  - (c) let the summarizing turn file facts through tools before it summarizes;
  - (d) verify after compaction;
  - (e) trigger on the provider's real `usage.input_tokens`. The estimate misses blocks appended by inner
    middleware, because summarization sits outside the tail/novel middleware (1.1).
- **Smallest workaround (LangChain v1 middleware only):** write our own `createMiddleware({ name:
  "SummarizationMiddleware", … })`, about 300 lines, that copies the deepagents pattern:
  - `wrapModelCall` + private `_summarizationEvent` + `getEffectiveMessages` + `findSafeCutoffPoint` + offload,
    returning `Command({update})` as at `:1171-1180`;
  - **keep the same state key names**, so the sub-agent exclusion list (`subagents.ts:78-91`) still applies;
  - add steps (a)-(e) from the algorithm in §9.4.
  - No LangGraph changes are needed.

---

## 2. Prior art (14 systems)

| # | System | Trigger | Pinned (always in context) | Summarized | Offloaded to files | Summary format | Rehydration | Measured results |
|---|---|---|---|---|---|---|---|---|
| 1 | **Claude Code auto-compact** | Threshold on an "auto-compact window": the model's limit or an override (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, settings, account, experiment; LK:`Anthropic/claude-code/skills/plugin-authoring/types/claude-code.d.ts:2333-2338`). Sub-agents get 100K-1M (`:523-527`). Also manual `/compact`, plugins, and **`precompute`**: a background summary kept for the next compaction "if the conversation still holds what it ran over" (`:11278-11283`). | System prompt; instruction files (CLAUDE.md) re-sent "when a file differs" and once more after a compaction (`:8750-8757`) | Whole conversation | Transcript on disk; memory files | LK:`Anthropic/claude-code/commands/compact.md`: tools forbidden; `<analysis>` then `<summary>` with 9 sections (Primary request · Concepts · Files+code · Errors+fixes · Problem solving · **All user messages** (security constraints verbatim; never attribute assistant-quoted text to the user) · Pending tasks · Current work · Next step with **verbatim quotes** of the last task) | Summary message + re-sent instruction files; the plan-mode reminder goes back to `full` after compaction (`claude-code.d.ts:8295-8302`); `session.compact` / PreCompact hooks can rewrite or veto (`:4484-4492`) | n/a |
| 2 | **Claude Code Tasks / agent teams** | n/a (task store) | `TaskList` on demand | n/a | Task list on disk shared by teammates | Task = `subject, description, status pending→in_progress→completed, owner, blocks/blockedBy, metadata`; "read a task's latest state using TaskGet before updating it"; never mark complete if tests fail (LK:`Anthropic/claude-code/claude-code-desktop-fable-5.md:2329-2680`) | Teammates call `TaskList`: pending, no owner, empty `blockedBy`, lowest id first | n/a |
| 3 | **OpenAI Codex** | `auto_compact_token_limit` = **90 % of context window** by default, clamped to it (CX:`protocol/src/openai_models.rs:461-464, 529-541`); usable input 95% (`:1102`); optional post-turn threshold (CX:`core/src/session/context_window.rs:111`); the trigger uses *server-observed* usage (CX:`core/src/state/auto_compact_window.rs:41`) | Re-rendered "initial context" (base instructions, AGENTS.md, environment, world state) put back in front (CX:`core/src/compact.rs:85-116`) | History; **up to 20K tokens of the user's own messages are kept verbatim** (`compact.rs:64, 404-407, 715-760`) | Rollout file; experimental "token budget" mode: notes tools `list_files_by_prefix/read_file/search_contents/append_to_file/write_file` and a new-window hint "Recent notes (up to 5, most-recent first)" (CX:`app-server/tests/suite/v2/history_notes_extension.rs:30, 172-176`) | Prompt (CX:`prompts/templates/compact/prompt.md:1-9`): "CONTEXT CHECKPOINT COMPACTION. Create a handoff summary… progress and key decisions · constraints, user preferences · what remains (clear next steps) · critical data". Prefix: "Another language model started to solve this problem…" (`summary_prefix.md`) | The compaction prompt is **appended to the live history** (`compact.rs:279`), so the prefix is cached. On overflow it trims the *oldest* item "to preserve cache (prefix-based)" (`:361`). Also remote `/responses/compact` (opaque) and async background compaction (CX:`core/src/session/async_compaction.rs:1-2`) | Factory (row 13): OpenAI 3.35/5, compression 99.3% |
| 4 | **Anthropic context editing + memory tool** (2025-09-29) | Clear stale tool calls/results "when approaching token limits" | Conversation flow | Old tool results cleared (not summarized) | Memory tool = client-side file directory; CRUD; persists across conversations | Files the agent writes | Agent reads its memory directory | Agentic search eval: memory + editing **+39 %** vs baseline, editing alone **+29 %**; 100-turn web search: **−84 % tokens** [anthropic.com/news/context-management] |
| 5 | **Anthropic API server-side compaction** | Automatic as context approaches the window; `context_management.edits:[{type:"compact_20260112"}]`, beta `compact-2026-01-12`; `instructions` takes your own prompt | Compaction block must be echoed back | Server summarizes earlier context | n/a | Opaque `compaction` block | Pass `response.content` back (LK:`…/claude-api/typescript/claude-api/README.md:280-313`). Bundled guidance: "the transcript is the source of truth… everything the model needs to know later is added at the tail, never written into the head"; freeze the rendered system prompt; deliver changes as appended messages; never compact mid tool round (LK:`…/claude-api/shared/preserved-thinking-migration.md:195-207`) | Factory: Anthropic 3.44/5, 98.7%; summaries 7-12K chars |
| 6 | **Anthropic, Effective harnesses for long-running agents** (2025-11-26) | New context window per session | Prompt tells the agent to read the progress file and git log first | Compaction alone "isn't sufficient" | `claude-progress.txt` (log of what agents did), **feature list JSON** (200+ features, all `"passes": false`; agents may only flip `passes`; "JSON… less likely to [be] inappropriately change[d]… compared to Markdown"), `init.sh`, git commits | Free-form progress notes + structured JSON | Initializer agent sets things up; each coding session reads progress + git + feature list, does one feature, commits, and leaves a clean state | Failure modes observed: one-shotting and running out mid-feature; a later agent "declare[s] the job done" too early |
| 7 | **Anthropic, Effective context engineering** (2025-09-29) | — | Minimal high-signal system prompt | Compaction (tune for recall first, then precision; clearing tool results is the "lightest touch") *(recalled)* | **Structured note-taking**: NOTES.md, to-do lists; the Claude-plays-Pokémon running tallies *(recalled)* | — | Just-in-time retrieval by path/handle; sub-agents return condensed summaries of "1,000-2,000 tokens" *(recalled)* | Names "context rot" and the "attention budget" (fetched) |
| 8 | **Manus** (2025-07-18) | Restorable compression | Stable prefix; tools never removed (logit masking instead) | — | **File system as context**: "compression strategies are always designed to be restorable" (drop page text, keep the URL; drop doc contents, keep the path) | `todo.md` rewritten step by step = **recitation** of goals at the tail, for ~50 tool calls per task | Re-read the files; keep errors in ("Erasing failure removes evidence") | KV-cache hit rate is "the single most important metric"; input:output ≈ **100:1**; cached vs uncached price **10×** |
| 9 | **Letta / MemGPT** | MemGPT: memory-pressure warning before overflow, then eviction with a recursive summary *(recalled from arXiv 2310.08560)* | **Core memory blocks**: `label, description, value, limit` (chars), shown with `chars_current/chars_limit`, read-only option, shareable across agents [docs.letta.com/guides/agents/memory-blocks] | Old messages → recursive summary | Archival (vector) and recall (conversation search) memory *(recalled)* | Blocks are XML-tagged in the prompt | Agent edits its blocks with memory tools; searches archival/recall | — |
| 10 | **Cognition** | — | Share full context and traces ("Share context, and share full agent traces"; "Actions carry implicit decisions", fetched 2025-06-12) | A dedicated compression LLM that compresses action history into "key details, events, and decisions" *(recalled, same post)* | — | — | — | "Context anxiety": models that know their budget cut corners near the limit (Devin on Sonnet 4.5, Sep 2025) *(recalled)* |
| 11 | **LangChain "Context engineering for agents"** | — | — | **Compress** (summarize, trim) | **Write** (scratchpads, memories), **Select** (retrieve), **Isolate** (sub-agents, sandbox, state fields) *(recalled; Lance Martin, mid-2025)* | — | — | — |
| 12 | **Magentic-One** (arXiv 2411.04468) | Stall counter over a threshold → re-plan *(recalled)* | **Task ledger** (given facts, facts to look up, facts to derive, educated guesses, plan) | — | — | **Progress ledger** each step: request satisfied? looping? progress? next speaker? instruction? *(recalled)* | On re-plan, agents clear their contexts (`C-similar-systems.md:265`) | "Statistically competitive" with SOTA on GAIA, AssistantBench, WebArena (fetched abstract) |
| 13 | **Factory.ai, anchored iterative summarization** (2025-12-16) | Threshold | Persistent structured summary | **Only the newly truncated span** is summarized and merged into the existing summary (sections: intent, file modifications, decisions, next steps) | — | Fixed sections: "each section acts as a checklist" | Summary + recent turns | Probe eval over 36,611 messages. Overall **3.70** (Factory) vs 3.44 (Anthropic) vs 3.35 (OpenAI). Artifact trail is weak for every method (2.19-2.45): "requires… a separate artifact index" |
| 14 | **JetBrains, "The Complexity Trap"** (arXiv 2508.21433) | — | Agent reasoning/actions | — | — | **Observation masking** (hide old tool outputs) | — | SWE-bench Verified: masking **halves cost** vs raw and matches or slightly beats LLM summaries; a hybrid is 7% / 11% cheaper; observations are ~84% of a turn's tokens |
| + | GitHub Copilot CLI (LK:`Microsoft/copilot-cli.md`) | context exhausted | — | "Continuation summary": task overview + success criteria · current state · discoveries incl. failed approaches · next steps · context to preserve (`:826-850`) | per-session SQL `todos(id,title,description,status pending/in_progress/done/blocked)` + `todo_deps` (`:367-368`) | — | "After sub-agents return, check todo status in SQL (source of truth)… trust SQL for status" (`:741-743`) | — |

**The five patterns that matter most for us:**
1. **Structured state outside the transcript, written by tools that enforce invariants.** Examples: the feature
   list where agents may only flip `passes` (6), Tasks with `blockedBy` and `owner` (2), SQL todos as source of
   truth (+), Letta blocks with size limits (9). The summary then only has to carry what the files don't.
2. **Compact inside the cached conversation.** Codex appends its prompt to the live history and trims from the
   oldest end to keep the cache (3); Claude Code says "you already have all the context… above" (1). Deep Agents
   instead re-sends the transcript as a fresh, uncached prompt (1.3).
3. **Re-inject pinned context after compaction, and only append between compactions.** Codex re-renders the initial
   context and keeps the user's own messages verbatim (3). Claude Code re-sends instruction files (1). The Claude
   API guidance is "added at the tail, never written into the head" (5). Manus recites todo.md at the tail (8).
4. **Fixed-section summaries, merged over the previous summary rather than regenerated** (13, 1), with explicit
   slots for user instructions, failed approaches and next step (1, +, 8).
5. **Probe-based checks for loss** (13), and cheap observation masking before LLM summaries (14, 4).

---

## 3. The lead's (PM's) durable state files

**General rules.**
- All project state lives in `.data/projects/<pid>/state/` on disk (canonical, human-readable, local-first). It is
  mounted read-only for the generic FS tools at `/state/` with a deepagents permission
  `{operations:["write"], paths:["/state/**"], mode:"deny"}`. The permission shape is in D §1; `delete` counts as a
  write (D).
- **Only structured tools write state.** They go through one Node module, `src/lib/project-state.ts`:
  - per-project mutex, write to a temp file then `rename`;
  - a monotonic `rev`;
  - JSON serialized with **sorted keys**, so renders are byte-stable for the prefix cache;
  - every write appends a ledger event and emits an SSE `{type:"state", pid, file, rev}`.
- Every entry carries `source`: a ledger id, a message id (`msg:<thread>:<idx>`) or a file path. Loss detection
  (§7) and dreaming (§6) depend on these.

### 3.1 `dag.json`: the work DAG (and project todos)
- **Purpose.** The single source of truth for who does what, in what order, with what evidence. The Plan panel and
  the Team panel's "now doing" line both render from it. Project todos are DAG nodes with `kind:"todo"` (usually
  owned by `pm`), not a second list. Two lists would drift: this is the "todos rot" failure (§8).
- **Format.**
```json
{ "pid": "p_42", "rev": 57, "updatedAt": "2026-10-17T19:02:11Z",
  "tasks": [
    { "id": "t7", "kind": "work", "title": "Draft pricing page copy", "status": "blocked",
      "owner": "ana", "deps": ["t3"], "milestone": "m1",
      "acceptance": "3 tiers, <=120 words each, owner's tone (prefs P-2)",
      "blocker": { "text": "needs final tier names", "on": "Q-2", "since": "2026-10-17T17:40:00Z" },
      "evidence": [],
      "lastReport": { "at": "2026-10-17T17:41:00Z", "by": "ana", "status": "blocked",
                      "summary": "v1 done for Pro/Team; Free tier blocked on naming",
                      "ref": "/project/reports/t7-02.md" },
      "created": "2026-10-17T15:02:00Z", "updated": "2026-10-17T17:41:00Z", "reopened": 0,
      "source": "msg:pm-p_42:118" },
    { "id": "t11", "kind": "todo", "title": "Review t3 deliverable", "status": "ready", "owner": "pm",
      "deps": ["t3"], "due": "2026-10-17", "evidence": [], "created": "…", "updated": "…", "source": "led:…" }
  ] }
```
- **Statuses.** `todo → ready` is computed by code when all deps are `done`. Other moves: `ready → in_progress →
  {review | blocked | done | failed}`, `review → {done | in_progress}`, `blocked → in_progress`, any →
  `dropped` (needs a reason).
- **Writers (tools; code checks the invariants):**
  - `add_task({title, kind:"work"|"todo"|"milestone", acceptance, owner?, deps?, milestone?, due?, detail?})` →
    `{id:"t12", rev, recite}`. Rejects: dependency cycles; deps on unknown ids; an owner not in the roster and not
    `pm`/`owner`; more than 60 open tasks.
  - `update_task({id, expectedRev, status?, owner?, addDeps?, removeDeps?, blocker?:{text,on?}|null, note?,
    evidence?: string[]})` → `{rev, recite}`.
    - Rejects an illegal transition, and `done` without at least one evidence ref (file path or ledger id).
    - Rejects a stale `expectedRev`. This is optimistic concurrency, the same idea as Claude Code's "read a task's
      latest state… before updating it".
  - `assign_task({id, agentId, brief})`: sets owner and `in_progress`, and sends the assignment through D's
    in-process `assign_task` (D §5).
  - **Runtime, not the PM:** the worker tool `report({taskId, status:"progress"|"blocked"|"review"|"done",
    summary, evidence[], blocker?})` writes `lastReport`, status and blocker. This follows Copilot CLI's "trust SQL
    for status". The report body is saved to `/project/reports/<task>-<n>.md`.
  - `recite` is one line, returned in every tool result. It recites the plan at the tail, as Manus does, without
    touching the head: `"DAG r58 · 4/9 done · blocked: t7(ana→Q-2) · ready: t8(bo), t9(unassigned) · todos: t11"`.
- **When it updates:** kickoff; every assignment, report and owner order (👍 / 🔁 / ✋ change status through the
  runtime); every replan.
- **Size and pruning.**
  - ≤ 60 open nodes, enforced by the tool.
  - `done`/`dropped` nodes older than 48 h, or more than 20 closed, move to `dag.archive.jsonl` with a one-line
    outcome. The archive is never pinned.
- **Pinned or on demand.** Rendered into the **state digest** (§4) at each window start: open nodes in full, plus
  closed nodes from the last 24 h as one-liners. Full JSON via `read_file /state/dag.json`.
- **UI.**
  - Plan panel = `tasks` grouped by milestone/status, `deps` drawn as edges, owner mascots, progress =
    done/total over `kind:"work"`.
  - Team panel "now" = the owner's `in_progress` task.
  - An approval card appears for `review` nodes whose acceptance names the owner.
  - The front end reads `GET /api/projects/<pid>/state` and then follows the SSE revs. This **replaces** D's plan
    of driving the Plan panel from `todos` (D §6 table). Workers' own `write_todos` checklists still show on their
    personal panes.

### 3.2 `decisions.md`: the decisions log (ADR-style, append-only)
- **Format.**
```md
## D-007 · 2026-10-16 · Three pricing tiers (Free / Pro / Team)
- Status: active            <!-- active | superseded by D-0xx | revoked -->
- Decision: Launch with three tiers; no annual plan in v1.
- Why: owner wants a simple page; annual adds billing work beyond the 10-28 deadline.
- Approved by: owner (led:2026-10-16T21:04:11Z/approval) · proposed by pm
- Supersedes: D-003
- Links: t3, Q-1, /project/research/competitor-pricing.md
- Source: msg:pm-p_42:96
```
- **Writer.** `record_decision({title, decision, why, approvedBy:"pm"|"owner", approvalRef?, supersedes?, links?})`.
  - Code assigns the id and date and marks the superseded entry.
  - `approvedBy:"owner"` is accepted **only** with an `approvalRef` that resolves to a real ledger approval event.
    Otherwise the tool opens an approval card through `interruptOn` and writes the entry when the owner approves.
    The model cannot fake an owner approval, and fabricated approvals are the main way bad context spreads (§8).
- **When:** an owner approval or decline; any PM choice that constrains more than one task; any reversal.
- **Size.** The file is unbounded (append-only). The **digest** shows only *active* decisions as one-liners, ≤ 25.
  Beyond that, the tool refuses new entries until something is superseded or archived. Detail via `read_file`.

### 3.3 `roster.json`: team roster state
```json
{ "rev": 31, "members": [
  { "agentId": "ana", "role": "writer", "archetype": "writer", "thread": "ana-p_42",
    "state": "blocked", "lastCheckIn": "2026-10-17T17:41:00Z", "lastReport": "t7 v1 done; Free tier blocked on Q-2",
    "blockers": [{ "text": "tier names", "on": "Q-2" }], "pmNote": "fast; asks before guessing",
    "load": { "open": 1, "doneToday": 2 } } ] }
```
- **Writers.**
  - The runtime writes `state` (working / idle / blocked / waiting_owner), `lastCheckIn`, `lastReport` and
    `blockers`, from reports, run start/end and heartbeat.
  - `load` and "current task" are **derived from `dag.json` at render time, never stored twice**.
  - The PM writes only `update_member({agentId, pmNote?, blocker?})`.
- **When:** on every worker run event, and on staffing changes after owner approval.
- **Size:** one entry per member; `lastReport` ≤ 300 chars; `pmNote` ≤ 200 chars. Pinned in the digest.
- **UI:** the Team panel.

### 3.4 `open.json`: open questions and risks
```json
{ "rev": 12, "items": [
  { "id": "Q-2", "kind": "question", "askOf": "owner", "text": "Final names for the three tiers?",
    "raised": "2026-10-17T17:42:00Z", "due": "2026-10-18", "status": "open", "links": ["t7"], "source": "msg:pm-p_42:121" },
  { "id": "R-1", "kind": "risk", "askOf": "pm", "text": "Stripe test keys not provisioned; blocks t9",
    "severity": "high", "status": "open", "mitigation": "ask owner by 10-19", "links": ["t9"] } ] }
```
- **Writers:** `raise_item({kind, text, askOf, links?, due?, severity?})` and `resolve_item({id, resolution})`.
  - A question with `askOf:"owner"` becomes an owner card.
  - An owner reply on that card resolves it through the runtime (`source` = the owner's message).
- **Size:** ≤ 20 open, enforced. Resolved items go to `open.archive.jsonl`. All open items are pinned in the digest.

### 3.5 `prefs.md`: owner preferences for this project
```md
- P-1 Short copy; no exclamation marks. (led:2026-10-16T20:11Z/📌 on ana msg)
- P-2 Tone: calm, a little playful. (msg:pm-p_42:40, owner)
```
- **Writers.** The 📌 handler (runtime) and `note_owner_pref({text, sourceRef})`, where `sourceRef` must point to
  an owner message or a 📌 event.
- **Size and placement.** ≤ 40 bullets / about 1.5K tokens. It is shared by the whole team:
  - it is rendered into each team member's per-project SOUL section (the 📌 rule in CONTEXT.md),
  - so for the PM it sits in the system prefix and changes only on 📌.
- **Scope:** company-wide owner preferences are Mira's (§5), not this file.

### 3.6 `charter.md`: project charter
```md
# Pricing page relaunch  (p_42)
Goal: ship a new pricing page by 2026-10-28.   Success metric: trial→paid conversion ≥ 4% over 14 days.
In scope: copy, design, Stripe checkout links.   Out of scope: annual billing, enterprise tier.
Qualifications: writer — SaaS pricing copy, ≥0.8 acceptance; engineer — Next.js + Stripe Checkout.
Budget: $15 model spend; owner gates: brief, staffing, launch.   Approved: led:2026-10-16T21:04Z
```
- **Writer:** `set_charter({...})`, always behind an owner approval (`interruptOn`).
- **When:** brief approval and re-scoping. Rare.
- **Size:** ≤ 1.5K tokens.
- **Placement:** **pinned in the system prefix** right after SOUL and MEMORY, since it changes only on approval.

### 3.7 `journal.md`: progress log (Anthropic's `claude-progress.txt` analogue)
- One line per meaningful event, e.g.
  `2026-10-17T17:41Z t7 blocked (ana): tier names → raised Q-2 to owner`.
- Written by the runtime from state-tool events, plus `log_progress({line})` from the PM.
- Not pinned. The digest shows the last 8 lines.
- The file rotates per compaction window (`journal/<n>.md`) and feeds dreaming.

### 3.8 `windows/<agent>/<n>.md`: compaction records
- One file per compaction, written by the runtime: the summary, the must-survive set, the probe score, token
  counts.
- Never pinned; the latest one is cited in the opener.
- Read by dreaming and by the "what happened earlier" fallback (`read_file`).

---

## 4. Compaction policy: orchestrators vs workers

### 4.1 Context layout (order matters for the prefix cache)
```
┌─ SYSTEM (byte-stable for the thread; changes only on 📌 / dream / charter approval) ─────────────┐
│ 1 role + archetype prompt (PM), tool-use rules, compaction protocol rules        ~3K            │
│ 2 tool schemas (fixed set, fixed order, never added or removed mid-thread)      ~4K            │
│ 3 SOUL.md (Inherent + this project's section incl. prefs.md) + MEMORY.md         ~2-4K (D HomeFiles) │
│ 4 charter.md                                                                     ≤1.5K          │
├─ MESSAGES ─────────────────────────────────────────────────────────────────────────────────────┤
│ 5 WINDOW OPENER (one HumanMessage, frozen for the window = _summarizationEvent.summaryMessage) │
│     <window n rev date> + <project_state> digest (code-rendered, sorted) ≤4K                    │
│     + <summary of earlier windows> ≤1.5K + pointers (history file, windows/, journal)            │
│ 6 rolling history (append-only): owner msgs, worker reports, tool calls/results                 │
│ 7 tail deltas: <state_delta rev=58> one-liners appended when state changes from outside         │
│   (worker report, owner card, heartbeat), plus `recite` lines in state-tool results              │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- **Why the digest is not in the system prompt.** The DAG changes every few turns. Re-rendering it at the head would
  invalidate the cache for the whole conversation on every change (Crusoe: "Rewriting or trimming an earlier message
  invalidates the cache from that point on", repo skill §8).
- **The rule.** The head changes **once per window**, at compaction. Everything in between is appended (Manus
  append-only; Claude API "added at the tail").
- Digest sample (the `<project_state>` block):
```
<project_state rev="57" as_of="2026-10-17T19:02Z">
PLAN m1 "Copy+design" 4/9 done · 1 blocked · 2 ready
- t7 [blocked] Draft pricing page copy — ana — on Q-2 since 17:40 — last 17:41 "v1 Pro/Team done; Free blocked"
- t8 [ready] Page layout in Figma — bo
- t9 [todo, deps t7,t8] Stripe checkout links — (unassigned)
TODOS (pm): t11 [ready] Review t3 deliverable (due today)
TEAM: ana writer · blocked(Q-2) · 17:41 | bo designer · idle · 18:55
OPEN: Q-2 → owner "Final names for the three tiers?" (17:42, due 10-18) | R-1 high: Stripe test keys (t9)
DECISIONS (active): D-007 three tiers, no annual (owner) | D-005 Figma not Framer (pm)
JOURNAL (last 8): …
</project_state>
```

### 4.2 Trigger thresholds (justified)
Inputs:
- V4.1 Flash has a **1,048,576-token** window (repo skill §4.1; models.ts `MODELS.main`).
- Crusoe without a payment method allows **500,000 TPM and 30 RPM per model**, per project (skill §6).
  **Every agent uses `main`**, so the whole company shares one TPM/RPM bucket.
- Prices are $0.29 in, $0.007 cached, $1.20 out per 1M (models.ts `PRICES`).
- Whether cached tokens count against TPM is **UNVERIFIED** (D §7). The arithmetic below assumes they do, which is
  the safe case.

| Constraint | Arithmetic | What it implies |
|---|---|---|
| TPM | 500K ÷ 30 RPM = **16.7K tokens** average per request if the team is to use all 30 RPM. The lead coordinates and is active about 4 calls/min. Budget it ⅓ of TPM, about 166K/min, so its mean context must be ≤ ~40K. Context grows as a sawtooth from the post-compaction floor F ≈ 22K (system ~11K + opener ≤ 6K + tail ~5K) up to the trigger T, so the mean is ≈ (F+T)/2 ≤ 40K → **T ≤ ~58-64K**. | Deep Agents' 170K fallback means one lead call ≈ 34% of the company's TPM minute. |
| Cost | At 64K with a 90% cache hit: 6.4K × $0.29 + 57.6K × $0.007 ≈ **$0.0023/call**. A cached in-context compaction turn ≈ $0.006 (incl. 3K out). A fresh uncached Deep Agents summary of 64K ≈ $0.019. | Cost does not bind, but caching the compaction turn saves ~3×. |
| Quality | 64K is **6%** of the window: far from context rot (row 7 in §2; JetBrains "lost in the middle") and from context anxiety (Cognition). | Leaves headroom; no need to tell the model its budget. |
| Thrash | Require growth ≥ 24K since the window opened before compacting again. | Prevents compacting every turn. |

**Settings.**
- **Lead (PM): soft 64K, hard 96K.**
  - At soft: compact **post-turn while idle**. The lead is often waiting on workers; this is Codex's post-turn
    phase. Run in the limiter's `background` lane.
  - At hard: compact inline before the next model call.
- **Mira: soft 48K, hard 80K.** Her context is mostly owner chat plus project deltas.
- **Workers: soft 96K, hard 128K.** They carry tool output. Also lower `toolTokenLimitBeforeEvict` to 8,000 for
  workers and 4,000 for orchestrators, which never need raw tool dumps.
- **Signal.** Use the provider's last `usage.input_tokens` (`usage_metadata.input_tokens`; D verified it lands
  there). Do not use `countTokensApproximately`, which misses inner-middleware blocks (§1.6) and undercounts JSON
  (`summarization.ts:385-390`).

### 4.3 What the lead's compaction summary must contain (checklist; fixed sections, ≤ 1,500 tokens)
1. **Owner instructions this window**: every owner message, quoted verbatim with message ids. Claude Code's
   "All user messages" and Codex's verbatim user messages do the same.
2. **Plan changes**: ids only (added / closed / reassigned / reopened); the details live in `dag.json`.
3. **Commitments the PM made** that are not yet met (to the owner, to workers), with times.
4. **Waiting on**: who, for what, since when (questions in flight; replies not yet answered).
5. **Decisions in progress**: options weighed, not yet recorded or approved.
6. **Failed attempts and errors**, and what was learned. Manus: keep the wrong stuff in.
7. **Artifacts**: paths produced or received this window.
8. **Transient context deliberately not filed**, with a reason.
9. **Current work and next step**, with a verbatim quote of the last instruction being executed (Claude Code §8-9).
- **Forbidden:** restating state-file content (cite ids), and claiming any approval that has no ledger ref.
- **Merged, not regenerated.** The previous window's summary is passed in, and the new one updates it section by
  section (Factory's anchored iterative approach).

### 4.4 Re-injection after compaction
The runtime re-renders the opener from the files at that moment:
- the digest (§4.1);
- the summary;
- pointers: `/conversation_history/<session>.md`, `/state/windows/pm/<n>.md`, `/state/journal/<n>.md`.

It installs the opener as `_summarizationEvent.summaryMessage`. System items 1-4 are untouched, so they never need
re-injecting; they never left.

### 4.5 Keeping the prefix cache hitting across compactions
- System + tools (~11-15K) are byte-identical across windows. Only the opener and the tail are new after a
  compaction, so the first post-compaction call pays ~10K uncached tokens (≈ $0.003).
- The compaction turn itself is appended to the *current* window, so its prefix is fully cached.
- Rendering is deterministic: sorted JSON keys, fixed section order, no clock in the head (Manus).
- Keep the tool set fixed per thread: no dynamic skill-tool disclosure for orchestrators.

### 4.6 Workers differ
- **Lighter state.** A worker's opener holds:
  - its assigned task card(s) from `dag.json` (title, acceptance, dep outputs' paths, brief);
  - decisions linked to those tasks;
  - its own `write_todos` checklist, **rendered as text**, because `todoListMiddleware` never shows it (§1.5);
  - the last report it sent.
- **Summary sections:** task + acceptance · done so far · files touched · failed approaches · owner DMs (verbatim) ·
  next step.
- Workers never write `dag.json`. Their `report` tool lands in the lead's DAG and roster, and the runtime appends a
  `<state_delta>` to the lead's thread.

---

## 5. Mira (orchestrator over many projects)

Files under `.data/company/`:
- **`index.json`**: one row per project. Mira reads it; it is computed by code.
```json
{ "rev": 210, "projects": [
  { "pid": "p_42", "name": "Pricing page relaunch", "pm": "pm-p_42", "status": "active", "health": "yellow",
    "deadline": "2026-10-28", "progress": { "done": 4, "total": 9 }, "blocked": ["t7"],
    "ownerPending": ["Q-2"], "lastPmReport": { "at": "2026-10-17T18:00Z", "text": "copy blocked on tier names" },
    "spend": { "usd": 3.12, "budget": 15 }, "stateRev": { "dag": 57, "open": 12 } } ] }
```
  - Rollups are **recomputed by code** on every project state write. `health` comes from a rule: red if a blocker is
    older than 24h, the deadline is under 2 days with < 80% done, or spend is over 90%.
  - Mira never parses PM files in context. She gets `<project_delta pid rev>` lines at her tail when a project's
    status, health or owner-pending changes.
  - This avoids the Paperclip failure where the CEO re-read all company state each wake (57% of 313M tokens;
    C report F14).
- **`decisions.md`** (company level: budgets, staffing policy, which projects exist). Writer
  `record_decision(scope:"company")`. Same format as §3.2.
- **`owner.md`**: company-wide owner preferences, from 📌 in Mira's chat. Pinned in Mira's system prefix.
- **`inbox.json`**: all owner-pending items across projects (approval cards). Derived from each project's
  `open.json` (askOf owner) and pending decisions.
- **Relationship to PM files.**
  - PM files are the source of truth for their project. Mira has **read-only** access (`read_file
    /projects/<pid>/state/*` for drill-down).
  - Mira's only write path into a project is a message to the PM, or an owner decision she relays. The relayed
    decision is recorded in the project's `decisions.md` by the PM tool with the owner's `approvalRef`.
  - One writer per file.
- **Heartbeat.** It reads `index.json` revs changed since `lastHeartbeatRev` and answers QUIET or lists items. The
  cost is bounded by the number of changed rows, not the number of projects.

---

## 6. Compaction vs dreaming: the boundary

| | **Compaction** (in-session) | **Dreaming** (cross-session; D §3) |
|---|---|---|
| Unit | one thread's context window | one agent (all its threads) |
| When | token threshold (soft: idle post-turn; hard: inline) | `task_end` (10-min idle), nightly, `project_close`, `pressure` (D §3b) |
| Reads | the current window's messages, the previous summary, the project state files | `/conversation_history/*`, `windows/*.md`, `journal/*`, ledger (orders, approvals, acceptance), `notes.md`, current MEMORY.md / SOUL.md; at close also `dag.json` + archive and `decisions.md` |
| Writes | new opener in checkpoint state; `windows/<n>.md`; history offload; **only through state tools**: missing decisions/prefs/todos/questions that came up in the window (the "file before you forget" step) | MEMORY.md (validated ops: Done / Mistakes / Best approaches), `retro.md` and talent profile at project close. **Never** `dag.json` / `decisions.md` (project records are read-only to dreaming) and never the live context |
| Goal | keep *this* project running without loss | make the *agent* better on the *next* project |
| Model | the agent's own model, in-context (cached) | main model, background lane; Nemotron NOOP gate first (D) |

**How the decisions log and DAG feed dreaming at project close.** The code builds the dream bundle, each item with
an id the model must cite:
- every closed task with `acceptance`, `evidence`, `reopened` count, the owner reactions on its reports, and
  planned-vs-actual time;
- every decision, with its supersede chain;
- every question that took more than 24h to answer.

The dream turns these into PM-archetype MEMORY ops, for example:
- *Best approach:* "ask tier-naming questions before assigning copy (Q-2 blocked t7 for 20h)" [dag:t7, open:Q-2];
- *Mistake:* "D-003 was superseded in 1 day: get owner sign-off on scope before research" [dec:D-003→D-007].

Workers' memories are fed from their tasks' evidence and acceptance.

---

## 7. Loss detection (concrete mechanism)

1. **A must-survive set, computed by code before compacting** (not by the model):
   - open DAG ids with owner and blocker;
   - open `open.json` ids;
   - pending approvals;
   - **the ids of every owner message in the span**;
   - the ids of worker reports in the span;
   - file paths written or received in the span (from tool-call args and report refs). This answers Factory's
     "separate artifact index" finding: artifact trail was the weakest dimension for every method.
2. **Reconcile ("file before you forget").** An owner message or worker report counts as *filed* if some state
   entry's `source` points at it. The unfiled list goes into the compaction turn. The model must, for each item,
   either file it with a state tool or list it under §4.3-8 with a reason. **Code checks that every id is
   accounted for.** If one is missing, it runs one repair turn.
3. **Structure check.** All 9 section headers are present; size ≤ 1,500 tokens; any "approved"/"owner decided"
   claim carries a resolvable ledger ref, otherwise the claim is struck and flagged.
4. **Post-compaction self-quiz.**
   - A side call, never appended to the thread: the new context `[system, opener, tail]` plus 4 probes generated by
     code templates with known answers (Factory's recall / artifact / continuation / decision types):
     - *state probe:* "Who owns t7 and what is blocking it?" → must contain `ana` and `Q-2`;
     - *decision probe:* "Which decision governs annual billing?" → `D-007`;
     - *window probe:* "What was the owner's last instruction?" → must contain the key tokens of the newest owner
       message;
     - *continuation probe:* "What do you do next?" → must name the task/question from section 9 of the summary.
   - Thinking off, `max_tokens` 400, JSON answer. Scored by string and id match.
   - Pass = all state probes plus ≥ 1 of 2 window probes.
   - On failure: retry the compaction once with "you dropped: …". If it still fails, install anyway with a doubled
     tail, write a `compaction_degraded` ledger row, and add a line to Mira's heartbeat.
5. **State diff.** The file revs before and after compaction must differ only by the logged reconcile tool calls.
6. **Offline eval.** Replay recorded threads, force compaction at fixed points, run the probe suite, and track the
   mean score per release (Factory's method, using our own ledger).

---

## 8. Failure modes (with sources) and mitigations

| Failure | Source / evidence | Mitigation in this design |
|---|---|---|
| **Summary drift** over repeated compactions | Factory: regenerating from scratch lets details "drift or disappear across multiple compression cycles"; Anthropic harness: compaction "doesn't always pass perfectly clear instructions" | State files are the source of truth; the summary holds only what files can't; merged fixed sections (§4.3) |
| **Losing track of who owns what** | Cognition, "actions carry implicit decisions"; Magentic-One needs a per-step "next speaker" ledger | `owner` is a validated DAG field; the digest shows the owner per open task; `assign_task` is the only way to change it |
| **Stale DAG vs reality** | Copilot CLI: "If status is still 'in_progress', the sub-agent may have failed to update — investigate" (`copilot-cli.md:741-743`) | The runtime writes status from `report` and run events, not the PM. `in_progress` with no check-in for 2 heartbeats is flagged `stale?` in the digest and in Mira's index |
| **Todos rot / premature "done"** | Anthropic harness: a later agent "declare[s] the job done"; Claude Code TaskUpdate: never complete if tests fail | Todos live in the DAG; `done` requires evidence; untouched > 72h is flagged; project close requires every node done or dropped-with-reason |
| **Over-long state files** | Letta `chars_limit` per block; B notes: Hermes "memory is injected every turn, keep it compact" | Hard caps enforced by tools (60 open tasks, 25 active decisions, 20 open items, 40 prefs); archives; digest ≤ 4K |
| **Context poisoning carried through summaries** | Claude Code prompt: never attribute assistant-quoted "user:" text to the user (`compact.md`); Drew Breunig's "context poisoning" *(recalled)* | Owner approvals must resolve to ledger events; owner messages quoted verbatim by id; the reconcile check (§7.2) |
| **Error evidence erased** | Manus, "Keep the wrong stuff in" | Summary section 6 is mandatory; `failed` tasks keep their evidence |
| **Cache churn** | Manus KV-cache rules; Crusoe skill §8; Claude API "never written into the head" | One head rewrite per window; tail deltas; deterministic rendering |
| **Uncached, structure-losing summaries** | `summarization.ts:942-972` (fresh prompt, `getBufferString`) | In-context compaction turn (Codex `compact.rs:279`) |
| **Invisible plan after compaction** | `todoListMiddleware.ts:334-340` renders no state | Plan lives in the DAG digest; workers' todos rendered into their opener |
| **Compaction thrash / context anxiety** | Cognition (Devin, Sonnet 4.5) *(recalled)* | 24K minimum growth; threshold far below the window; no budget nags |

---

## 9. Concrete design

### 9.1 File tree and backends
```
.data/
  company/                         # disk (FilesystemBackend, mounted read-only at /company/ for Mira's FS tools)
    index.json  decisions.md  owner.md  inbox.json
  projects/<pid>/
    state/                         # disk; canonical; written ONLY by project-state.ts tools; FS mount /state/ read-only
      charter.md  dag.json  dag.archive.jsonl  decisions.md  roster.json  open.json  open.archive.jsonl
      prefs.md  journal/<n>.md  windows/<agentId>/<n>.md  retro.md (at close)
    files/                         # disk; /project/ shared deliverables (D); reports/<task>-<n>.md
  history/<agentId>/<pid>/         # disk; /conversation_history/ offload (D)
agents/<agentId>/SOUL.md MEMORY.md notes.md     # disk; /home/ (D)
checkpoints.sqlite                 # LangGraph SqliteSaver: messages, _summarizationEvent (window opener), todos
(StateBackend, per thread)         # scratch: /large_tool_results/, temp files
```

### 9.2 Lead tool list
| Tool | Args | Effect |
|---|---|---|
| `add_task` | `{title, kind, acceptance, owner?, deps?, milestone?, due?, detail?}` | new DAG node; validates acyclicity, owner, caps; returns `{id, rev, recite}` |
| `update_task` | `{id, expectedRev, status?, owner?, addDeps?, removeDeps?, blocker?, note?, evidence?}` | legal transitions only; `done` needs evidence; returns `{rev, recite}` |
| `assign_task` | `{id, agentId, brief}` | owner + `in_progress` + dispatch to the worker thread (D §5) |
| `record_decision` | `{title, decision, why, approvedBy, approvalRef?, supersedes?, links?}` | appends ADR; owner approval needs a real ledger ref or opens an approval card |
| `raise_item` / `resolve_item` | `{kind, text, askOf, links?, due?, severity?}` / `{id, resolution}` | open questions/risks; askOf owner → card |
| `note_owner_pref` | `{text, sourceRef}` | prefs.md bullet (sourceRef = owner msg or 📌) |
| `update_member` | `{agentId, pmNote?, blocker?}` | PM note on the roster (other fields are runtime-owned) |
| `log_progress` | `{line}` | journal line |
| `set_charter` | `{goal, metric, scope, outOfScope, qualifications, deadline, budget}` | behind `interruptOn` owner approval |
| (read) `read_file /state/...` | — | generic FS read; writes denied |
| Worker: `report` | `{taskId, status, summary, evidence[], blocker?}` | runtime → dag.json, roster.json, reports file, `<state_delta>` to the lead |

### 9.3 Context layout
See the diagram in §4.1. Order: system (role, tools, SOUL+MEMORY, charter) → window opener (digest + merged
summary + pointers) → append-only history → tail deltas and recite lines.

### 9.4 Compaction algorithm (our `SummarizationMiddleware` replacement)
1. After each model response, read `usage.input_tokens`. If it is ≥ SOFT and window growth ≥ 24K, set
   `compactDue`. Compact when the agent goes idle (post-turn, background lane). If it is ≥ HARD, compact before the
   next model call. Never compact while an AI tool call is waiting on its results.
2. Choose the cutoff: keep a tail of up to 8K tokens (workers: 16K), starting at a safe point (`findSafeCutoffPoint`
   logic).
3. Code computes the must-survive set and the **unfiled** list (§7.1-2).
4. Append a `<compaction window=n>` HumanMessage to the **current** effective messages, so system + tools + history
   are a cached prefix. It carries the checklist (§4.3), the previous summary and the unfiled list. Only state tools
   are allowed, ≤ 2 tool rounds, executed by the middleware itself. Then the summary text.
5. Validate: sections present, size cap, every unfiled id filed or justified, approval claims backed by ledger refs.
   Otherwise one repair turn.
6. Persist `windows/<agent>/<n>.md` and append the cut span to `/conversation_history/` (as deepagents does).
7. Render the new opener deterministically from the state files *now*: digest + merged summary + pointers.
8. Install `_summarizationEvent = {cutoffIndex, summaryMessage: opener, filePath}`. The compaction turn falls before
   the cutoff and leaves the live context.
9. Self-quiz side call on `[system, opener, tail]` with 4 code-generated probes; score by code.
10. On a failed quiz, retry steps 4-8 once with the misses listed. If it still fails, install with a doubled tail
    and write a `compaction_degraded` ledger row plus a heartbeat item.
11. Ledger row `{t:"compaction", agent, thread, window:n, tokensBefore, tokensAfter, cachedInCompaction,
    probeScore, unfiled, filed, ms, usd}`.
12. Until the next compaction, deliver every outside state change as an appended `<state_delta rev>` line, and
    never re-render the opener.

---

## 10. Build order (each step has a test that fails when the code is wrong)

1. **`project-state.ts` + state tools** (dag, decisions, open, roster, prefs, journal; atomic write, rev, SSE).
   *Test:* a cycle is rejected; `done` without evidence is rejected; an owner not in the roster is rejected; a stale
   `expectedRev` is rejected; `approvedBy:"owner"` without a real ledger approval is rejected; the same state
   renders byte-identically twice; the Plan panel fixture renders `t7` as blocked under `ana`.
2. **Worker `report` → runtime writes + lead `<state_delta>`.**
   *Test:* a scripted worker reports `blocked` on t7 with `on:"Q-2"`. Then `dag.json` t7 is `blocked`, roster `ana`
   has the blocker, and the lead thread's last message is the delta line. A PM tool call trying to set
   `lastReport` is refused.
3. **Window opener + replacement `SummarizationMiddleware`, triggered on `usage.input_tokens`.**
   *Test (real Crusoe):* a 12-turn replay with a mid-window DAG change. From turn 3 on,
   `cached_tokens / prompt_tokens ≥ 0.8`, and it does not drop after the delta. The effective messages start with
   the opener, and the cutoff never splits a tool pair.
4. **Compaction turn with reconcile + validation + install.**
   *Test:* force a compaction (SOFT = 1) on a 40-turn transcript where the owner said "use Stripe, not PayPal" and
   the PM never filed it. Afterwards `decisions.md` (or `prefs.md`) has an entry whose `source` is that owner
   message, or the summary's "Transient" section names it with a reason. Removing the reconcile step makes this
   test fail.
5. **Self-quiz + degraded fallback + ledger row.**
   *Test:* after a forced compaction the lead answers **"who owns task 7 and what is blocking it"** with `ana` and
   `Q-2`, matching `dag.json`. Mutation check: dropping the TEAM/PLAN section from the digest renderer makes the
   probe fail and produces a `compaction_degraded` row.
6. **Mira index rollups + dreaming hooks at project close.**
   *Test:* closing p_42 sets `index.json` to status `done`, progress 9/9 and health green. The project-close dream
   bundle lists every closed task with evidence and every superseded decision, and each resulting MEMORY op cites a
   `dag:`/`dec:` id. The validator rejects an op with no citation.

---

## Self-check (audit against coverage and bar)
| Item | Verdict | Evidence |
|---|---|---|
| 1 Deep Agents today (trigger, keep, prompt, placement, eviction, todos/files survival, customization) with path:line + version | PASS | §1, `DA:` = deepagents@1.15.1 lines; `LC:` = langchain@1.5.18 |
| 2 ≥ 8 prior-art systems, all with citations | PASS | 14 rows; unverified details marked *(recalled)* |
| 3 Every state file has a format sample, writer tool, update trigger, size rule, pinned/on-demand | PASS | §3.1-3.8 (charter, dag+todos, decisions, roster, open, prefs, journal, windows) |
| DAG feeds the Plan and Team panels | PASS | §3.1 UI, §3.3 |
| 4 Layout order, trigger justified with numbers, summary checklist, re-injection, cache, workers | PASS | §4.1-4.6; TPM/cost/quality table |
| 5 Mira's state and its relation to PM files | PASS | §5 |
| 6 Compaction vs dreaming boundary, and DAG/decisions feeding dreaming | PASS | §6 table + close bundle |
| 7 Loss detection is a concrete mechanism | PASS | §7: must-survive set, reconcile, quiz, diff, offline eval |
| 8 Failure modes with sources | PASS | §8 table |
| 9 File tree + backends, tool list, layout, ≤ 12-step algorithm | PASS | §9.1-9.4 (12 steps) |
| 10 ≤ 6 build steps, each with a test | PASS | §10 |
| No invented APIs; local-first; no re-coverage | PASS | New tool names are proposed and labeled as ours. Disk/SQLite only. Runtime wiring defers to D |
| UNVERIFIED items stated | PASS | Whether cached tokens count toward TPM (D); recalled prior-art details are marked |
