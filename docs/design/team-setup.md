# Team setup, end to end (design v1, DRAFT)

How a team goes from "I want X" to experts working on it, and the runtime, memory, prompts and privacy rules
underneath. Decisions Q1–Q13 were accepted by the owner on 2026-10-17 as defaults; they can change later and are
tracked in `DECISIONS.md`.
Evidence lives in `docs/research/` (A dots/Muse · B prompt patterns · C similar systems · D Deep Agents runtime ·
E privacy · F orchestrator memory); cited as `[D §7]`.

## 0. Principles (each one is what the research converged on)

1. **Default to one expert.** Teams only when the work splits into independent parts: multi-agent setups lose
   39–70% on sequential tasks [C §6]. Mira's triage defaults to solo.
2. **One writer per artifact, and nobody paraphrases.** Experts post work straight to the channel; the PM plans,
   assigns and accepts, it never relays [C: Cognition, telephone game].
3. **State lives in files written by checked tools.** The lead's plan, decisions and roster are files that code
   validates; "done" needs evidence; progress comes from artifacts, never a worker's own number [B a-pattern 4, F §3].
4. **One memory writer.** Agents and background jobs only propose; dreaming commits ops that code validates, each
   citing evidence ids [B 3, D §3b].
5. **Gate plans and consequential actions, not steps.** Owners reject 39% of plans but 3% of per-action prompts
   [C: Claude Code]; one launch card, then gates only where an action is external, irreversible, costly or new.
6. **Wake on events.** Only Mira has a timer heartbeat; everyone else wakes on a message, assignment or approval
   [C: Paperclip burned 57% of 313M tokens on a 5-min CEO heartbeat].
7. **Stable prefix first, changing content last** so Crusoe's cache keeps hitting; the date goes last [B e, F §4].
8. **Privacy is enforced in code at fixed hook points.** Detectors are one layer; egress allowlists, taint and
   approvals must hold when detectors miss [E §1, §6].

## 1. The setup flow

| # | Step | Who | Output | Gate |
|---|---|---|---|---|
| 1 | Ask | Owner → Mira (DM) | the request | — |
| 2 | Triage | Mira, by checklist | **solo** (one expert, DM) or **project** (a PM) | one-tap override on her reply |
| 3 | Brief | PM | `charter.md`: dated goal, success metric, scope must/won't, roles + qualifications, budget | — |
| 4 | Source | PM | past projects (charter, retro, decisions, ledger) + talent (agents, memories, acceptance) | — |
| 5 | Staff | PM | per role: **rehire** the best match, or **create** an expert (archetype + config + seeded memory) | — |
| 6 | Approve | Owner | one editable **launch card**: brief, roster (new/rehired + why + record), budget, wake policy | **the** gate; "request revision" loops to 3–5 |
| 7 | Provision + kickoff | Runtime, then PM | rows, threads, home files, channel; PM writes the DAG and assigns first tasks | — |

- **Staffing loop (step 4–5)** copies Captain Agent [C §2]: role description → retrieve from the agent library →
  a selector that may answer **"none fits"** → create the missing expert → save it to the library. GAIA: no library
  18.2 → agent library 29.1 → agent + tool libraries 40.6.
- **Staffing check** before the card: no two roles with the same qualifications, every qualification covered.
- **Q1 (decided) · PM is the lead for the whole project.** It writes the plan, assigns, accepts work against the
  qualifications it wrote, and records decisions. It never relays: experts post directly, owner DMs go straight to
  experts [A, C: every studied product keeps one persistent coordinator].
- **Q2 (decided) · Gates.** One launch card (step 6). During the project: new hires, budget at 80% (warn) and 100%
  (pause), scope changes, and tool calls in tiers T4–T6 (§6). Small tasks: no card.
- **Q3 (decided) · Rehiring keeps the identity.** Same agent (name, mascot, record, career memory), a **fresh thread
  per project** (`a:{agent}:p:{project}` [D §1]) with project-scoped memory seeded from a filtered subset. At most
  2 live projects per agent. Lessons cross projects only through gated dreaming [A: cross-task carry-over was the
  failure OpenAI measured; C §3].
- **Q4 (decided) · Expert config** = archetype · brief (objective, deliverables, success criteria, non-goals,
  escalate-to) · tools and skills (small list) · model tier · budget (USD + share of the per-model TPM) · autonomy
  per tool tier · wake policy · memory scope + seed · reporting line. Persona is **tone only**: personas alone add no
  accuracy and irrelevant persona detail can cost up to ~30 points [C §2].
