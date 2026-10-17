# J. Simulated owner: how others build simulated users, and what Agent Teams should copy

Researched 2026-10-17. Scope: research only. No installs, no LLM calls, no clones. Package facts come from the npm registry JSON and raw GitHub files. LangSmith 0.9.0 / deepagents 1.15.0 / langchain 1.5.18 facts come from the type declarations already installed in `/Users/tk/Desktop/agent-teams/node_modules`. Paper quotes marked "(summarised)" were pulled through a summarising fetcher and not read line by line. See `## Unverified`.

## Sources

1. openevals JS source: `js/src/simulators/multiturn.ts`, `js/src/simulators/prebuilts.ts`, main branch, read 2026-10-17. https://github.com/langchain-ai/openevals/tree/main/js/src/simulators
2. openevals autodocs API reference (`_autodocs/api-reference/simulators.md`, `llm-as-judge.md`, `configuration.md`), read via Context7 `/langchain-ai/openevals`. https://github.com/langchain-ai/openevals/tree/main/_autodocs
3. openevals npm registry metadata: latest `0.2.2` (published 2026-08-18). Its deps are `langsmith >=0.6.0`, `langchain >=1.2.27`, `@langchain/openai >=0.4.4`, and peer `@langchain/core >=0.3.73`. https://registry.npmjs.org/openevals
4. openevals `js/package.json` on main: `langsmith >=0.10.5` (raised from `>=0.10.2` in commit `e7c7be9`, 2026-10-02, not yet released). https://github.com/langchain-ai/openevals/blob/main/js/package.json
5. agentevals JS README and autodocs (`js-trajectory-match.md`, `js-graph-trajectory-utils.md`, `index.md`), via Context7 `/langchain-ai/agentevals`. https://github.com/langchain-ai/agentevals
6. agentevals npm registry metadata: latest `0.0.7` (2026-03-03). Deps are `langsmith >=0.4.6` and `openevals ^0.1.4`, with peer `@langchain/langgraph >=0.2.46`. https://registry.npmjs.org/agentevals
7. deepagents `1.15.0` package.json (installed): `peerDependencies.langsmith = ">=0.7.1 <0.10.0"`. `/Users/tk/Desktop/agent-teams/node_modules/deepagents/package.json`
8. langsmith JS `0.9.0` (installed) type declarations and source: `dist/evaluation/_runner.d.ts`, `dist/vitest/index.d.ts`, `dist/utils/jestlike/types.d.ts` and `index.js`, `dist/run_trees.d.ts`, `dist/singletons/traceable.js`.
9. LangSmith docs, "Multi-turn simulation". https://docs.langchain.com/langsmith/multi-turn-simulation
10. LangSmith docs, "Multi-turn online evaluators", and the LangSmith changelog entry on the 120 s thread idle minimum. https://docs.langchain.com/langsmith/online-evaluations-multi-turn · https://docs.langchain.com/langsmith/changelog
11. LangSmith docs, "Threads". https://docs.langchain.com/langsmith/threads
12. LangSmith docs, "Repetitions". https://docs.langchain.com/langsmith/repetition
13. LangSmith docs, "Vitest/Jest". https://docs.langchain.com/langsmith/vitest-jest
14. Yao, Shinn, Razavi, Narasimhan, "τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains", arXiv:2406.12045 v1, 2024-06-17. https://arxiv.org/abs/2406.12045
15. τ-bench repo: `tau_bench/envs/user.py`, `tau_bench/envs/base.py`, `run.py`, `README.md` (main, read 2026-10-17). https://github.com/sierra-research/tau-bench
16. Barres, Dong, Ray, Si, Narasimhan, "τ²-Bench: Evaluating Conversational Agents in a Dual-Control Environment", arXiv:2506.07982 v1, 2025-06-09. https://arxiv.org/abs/2506.07982
17. τ²-bench repo (main, read 2026-10-17): `data/tau2/user_simulator/simulation_guidelines.md`, `simulation_guidelines_tools.md`, `docs/evaluation.md`, `src/tau2/evaluator/AGENTS.md`, `src/tau2/evaluator/review_llm_judge_user_only.py`, `src/tau2/data_model/tasks.py`, `src/tau2/data_model/simulation.py`, `data/tau2/domains/airline/policy.md`. https://github.com/sierra-research/tau2-bench
18. Inspect AI docs: "Metrics" (epochs and reducers), "Setting Limits", `inspect_ai.util` reference (`cost_limit`). https://inspect.aisi.org.uk/metrics.html · https://inspect.aisi.org.uk/setting-limits.html · https://inspect.aisi.org.uk/reference/inspect_ai.util.html
19. inspect_evals τ² port: `src/inspect_evals/tau2/README.md` and `common/agents.py` (main, read 2026-10-17). https://github.com/UKGovernmentBEIS/inspect_evals/tree/main/src/inspect_evals/tau2
20. DeepEval (Python) docs: Conversation Simulator, Stopping Logic, Simulation Graph, ConversationalGolden. https://deepeval.com/docs/conversation-simulator · https://deepeval.com/docs/conversation-simulator-stopping-logic · https://deepeval.com/docs/conversation-simulator-simulation-graph
21. DeepEval TypeScript SDK: npm `deepeval` `0.9.23` (2026-10-16) and `typescript/src/simulate/index.ts`. https://github.com/confident-ai/deepeval/blob/main/typescript/src/simulate/index.ts
22. Promptfoo "Simulated User" provider docs, plus source `src/providers/simulatedUser.ts` (main) and npm `promptfoo` `0.124.1` (2026-10-08). https://www.promptfoo.dev/docs/providers/simulated-user · https://github.com/promptfoo/promptfoo/blob/main/src/providers/simulatedUser.ts
23. Braintrust docs: "Run evals in code" (`trialCount`), "Custom code scorers" (`trace.getSpans`, `trace.getThread`), and the "Evaluating a multi-turn chat assistant" cookbook. https://www.braintrust.dev/docs/evaluate/run-in-code · https://www.braintrust.dev/docs/evaluate/custom-code
24. Langfuse docs: "Simulated multi-turn conversations" cookbook and "Experiments via SDK" (JS `langfuse.experiment.run`). https://langfuse.com/guides/cookbook/example_simulated_multi_turn_conversations · https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk
25. Maxim docs: "Simulation (via SDK)", "Custom Simulation", and the REST API `POST /v1/test-runs/simulations`. https://www.getmaxim.ai/docs/offline-evals/via-sdk/simulation · https://www.getmaxim.ai/docs/simulations/text-simulation/custom-simulation · https://www.getmaxim.ai/docs/test%20runs/simulation/trigger-simulation-test-run
26. Lu et al., "ToolSandbox: A Stateful, Conversational, Interactive Evaluation Benchmark for LLM Tool Use Capabilities", arXiv:2408.04682 (v1 2024-08-08, revised 2025-04-16). https://arxiv.org/abs/2408.04682
27. Laban, Hayashi, Zhou, Neville, "LLMs Get Lost In Multi-Turn Conversation", arXiv:2505.06120, 2025-05-09. https://arxiv.org/abs/2505.06120
28. Anthropic Engineering, "Demystifying evals for AI agents", 2026-01-09. This is a vendor blog and describes Anthropic's practice, not facts about any tool. https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
29. langchain `1.5.18` (installed) `dist/agents/middleware/hitl.d.ts`: `HITLRequest`, `Decision`, `HITLResponse`, and the `Command({ resume })` example.
30. Agent Teams source (read only): `src/lib/orders.ts`, `src/lib/types.ts`, `src/lib/tracing.ts`, `src/server/runtime/agents.ts`.

