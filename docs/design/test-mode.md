# Test mode: simulated owner, recording and replay (design v1)

The owner wants a Stripe-style test mode. Pick a scenario, click once, and a simulated owner drives the real flow
with real tokens: the first DM to Mira, the team forming, the work, mid-project questions and new requirements.
Everything is recorded from the first message to the last action, so a demo can replay it fast without waiting
on the model. Running the same scenario again shows whether the company got better: team size, tokens, quality,
and the memory, skill and composition edits between runs.

Evidence: `docs/research/J-simulated-owner.md` (simulated users, scoring), `K-record-replay.md` (cassettes, tapes,
determinism), `L-test-mode-ux.md` (Stripe sandboxes and test clocks, simulation products, replay players),
`I-team-test-cases.md` (the case catalog the scenarios come from). Cited as `[J §…]`.

## 0. Decisions (owner, 2026-10-17)

- **Scenarios:** a product launch kit and a market research report (catalog cases C2 and C3). Each runs **three
  times on the same project and requirements**. A variant (same kind of work, a different client) is an optional
  fourth run that checks the learning transfers rather than memorizes.
- **The demo's bar:** quality and efficiency rise steadily from run 1 to run 3, visibly: higher rubric scores, less
  time to finish, fewer tokens, and readable diffs of the skills, memory and team composition that changed between
  runs. If run 2 isn't clearly better than run 1, the series stops and we rethink what to fix (§7).
- **One shared test company** for every scenario, kept apart from the real company. Runs build on each other the
  way a real company would, so a later scenario can rehire an earlier scenario's expert. Each run starts from a
  recorded snapshot, so any point can be restored or a fresh company started.
- **Hybrid owner.** Questions, new requirements and status checks are scripted and identical every run, so runs
  stay comparable. Reactions to deliverables (👍 / 🔁) come from a judge that checks each one against the
  scenario's criteria, so acceptance stays a real signal.
- **Build now, as acceptance tests.** Scenarios fail at the first missing piece of the runtime and turn green as
  it lands.
- **Real recording waits for the agent SDK** (the server runtime: threads, streaming, setup flow). Until then
  everything is built and tested against fakes; no tokens are spent.

## 1. The pieces

| Piece | What it does | Where | Needs |
|---|---|---|---|
| Scenarios | Background story, client brief and facts, the opening request, what the owner knows, scripted beats, gate and reaction policy, deliverables, claims, budget, trials | `scenarios/` (YAML + Markdown), schema in `src/lib/sim/scenario.ts` | — |
| Contracts | Tape events, owner actions, claim results, run summaries | `src/lib/sim/types.ts` | — |
| Owner driver | Event loop: watches the run, fires beats, decides gates, asks the judge, answers questions from known facts, stops | `src/lib/sim/driver.ts` (pure, port-based) + `src/server/sim/owner-llm.ts` | an adapter to the runtime's threads API |
| L1 cassette | Records every model HTTP exchange with chunk timing; replays it with zero tokens; fails closed on a miss with a diff | `src/server/sim/cassette.ts`, `modelFetch()` | `crusoe({ fetch })`, `callCrusoe` |
| L2 tape | The app-event stream of a run, `seq`/`t`/`dur` timed, with keyframes for seeking | `src/server/sim/tape.ts`, `.data/sim/tapes/<id>.jsonl` | runtime SSE (`token`, `now`, `plan`, `tool`, `done`, `error`), ledger and bus taps |
| Replay | Streams a tape back into the unchanged live UI at 1× / 4× / 16× / instant, with seek, skip-idle and markers | `GET /api/sim/replay/[id]` | the UI reading the same event shape |
| Claims | Code checks over the tape and the artifacts (team shape, single gate, direct posting, budget, deliverable rubrics); an advisory judge; pass^k | `src/lib/sim/claims.ts`, `src/lib/sim/checks/` | artifacts in the vault |
| Runs and comparison | Run index and per-run summary; run-over-run comparison of one scenario family, with vault diffs between run starts | `src/server/sim/runs.ts`, `src/lib/sim/compare.ts` | vault, ledger `run` field |
| Test company | A separate `DATA_DIR` copied from the live company once, snapshot before each run, reset to any snapshot | `src/server/sim/company.ts`, `npm run dev:test` | `src/server/paths.ts` `dataDir()` |
| UI (later) | TEST MODE banner, scenario picker, director strip, results, replay player, run comparison | `src/components/sim/` | the pieces above |