- **Q5 (decided) · Triage.** Mira decides with an explicit checklist (independent parts? > 1 domain? > ~1 day?),
  defaults to solo, says which she chose; the owner flips it with one tap; a solo expert may ask to upgrade.
- **Q6 (decided) · Start small.** At most 3 experts at launch; the PM asks to hire more later (a gate) [C: Paperclip
  users hired 11, 4 were useful].

## 2. Agents: identity, files, threads

- **Two primitives (owner, 2026-10-17): archetypes and the skill library.** Everything else is built on them.
  - **Archetype** (`ArchetypeDef` in `src/lib/skills/types.ts`): chief, lead (PM), engineer, designer, researcher,
    analyst, writer. Each has an Inherent section, qualifications vocabulary, and its own **curated toolset** of the
    high-quality tools it uses most, including **presentation tools** that render in the work pane (the analyst's
    charts today; an infinite canvas and its tools for the designer). An agent built from an archetype inherits the
    toolset and its renderers. Toolsets per archetype, the registry (`src/lib/tools/types.ts`) and the presentation rule (fence for small read-once data, versioned artifact for anything edited, revised or approved, derived views from state files): `docs/research/H-archetype-toolsets.md`. The designer's canvas is Excalidraw (MIT; tldraw needs a paid production key).
  - **Skill library** (`skills/index.json`, `skills/library/<id>/`): curated SKILL.md packages from the open
    ecosystem, permissively licensed, vetted, scanned. Orchestrators search it first; only a miss goes to You.com.
  - **Composition** (not a primitive): an archetype plus the skills chosen for one role. The orchestrator composes it
    when staffing, or adapts one from the history of past compositions and their outcomes. No fixed default skills.
- **Home files** (`agents/<id>/`, editable in the profile): `SOUL.md` (Inherent + per-project section + 📌 standing
  instructions) and `MEMORY.md` (Mistakes, Best approaches). **Q7 (decided):** drop MEMORY.md's "Done" section for a
  **Track record** line computed by code from the ledger; four products keep task progress out of memory [B 5].
  Memory lines are facts, not commands, and tagged stated / observed / inferred with a source [B 10].
- **Freshness:** our own `HomeFiles` middleware reads SOUL/MEMORY every call; the stock `memory` option freezes
  them per thread, so dreaming's edits would never reach a persistent agent [D §0 finding 2].
- **Threads:** one per agent × project, durable in SQLite (`SqliteSaver`). One run per thread at a time via a queue;
  two concurrent runs fork the checkpoint and lose messages [D §0 finding 6]. A DM mid-run is delivered through an
  inbox drained before the next model call [D §1, §11 step 4].

## 3. Runtime (Deep Agents JS, local first) [D §10]

