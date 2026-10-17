# G. Versioning the agent files, and the lineage graph

Research agent G, 2026-10-17. Scope: git-backed version history for every agent-facing file (SOUL, MEMORY, notes,
skills, the lead's state files, Mira's company files), and a lineage graph showing how a new agent's memory and
skills derive from past agents. Inputs taken as given: `docs/design/team-setup.md` §2, §4, §5, §6, §8b;
D §3b and §10 (dream ops, `memories` and `dreams` tables, `seeded_from_agent_id`); F §3 and §9 (state files, the
`project-state.ts` writer and the lead's tools); E §4 and §6 (labels, R4 project boundary, T2 memory tier, E5 memory
sink).

**Sources and versions (verified this session).**
- `git` 2.39.5 (Apple Git-154, `/Library/Developer/CommandLineTools/usr/bin/git`); `git commit -h` lists
  `--trailer`; `%(trailers:key=…,valueonly,separator=…)` and `git interpret-trailers --parse` run correctly
  (checked in `/tmp/gbench/r-cli`).
- `isomorphic-git@1.44.3` (npm latest, published 2026-10-17), `simple-git@4.0.2` (2026-09-26), `diff@9.0.0`
  (jsdiff), `@xyflow/react@12.12.0`. I installed the first three into `/tmp/gbench/` and read their `.d.ts` files.
  Signatures quoted below come from `node_modules/isomorphic-git/index.d.ts`,
  `node_modules/simple-git/dist/src/typings/simple-git.d.ts` and `node_modules/diff/libesm/index.d.ts`.
- Benchmarks: `/tmp/gbench/bench.mjs`, `b3.mjs`, `b4.mjs` on this Mac (Node 24.1.0), 350-commit repo, 20 files.
- `git-filter-repo`: manual at `github.com/newren/git-filter-repo/blob/master/Documentation/git-filter-repo.txt`
  (needs git ≥ 2.36 and python3 ≥ 3.6). It is **not installed** on this machine. License shows as "Other" on GitHub,
  so the exact terms are **UNVERIFIED**.

---

## 1. Prior art (11 systems)