## 2. Scenarios [J §Recommendation, I §3]

A scenario is a YAML file under `scenarios/`, validated by `ScenarioSchema`. Every field is read by code; nothing
in it is a note to a person. The fields, in order:

- `id`, `family` (runs of one family are compared), `variant` (`base` or a name), `title`, `summary`.
- `story` (the shared background: the owner's studio and how it works) and `brief` (the client: product, buyers,
  facts F1–Fn the copy may cite). Both are Markdown files next to the scenario. The team sees only what the owner
  tells it and the files listed in `inputs`; the story and the grader notes never reach an agent.
- `request.text`: the opening DM to Mira, sent verbatim.
- `owner`: `persona` (tone only), `known` (facts the owner can give when asked), `unknownReply` (said for anything
  not in `known`; the owner never invents a requirement [J: τ²]).
- `expect`: `triage` (`project` or `solo`), `maxExperts`, `archetypes`, `deliverables` (id, kind, the archetype
  expected to make it, how to recognize the artifact), `mustHappen` and `mustNotHappen` milestones.
- `beats`: scripted owner actions with a trigger. The triggers are events: a team was created, a card appeared, an
  agent of an archetype posted for the nth time, a deliverable landed, another beat fired, the run went idle.
  Actions: send a message (to Mira, the lead, a channel, or an expert by archetype), pin a standing instruction,
  hold, advance the test clock.
- `gates`: the launch card (a sequence such as `revise: …` then `approve`, a revision cap, what to do with an
  unexpected extra card) and approval cards (a default, and rules matched on the title with a spend cap).
- `reactions`: for each deliverable, the rubric items the judge and the checks apply, the order on pass (`go`) and
  on fail (`redo`, with a note naming what failed), and a redo cap.
- `rubric`: per deliverable, `code` items (a named check from `src/lib/sim/checks/` with params) and `judge` items
  (one yes/no question). Code items gate; judge items are advisory until calibrated against the owner's labels.
- `stop`: `when` (e.g. every deliverable accepted), `maxOwnerActions`, `maxWallMin`, `idleMin`.
- `budget`: `maxUsd`, `maxTokens`. The driver ends the run at the cap.
- `improve`: the bar the next run of the series must clear (§7): `minQualityGain`, `qualityCeiling`,
  `minTimeCut`, `minTokenCut`.
- `trials` (default 3), `arms` (`team`, optionally `solo` for the same-budget baseline [I §5]), `models` (owner and
  judge tiers from the fixed set; the owner runs at temperature 0), `close` (close the project and run dreaming
  before the next trial, so the next one can learn).

## 3. The owner driver [J §Recommendation]

- Turn-based simulators (openevals, Promptfoo, DeepEval) assume one reply per user turn; our runs are event-driven
  (several agents post, cards appear). So the driver is our own loop: wait for an event, a pending gate, idleness or
  the deadline; apply the policy; repeat until a stop condition.
- It talks to the app through a **port**: `act(action)` and an async stream of tape events. Adapters: a fake (tests),
  the runtime's threads API (when the SDK lands). The driver never imports UI code.
- **Code decides; the model words.** Which beat fires, how a gate is decided, whether a deliverable passed: code and
  the judge's yes/no. The owner model only phrases answers to questions, from `owner.known`, at temperature 0. A
  question the facts can't answer gets `unknownReply`.
- Every decision is written to the tape as a `sim` event (beat fired, judge verdict with its failed items, stop
  reason), so the director strip and the fidelity check can read it.
- **Fidelity.** A run is *invalid* (not failed) if the simulated owner misbehaved: leaked a grader note, invented a
  requirement, or acted outside the script. Code checks the owner's own messages against `known` and the beats.