- Modules under `src/server/runtime/`: `db` (`.data/runtime.db`), `checkpointer`, `models` (`crusoe()` with an
  injectable `fetch`), `limiter` (per-model RPM + **TPM**, lanes, header calibration), `resilience` (fallback outermost,
  retry inner: today's order is inverted [D §0 finding 3]), `home-files`, `backends`, `inbox`, `agents`, `threads`
  (queue), `run`, `bus` (SSE), `ledger-callbacks`, `tools/assign`, `approvals`, `scheduler`, `heartbeat`, `dream/*`,
  `recovery`.
- Tables: projects, agents, project_members, threads, runs, inbox, assignments, approvals, memories, dreams,
  heartbeat_notes [D §10]. The JSONL ledger stays the stats source of truth (adds `thread`, `run`).
- `write_todos` is opt-in since deepagents 1.12 [D §0 finding 1]; the **Plan panel reads the lead's `dag.json`**
  (§4), not todos.
- One new dependency: `@langchain/langgraph-checkpoint-sqlite@^1.1.0` (compatibility verified [D §0]).
- **Cache and push (owner, 2026-10-17):** nothing the owner has seen once shows a loading screen again. A server
  cache (`src/server/cache/`) keeps the ledger in memory (appends update it; no re-reads) and caches agent Markdown
  (writes update it; a file watcher catches outside edits; `invalidate`/`set` for the vault writer). A bus pushes
  change topics over `GET /api/events` (SSE); the client keeps a stale-while-revalidate cache (persisted to
  `sessionStorage`) and refreshes on events instead of polling.
- Fetch chain to Crusoe: `privacyScrub → limit → fetch`. It's the only point that also catches summarization's own
  model call [E §8].

## 3b. Search and research: You.com by default [`research/youcom-for-agent-teams-2026-10-17.md`]

Decided (owner, 2026-10-17): You.com is the default web search for every information-gathering step. Tools are
plain `tool()` wrappers over the REST endpoints (no new dependency), `YDC_API_KEY` stays server-side, and every call
writes a ledger row (endpoint, tier, list price, latency) so search spend shows per agent.

| Tool | Endpoint | Who gets it | Notes |
|---|---|---|---|
| `web_search` | `POST ydc-index.io/v1/search`, `extraction_mode: highlights` | **every agent (default)** | highlights return only the relevant passages, so Flash reads fewer tokens; $5 / 1k |
| `fetch_page` | `POST ydc-index.io/v1/contents` | every agent | known URLs → Markdown; $1 / 1k pages |
| `answer` | `POST api.you.com/v1/answer` | analyst, Mira | one-pass cited answer for a sanity check; $5 / 1k |
| `research` | `POST api.you.com/v1/research` | researcher (all tiers), analyst, PM / HR / Mira (through the pipelines below) | tiers `lite` · `standard` · `deep` · `exhaustive` · `frontier` ($12–$1,200 / 1k); `output_schema` (not on `lite`); `source_control` (≤ 500 domains, freshness); `background: true` + SSE progress drives the "now" line |

- **Researcher archetype** gets a `you-research` SKILL.md: when to use search vs answer vs each research tier, how to
  write an `output_schema`, `source_control`, background mode, and budget rules. `exhaustive` and `frontier` go through
  an approval card like any spend.
- **Analyst** asks `output_schema` for the exact shape of a chart template, then writes the ` ```chart ` block.
- **👀 Dig in** on a research reply reruns it one tier higher.
- **Skill sourcing for orchestrators is code, not a search loop** (`find_skill(need, qualifications)`, one tool call
  for the PM / HR / Mira; the loop lives in the runtime so Flash spends no tokens searching):
  1. Look up the **skill library** (vetted picks, versioned per §8b). A hit costs $0.
  2. On a miss, one Research call at `deep` with `output_schema {skill_name, repo_url, publisher,
     is_official_publisher, install_command, last_updated, why_it_fits}` and `source_control` limited to github.com
     and skills.sh (~$0.10, 20–26 s; plain search failed this test, Research passed both hard cases).
  3. Vet in code: GitHub stars, drop forks and archived repos, rank by stars; scan the SKILL.md with the detector pack
     and injection checks (You.com doesn't vet: it ranked a 1-star repo #2 as "official"; Snyk found 76 malicious
     skills among 3,984).
  4. The owner approves (on the launch card for a new hire, or its own card later).
  5. Store the pick in the library with its provenance, so the next hire for that need doesn't search again.
- **HR** uses the same pipeline to look for a better skill before replacing a weak agent.
- **Privacy:** search and research are tier T3 (public read egress): queries are scanned before they leave, and
  results come back labelled `untrusted` (§6).
- **Q12 (decided) · Engineers stay on You.com** like everyone else (the owner's default). Revisit with our own eval
  if their docs lookups underperform: an independent coding-docs benchmark has You.com at 55% vs Exa at 83%.
- **Q13 (decided) · Mira's daily news check** is on: one research call per active project per day (~$0.36 per team
  per day, estimated).

## 4. The lead's memory and compaction [F]

- **Durable state** under `.data/projects/<pid>/state/`, written **only** by structured tools (mounted read-only for
  file tools): `charter.md`, `dag.json` (tasks + PM todos: id, status, owner, deps, acceptance, blocker, evidence,
  last report; ≤ 60 open), `decisions.md` (ADR: decision, why, approved by + ledger ref, supersedes; ≤ 25 active),
  `roster.json`, `open.json` (questions/risks; owner questions become cards), `prefs.md`, `journal/`, `windows/`.
- **Lead tools:** `add_task`, `update_task({id, expectedRev, …})` (legal transitions only; `done` needs evidence),
  `assign_task`, `record_decision`, `raise_item`/`resolve_item`, `note_owner_pref`, `update_member`, `log_progress`,
  `set_charter` (owner approval). Workers: `report({taskId, status, summary, evidence[], blocker?})` → runtime updates
  the DAG, roster and the lead's deltas [F §9.2].
- **Context order:** system (role, tools, SOUL+MEMORY, charter) → window opener (code-rendered state digest ≤ 4K +
  merged summary + file pointers) → append-only history → `<state_delta>` lines at the tail.
- **Triggers** on real `usage.input_tokens`: lead 64K soft / 96K hard, Mira 48K / 80K, workers 96K / 128K. Reason:
  every agent shares one 500K tokens/min bucket per model; a 170K call (the deepagents default) is 34% of it [F §4].
- **Compaction** replaces deepagents' summarizer (same middleware name): compact at idle, never mid tool round;
  an in-context, cached compaction turn files every **unfiled** owner message / report into state tools first, then
  writes a 9-section summary; validate; render a new opener from the files; **quiz** with 4 code-generated probes
  ("who owns t7, what blocks it"); retry once, else degrade with a longer tail and a ledger row [F §9.4].
- **Mira:** `.data/company/index.json` (code-computed rollups per project), company decisions, owner prefs, an inbox
  of everything waiting on the owner; read-only access to PM files.

## 5. Dreaming and the heartbeat

- **Dreaming** (per agent, background lane, never while the agent runs) [D §3b, D-dreaming-notes]:
  - Triggers: task end + 10 min idle · nightly 02:00 · project close (→ retro + talent profile) · memory over cap.
  - A cheap NOOP gate first (Nemotron Lightning: "anything worth remembering?"); the writer runs on main.
  - Output is **ops** (add / update / retire / noop), each citing evidence that code maps from short numbers, so it
    can't cite something that doesn't exist. Code validates and applies; ≤ 25% of items retired per dream; old file
    saved first; **SOUL.md never edited**; heartbeat transcripts never used as input.
  - Compaction vs dreaming: compaction is per thread and writes only the opener + state facts; dreaming is per agent
    and writes MEMORY.md; at project close it reads the DAG and decisions log.
  - **Q8 (decided):** dreams auto-apply with an undo and a diff in the profile; edits to cross-project memory or a
    talent profile ask the owner.
- **Heartbeat** (Mira only, timer) [A clone 1–2, B 7]: a read-only child reads a code-computed diff of the company
  and proposes; Mira decides. Speaks only on a listed trigger (meaningful change, completion, failure, an owner
  action needed) with a P0/P1/P2 tag; otherwise `QUIET` (with a logged reason; the app swallows it). Silent while her
  own last question is unanswered.

## 6. Privacy and tool rules [E]

- **Rule model:** our own JSON DSL `policy/v1` (Cedar-like semantics; Cedar/Rego can't express redact/ask, labelled
  flows, grants or budgets). Kinds: `tool`, `flow`, `grant`, `budget`, `classifier`. Labels: `secret.*`, `pii.*`,
  `owner_private`, `project:<id>`, `untrusted`. Sinks: Crusoe, LangSmith, web, email, APIs, own memory, cross-project
  memory, other teams. Most restrictive wins; grants only turn ask → allow; `locked` rules can't be relaxed [E §4].
- **Tiers:** T0 internal read and T1 internal write auto-allow · T2 memory auto for self, asks for cross-project ·
  T3 public read egress auto unless sensitive context or an untrusted destination · T4 communicate asks per recipient
  · T5 state-changing APIs ask · T6 money/credentials ask every time (secrets by reference only) · T7 shell denied
  without a sandbox [E §6].
- **Detector pack** (copy, local): gitleaks `config/gitleaks.toml` (MIT, 222 rules) + 3 secretlint rules (MIT) ·
  TypeScript ports of Presidio recognizers with context words and validators (MIT) · LangSmith's secret rules for
  traces · `jev-secrets` (MIT) approach: reversible pseudonymisation, re-scan after rewrite, refuse to send on a leak.
  **Not** trufflehog (AGPL) or secrets-patterns-db (CC-BY-SA). Port fixes: strip `(?i)`, `\z` → `$`, `(?P<` → `(?<`;
  scan in a worker with a timeout [E §3].
- **Enforcement points (verified):** Crusoe `fetch` wrapper · `wrapModelCall` (covers the system message, where
  SOUL/MEMORY live) · `wrapToolCall` for args and results (+ `humanInTheLoopMiddleware`, `interruptMode: "per_call"`)
  · `toolCallLimitMiddleware` for budgets · deepagents filesystem `permissions` for paths · LangSmith
  `createSecretAnonymizer` via `LangChainTracer({ client })` · memory/dream writes [E §8].
- **Natural language → rules:** compile with GLM-5.3 from trusted context only → schema-validated
  `{rules, assumptions, questions}` → ≤ 3 multiple-choice questions → plain-English read-back rendered **from the
  JSON** (so it can't disagree with what's enforced) → conflict check → **dry run** over the last 7–30 days of calls
  ("would block 3, redact 12, ask 5") → save in enforce or shadow mode [E §5].
- **Views:** V1 tool-call strip under each message (data-class chips + outcome: allowed / redacted / asked / blocked
  / shadow; click → spans, what the model saw, the rule) · V2 approval cards with grant scope (once / project /
  30 days), red blocked rows, "Recently blocked" · V3 data-flow Sankey (class → agent → sink; trifecta badge) ·
  V4 rules page (NL box, proposal + dry run, rules, grants with revoke, per-agent "what I can do") [E §7].
- **Q9 (decided):** LangSmith keeps tracing, with the secret anonymizer on.
- **Q10 (decided):** secrets are tokenized before Crusoe by default; PII only where a rule says so.
- **Q11 (decided):** the owner has no existing Jev rules. We design our own baseline from E §4.3 and add TypeSafe Jev
  as a hosted detector next to the local pack (`TYPESAFE_API_KEY` in `.env.local`).
- **Where the owner sees it:** a **Rules** tab next to Performance in the agent and team panels: rules in one-line
  read-backs with outcome chips, the per-agent "what I can do" sheet, and the natural-language box.
- Contract shared by the engine, routes and UI: `src/lib/policy/types.ts`.

## 7. Prompts [B §3]

- **Shared prefix** (identical for every agent): the system in third person · message envelope + trust labels ·
  reactions are orders · approval tiers · only tool calls reach anyone · report status lines (`result:` /
  `needs input:` / `failed:`) · truth rules · instruction priority · chat style.
- **Mira:** triage table · check existing agents before creating · ≤ 3 clarifying questions, once · proposal card
  via prepare → launch · dispatch and end the turn (never poll) · verify and relay · escalation list.
- **PM:** fixed setup checklist (Brief → Source → Staff → Approve → Kickoff) · staffing rule · assignment brief
  template (code fills fixed slots; the model writes only the task paragraph [B 1]) · lead loop · escalation.
- **Expert:** what each request type authorizes · ask vs proceed · advisor checkpoint (GLM-5.3) · self-check ·
  report contract · channel etiquette.
- **Dreaming:** offline, history only, act on nothing · inputs in order · consolidate → reflect → proposed ops.
- For DeepSeek Flash, copy the older and small-model prompt styles (if-then rules over judgment paragraphs) [B 5].
- Reply budget from app counters: owner away > 30 min → ≤ 80 words; ≥ 2 unanswered agent replies → status update
  instead of a message [B 8].

## 8. UI changes

- **Launch card v2:** brief, roster (new/rehired, why, record), budget, wake policy, "request revision".
- **Plan panel** from `dag.json`; **team panel** from `roster.json` + charter; **decisions** list.
- **Approval cards** from the `approvals` table (resume via `POST /api/approvals/[id]`), with grant scope.
- **Tool-call strip** (V1), **data flows** (V3), **rules page** (V4); dream diffs in the agent profile.

## 8b. Versioning and lineage [G]

Requirement (owner, 2026-10-17): every agent-facing file is versioned with git underneath, its history and diffs are
viewable, and a new agent's inheritance from past agents is visible as a graph.

- **One vault repo** at `.data/vault/` (separate from the app repo, never pushed): `agents/<id>/{agent.json, SOUL.md,
  MEMORY.md, notes.md, PROFILE.md, projects/, skills/}`, `skills/<archetype>/`, `projects/<pid>/state/*`,
  `company/*`. Per-agent repos or branches would break cross-agent inheritance, atomic multi-file commits and one-pass
  indexing.
- **git CLI** behind a small typed wrapper (`src/server/runtime/vault.ts`): 25 ms per commit, 18 ms for one file's
  history at 350 commits with git's commit-graph index; native trailers and the rewrite tooling "erase" needs.
  `isomorphic-git` is a documented fallback only.
- **One writer queue**; each write carries the file's expected blob hash (owner edits win over a racing dream).
  One commit per dream, per state-tool call or `report`, per owner save or 📌; notes once per run.
- **Commits** are authored by the actor; code writes the subject and **trailers**: `Change` (stable id that survives
  rewrites), `Source`, `Agent`, `Project`, `Run`, `Dream`, `Tool`/`Task`/`Rev`, `Op`, `Evidence`, `Seeded-From`,
  `Derived-From`, `Held-Back`, `Skill`, `Approved-By`, `Restores`/`Reverts`, `Forget`, `Labels`, `Redacted`.
- **Inheritance** = copy with per-item provenance in one "seed" commit (no git fork): project-scoped items filtered
  (the owner can opt them in on the launch card), near-duplicates across parents merged with both parents named,
  contradictions kept, size caps applied, everything left out recorded as `Held-Back`. Archetype skills track latest
  by default and can be pinned; inherited skills are copied and evolve separately.
- **Lineage index** (derived, rebuilt from `git log`): `vault_commits`, `vault_files`, `lineage_nodes`,
  `lineage_edges` with Graphiti's four timestamps; edges `seeded_from`, `derived_from`, `supersedes`, `evidence_of`,
  `produced_by`, `used_skill`, `version_of`, `in_project`, `held_back`. The `memories` table becomes derived too.
- **Privacy:** the writer scrubs secrets before anything touches the vault (a fourth enforcement point). **Forget**
  (default, reversible) removes the item and masks it in history views; **Erase from history** (irreversible) runs
  `git filter-repo`, gc and a reindex, then lists other places the text lives (checkpoints; LangSmith traces).
- **Views:** a History tab on every file (source chips, word diffs annotated per op, Restore as a new commit); a
  per-item timeline; a Lineage tab (generation columns, inherited vs held-back items, skill pins, an "as of" slider);
  a "learned 2 · View diff · Undo" chip for dreams; "Based on" on the launch card and profile.
- Needs `git-filter-repo` (python3 + `brew install git-filter-repo`) only for Erase.

## 9. Build order

Tracks run in parallel where they don't share files; each step ships with a test that fails when it's wrong
(tests listed in the cited section).

| Track | Steps |
|---|---|
| **R runtime** [D §11] | R1 durable thread *(building)* · R3 limiter + middleware order *(building)* · R2 home files + backends + permissions · R4 thread queue + DM inbox · R5 streaming bridge (SSE: plan, now line, ledger rows) · R6 approvals · R7 assignment round-trip · R8 scheduler (heartbeat + dreaming) |
| **M lead memory** [F §10] | M1 state module + tools · M2 worker `report` → DAG/roster/deltas · M3 window opener + replacement summarizer (cache hit ≥ 0.8 from turn 3) · M4 compaction turn files unfiled items · M5 quiz + fallback · M6 Mira rollups + dream at close |
| **P privacy** [E §10] | P1 detector pack + false-positive tests · P2 Crusoe + LangSmith scrub · P3 policy engine (a deny never relaxes) · P4 tool gate + approvals · P5 taint · P6 project boundary · P7 NL compiler (eval) · P8 UI |
| **S setup flow** | S1 Mira triage + `project` card v2 · S2 PM brief/source/staff tools + agent library · S3 provisioning (`POST /api/projects`) + kickoff |
| **W web tools** [§3b] | W1 `web_search` + `fetch_page` (You.com) as default tools, with ledger rows · W2 `research` + `answer` tools, researcher `you-research` skill, SSE → "now" line · W3 `find_skill` pipeline + skill library (library hit, deep research, vetting, approval, store) |
| **V vault** [G §9] | V1 writer + queue + trailers (25 concurrent writes → 25 clean commits) · V2 scrub + forget/erase (no secret anywhere in history; change ids survive) · V3 writers wired (dream, state tools, owner edits, 📌) · V4 lineage index (full rebuild = incremental) · V5 seeding from parents (filter, merge, Held-Back, pins) · V6 History + Lineage UI |
| **X toolsets** [H §7] | X1 registry + resolver *(building)* · X2 pure canvas ops *(building)* · X3 canvas tools + vault storage · X4 CanvasPane (Excalidraw) + artifact tabs · X5 doc + sources artifacts · X6 plan / board / dashboard / diff / table views + `describe` |
| **U UI** | U1 Plan/team panels from state files · U2 approval cards from the runtime · U3 tool-call strip · U4 rules page |

Order of dependence: R1–R4 → R5–R7 → M and S; P1–P3 can start any time; P4 after R6; U follows the step it renders.
Needs a working Crusoe key for R5 and M3 (the current key expires 2026-10-18).