| # | System | What is versioned | Mechanism | How history and diffs reach the user | What we take |
|---|---|---|---|---|---|
| 1 | **Letta Code MemFS / Context Repositories** ([docs](https://docs.letta.com/concepts/memfs), [blog 2026-02-12](https://www.letta.com/blog/context-repositories/), [`letta_root_memfs.md`](https://github.com/letta-ai/letta-code/blob/main/src/agent/prompts/letta_root_memfs.md)) | The whole memory folder: `system/*.md` (always in context), deeper files, `skills/`, `MEMORY.md` index | **One git repo per agent.** "Every memory edit is committed to the MemFS git repository." Agent commits with `git commit --author="$name <$AGENT_ID@letta.com>" -m "<type>: <what changed>" -- <specific files>` ("never `git add -A`"). A pre-commit hook validates frontmatter and blocks `read_only` files. Reflection subagents work in **worktrees on branch `letta/reflection/<id>`** and merge back; on conflict they abort and retry later (D-dreaming-notes §1). | `/memory` in the CLI, or `git -C $MEMORY_DIR log` by hand. No diff UI. Defragmentation backs up the repo first. | Conventional subjects; author = the agent; commit only explicit paths; a hook as the validation point. We **don't** copy per-agent repos or worktrees (§2). |
| 2 | **Svod** ([FleetQ/svod-engine](https://github.com/FleetQ/svod-engine), v1.5.0) | Markdown + YAML notes in a vault | One git repo (jgit). **"One serialized writer"**; "Revision = git blob hash": a write with a stale revision gets a structured `conflict`, never a silent overwrite. Notes carry `status`, `superseded_by`, `expires_at`. Deletes go to `.trash/` and are committed. The index "self-heals against git `HEAD`". | `history`, `diff`, `get_revision` and `graph_query` tools; a local HTTP API; conflicts carry `base/ours/theirs` for a 3-way UI. | A single writer queue; the blob hash as the optimistic-concurrency token; the index as a rebuildable projection of git. |
| 3 | **Palinode** ([phasespace-labs/palinode](https://github.com/phasespace-labs/palinode/)) | Typed Markdown memory files | Git-versioned files plus a SQLite FTS5/vec index. Compaction: the LLM proposes **KEEP/UPDATE/MERGE/SUPERSEDE/ARCHIVE** ops and a deterministic executor applies them; "every compaction is a git commit". | `history` (git log with diff stats and renames), `blame`, `trace` ("a fact's full provenance lineage: sources, saved/changed commits, supersession"), `rollback` ("safe, creates new commit"). | It matches our dream ops. Restore = a new commit. A per-fact `trace` view. |
| 4 | **gitmem** ([josephy02/gitmem](https://github.com/josephy02/gitmem)) | An append-only JSONL event log in git | "Nothing is ever mutated or deleted: corrections and retractions are new events that supersede old ones." Projections are pure functions of the log, and "`gitmem rebuild` is byte-identical to an incremental build — that's a test." Conflicts are "surfaced, never auto-resolved". | `trace <id>` gives the derivation ancestry; `git blame` and `git diff`. | **Rebuild equals incremental, enforced as a test** (our V4 test). Merges of contradicting parents are surfaced, not auto-resolved. |
| 5 | **Memoria** ([matrixorigin/Memoria](https://github.com/matrixorigin/Memoria/), arXiv 2604.03927) | Memory rows in MatrixOne (copy-on-write DB) | Snapshot, branch, merge and rollback over database storage. | `memory_diff` previews a merge; `memory_rollback`. | The idea of branching to experiment. We don't need it: dreams compute ops off-tree, then apply under the queue. |
| 6 | **Zep Graphiti** ([repo](https://github.com/getzep/graphiti), [`edges.py`](https://github.com/getzep/graphiti/blob/main/graphiti_core/edges.py), [blog](https://www.getzep.com/blog/beyond-static-knowledge-graphs/)) | A temporal knowledge graph of entities, edges (facts) and episodes | **Bi-temporal edges:** `valid_at`/`invalid_at` (world time) and `created_at`/`expired_at` (system time). A contradiction sets `invalid_at` and `expired_at` on the old edge and creates a new one. Facts are "invalidated — not deleted". Each edge lists the `episodes` it came from. | Search returns all four timestamps; point-in-time queries. | The four time columns on our lineage nodes and edges. Supersede, never delete. `episodes` maps to our `evidence_of` edges. |
| 7 | **Mem0 memory history** ([API](https://docs.mem0.ai/api-reference/memory/history-memory)) | Each memory item | A history row per change: `event` ∈ `ADD/UPDATE/DELETE`, `old_memory`, `new_memory`, `input` (the conversation that caused it), `agent_id`, `session_id`, `created_at`. | `client.history(memory_id)` returns the item's timeline. | The **per-item timeline** (old → new, why, which run) as the default view of a memory's history. |
| 8 | **Dolt** ([system tables](https://www.dolthub.com/docs/sql-reference/version-control/dolt-system-tables/), [agentic workflows](https://www.dolthub.com/blog/2025-03-17-dolt-agentic-workflows/)) | SQL tables (rows and schema) | A git-style commit graph over Prolly trees. `dolt_history_$t` gives a row's value at every commit; `dolt_diff_$t` gives one row per change; `dolt_log`; branch-per-task. | History and diffs **are SQL tables**, so a custom React UI is just a query. | Our SQLite index exposes history as plain tables (`vault_commits`, `vault_files`) so the UI never shells out to list history. We **don't** adopt Dolt: it is a server plus a binary, our content is Markdown, and it would be a second database. |
| 9 | **Anthropic memory tool** ([docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool), [Python `BetaLocalFilesystemMemoryTool`](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/lib/tools/_beta_builtin_memory_tool.py)) and **Claude Code memory** ([docs](https://code.claude.com/docs/en/memory)) | `/memories/*` files (the client stores them); Claude Code's `MEMORY.md` index and topic files | Client-side: `view/create/str_replace/insert/delete/rename`. The reference implementation uses atomic temp-file writes, path-traversal and symlink-escape checks, and `clear_all_memory`. **No versioning**: history is left to "storage you control". Claude Code stamps a `modified` frontmatter field and lets the user edit through `/memory` (D-dreaming-notes §4). | None built in. | Confirms that versioning is ours to add at the storage layer. We copy the atomic write and the path validation. |
| 10 | **OpenClaw** ([memory architecture](https://docs.openclaw.ai/concepts/memory-architecture), [dreaming](https://docs.openclaw.ai/concepts/dreaming), [backup](https://docs.openclaw.ai/cli/backup)) | `MEMORY.md`, `USER.md`, daily notes; SQLite state | Dreaming is the **one primary writer**. Rewrites use a **content hash re-checked before an atomic rename** (abort on change). "The pre-image of every accepted rewrite is stored" in SQLite, and `DREAMS.md` gets "short diff-style highlights". `doctor` "prints a backup tip if the workspace is not already under git". `openclaw backup git` dumps SQLite to per-table JSONL in a git repo and warns that "Git history is durable", with an `--exclude-secrets` mode. `memory forget` purges by provenance, including "rewrite backups". | Dreams UI and the `DREAMS.md` diary; there is no per-file git history. | The hash check before rename (we use blob shas). A dream summary card with highlights. A forget that also scrubs derived stores and backups. |
| 11 | **Hugging Face model tree** ([model cards](https://huggingface.co/docs/hub/en/model-cards#specifying-a-base-model), [hub-docs #1410](https://github.com/huggingface/hub-docs/issues/1410)) and **MLflow / Unity Catalog lineage** ([MLflow registry](https://mlflow.github.io/mlflow-website/docs/latest/ml/model-registry.md), [UC lineage](https://learn.microsoft.com/en-us/azure/databricks/data-governance/unity-catalog/data-lineage), [UC model lineage](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/manage-model-lifecycle/)) | Model ancestry (HF); model version → run → dataset (MLflow/UC) | HF: `base_model` is "a single model ID, or a list" (a list means a merge, i.e. **multiple parents**). `base_model_relation` ∈ `adapter/merge/quantized/finetune` (inferred by the Hub, overridable). API: `?expand=baseModels`. MLflow: "each registered model version is linked to the MLflow run … that produced it". | HF: a "Model tree" sidebar on the model page (base model, then counts per relation), with filters like `base_model:finetune:<id>`. UC: a **Lineage tab**, then "See lineage graph", "one level is displayed … click the icon on a node to reveal more", and edge click → "Lineage details panel". | **Typed parent edges with multiple parents** (HF). A lineage tab plus an expandable graph with an edge-details panel (UC). A version page that links to the producing run (MLflow). |

Also cited for mechanisms: Gerrit's `Change-Id` trailer, a stable id that survives rewrites
(`https://gerrit-review.googlesource.com/Documentation/user-changeid.html`, known reference, not fetched this
session). I found DiffMem ([Growth-Kinetics/DiffMem](https://github.com/Growth-Kinetics/DiffMem), "Git Based Memory
Storage for Conversational AI Agent", 904★) but didn't read its internals in the time budget.

**Convergent pattern (≥ 4 systems: Letta, Svod, Palinode, gitmem, OpenClaw):** Markdown is the source of truth; git
holds history; **one serialized writer**; LLM output is **ops applied by code**; every consolidation is one
reviewable commit; restore creates a new commit; a search/graph index is rebuilt from the files. Nobody in this set
ships a per-item, multi-parent **lineage across agents**. HF's model tree is the closest analogue, and that's the
part we add.

---

## 2. Git mechanism

### 2.1 Recommendation: one vault repo at `.data/vault/`, separate from the app repo

```
.data/vault/                         # `git init -b main`; never pushed by default; .data/ is already gitignored
  .git/                              # hooksPath → empty dir; gc.auto=0 (we run maintenance nightly)
  VAULT.md                           # what this is + "vault-schema: 1"
  agents/<agentId>/
    agent.json                       # identity + config snapshot: archetype, model tier, skills [{name, track|pin}], parents
    SOUL.md  MEMORY.md  notes.md  PROFILE.md
    projects/<pid>.md                # project-scoped memory moved here at project close (D §3b)
    skills/<name>/SKILL.md           # agent-owned or inherited (copied) skills
  skills/<archetype>/<name>/SKILL.md # shared archetype skills (owner-curated; agents "track" or "pin" them)
  projects/<pid>/state/              # F §9.1, unchanged file set
    charter.md dag.json dag.archive.jsonl decisions.md roster.json open.json open.archive.jsonl prefs.md journal/<n>.md retro.md
  company/                           # Mira (F §5)
    index.json decisions.md owner.md
NOT in the vault (stay where F/D put them): projects/<pid>/files/ (deliverables), projects/<pid>/state/windows/
(compaction records = transcript-derived), company/inbox.json (a volatile queue), history/ (conversation offload),
runtime.db, checkpoints.sqlite, ledger.jsonl.
```

**Why one vault and not per-agent repos (Letta's choice) or refs per agent:**

| | One vault (**chosen**) | Repo per agent (Letta) | One repo, a branch/ref per agent |
|---|---|---|---|
| Cross-agent inheritance | A copy inside one object DB. The parent's exact state is `git show <sha>:agents/pip/MEMORY.md`. | Cross-repo references; the parent sha isn't resolvable from the child repo without fetching | Each branch carries the **whole tree** (every agent, every project), so a "fork" forks everything |
| Files that belong to no agent (project state, company) | Live naturally | Need yet another repo | Which branch gets `dag.json`? Merges needed |
| Atomic multi-file change (`report` → dag.json + roster.json; a seed touching child + provenance) | One commit | Impossible across repos | Merge commits |
| Lineage index / graph queries | One `git log` to index | N logs | One log, but non-linear |
| Writer queue, gc, forget-rewrite | One each | N each | One, but rewriting must handle all branches |
| Portability of one agent ("travels with you") | `git log -- agents/pip/` or `git filter-repo --path agents/pip/` into an export | Native | — |

Letta needs per-agent repos because its agents are cloud-hosted and portable across machines. Ours live in one local
company and inherit from each other, so one repo wins on every row that matters here.

**Separate from the app repo** because the app repo holds code history and is pushed to GitHub, while the vault holds
private knowledge and is never pushed by default. A forget-rewrite must not touch code history. `.data/` is already
gitignored (`.gitignore`, "performance ledger" block). Migration: on first boot the runtime copies the tracked
`agents/mira/{SOUL,MEMORY}.md` into the vault as the first commit (`Source: seed`). From then on
`src/lib/agent-files.ts` `ROOT` points at `.data/vault/agents`, and the checked-in `agents/` becomes templates only.

### 2.2 Library: the `git` CLI via `execFile`, with a ~150-line typed wrapper

| Option (verified version) | Commit | Log for a path | Diff between commits | Ref from a commit | Trailers | Rewrite / gc | Measured |
|---|---|---|---|---|---|---|---|
| **git CLI 2.39.5** via `node:child_process.execFile` (**chosen**) | `git add -A -- <paths>` then `git commit -q -F - --author="Pip <pip@agents.agent-teams.local>"` (message on stdin) then `git rev-parse HEAD` | `git log --format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%(trailers:unfold,only,separator=%x1d)%x1e -- <path>` | `git diff --no-color --no-ext-diff -U3 <a> <b> -- <path>`; `--word-diff=porcelain` for prose; `git show <sha>:<path>` for each side | `git tag agent/pip/v3 <sha>` · `git update-ref refs/… <sha>` · `git branch <name> <sha>` | Native: `--trailer`, `%(trailers:key=Agent,valueonly)`, `git interpret-trailers --parse` (all run locally) | `git filter-repo` (external), `git gc`, `git commit-graph write --reachable --changed-paths`, `git log -S` (pickaxe) | commit (one spawn, tracked file) **25 ms**; spawn **7.8 ms**; path log with trailers, 350 commits: **82 ms → 18 ms after `commit-graph --changed-paths`**; diff **15 ms** |
| `isomorphic-git@1.44.3` (pure JS) | `commit({fs, dir, message, author, committer?, parent?, tree?, ref?, noUpdateBranch?, disallowEmpty?, dryRun?})` after `add({fs, dir, filepath})` | `log({fs, dir, filepath, ref?, depth?, since?, follow?, includeChanges?, force?})` | No text diff: `walk({fs, dir, trees:[TREE({ref:a}), TREE({ref:b})], map})` + `readBlob({fs, dir, oid, filepath})` + jsdiff | `branch({fs, dir, ref, object, checkout?, force?})` · `writeRef({fs, dir, ref, value, force?, symbolic?})` | None; we would parse the message ourselves | No gc/repack, no filter-repo; `merge` "will fail if multiple candidate merge bases are found" and "it is not possible to abort" (d.ts) | add+commit **17.7 ms**; `log({filepath})` at 300 commits **582 ms** (7× slower than CLI before commit-graph, 32× after) |
| `simple-git@4.0.2` (wraps the git binary) | `commit(message, files?, options?)` | `log({file, format, maxCount, …})` | `diff(options)` · `raw([...])` | `branch`, `raw(['tag', …])` | Through `raw` and a custom `format` | Through `raw` | Same as CLI plus a wrapper. Default `maxConcurrentProcesses: 5`, which is exactly the parallelism a writer must not have |

**Why the CLI:** it is the only option with native trailer formatting and parsing, path-limited log with Bloom
filters (`--changed-paths`), the pickaxe search (`-S`) that forget needs, `gc`, and `filter-repo`. The git binary
is already a fact of life on the owner's Mac (Apple CLT ships 2.39.5). simple-git adds a dependency whose parsing we
would override anyway. isomorphic-git is the **fallback** for an environment without git (for example the `VERCEL`
branch in `agent-files.ts`): commit-only mode, history listed from the SQLite index, no forget. It isn't built now.

**Wrapper rules (`vault/git.ts`):**
- Resolve the real binary once at boot (`xcrun --find git` on macOS). The `/usr/bin/git` shim adds about 21 ms per
  spawn (measured 28.8 vs 7.8 ms).
- Require `git --version` ≥ 2.36 (filter-repo's floor).
- Run every call with `cwd = .data/vault` and env `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`,
  `GIT_TERMINAL_PROMPT=0`, plus `-c core.hooksPath=<empty dir> -c commit.gpgsign=false -c core.autocrlf=false`.
  This keeps the user's global hooks, signing and fsmonitor out of the vault.
- `maxBuffer` 64 MB; log output is streamed for reindex (`spawn`, not `execFile`).

### 2.3 Concurrency: one in-process writer queue + blob-hash preconditions

- **`VaultWriter`** is a FIFO queue on the runtime singleton (D §10 `getRuntime()`), one job at a time. Each job is
  `{ writes: {path, content | null}[], expect?: {path: blobSha | "absent"}[], author, subject, body?, trailers }`.
  Steps inside a job:
  1. check `expect` against `git rev-parse HEAD:<path>` **and** the working-tree hash (`git hash-object <path>`);
  2. scrub (§6);
  3. write each file to `*.tmp`, then `rename`;
  4. `git add -A -- <paths>`, then `git commit -F -`, then `rev-parse`;
  5. index (§5) in one SQLite transaction.

  Only the queue stages, so the index holds exactly this job's paths.
- **Preconditions replace mtime checks.** D §3b guardrail 7 ("owner edits win" via mtime) becomes `expect`: the
  dream captured MEMORY.md's blob sha when it gathered input. A mismatch fails the job with `conflict`, the dream
  re-runs later, and the owner's edit wins. This is Svod's "revision = blob hash" and OpenClaw's hash re-check.
  F's `update_task({expectedRev})` keeps its own `rev`, which is checked inside `project-state.ts` before it
  enqueues.
- **No worktrees and no merges.** Letta uses worktrees because its reflection agent edits files for minutes. Our
  dream computes ops *off-tree* and applies them in milliseconds under the queue, so there is nothing to merge.
- **Cross-process safety.**
  - git's own `.git/index.lock` remains the backstop. On `index.lock` exists: retry 3× with 50/100/200 ms backoff.
    At boot, delete a lock older than 60 s.
  - The owner using `git` by hand in the vault is allowed. A sweep (boot, then every 10 min) runs
    `git status --porcelain` and commits stray edits as `Source: external` (author "Owner (external edit)").
- **Crash safety.** Before step 3 the job is inserted into `vault_jobs(status='pending', job_json)`. At boot:
  - pending jobs with a dirty tree are committed with their stored message;
  - pending jobs with a clean tree are marked done;
  - `vault_meta.last_indexed_sha ≠ HEAD` triggers incremental indexing.

### 2.4 Commit granularity (recommended, with numbers)

| Writer | Commit unit | Why |
|---|---|---|
| Dream apply | **one commit per dream** (all ops + `notes.md` truncation) | The dream is the unit of undo ("Pip learned 2 things · Undo", Q8) |
| Lead state tools (F §9.2), worker `report` | **one commit per tool call**; `report` = one commit across dag.json + roster.json | Each call is one decision with its own *why* and `rev`. Per-run commits would mix 10 reasons and make "restore t7" impossible. A crashed run would leave edits uncommitted. |
| Owner UI save (Soul / Memory tab), 📌 | one commit per save | Owner intent is the unit |
| `append_note` (worker hot path) | coalesced: **one commit per run** for `notes.md` (`Tool: append_note ×N`) | Notes are scratch input to dreams; per-append commits are noise |
| Mira `index.json` rollups | only on content change, at most 1 per 10 min (`Source: rollup`) | Code-computed and low value per change |
| Skill edits, seeding, restore, forget | one commit each | — |

**Cost.**
- Estimate: 10 agents and 3 live projects make about 300–500 commits a day, so ~150K a year. At 25–40 ms per commit
  that is 8–20 s of git time per day.
- Throughput ceiling: ~30 commits/s serialized. We expect < 1/s at peak.
- Repo size: the 350-commit bench repo is 6.0 MB of loose objects. Nightly `git gc --quiet` packs it;
  `git commit-graph write --reachable --changed-paths` keeps path logs fast.
- The history UI lists from SQLite, not `git log`, so list cost doesn't grow with history. Path-log latency at 150K
  commits is **UNVERIFIED** (only measured at 350).

---

## 3. Commit conventions

**Author** is the actor: `Pip <pip@agents.agent-teams.local>`, `Pip (dream) <pip@agents.agent-teams.local>`, or
`Owner <owner@agent-teams.local>`. We never use the owner's real email, because the vault may be exported.
**Committer** is always `Agent Teams runtime <runtime@agent-teams.local>`. **Subject** is written by code from a
template (`<type>(<scope>): <summary>`). Types are `memory`, `soul`, `state`, `skill`, `agent`, `company`, `restore`,
`forget` and `sweep`. **No model-written text goes in the subject or trailers.** Content lives only in files, which
keeps the forget surface to blobs (§6).

**Trailers** (a final paragraph of `Key: value` lines, parsed with `%(trailers:unfold,only)`; order is free; keys
can repeat):

| Key | Value grammar | Required on |
|---|---|---|
| `Change` | `c_<ulid>`, a stable change id that survives rewrites (Gerrit Change-Id analogue). **All cross-references use it, never a sha.** | every commit |
| `Vault-Schema` | `1` | every commit |
| `Source` | `dream \| pin \| owner \| tool \| report \| seed \| skill \| restore \| forget \| external \| recovery \| rollup \| system` | every commit |
| `Agent` | subject agent id whose `agents/<id>/**` changed (repeat if several) | agent files |
| `Project` | `p_…` scope of the change (the item's or file's project) | state files; project-scoped memory |
| `Run` | run id (uuid7 = LangSmith run id, D §10) | writes made during a run |
| `Dream` | `d_…` | `Source: dream` |
| `Tool` | tool name, optionally `×N` | `Source: tool \| report` |
| `Task` / `Rev` | DAG task id / F's monotonic `rev` after the write | dag.json writes |
| `Op` | `<add\|update\|retire\|merge\|forget> <itemId> [<section>] [ev=<id>,<id>]` | every MEMORY/PROFILE item change (dream, owner, seed) |
| `Evidence` | comma list of evidence ids (`msg:<thread>:<idx>`, `led:<at>/<t>`, `asg:<id>`, `note:<n>`, `file:<path>`) | dream, report, `done` transitions |
| `Seeded-From` | `<agentId>@v<n> <changeId>` | `Source: seed` (one per parent) |
| `Derived-From` | `<newItemId> <- <agent>:<itemId>[ + <agent>:<itemId>…]` or `skill:<name> <- <path>@v<n>` | seed; cross-agent copies |
| `Held-Back` | `<agent>:<itemId> <reason>` (e.g. `project:p_bluebird`, `cap`, `conflict`) | seed (partial inheritance) |
| `Skill` | `<path>@v<n> <blobShort> [pin\|track]` | skill edits, pins |
| `Supersedes` | `D-007 -> D-003` (decisions) | `record_decision` with `supersedes` |
| `Approved-By` | `owner <approvalId \| ledgerRef>` | gated writes: `propose_soul`, cross-project memory, `set_charter`, seed with held-back overrides |
| `Restores` / `Reverts` | `<changeId>` | restore / undo |
| `Forget` | `<requestId> <itemId…>` | forget |
| `Labels` | data-class labels on the changed content, e.g. `project:p_42, pii.email` (never values) | when the label set is non-empty |
| `Redacted` | count of scrub replacements (never the value) | when > 0 |

**Who commits, and when:**
- dream apply (end of `dream()`, D §3b);
- 📌 handler (`addStandingInstruction`);
- owner UI saves (`writeAgentFile`, the Soul/Memory tab);
- every lead state tool and worker `report` (inside `project-state.ts`, after validation);
- `append_note` (at run end);
- skill edits (owner, or an agent-local skill tool);
- provisioning and seeding (`POST /api/projects`, S3);
- `propose_soul` approval (the approval handler);
- Mira rollups;
- restore, undo and forget (the UI);
- the external sweep.

**Example 1: a dream (2 ops + 1 retire).**
```
memory(pip): learn 2, retire 1 after task t7

Dream d_01JA7Q2 (task_end) over a:pip:p:p_42 messages 118-164.

Change: c_01JA7Q2X8KJ3
Vault-Schema: 1
Source: dream
Agent: pip
Project: p_42
Dream: d_01JA7Q2
Run: 0192f3a1-7c2e-7b1a-9d40-5e0c6f1a2b33
Op: add m_91c2 approach ev=asg:41,led:2026-10-17T14:02:11Z/order
Op: update m_7f3a approach ev=msg:a:pip:p:p_42:131
Op: retire m_33d0 mistake ev=led:2026-10-17T14:20:03Z/decline
Evidence: asg:41, led:2026-10-17T14:02:11Z/order, msg:a:pip:p:p_42:131, led:2026-10-17T14:20:03Z/decline
Labels: project:p_42
```
Author `Pip (dream) <pip@agents.agent-teams.local>`; files `agents/pip/MEMORY.md`, `agents/pip/notes.md`.

**Example 2: a lead state tool.**
```
state(p_42): t7 in_progress -> done

Change: c_01JA7R0M2QF9
Vault-Schema: 1
Source: tool
Tool: update_task
Project: p_42
Run: 0192f3b8-11aa-7c3d-8e2f-0a9b8c7d6e5f
Task: t7
Rev: 57
Evidence: asg:41, file:projects/p_42/files/reports/t7-2.md
```
Author `Ada <ada@agents.agent-teams.local>` (the PM); file `projects/p_42/state/dag.json`.

**Example 3: hiring from two parents with a project filter (partial and multi-parent).**
```
agent(nova): hire researcher from pip@v3 + rex@v2

Seeded 9 memory items and 2 skills for p_57; 3 items held back.

Change: c_01JA8B6T4W1N
Vault-Schema: 1
Source: seed
Agent: nova
Project: p_57
Approved-By: owner apr_88
Seeded-From: pip@v3 c_01J9ZK5R2C7A
Seeded-From: rex@v2 c_01J8QQ0H6D2E
Derived-From: m_a101 <- pip:m_7f3a
Derived-From: m_a102 <- pip:m_91c2 + rex:m_5e10
Derived-From: m_a103 <- rex:m_0b77
Derived-From: skill:research <- skills/researcher/research@v5
Derived-From: skill:sql-notes <- agents/rex/skills/sql-notes@v2
Skill: skills/researcher/research@v5 3c1d9e2 pin
Held-Back: pip:m_44b1 project:p_bluebird
Held-Back: pip:m_45c0 project:p_bluebird
Held-Back: rex:m_0c12 conflict
```
(Six more `Derived-From` lines are elided.) Author `Ada`; files `agents/nova/{agent.json,SOUL.md,MEMORY.md}` and
`agents/nova/skills/sql-notes/SKILL.md`.

---

## 4. Inheritance and initiation

**Model: copy plus per-item provenance, in one seed commit. No git fork/branch per agent.** The child's files live at
a different path (`agents/nova/`). A git branch would fork the whole vault and a merge commit would merge whole
trees, so a fork would *look* like lineage without meaning it. HF's model tree shows that **typed edges with a
parent list** are the right representation. Our parents' exact states stay addressable because every
`Seeded-From` names a change id, which resolves to a sha on our single `main` (an ancestor of the seed commit), and
`git show <sha>:agents/pip/MEMORY.md` reproduces what Pip knew then.

**Agent versions.** An agent version `agentv:<id>@<n>` is cut when any of these happens:
- the agent is hired or seeded (v1);
- a `project_close` dream writes PROFILE.md;
- a SOUL change is approved;
- the owner clicks "Save version".

Each one is mirrored as a lightweight tag `agent/<id>/v<n>` (`git tag agent/pip/v3 <sha>`), so
`git log agent/pip/v2..agent/pip/v3 -- agents/pip/` answers "what did Pip learn between versions". A rehire (Q3,
same identity) adds a version and never creates a child. A child exists only when the PM (S2) chooses **create
from**.

**Seeding algorithm (`vault/lineage.ts seedAgent`), all code with no model call:**
1. **Pick parents** (the PM's staffing step, S2): 1–3 source agent versions, chosen by the PM from the library.
   Each one is stored as `{agentId, version, changeId}`.
2. **Collect candidates:** each parent's active items from the index at that version (`memories` rows valid at the
   version's commit), plus its agent-local skills.
3. **Apply the boundary filter (E §6 R4, E5).** By default only items with `project_id = null` (global/PROFILE) pass.
   An item labelled `project:<x>` would flow into a new agent, which is the sink `memory:global`/`project:<new>`. It
   goes to the launch card as "3 items mention Bluebird: include?" (R4 is `ask`; a `block` rule such as E §5 example
   5 makes it non-includable). Excluded items become `Held-Back: … project:<x>`.
4. **Dedup and merge across parents:** D §3b guardrail 2 (token-Jaccard ≥ 0.8, same section). A merged item gets
   one new id and `Derived-From` with **both** parents (`m_a102 <- pip:m_91c2 + rex:m_5e10`). Its evidence is the
   union of the parents' evidence ids, carried as references. **Contradictions** (same section, high overlap,
   opposite polarity, or the owner flagged a conflict) are **not auto-resolved** (gitmem): the newer one is kept,
   the older one becomes `Held-Back: … conflict`, and both show on the card. A later dream may retire.
5. **Apply caps** (D §3b guardrail 3: Mistakes ≤ 15, Approaches ≤ 15, ≤ 6 KB). Rank by parent acceptance rate (from
   the ledger), then recency. Overflow → `Held-Back: … cap`.
6. **Skills.**
   - Archetype skills: **track** by default (the agent reads the working-tree file at `skills/<arch>/<name>/`).
   - The owner or PM may **pin**: `agent.json` `skills: [{name:"research", pin:{change:"c_…", blob:"3c1d9e2"}}]`.
     The loader reads `git cat-file blob <blob>` (cached by blob sha) and falls back to change → sha → `git show
     <sha>:<path>` after a rewrite.
   - A parent's agent-local skills are **copied** into `agents/<child>/skills/` and diverge from then on, with
     `Derived-From`.
   - The UI shows "pinned v5 · archetype now v7 (2 newer)" with Compare / Track latest.
7. **Write and commit:** one seed job writes `agent.json`, `SOUL.md` (Inherent from the archetype plus the brief;
   parents' 📌 lines are **not** inherited unless the owner ticks them, since SOUL is owner territory), `MEMORY.md`
   with new ids, and skills, as one commit with the trailers in Example 3. The index creates the `seeded_from` and
   `derived_from` edges.

**Single-parent** is the same path with one `Seeded-From`. **Partial inheritance** is steps 3–5, and every exclusion
is recorded, so the lineage shows what *wasn't* inherited and why. **Multi-parent** is steps 2 and 4.

---

## 5. Lineage data model

**Recommendation: git trailers are the source of truth. The SQLite tables in `.data/runtime.db` are a derived index,
rebuildable from `git log` at any time.**
- Provenance travels with the content it describes and can't drift from it.
- A wiped or corrupted DB loses nothing.
- Forget-rewrites keep change ids, so a reindex restores every edge.

The one exception is `run → used_skill@version` edges. They come from the `runs` table (`runs.skills_json`: blob shas
the loader served), because runs don't commit, and `runs` is primary data already. D §10's `memories` table is kept
but becomes **derived**: the dream no longer inserts rows directly; the indexer writes them from the commit.

**Nodes.**

| kind | id form | Created by |
|---|---|---|
| `agent` | `agent:pip` | first commit touching `agents/pip/` |
| `agent_version` | `agentv:pip@3` | seed / project_close / approved SOUL / "Save version" (tag `agent/pip/v3`) |
| `memory_item` (a version) | `mem:pip:m_7f3a@2` | each `Op:` add/update/merge |
| `skill_version` | `skill:skills/researcher/research@5` | each commit changing a `SKILL.md` (n = count of commits touching it) |
| `project` | `project:p_42` | first `Project:` trailer |
| `dream` | `dream:d_01JA7Q2` | `Dream:` trailer |
| `run` / `evidence` | `run:<uuid>` / `ev:asg:41` | `Run:` / `Evidence:` trailers (leaf nodes, no content) |

**Edges** (direction: child → parent, or derived → source):
- `seeded_from`: agentv → agentv
- `derived_from`: mem → mem, or skill → skill
- `supersedes`: mem@n → mem@n−1, or decision → decision
- `evidence_of`: ev → mem
- `produced_by`: mem → dream | run | owner
- `used_skill`: agentv | run → skill_version, with `{pinned}`
- `version_of`: mem → agent, or agentv → agent
- `in_project`: mem | agentv → project
- `held_back`: agentv → mem, with `{reason}`

**Time validity (Graphiti's four columns):**
- `valid_at`: world time the lesson became true = the earliest evidence timestamp.
- `invalid_at`: world time it stopped being true = the retiring evidence's timestamp.
- `created_at`: transaction time = commit time.
- `expired_at`: commit time of the superseding or retiring commit.

"What did Pip know on Oct 3" is `created_at ≤ t AND (expired_at IS NULL OR expired_at > t)`.

```sql
-- all tables derived from the vault; DROP + rebuild is always safe
CREATE TABLE vault_commits (
  seq          INTEGER PRIMARY KEY,        -- topo order from `git log --reverse --topo-order`
  change_id    TEXT UNIQUE NOT NULL,       -- Change: trailer
  sha          TEXT UNIQUE NOT NULL,
  parent_sha   TEXT,
  author_kind  TEXT NOT NULL CHECK (author_kind IN ('agent','owner','system')),
  author_id    TEXT NOT NULL,              -- from author email local-part
  source       TEXT NOT NULL,
  subject      TEXT NOT NULL,
  project_id   TEXT, run_id TEXT, dream_id TEXT, tool TEXT, task_id TEXT, rev INTEGER,
  committed_at TEXT NOT NULL,
  trailers_json TEXT NOT NULL              -- full parsed trailer list, for anything not columnized
);
CREATE TABLE vault_files (
  change_id TEXT NOT NULL REFERENCES vault_commits(change_id),
  path      TEXT NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('A','M','D')),
  old_blob  TEXT, new_blob TEXT,
  PRIMARY KEY (change_id, path)
);
CREATE INDEX vault_files_by_path ON vault_files(path, change_id);

CREATE TABLE lineage_nodes (
  id         TEXT PRIMARY KEY,             -- 'mem:pip:m_7f3a@2', 'agentv:pip@3', …
  kind       TEXT NOT NULL CHECK (kind IN ('agent','agent_version','memory_item','skill_version','project','dream','run','evidence')),
  ref        TEXT NOT NULL,                -- agent id | item id | file path | project id …
  version    INTEGER,
  owner_agent TEXT,                        -- for memory_item / agent-local skill
  section    TEXT,                         -- mistake | approach | profile | standing
  text       TEXT,                         -- item text at this version (from the blob); NULL after forget
  blob       TEXT,                         -- skill blob / file blob at this version
  change_id  TEXT NOT NULL,                -- commit that created this node
  origin_project_id TEXT,                  -- project the content came from (carried through derivations)
  labels_json TEXT,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','retired','forgotten')),
  valid_at TEXT, invalid_at TEXT, created_at TEXT NOT NULL, expired_at TEXT
);
CREATE TABLE lineage_edges (
  src  TEXT NOT NULL REFERENCES lineage_nodes(id),
  dst  TEXT NOT NULL REFERENCES lineage_nodes(id),
  kind TEXT NOT NULL CHECK (kind IN ('seeded_from','derived_from','supersedes','evidence_of','produced_by','used_skill','version_of','in_project','held_back')),
  change_id TEXT NOT NULL,
  attrs_json TEXT,                         -- {pinned:true} | {reason:"project:p_bluebird"} | {merged:true}
  valid_at TEXT, invalid_at TEXT, created_at TEXT NOT NULL, expired_at TEXT,
  PRIMARY KEY (src, dst, kind, change_id)
);
CREATE INDEX lineage_edges_dst ON lineage_edges(dst, kind);
CREATE TABLE vault_meta (key TEXT PRIMARY KEY, value TEXT);   -- last_indexed_sha, schema_version
CREATE TABLE vault_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, job_json TEXT NOT NULL, created_at TEXT NOT NULL);  -- PRIMARY (crash journal)
-- D §10 `memories` gains: item_id, version, change_id, valid_at, invalid_at, expired_at, derived_from_json,
-- origin_project_id, labels_json; status adds 'retired','forgotten'; it is rebuilt with lineage_nodes(kind='memory_item').
```

**Queries the UI needs.**
- Ancestors: a recursive CTE over `seeded_from` from `agentv:nova@*`.
- Descendants: the same over `dst`.
- "What came from whom": `derived_from` edges where `src LIKE 'mem:nova:%'`.
- An item's timeline: `supersedes` chain plus `vault_files` for its file.

**Incremental indexing (after each commit, in the writer job).**
- Parse the commit just made. For each `Op:`, read the item text from the new blob: `git show <sha>:<path>`, then
  `parseMemory()` finds `[m_xxxx]`.
- Insert nodes and edges, then set `last_indexed_sha`, all in one transaction.

**Rebuild after a crash or corruption (`vault reindex --full`).**
1. In one transaction, delete all derived tables (`vault_commits`, `vault_files`, `lineage_*`, `memories`).
2. Stream one spawn:
   `git log --reverse --topo-order --raw --no-renames --no-abbrev --format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%(trailers:unfold,only,separator=%x1d)`.
   `--raw` gives `:old_mode new_mode old_blob new_blob status\tpath` per file.
3. Fetch the blobs needed for item text through one long-lived `git cat-file --batch`.
4. Replay trailers in order with **the same function** the incremental path uses.
5. Set `last_indexed_sha = HEAD`.

Boot catch-up is the same replay over `git rev-list --reverse <last_indexed_sha>..HEAD`. Determinism holds because
ids come from trailers and the order comes from git. The V4 test enforces "rebuild == incremental".

**Owner edits get per-item ops too.** On a Memory-tab save, the writer diffs `parseMemory(old)` and
`parseMemory(new)`:
- a new bullet without an id gets a fresh `m_xxxx` appended and becomes `Op: add`;
- changed text → `Op: update`;
- a removed bullet → `Op: retire`.

So Mem0-style item timelines cover owner edits as well as dreams.

---

## 6. Privacy interplay

**Scrub before commit: one hook point, in-process.** `VaultWriter` step 2 runs E's detector pack (E §3:
gitleaks-derived rules + secretlint + Presidio ports) over **every file body, the subject, the body and every trailer
value** before anything touches disk.
- `secret.*` → replaced by `[REDACTED:secret.<rule>]`; the count goes in `Redacted:` (the redact/locked rule
  `r_secr02` already names `memory:self`/`memory:global` sinks, E §4.3).
- Any remaining match after rewrite (the re-scan, as in `jev-secrets`) → the job fails and nothing is written.
- `Labels:` is computed here (`project:*`, `pii.*`).

This is E5 extended. The vault commit becomes the fourth place E5 runs (after `dream/validate.ts`, E3 file writes
and the 📌 handler). It is **not** a git `pre-commit` hook:
- hooks are disabled for determinism (§2.2), and a Node hook would add ~100 ms per commit;
- the in-process check also covers the working-tree file, which a hook would see too late.

Since subjects and trailers are code-templated (§3), model text reaches the vault only through file bodies.

**Forget: two tiers with a concrete mechanism.**

| Tier | Owner action | Mechanism | Reversible |
|---|---|---|---|
| **Forget** (default) | "Forget this" on an item, a SOUL line or a history row | A normal commit removes it from HEAD (`Source: forget`, `Forget: f_… m_7f3a`, `Op: forget`). The index sets the node to `forgotten` and **masks the text in all history and diff views** (rendered as "forgotten on Oct 17"). Default cascade: `derived_from` descendants (other agents' copies) are listed with "also forget in Nova, Rex" pre-ticked. | Yes (Restore) |
| **Erase from history** (explicit, typed confirmation, irreversible) | "Erase everywhere" | (1) Under the writer queue lock, collect the literal strings: the item text at every version from `lineage_nodes.text`, plus `git log --all -S'<literal>' --format=%H` to catch copies the index missed. (2) Write `exprs.txt` (one literal per line, `==>[erased f_…]`). (3) `git filter-repo --force --replace-text exprs.txt --replace-message exprs.txt` (filter-repo manual: literals by default, `regex:`/`glob:` prefixes; `--sensitive-data-removal --no-fetch` if version ≥ 2.47 [GitHub docs]). A whole project uses `--invert-paths --path projects/<pid>/ --path agents/<id>/projects/<pid>.md` instead. (4) `git reflog expire --expire=now --all && git gc --prune=now` (filter-repo already rewrites tags). (5) `vault reindex --full`. Change ids are untouched, so every lineage edge survives with new shas. (6) Scrub derived stores in `runtime.db`: `memories.text`, `dreams.ops_json`, `approvals` payloads. (7) **Erase report:** "also present in 2 conversation checkpoints (threads a:pip:p:p_42…) → Erase there too", which deletes those checkpoint rows; and "LangSmith traces: kept up to 14 days (E §1), not erasable from here". | No |

**Why rewrite and not the alternatives:**
- *Encryption at rest with key deletion* (crypto-shredding, per-file or per-project keys via git-crypt/age):
  - it makes `git diff`, history and blame unreadable without textconv, which defeats the owner's requirement;
  - one key per file forgets the whole file's history, not one line;
  - agents need plaintext in the working tree anyway.
  - It's still the right tool for disk theft, which FileVault covers. Rejected for forget.
- *Excluded content* (sensitive text only in SQLite, git holds pointers): breaks "Markdown is the source of truth"
  and plain `git diff`. We use exclusion only where it already applies: secrets never enter (scrub), and transcripts
  and windows never enter (layout §2.1).
- *Rewrite* costs one Python script dependency (`git-filter-repo`, not installed here; `brew install
  git-filter-repo` or vendor the single file after a license check, **UNVERIFIED**) and rewrites shas. Change ids
  make the sha rewrite harmless. If filter-repo is missing, the UI offers only tier 1 and says why.

**Cross-project data in inherited memory.**
- Every memory node carries `origin_project_id` and `labels_json`, and **both propagate through `derived_from`**.
  A Bluebird lesson copied into Nova still says `origin_project_id = p_bluebird`.
- Seeding enforces R4 (§4 step 3).
- A later "forget project Bluebird" walks `derived_from` from every node with that origin and offers tier 1 or 2 for
  all copies.
- PROFILE.md and global items written at `project_close` already pass E5's cross-project ask before they become
  inheritable.

---

## 7. UI views (dots-style: chat left, work pane right)

Prior-art anchors:
- the HF model tree sidebar (base model → this model; counts per relation);
- the Unity Catalog Lineage tab → "See lineage graph" (one level, expand per node, edge-details panel);
- the MLflow version page linking to its source run;
- Palinode `history`/`trace`/`rollback` (restore = new commit);
- Mem0 `history(memory_id)` (old → new + input);
- the OpenClaw Dreams UI and `DREAMS.md` "diff-style highlights";
- Svod's 3-way conflict view.

**(a) History tab, on any versioned file.** Every file view in the work pane has the tabs **File · History**.
Agent profiles show Soul · Memory · Skills · History · Lineage; project panels (Plan from dag.json, Team, Decisions)
get a clock icon that opens History.

```
History · Pip / MEMORY.md                         [ Commits | Items ]     Source: [All ▾]  Since: [30 d ▾]
───────────────────────────────────────────────────────────────────────────────────────────────────────────
● Today 14:31   Pip learned 2, retired 1           (dream)  task t7 · Pricing relaunch     +2 −1   Undo
● Today 11:02   You edited 2 lines                  (owner)                                  +1 ~1   Restore
● Oct 16 18:40  📌 "Lead with the cost line"        (pin)    from your message               +1     Restore
● Oct 15 09:12  Hired from Rex v2 + Pip v3          (seed)   9 items · 2 skills · 3 held back +9     Lineage →
───────────────────────────────────────────────────────────────────────────────────────────────────────────
▼ Today 14:31 · Pip (dream) · d_01JA7Q2 · run 0192f3a1            [ Inline | Side by side ]  [ Restore this version ]
  ## Best approaches
+ - 2026-10-17 · Open the pricing memo with the cost line. [m_91c2]   ⟵ added · evidence: 👍 msg 131 · t7 done
~ - … quote the {-monthly-}{+annual+} figure first. [m_7f3a]          ⟵ updated · evidence: msg 131
  ## Mistakes
- - Sent the draft before the numbers were checked. [m_33d0]          ⟵ retired · evidence: ✋ decline 14:20
```

- **Rows** come from `vault_commits ⋈ vault_files WHERE path = ?`, so listing takes one SQLite query.
  - The source chip colour is per `Source`.
  - The subject is shown as-is (code-written).
  - Clicking a trailer opens it: `Run` → the run's tool-call strip (E V1); `Dream` → the dream card; `Task` → the
    Plan panel; evidence chips scroll the **chat pane** to that message.
- **Diff:**
  - Text comes from `git show <sha>^:<path>` and `git show <sha>:<path>`, rendered with jsdiff:
    `diffWordsWithSpace` for prose, `structuredPatch` for the hunks view.
  - A gutter annotation per `Op:` (matched by item id).
  - Toggle between inline and side-by-side.
  - **JSON files get a semantic renderer** (keys are sorted, F §3): `t7 status in_progress → done · evidence +
    reports/t7-2.md · Ada via update_task (rev 57)`.
  - `decisions.md` shows ADR blocks, with superseded ones struck through.
- **Restore** opens a confirm dialog showing the diff HEAD → that version, then makes a new commit
  (`Source: restore`, `Restores: c_…`). **Undo** on a dream does the same with `Reverts:`. Nothing is ever reset.
  State files restore only through the state module, so `rev` advances and the lead gets a `<state_delta>`.
- **Items view** (Mem0-style). Every item with its status; clicking `m_7f3a` opens its timeline:
  - "v1 added Oct 3 (dream, 👍 msg 88)";
  - "v2 updated today: monthly → annual (msg 131)";
  - "Came from: Pip m_91c2 (seed, Oct 15)";
  - "Copied into: Nova m_a101";
  - plus Forget / Erase actions.
- **Owner view of a memory's history:** opening an item shows exactly who changed it (agent, dream or owner), when,
  why (the evidence chips open the actual message or reaction), the before and after text, where it came from and
  who inherited it.

**(b) Lineage tab (agent profile, work pane).**

```
 Ancestors                        This agent                          Descendants
 ┌──────────┐  seeded 6 · 1 skill  ┌───────────────────┐  seeded 4    ┌──────────┐
 │ Pip  v3  │ ───────────────────▶ │ Nova  v1 → v2     │ ───────────▶ │ Juno v1  │
 └──────────┘   3 held back        │ researcher · p_57 │              └──────────┘
 ┌──────────┐  seeded 3 · 1 skill  │ 9 inherited ·      │
 │ Rex  v2  │ ───────────────────▶ │ 14 own · 2 skills  │      [as of: ───●──── Oct 17]
 └──────────┘                      └───────────────────┘
```

- **Layout:** columns = generations (ancestors up to 3 back, descendants up to 2 ahead). Code computes it from the
  recursive CTE and renders HTML/SVG, so there's **no new dependency**. Graphs are tiny (1–3 parents). Move to
  `@xyflow/react@12.12.0` only if a company graph exceeds ~50 nodes.
- **Node click:** a version list (v1 hire, v2 project close…) and the record from the ledger (acceptance rate, cost).
- **Edge click** opens a details panel (UC pattern):

  | Inherited item | From | Now in Nova | |
  |---|---|---|---|
  | Open the pricing memo with the cost line. | Pip m_91c2 + Rex m_5e10 (merged) | active, edited once | History → |
  | Quote annual figures first. | Pip m_7f3a | retired Oct 20 | History → |
  | 2 items mentioning Bluebird | Pip | **held back** (project boundary) | — |
  | Skill `research` | archetype @v5 | **pinned** (archetype now v7, 2 newer) | Compare · Track latest |

- The **"as of" slider** filters nodes and edges with `created_at ≤ t < expired_at` (Graphiti transaction time).
- "Show items" expands item-level nodes when there are ≤ 40 of them; otherwise it shows the list.

**(c) Where dreams and "based on" appear.**
- **Dream result:**
  - A one-line system chip in the agent's DM in the **chat pane**: "Pip learned 2 things · retired 1 —
    *View diff* · *Undo*" (Q8). *View diff* opens (a) at that commit in the work pane.
  - The same entry sits at the top of the profile's History.
  - A cross-project memory or `propose_soul` op appears as an approval card instead (E V2). After approval its
    commit carries `Approved-By`.
- **"Based on" summary:**
  - On the **launch card** (setup step 6), per new expert: "Nova · researcher · NEW, based on **Pip v3**
    (Pricing relaunch, 92% accepted) + **Rex v2**: 9 lessons, 2 skills (research pinned v5) · **3 held back**
    (Bluebird ×2, 1 conflict) [Review]". The held-back checkboxes are where R4's `ask` is answered.
  - After hire, in the **profile header**: "Based on Pip · Rex" chips → Lineage tab.
  - The seed commit is the first row of each of Nova's file histories.

---

## 8. Integration with the existing design

**Module:** `src/server/runtime/vault/`:
- `git.ts`: binary resolution, env isolation, `run`/`stream`;
- `writer.ts`: `VaultWriter` queue, preconditions, `vault_jobs` journal;
- `trailers.ts`: format and parse; the key list from §3 lives here as a typed union;
- `scrub.ts`: E5 adapter over the detector pack;
- `index.ts`: incremental + full reindex, boot catch-up;
- `lineage.ts`: `seedAgent`, ancestor/descendant queries, agent versions + tags;
- `diff.ts`: blob pairs → jsdiff hunks; JSON semantic diff for `dag.json`/`roster.json`/`open.json`;
- `forget.ts`: tier 1 and 2;
- `maintenance.ts`: nightly `gc` + `commit-graph`, external-edit sweep;
- `skills.ts`: track/pin resolution, blob cache.

API (thin):
- `GET /api/vault/history?path=` and `GET /api/vault/item/[id]`;
- `GET /api/vault/diff?change=&path=`;
- `POST /api/vault/restore`, `POST /api/vault/forget`;
- `GET /api/agents/[id]/lineage`.

**Plug-in points:**
- **Dream apply (D §3b):**
  - guardrail 6 "copy the old file to `agents/<id>/.history/`" → **removed**: the vault commit is the backup and
    the undo;
  - guardrail 7 mtime → `expect: {MEMORY.md: <blob sha read at gather time>}`;
  - `dream()` ends with one `writer.commit({writes:[MEMORY.md, notes.md], trailers: {Source:"dream", Dream, Op[], Evidence, …}})`;
  - `db.dreams.log` stays, and gains the `change_id` column. `memories` rows are written by the indexer.
- **Lead state tools (F §9.2) and worker `report`:** `src/lib/project-state.ts` keeps its per-project mutex, rev and
  validation. Its "write temp then rename" step is **delegated to `writer.commit`**, with trailers `Source:"tool"`,
  `Tool`, `Task`, `Rev`, `Run`, `Evidence`. The SSE `{type:"state"}` event fires after the commit resolves. The
  `/state/**` read-only permission is unchanged; the path moves to `.data/vault/projects/<pid>/state/`.
- **`HomeFiles` middleware:** unchanged semantics (reads the working tree fresh every call). Its root constant moves
  to `.data/vault/agents/<id>/`. The skill loader adds pin resolution via `skills.ts`.
- **`src/lib/agent-files.ts`:**
  - `ROOT` → `.data/vault/agents`;
  - `writeAgentFile` (owner UI) → `writer.commit({Source:"owner"})` with per-item ops synthesized (§5);
  - `addStandingInstruction` (📌) → `writer.commit({Source:"pin", Evidence:"msg:…"})`.
- **Privacy:** E5 gains a 4th site (`vault/scrub.ts`); P1's detector pack is a prerequisite for V2. R4 is consulted
  in `seedAgent`.
- **`memories` table:** becomes derived (new columns in §5); `agents.seeded_from_agent_id` stays as the *primary*
  parent for old queries, while the full parent list lives in `lineage_edges`.
- **Provisioning (S3, `POST /api/projects`):** creating an expert calls `seedAgent` (or writes v1 from the archetype
  with `Source: seed` and no parents).

**Changes to `docs/design/team-setup.md`:**
- §2 home files: the paths move under `.data/vault/agents/<id>/`; add `agent.json` and `skills/`; "every write is a
  vault commit".
- §3: add `vault/*` to the module list. Add the tables `vault_commits`, `vault_files`, `lineage_nodes`,
  `lineage_edges`, `vault_meta`, `vault_jobs`, and note that `memories` is derived. Note the dependency: the git
  binary ≥ 2.36 (+ optional `git-filter-repo`) and `diff@9`, with no new npm git library.
- §4: the state path → `.data/vault/projects/<pid>/state/`; each state tool call = one commit with `Tool/Task/Rev`
  trailers.
- §5:
  - in dream guardrails, "old file saved first" → "one vault commit per dream, `expect` blob precondition";
  - Q8's undo = a revert commit;
  - the `project_close` dream cuts an agent version (tag).
- §6: add "vault commit" to the enforcement points; add the forget policy (tier 1 default; tier 2 erase via
  filter-repo).
- §8 UI: History tab on every file; Lineage tab; "based on" on launch card v2; the dream chip.
- §8b: replace "design pending" with the decisions above (one vault, CLI git, trailers, change ids, derived index,
  copy + per-item provenance, two-tier forget).
- §9: add track **V** (below). Dependencies: V1 after R2 (home files); V2 after P1; V3 alongside M1/M2; V5 before S2/S3.

---

## 9. Build order (each step has a test that fails when the code is wrong)

1. **V1 · `git.ts` + `writer.ts` + `trailers.ts` (vault init, queue, preconditions, journal).**
   *Test:*
   - fire 25 concurrent `writer.commit` calls on 25 different files: exactly 25 new commits, each touching exactly
     its own path, `git fsck --strict` clean, no `index.lock` error;
   - `git interpret-trailers --parse` on each message round-trips to the trailer object `trailers.ts` produced;
   - a job whose `expect` blob is stale is rejected with `conflict` and leaves HEAD and the working tree unchanged;
   - killing the process after the file rename but before `commit` leads, on boot, to one commit with the job's
     original subject and trailers.
2. **V2 · `scrub.ts` at the writer (E5 4th site) + forget tiers.**
   *Test:*
   - a MEMORY.md body and a trailer value containing an AWS-key fixture are committed; afterwards
     `git log --all -p | grep -c AKIA` = 0, the file shows `[REDACTED:secret.aws-access-token]`, and the commit has
     `Redacted: 2`;
   - a residual match after rewrite makes the job fail with no file written;
   - tier 2 on a string present in 3 commits: `git log --all -S'<string>'` returns nothing,
     `git cat-file --batch-all-objects --batch | grep -c '<string>'` = 0 after gc, and every pre-erase `Change:` id
     still resolves through `vault_commits`.
3. **V3 · Writers wired: dream apply, `project-state.ts` tools + `report`, owner save, 📌, `append_note`
   coalescing.**
   *Test:*
   - after a dream applies 2 adds + 1 retire, `git log --format=%H -- agents/x/MEMORY.md` shows **one** new commit
     whose trailers contain `Dream:`, 3 × `Op:` and `Evidence:`, and the index lists both new items with
     `produced_by → dream` and `evidence_of` edges;
   - an owner save landing between the dream's gather and apply makes the dream commit nothing and leaves the owner's
     text at HEAD;
   - `update_task(t7 → done)` produces one commit touching only `dag.json`, with `Tool: update_task`, `Task: t7`,
     `Rev: <n>`;
   - a `report` produces one commit touching both `dag.json` and `roster.json`;
   - 4 `append_note` calls in one run produce one commit.
4. **V4 · `index.ts`: incremental index, full rebuild, boot catch-up.**
   *Test:*
   - on a fixture vault of 200 scripted commits (dreams, owner edits, seeds, a forget), the incremental index and a
     `reindex --full` from an empty DB are **row-for-row identical** across all derived tables (gitmem's rule);
   - deleting `runtime.db` and booting reproduces the same lineage graph;
   - with `last_indexed_sha` set 3 commits behind HEAD, boot indexes exactly those 3.
   - Removing the shared replay function (separate code paths) makes the equality fail.
5. **V5 · `lineage.ts seedAgent`: partial and multi-parent inheritance, agent versions, skill pin/track.**
   *Test:* seed Nova from Pip (5 global + 2 `project:p_bluebird` items) and Rex (3 items, one ≥ 0.8 Jaccard with
   one of Pip's) with no owner override. Expected:
   - Nova's MEMORY.md has **7** items, none containing "Bluebird";
   - the seed commit has 2 `Seeded-From`, 2 `Held-Back … project:p_bluebird`, and the merged item's
     `Derived-From` names **both** parents;
   - `ancestors(nova)` = {pip@v3, rex@v2};
   - tag `agent/nova/v1` points at the seed commit;
   - pinning `research@v5`, then committing v6 of the archetype skill, still loads v5's blob, while a tracking agent
     loads v6.
6. **V6 · UI: History tab (commits + items + diff + restore), Lineage tab, dream chip, launch-card "based on".**
   *Test* (component + API, fixture vault):
   - History for `agents/pip/MEMORY.md` renders the dream row with the `dream` chip and 3 gutter annotations;
   - clicking Restore on the owner row creates a commit with `Restores: <that change id>`, and HEAD's file is
     byte-equal to that version;
   - the dag.json history row reads "t7 status in_progress → done";
   - the Lineage edge Pip→Nova lists 5 items and "2 held back (project boundary)";
   - a forgotten item renders as "forgotten on …" in every diff that contained it.

---

## Self-check (against coverage and the bar)

| Item | Result | Evidence |
|---|---|---|
| C1 prior art ≥ 6 with what/mechanism/how it reaches the user | PASS | 11 rows in §1 (Letta, Svod, Palinode, gitmem, Memoria, Graphiti, Mem0, Dolt, Anthropic/Claude Code, OpenClaw, HF + MLflow/UC), each with URL(s) |
| C2 repo choice with reasons; library versions + exact APIs; concurrency; granularity with numbers | PASS | §2.1 table (3 options); §2.2 git 2.39.5 / isomorphic-git 1.44.3 / simple-git 4.0.2 with signatures from `.d.ts` and CLI calls; §2.3 queue + blob preconditions; §2.4 table + measured 25 ms / 18 ms / 582 ms |
| C3 author, message, trailers, who commits and when, 3 examples | PASS | §3: trailer table (21 rows, 23 keys), writer list, Examples 1–3 |
| C4 fork vs copy vs per-item; partial; multi-parent; skill pin vs track | PASS | §4 model + 7-step algorithm (filter, merge with two `Derived-From` parents, held-back, pin/track) |
| C5 nodes, edges, time validity, where it lives, schema, rebuild | PASS | §5: 7 node kinds, 9 edge kinds, Graphiti 4-column validity, git-as-truth decision, SQL DDL, full and incremental rebuild steps |
| C6 scrub before commit; concrete forget; cross-project | PASS | §6: in-process scrub at writer step 2; two-tier forget with exact filter-repo/reflog/gc/reindex steps; origin propagation and cascade |
| C7 History tab, Lineage graph, dream diff + "based on", with UI prior art | PASS | §7 (a)(b)(c) with mock-ups, data sources and HF/UC/MLflow/Palinode/Mem0/OpenClaw anchors; what the owner sees when opening a memory's history |
| C8 owning module, plug-in points, team-setup changes | PASS | §8: `src/server/runtime/vault/*` file list, 6 plug-in points, per-section edits to team-setup.md |
| Build order ≤ 6 steps with failing tests | PASS | §9 V1–V6, each with a test that fails when the code is wrong |
| APIs verified or labelled UNVERIFIED | PASS | Versions + `.d.ts` paths in the header; UNVERIFIED: filter-repo license, path-log latency at 150K commits, the Gerrit URL (not fetched) |
| No hosted service; only the report file edited; no invented APIs | PASS | Everything is local (`.data/vault`, never pushed). The only writes outside the report are benchmark scratch files in `/tmp/gbench/`. Every git, isomorphic-git, simple-git and jsdiff call quoted was run or read from type definitions. |