## Tools compared

| Tool | What it simulates | API shape | JS/TS? | Fits langsmith 0.9? | Lesson for us |
|---|---|---|---|---|---|
| **openevals** (LangChain) | An LLM or static user in a strict user→app→user chat loop. | `runMultiturnSimulation({ app, user, maxTurns?, stoppingCondition?, trajectoryEvaluators?, referenceOutputs?, threadId? })` returns `{ trajectory, evaluatorResults }`. `app({ inputs, threadId })` must return one message. `user` is a callable `({ trajectory, turnCounter })` or a string list. `createLLMSimulatedUser({ system, model? \| client?, fixedResponses? })` [1][2] | **Yes** (npm `openevals` 0.2.2) [3] | **Yes, by range, if pinned.** Published 0.2.2 declares `langsmith >=0.6.0` [3]. Main already declares `>=0.10.5` [4], so the next release would conflict with deepagents' `<0.10.0` peer [7]. Pin `openevals@0.2.2` exactly. | Reuse its two LLM pieces: the role-flipping simulated user, and `createLLMAsJudge` with `judge: BaseChatModel` so we can pass Crusoe [2]. Don't use its loop as our harness: it alternates strictly, takes one message per turn, has no gates, and catches evaluator exceptions with `console.error` instead of failing [1]. |
| **agentevals** (LangChain) | Nothing simulated. It scores agent trajectories. | `createTrajectoryMatchEvaluator({ trajectoryMatchMode: "strict"\|"unordered"\|"subset"\|"superset", toolArgsMatchMode, toolArgsMatchOverrides })`, `createTrajectoryLLMAsJudge({ model, prompt: TRAJECTORY_ACCURACY_PROMPT })`, `extractLangGraphTrajectoryFromThread(graph, config)` [5] | **Partial.** JS has message-trajectory match, the LLM trajectory judge, and graph-trajectory LLM judge. `graphTrajectoryStrictMatch` is not exported from the TS entry point [5]. | Yes by range (`langsmith >=0.4.6`), but it pulls a nested `openevals ^0.1.4` [6]. | Matching tool calls one by one is the wrong level for a team run. We care about events (proposal, launch, posts), not exact tool sequences. Copy the **subset/superset** idea only: required events present, forbidden events absent. |
| **LangSmith** experiments, vitest, thread evaluators | Doesn't simulate. Hosts datasets, experiments, repetitions and thread-level judges. | `evaluate(target, { data, evaluators, summaryEvaluators, numRepetitions, maxConcurrency, experimentPrefix, metadata })` [8][12]. `langsmith/vitest`: `ls.describe`, `ls.test(name, { inputs, referenceOutputs, config: { repetitions } }, fn)`, `ls.logOutputs`, `ls.logFeedback`, `wrapEvaluator`. The test fn gets `testMetadata.repetition` [8][13]. Threads are grouped by `metadata.thread_id` or `session_id` [11]. Online thread evaluators are LLM-judge only, need ≥2 min idle, and don't run on experiments [10]. | **Yes** (all of the above are in 0.9.0's `.d.ts`) [8] | **Native** | The simulated run goes **inside** an `ls.test` with `config.repetitions = k`, or inside an `evaluate` target with `numRepetitions`. The docs show this exact pattern with openevals [9]. The UI only shows the mean and std across repetitions [12], so pass^k must be computed by us, for example in a `summaryEvaluators` entry. |
| **τ-bench** (Sierra) | An LLM customer with a hidden instruction. It stops by emitting `###STOP###`. | `load_user(user_strategy ∈ {human, llm, react, verify, reflection}, model, provider)`, then `reset(instruction)` and `step(content)`. `env.step(action)` ends on `###STOP###` or a terminate tool. The reward compares the DB hash to a gold replay and checks required output strings [15]. | **Python-only** [15] | n/a | Copy the system-prompt rules, the hard stop token, outcome-based reward and **pass^k** [14][15]. Track user-simulator cost separately (`get_total_cost()`) [15]. |
| **τ²-bench** (Sierra) | An LLM user with its **own tools** on a shared state (dual control), a persona and a structured scenario. | `UserScenario { persona, instructions: StructuredUserInstructions { domain, reason_for_call, known_info, unknown_info, task_instructions } }`. `EvaluationCriteria { actions, env_assertions, communicate_info, nl_assertions, reward_basis }`. Stop tokens are `###STOP###`, `###TRANSFER###` and `###OUT-OF-SCOPE###`. `TerminationReason` covers user_stop, agent_stop, max_steps, timeout, too_many_errors, … [17] | **Python-only** [17] | n/a | The closest model for our scenario file. Score the end state, not the path [17]. Any premature termination scores 0 [17]. Run a **simulator-error reviewer** on every run [17]. Constrain the user with tools; the paper reports lower simulator error that way [16]. |
| **Inspect AI** (UK AISI) and the **inspect_evals** τ² port | General eval framework. The τ² port runs the user simulator as an agent with `get_model(role="user")` at temperature 0 [19]. | `Task(epochs=Epochs(k, ["mean", "pass_k_3", "at_least_2"]))`. The `pass_k_{k}` reducer cites τ-bench [18]. Limits: `message_limit`, `token_limit`, `time_limit`, `working_limit`, `cost_limit` raise `LimitExceededError` [18]. | **Python-only** [18] | n/a | Treat repeats and budgets as first-class config (epochs, reducers, limits), not afterthoughts. Separate model roles for the SUT and the user. The τ² port warns that some evals consume **over 60M tokens** and suggests `--limit 5 -T message_limit=10` [19]. |
| **DeepEval** ConversationSimulator | An LLM user from a "golden" (scenario, expected outcome, persona). Python adds a **scripted state graph**. | Python: `ConversationSimulator(model_callback, simulator_model, stopping_controller, simulation_graph)` and `.simulate(conversational_goldens, max_user_simulations=10)`. `ConversationalGolden { scenario, expected_outcome, persona, context, ... }`. `SimulationNode(action, name, max_visits, terminal)` with `node.add_node(child, when="…")`, where an LLM router picks the edge. `stopping_controller` returns `proceed()` or `end(reason)` [20]. | **Partial.** The TS `ConversationSimulator({ modelCallback }).simulate({ conversationalGoldens, maxUserSimulations })` exists, but each turn and the completion check go to Confident AI's hosted `SIMULATE_ENDPOINT`. The TS source has no graph and no stopping controller [21]. | n/a (separate platform) | The **SimulationGraph** is the best public example of a hybrid gate policy: scripted user turns, an LLM that only classifies the agent's reply, and caps such as `max_visits=3` ("complain three times, then give up") [20]. |
| **Promptfoo** `promptfoo:simulated-user` | An LLM user inspired by τ-bench. It stops on `###STOP###` or `maxTurns` [22]. | Config `{ instructions (Nunjucks), maxTurns=10, initialMessages, stateful=false }`. It checks for `###STOP###` before sending the user message to the target. It accumulates target and simulated-user token usage separately [22]. | **Yes** (Node) [22] | n/a (no langsmith dep) | JS-native, but the user turns come from **Promptfoo's hosted model**: the source always constructs `PromptfooSimulatedUserProvider` with `taskId 'tau'` [22]. That's no good for our Crusoe-only, real-token setup. Worth copying: `initialMessages` to start mid-flow, and `stateful` for targets that keep their own history. |
| **Braintrust** | No built-in simulated user (the voice cookbook delegates to Evalion) [23]. | `Eval(name, { data, task, scores, trialCount, maxConcurrency, metadata })`. Scorers can read the trace: `trace.getSpans({ spanType: ["llm"] })` and `trace.getThread()` [23]. | **Yes** [23] | n/a (second backend) | The **trace-aware code scorer** idea, such as "number of LLM spans between 3 and 5" [23], is exactly how our structural checks should read the run. `trialCount` is their name for repeats. |
| **Langfuse** | No native simulator. Their cookbook uses openevals `run_multiturn_simulation` [24]. | JS: `langfuse.experiment.run({ name, data, task, evaluators, runEvaluators, maxConcurrency, metadata })` [24] | **Yes** (experiments). The simulation cookbook itself is Python [24]. | n/a | More evidence that openevals is the de facto simulator. Run-level evaluators (`runEvaluators`) are their place for pass^k-style aggregates [24]. |
| **Maxim** | An LLM user with a scenario, persona and expected steps. A custom simulator gets an auto-appended **`end_simulation` tool** [25]. | Python SDK: `create_test_run(...).with_simulation_config(SimulationConfig(max_turns=...)).with_data(...)`. Its `yields_output(data, sim_ctx)` receives `SimulationContext { conversation_history, current_user_input, turn_number, total_cost, total_tokens }`. REST: `POST /v1/test-runs/simulations` with `simulationConfig { maxTurns, persona, … \| CUSTOM { model, provider, simulatorPrompt } }` [25]. | **Partial.** The simulation SDK docs are Python-only. A REST endpoint exists [25]. JS SDK simulation support is unverified. | n/a | Use a **tool call** to end rather than a magic string, and give the target running **cost/tokens per turn** so budget stops can fire mid-run [25]. |
| **ToolSandbox** (Apple, research) | An LLM user with a goal, a **knowledge boundary** and demonstrations. It can only call `end_conversation` [26]. | Score is milestones (a DAG of must-happen state snapshots, matched in any valid order) × an indicator that no **minefield** (must-not-happen event) occurred [26]. | **Not a JS library.** It's a research benchmark; the repo language wasn't checked. | n/a | **Milestones + minefields** is the right score for "the launch card was the only gate": an extra gate is a minefield and zeroes the run [26]. |
| **Laban et al.** (research) | An LLM user that reveals a pre-sharded instruction, **at most one shard per turn** [27]. | A research method, not an API | **Not a library**: it's a technique we would implement ourselves | n/a | Controls disclosure in code: the request is split ahead of time and the simulator only picks which shard to reveal next. Simulator plus extraction errors were under 5% of inspected conversations (summarised) [27]. |

## Simulator design rules

- **Give the simulator a private brief split into what it knows and what it doesn't.** τ² scenarios carry `known_info` and `unknown_info`, and the guidelines say unknown information "should be considered unknown or unavailable" [17]. τ-bench says to answer "I do not remember" instead of inventing an order id [15]. ToolSandbox's knowledge-boundary prompt is credited with cutting simulator hallucination (summarised: 6.97% hallucination, 0.77% instruction errors with boundary plus demonstrations) [26].
- **Disclose progressively, never all at once.** "Do not give away all the instruction at once" and "Do not repeat the exact instruction" [15]. τ² says "Disclose information progressively. Wait for the agent to ask" [17]. The strongest form is pre-sharding the request and revealing at most one shard per turn [27].
- **Make the end machine-checkable and check it before sending.** Use the stop tokens `###STOP###`, `###TRANSFER###` and `###OUT-OF-SCOPE###` [15][17]. The last one stops the run instead of letting the simulator improvise when the scenario has no answer [17]. Alternatively use an end tool: `end_conversation` [26], `end_simulation` [25]. Promptfoo checks the stop token before forwarding the message [22].
- **Put hard caps outside the simulator and record why the run ended.** The τ-bench paper caps each task at 30 agent actions (summarised) [14]. Other caps: `maxTurns` [1][22], `max_user_simulations` [20], `max_visits` [20], Inspect's `message_limit` / `token_limit` / `cost_limit` [18]. τ² records a `TerminationReason`, and any reason other than `AGENT_STOP` or `USER_STOP` scores 0 before any evaluator runs [17].
- **Constrain the simulator with actions rather than prose.** In τ² the user acts through tools on shared state. The paper reports total simulator error of 16% in telecom (tool-constrained) against 40% retail and 47% airline (summarised) [16]. For us, approvals and reactions are a closed action set and should be typed actions, not free text.
- **Audit the simulator on every run.** τ²'s `review_llm_judge_user_only.py` tags each user turn with `hallucination`, `revealed_info_early`, `premature_termination`, `inconsistent_behavior` and others. It grades severity as `critical_helped`, `critical_hindered` or `minor`. It explicitly does not blame the user for giving up when the agent stalls [17]. τ-bench's auto error identification assigns fault to user, agent or environment [15]. τ-bench's `verify` and `reflection` strategies regenerate a user turn that a second LLM call rejects [15]. A run flagged `critical_*` is a broken test, not an agent failure.
- **Keep the simulator stable and separate from the system under test.** The inspect_evals τ² port runs the user model through `get_model(role="user", config=GenerateConfig(temperature=0.0))` [19]. τ-bench takes `--user-model` and `--user-model-provider` separately from the agent model [15].
- **Pin the opening turn verbatim and store the simulator brief in the dataset.** openevals `fixedResponses` are used by turn index before the LLM takes over [1]. LangSmith's docs put `simulated_user_prompt` and the first `messages` in each dataset example [9]. Promptfoo uses `initialMessages` to start mid-flow [22].
- **The simulator sees only what a human would see.** openevals drops tool-call and tool messages from the simulated user's view and flips roles [1]. τ² user tool calls are hidden from the agent [17]. Our owner should see only the DMs, channel posts and cards the UI shows.
- **Meter the simulator's own cost separately.** τ-bench reports `info.user_cost` [15]. Promptfoo keeps separate counters for the target and the simulated user [22]. Maxim exposes running `total_cost` and `total_tokens` to the target each turn [25].
- **Write scenarios so that exactly one outcome is correct.** τ-bench instructions are designed so that "only one possible outcome under the domain policy" exists [14]. Anthropic's blog, which is a vendor opinion and not a tool fact, reads 0% pass@100 as "a broken task" and recommends a reference solution per task [28].

## Gates and reactions

**Three policy styles appear in the wild:**

1. **Scripted (deterministic).** openevals accepts `user` as a list of strings consumed by turn [1]. LangChain HITL resumes an interrupt with a coded decision: `HITLRequest { actionRequests, reviewConfigs }`, answered by `new Command({ resume: { decisions: [{ type: "approve" | "edit" | "reject" | "respond" }] } })` [29]. agentevals' README resumes an `interrupt()` with a fixed answer [5]. This is fully reproducible but can't react to content.
2. **LLM decides, guided by rules in natural language.** τ-bench and τ² gates are confirmations. The airline policy requires the agent to "obtain explicit user confirmation (yes)" before any write [17]. The simulated user decides from conditional preferences in its brief, for example "If only one certificate can be used, you prefer using the larger one…" (a τ-bench task reused in Promptfoo's docs [22]). This handles open questions but is a source of simulator error [16][17].
3. **Hybrid.** DeepEval's `SimulationGraph` uses scripted `action` functions per state. An LLM router only classifies the assistant reply against edge descriptions (`when="The assistant refused…"`). `max_visits` and `terminal=True` bound it [20]. openevals `fixedResponses` give a scripted prefix with an LLM tail [1]. τ² user tools give LLM choice inside a typed action space [17].

**How this maps to Agent Teams.** The app already models gates as typed messages. A `proposal` (the launch card) has `state: "pending" | "launched"`. An `approval` has `state: "pending" | "approved" | "declined"` [30]. Reactions are five fixed `OrderKey`s (`go`, `dig`, `redo`, `hold`, `pin`), and each becomes text the agent receives via `orderText()` [30]. So every owner decision except free-text replies is a closed choice, and the policy for those should be **scripted and per scenario**. That makes a failure attributable to the team, not to the simulator.

- Use an LLM only to (a) answer clarifying questions from `knownInfo` and (b) phrase a revision note when the policy says "revise".
- If a gate shows up as free text rather than a card, which is itself a defect we want to catch, a DeepEval-style LLM router may *classify* it [20]. It must not *decide* it.
- If the launch card is later implemented as a LangChain HITL interrupt, the scripted decision maps one-to-one onto `Decision.type` [29].

No public framework found simulates emoji-style reactions (see Unverified). The closest analogue is τ²'s user tools: a constrained action the user takes on shared state [16][17].

## Scoring a team run

**Score outcomes and events, not exact paths.** τ²'s `actions` field is "one reference trajectory … not the only correct one". By default the reward is the end-state DB hash × required communications, multiplied together so any zero zeroes the total [17]. Anthropic's blog (vendor opinion) warns that checking specific step sequences is "too rigid" [28]. ToolSandbox's milestones (DAG order, any valid path) × no-minefield is the right shape for us [26].

**Deterministic code checks.** These read the message log and ledger, which carry typed `kind`, `from` and `state` fields [30]. Each check fails the run outright.

| Check | Pass condition | Data |
|---|---|---|
| Triage | Solo vs project matches `expect.triage` (a solo handoff vs a `proposal` from Mira) | Message kinds in the owner↔Mira DM |
| Team size | `proposal.project.members.length ≤ 3`, and every member id resolves to a real archetype or agent | `Project.members` [30] |
| Skills real | Every staffed skill id exists in the skill library | Skill library lookup |
| Single gate (minefield) | Before launch, the owner saw exactly one gate type: the proposal(s). No `approval` card and no "should I proceed?" text before launch. | Message order |
| Launch only after approval | Team or channel exists only after the owner approved, and never after a decline | Event timestamps |
| Revision honored | After "revise", a new proposal appears that differs from the prior one, and there are at most `maxRevisions` cycles | Proposal diffs |
| Kickoff | The first post in the new channel is from `leadId` and names an assignment for each member | Channel messages |
| Experts post directly | Each expert has ≥1 `text` message with `from === expertId` in the channel | Channel messages |
| Orders honored | After ✋ (`hold`), no new work on that item until 👍 (`go`). After 🔁 (`redo`), a new version follows. After 📌 (`pin`), a standing instruction is stored. | Messages and ledger |
| Mid-project approvals | Every `approval` reaches a final state that matches the policy, and a declined action is not carried out anyway | Approval states |
| Budget held | Total tokens and USD ≤ `budget` (per role and total), wall clock ≤ cap | Token usage on runs |
| Clean termination | Ended by `owner_stop` or `done`, never by max turns, timeout or error. Anything else scores 0, as in τ² [17]. | Harness |

**LLM-as-judge, advisory unless a rubric is calibrated.** Use the judge for charter quality against the request, whether expert work addresses the brief, kickoff clarity and final artifact quality.

- Use openevals `createLLMAsJudge({ prompt, judge: <ChatOpenAI→Crusoe>, choices: [0, 0.5, 1], useReasoning: true, fewShotExamples, feedbackKey })` [2].
- Run a separate **simulator-fidelity judge** modelled on τ²'s user-only reviewer [17]. Runs it flags `critical_helped` or `critical_hindered` are **excluded and counted**, not scored.
- LangSmith's online thread evaluators are for production threads only. They are LLM-only, wait ≥2 min of idle, and can't take experiments as a source [10].

**Repeatability.**

- Run each scenario k times. τ-bench used ≥3 trials for main results and τ² used 4 (summarised) [14][16].
- Report c/n, pass^1 and **pass^k = E_task[C(c,k)/C(n,k)]** [14], implemented in τ-bench `run.py` as `comb(c, k) / comb(num_trials, k)` averaged over tasks [15]. Inspect ships the same reducer as `pass_k_{k}` [18].
- LangSmith shows only the mean and std across repetitions [12]. Compute pass^k ourselves. One route is a `summaryEvaluators` function that groups `runs` by `reference_example_id`, both available in 0.9.0 [8]. The other is to aggregate `testMetadata.repetition` results in vitest [8].
- Also track the **invalid-run rate** (simulator-flagged) and the **termination-reason histogram**.

**Cost per run.**

- Meter three roles separately: team (the system under test), owner simulator and judge [15][22].
- Enforce caps inside the run, in the spirit of Inspect's cooperative `cost_limit` [18], not after the fact.
- Expect τ²-scale runs to be expensive: the Inspect τ² port warns of more than 60M tokens for some evals [19].
- Start small: 3–5 scenarios × k=3 for capability work. Run regression scenarios more often once they pass reliably; Anthropic's "graduate to regression" practice is a vendor opinion [28].

## Recommendation for Agent Teams

**Build our own TypeScript owner driver and run it in vitest under `langsmith/vitest`.** Borrow only openevals' LLM helpers. Turn-based simulators (openevals, Promptfoo, DeepEval) assume one reply per user turn. Our product is event-driven: several agents post, cards appear, and the owner acts on reactions and gates.

- **Loop:** wait for one of `gate_pending | idle(idleMs) | deadline`, apply the owner policy, and repeat until `stop` fires.
- **Experiment wrapper:** `ls.describe` / `ls.test(..., { inputs: scenario, config: { repetitions: k } })` [8][13]. Do the pass^k math in our reporter.
- **Optional dependency:** `openevals@0.2.2`, pinned exactly (its range admits langsmith 0.9 [3]; main does not [4]). Use it for `createLLMSimulatedUser({ client })` (free-text replies only) and `createLLMAsJudge({ judge })`, both pointed at Crusoe through a LangChain `ChatOpenAI` [2].
- **Skip:** agentevals [5], Promptfoo (hosted user model [22]) and DeepEval TS (hosted simulation [21]).

**Scenario file fields** (one YAML per scenario):

- `id`, `title`, `suite: capability | regression`, `tags`
- `request.text`: the opening DM to Mira, sent verbatim.
- `request.shards[]` (optional): details revealed at most one per owner turn [27].
- `owner.persona`, `owner.knownInfo[]`, `owner.unknownInfo[]` (unknown → "I don't know, your call") [17][26]
- `expect.triage: solo | project`, `expect.maxExperts: 3`, `expect.requiredArchetypes[]?`, `expect.requiredSkills[]?`
- `expect.mustHappen[]` (milestones: `proposal`, `launch`, `kickoff_by_pm`, `post_by_each_expert`, …) and `expect.mustNotHappen[]` (minefields: `approval_before_launch`, `launch_without_approval`, `relay_by_pm_only`, …) [26]
- `policy`: see below
- `stop.ownerStopWhen` (for example "all assignments delivered and approved"), `stop.maxOwnerActions`, `stop.maxWallMs`, `stop.idleMs`
- `budget.maxTokens`, `budget.maxUsd`, `budget.perRole { team, owner, judge }`
- `trials.k` (default 3)
- `models { team, owner, judge }`: owner at temperature 0 [19]
- `judge.rubrics[] { key, prompt, choices, advisory: true|false }`

**Owner-policy fields:**

- `gates.launchCard.sequence`, e.g. `["revise: cut scope to MVP", "approve"]`; `gates.launchCard.maxRevisions`; `gates.launchCard.onExtraCard: decline | fail`
- `gates.approvalCard.default: approve | decline`; `gates.approvalCard.rules[] { match: <title regex>, decision, note? }`
- `reactions[] { on: { from: pm | expert | <agentId>, kind, nth }, order: go | dig | redo | hold | pin, then?: <follow-up order after N posts> }`, using the existing `OrderKey`s [30]
- `questions.answerFrom: knownInfo`, `questions.llm: true | false` (LLM only for wording), `questions.unknownReply`
- `nudge { afterIdleMs, text }`, plus an end action (`###STOP###`-style, enforced by the harness) [15][17]

**Which checks run where:**

- **Code (gating):** everything in the code-check table above, plus termination reason, budget and the pass^k math.
- **LLM judge (advisory until calibrated against human labels):** charter quality, artifact quality, kickoff clarity.
- **LLM fidelity reviewer (gates validity, not score):** τ²-style tags on owner turns [17].

**Tracing hygiene (from our own code):**

- Today, reactions are written as LangSmith feedback `key: "order"`, scoring 1 for 👍 and 0 for 🔁 [30]. Simulated reactions must go to a separate `LANGSMITH_PROJECT`, or be tagged `sim`, so they don't pollute the real signal.
- App LLM runs carry `agent` / `team` / `mode` metadata but no `thread_id` [30]. Add `thread_id = <scenarioRunId>` on every run, child runs included, so LangSmith groups a simulated run into one thread [11].
- If the harness drives the app over HTTP instead of in-process, carry trace context with `RunTree.toHeaders()` / `RunTree.fromHeaders()` (present in 0.9.0) [8].

## Unverified

- **Install and runtime compatibility.** That `openevals@0.2.2` and `agentevals@0.0.7` install and run cleanly alongside `langsmith@0.9.0` and `deepagents@1.15.0` is checked by declared semver range only [3][6][7]. Not install-tested, per scope.
- **Two langsmith copies.** If a future openevals pulls a nested `langsmith >=0.10.5` [4], it is unknown whether traces stay connected. langsmith 0.9.0 keeps its async context under the global `Symbol.for("ls:tracing_async_local_storage")` [8], which suggests sharing, but this is untested.
- **Crusoe pricing.** Whether LangSmith prices runs tagged `ls_provider: "crusoe"` [30]. If it doesn't, USD cost must come from our own price table. Crusoe per-token prices were not looked up.
- **Child runs in evaluators.** Whether `evaluate()` evaluators receive child runs in `run` without extra loading. Not checked, so the recommendation passes structured outputs instead.
- **Summarised paper quotes.** These came through a summarising fetcher and were not read verbatim: τ-bench's 30-action cap and "≥3 trials" [14]; τ² simulator error rates (16% / 40% / 47%), the 4-trial setup and the 18–25% no-user drop [16]; ToolSandbox's 6.97% / 0.77% [26]; Laban's "<5%" [27]. The pass^k formula is cross-checked against τ-bench `run.py` code [15].
- **DeepEval TS.** Whether it needs a paid Confident AI account, and what the hosted simulator costs [21].
- **Promptfoo `config.userProvider`.** It is declared in the provider's type but appears unused in `callApi` on main [22]. The user model may not be overridable.
- **Maxim JS SDK.** Simulation support is unconfirmed; only Python SDK docs and the REST spec were seen [25].
- **Not researched.** Coval, Hamming and Arize Phoenix were not researched; four or more other tools were covered instead.
- **Emoji reactions.** I found no public framework that simulates emoji-style reactions. A wider search might find one.
- **Next.js in-process.** Whether Next.js 16 route handlers can be invoked in-process from vitest with full app context. This is a design suggestion, not a verified approach.