## 4. Recording [K]

Two recordings, because they serve different jobs:

- **L1 cassette (regression).** `modelFetch()` wraps `fetch` for model calls. Modes from `CASSETTE`: `off`,
  `record:<file>`, `replay:<file>`, `update:<file>`. It stores the canonical request (dates and UUIDs masked, no
  headers), status, time to first byte, and the raw chunks with their gaps. Matching is by `(key, occurrence)`, not
  order, because parallel tool calls arrive in different orders. A miss fails closed with a diff of the closest
  entry. The chat route's `callCrusoe` uses it; the runtime passes it to `crusoe(model, { fetch })`.
- **L2 tape (demo, claims, comparison).** One NDJSON file per run: a header (scenario, trial, arm, company snapshot,
  app commit, markers), then events with `seq`, `t` (ms on a monotonic clock since the start), optional `wall` and
  `dur`. Sources: the runtime's SSE stream (teed), `record()` in the ledger, `Bus.emit`, the driver's own actions and
  decisions. A keyframe of the UI state every ~10 s makes seeking cheap.
- **Determinism rules** [K §Determinism hazards]: everything time-based reads an injected clock; prompts take `now`
  as a parameter; a tape is one sample (re-record the whole run, never patch one entry); record retries and
  fallbacks as their own entries; never key on headers; strip `Authorization`.

## 5. Replay [K, L §8]

- `GET /api/sim/replay/[id]?speed=4&from=12000` streams the tape's events in the same shape the live stream uses,
  with `id: <seq>` so a dropped connection resumes. The UI runs its real code: mascots, streaming Markdown, panels.
- Owner actions render as if typed; they are never re-sent. Replay never calls a model, the vault or the ledger.
- Speeds 1× 2× 4× 8× 16× and instant; gaps longer than `idleCapMs` shrink to it (skip idle); seek = apply the last
  keyframe before T, fold the events up to T, schedule the rest. Markers: owner orders, cards, timers, budget, failed
  claims.
- Replay plays a recording; it does not re-run. "Fork from here" (a new live run from a checkpoint) is labeled as
  spending tokens.

## 6. Claims and scoring [J §Scoring, I §5]

- **Code checks gate** (from the tape, the ledger and the artifacts): triage matched; a PM led; at most
  `maxExperts` at launch; the launch card came before any work and was the only gate before kickoff; every
  expert posted its own work (the PM didn't relay); orders were honored (a 🔁 got a new version, ✋ stopped work);
  every deliverable exists and passes its code rubric; budget held; the run ended on a stop condition, not an error.
- **Judge items are advisory**: a different model family from the workers (GLM-5.3), only the deliverable and the
  one question, yes/no plus a quote.
- **Repeatability:** `trials` runs per arm; report pass^k (all k passed), the pass rate, and the spread of cost and
  wall time.
- **Team-worthy rule** (I §5): with a `solo` arm, the team must beat solo on pass rate at ≤ 1.5× solo cost.
- **Re-grade** runs a stored tape against edited claims without re-running the model.

## 7. Learning across runs

**What is measured, per run:**
- quality: the rubric pass rate on the final versions (code and judge items), first-pass acceptance (deliverables
  accepted without a 🔁), the number of redos;
- efficiency: **time to done** (first owner message → every deliverable accepted), tokens in / cached / out, USD,
  model calls, cache hit, team size, and a per-phase breakdown (triage, charter, staffing, launch, work, review,
  close, learn) with model wait time apart from everything else, because Crusoe latency and the rate limiter add
  noise to wall time;
- team: rehired vs created, archetypes and skills per role (the composition);
- what changed before the next run, from the vault: commits to each agent's `MEMORY.md` and `SOUL.md`, its skill
  files and the compositions, with diffs and the evidence each edit cites.

**A series** is runs with the same scenario file (hash), the same app commit and one starting company snapshot.
The comparison refuses to mix series. Fixing code or editing the scenario starts a new series at run 1, so an
improvement can't come from us changing the test or the app between runs.

**The improvement gate.** After each run, code compares it with the previous run of the series against the
scenario's `improve` bar (defaults: quality +10 points, or held at ≥ 95%; time to done −20%; tokens −15%). The
verdict is `improving`, `stalled` or `regressed`, with one line per bar missed. Anything but `improving` stops the
series and writes a rethink report: the phase breakdown side by side, the rubric items that failed in both runs,
the redo notes, and which learning edits were made and whether the next run used them.

**Keeping it honest:**
- Each run is a new project. Earlier runs' project files (charter, deliverables, research) are invisible to later
  runs (the project boundary, Q3). Only learning carries over: memory, skills, compositions, rehiring.
- A leak check (`facts_in_learning`) fails a run whose learning edits contain the client's facts, the competitor
  names or prices from the brief: the company must learn how to do the work, not memorize the answer.
- The variant run (a new client, same requirements) is the transfer check: if run 3 improved but the variant
  falls back to run-1 levels, the company memorized the scenario.

## 7b. The learning step (a gap in the runtime plan)

The demo depends on something the runtime plan doesn't include yet. Dreaming (team-setup §5) edits `MEMORY.md`,
and no step edits **skills**. Proposed, at project close (`close.learn`), in order, each step a vault commit that
cites evidence from the run (failed rubric items, 🔁 notes, slow phases):
1. **Retro** by the PM: what went wrong and what was slow, from the tape and the ledger (code-computed numbers).
2. **Dream** per agent: `MEMORY.md` ops (team-setup §5), validated by code.
3. **Skill tuning** per agent: edits to the agent's own copy of each skill it used (SKILL.md), only where a failed
   item or a 🔁 note points at a gap in the skill; size-capped, scanned, shown as a diff with undo (Q8).
4. **Composition note** for Mira and the PM: the roster, its cost and outcome, so the next staffing for this kind of
   work can adapt it (team-setup §2: compositions adapted from past compositions and their outcomes).
This belongs to the runtime track (M6, R8); test mode measures it, and the improvement gate tells us whether it works.

## 8. The test company [L §5, §6]

- A separate data directory (`DATA_DIR=.data/test-company`) served by its own dev server (`npm run dev:test`, port
  3001, `APP_MODE=test`), so live stats, memory and the vault never see test data. Created once by copying the live
  company's agents, skills and rules; never synced back.
- Before each run: a snapshot (vault commit id plus the ledger's row count) recorded in the tape header. Reset =
  restore a snapshot; a fresh company = a new directory.
- Test clock: heartbeats, dreams and budget checks read the run clock; the driver can advance it ("next heartbeat",
  "02:00 dream", "close the project") and every timer in the skipped window fires in order.
- External effects are off by default in test mode (email, posting, purchases); web search and reading stay on.
- Every screen in test mode shows a TEST MODE banner; replays say REPLAY with the speed and the recording date.

## 9. Build steps

| # | Step | Depends on | Status |
|---|---|---|---|
| T1 | Contracts + scenario schema + scenario files (stories, briefs, requirements) | — | building |
| T2 | L1 cassette + `modelFetch`, wired into `callCrusoe` | — | building |
| T3 | L2 tape writer/reader, ledger and bus taps, tape routes, replay endpoint with speed/seek | — | building |
| T4 | Owner driver (pure) + owner LLM helpers (reply wording, judge) | T1 | building |
| T5 | Claims, deliverable checks, pass^k, re-grade | T1 | building |
| T6 | Runs index, summaries (quality, time to done, phases), series, improvement gate, rethink report, run comparison with vault diffs | T3, T5, vault | after T3 |
| T7 | Test company: data dir, snapshot, reset, `dev:test`, test clock | `paths.ts` | after paths.ts merges |
| T8 | Runtime adapter for the driver; tee the runtime SSE into the tape | the agent SDK | waits |
| T9 | Test-mode UI | T3–T7 | later |
| T10 | First real recordings (golden runs) | T8, a valid Crusoe key | waits |
| T11 | The learning step at project close: retro, dream, skill tuning, composition note (§7b) | runtime M6/R8 | to agree with the runtime track |
