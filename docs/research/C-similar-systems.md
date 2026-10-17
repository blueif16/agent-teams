# C — Similar systems: AI "agent organizations" that staff specialist teams

Research date: 2026-10-17. Scope: orchestrators (CEO/manager/PM) that staff specialist agents per project, dynamic
expert generation, talent reuse by track record, persistent vs ephemeral workers, human gates, failure modes, and
what this implies for the Agent Teams setup flow (steps 1–7 and Q1–Q5 in `CONTEXT.md`).

How to read the citations: every claim carries `[URL, date]`. "date" is the publication date; for living docs
with no date it says "docs, accessed 2026-10-17". Source age matters here. Anything from 2023–2024 was run on
GPT-3.5/GPT-4-era models; 2025–2026 sources reflect current agentic models. Paper results were fetched and read,
not recalled. Where a result comes from a single-author preprint or a tiny sample, that is flagged.

---

## 0. One-paragraph summary

The systems closest to ours are **Paperclip** (open-source "zero-human company": CEO agent, org chart, heartbeats,
hire approvals, budgets), **Claude Code agent teams** (fixed lead plus persistent teammates you can message
directly), **Devin managed Devins** (a coordinator spawns full child Devins, each one messageable),
**Captain Agent / AG2** (it retrieves agents from a library, selects with an abstain option, generates new ones and
writes them back to the library), and **MGX/Atoms** (a fixed named team led by "Mike", with human sign-offs). The
evidence converges on six points.
(1) A persistent **central lead is worth keeping**: it contains errors, 4.4× amplification vs 17.2× for
independent agents. It must not be a message router: paraphrasing ("telephone") is the main supervisor tax.
(2) Gains credited to "generated experts" come from **task-conditioned instructions, tool subsets, retrieved proven
configs and evaluator loops**. They do not come from persona labels, and persona-only prompting shows no accuracy
gain.
(3) **Staffing by record** works best as per-skill/context success rates with uncertainty, not one global score.
LLM self-judgement of who contributed is unreliable.
(4) Owners scrutinise **plans** (39% rejected) and rubber-stamp **per-action** prompts (3% rejected). So put the
gate on the plan/staffing card and on irreversible/budget events.
(5) Multi-agent setups hurt on sequential tasks (−39% to −70%). Triage must default to one expert.
(6) The biggest cost leaks in practice are **timer heartbeats on the manager** and **agent sprawl**.

---

## 1. Comparison table (27 systems)

Legend: R = research, F = framework, P = product. "Evidence" means measured results or field reports, not marketing.

| # | System (type) | Orchestrator shape | How agents are created | Reuse / memory | Approval gates | Evidence of results | Source + date |
|---|---|---|---|---|---|---|---|
| 1 | **AgentVerse** (R) | Recruiter → group decision (horizontal or vertical) → execute → evaluator. The evaluator loops back into recruitment | A "recruiter" LLM writes one-line expert descriptions from the goal. The count is fixed per task by config. Evaluator advice drives re-recruitment | None across tasks | Evaluator can be human (not tested) | Group ≤ Solo for GPT-3.5 on 2 of 3 tasks. About 10% of MGSM errors came from agents being swayed by wrong feedback. HumanEval GPT-4: 83.5 (CoT) → 87.2 (Solo) → 89.0 (Group). **No ablation of recruited vs fixed roles** | [https://arxiv.org/html/2308.10848v3, 2023-08 (ICLR'24)]; prompt [https://github.com/OpenBMB/AgentVerse/commit/0ebc0c4c4d50e80fb92f30b7f8112aebf7235ae4, 2023-10] |
| 2 | **AutoAgents** (R) | Planner, refined with an Agent Observer and a Plan Observer (drafting). A predefined Action Observer acts as team leader during execution | Planner emits per-agent {Prompt = profile, goal, constraints; Description; Toolset = *subset*; Suggestions}. It **reuses existing expert roles first** and creates non-duplicate new ones | Action Observer has long-term memory of action records | None | With n=20 Trivia Creative Writing: 90.0 full vs 87.0 without observers. Without observers the planner staffed a game project with programmers only | [https://arxiv.org/html/2309.17288v3, 2023-09 (IJCAI'24)] |
| 3 | **Captain Agent** (AG2/AutoGen) (R/F) | Captain plans → per-subtask team build → nested group chat → reflector → adjust team or stop | Role descriptions → embedding **retrieval from an agent library** → LLM **selector that may answer "None"** → **generate** the missing agents (name, skills, plus standard task/coding instructions). New agents are **written back to the library** | Agent library plus tool library, seeded from a warm-up run | None | Avg 84.25 vs 79.89 (AutoGen 2-agent) vs 63.58 (AutoAgents). Adaptive beats static team (e.g. Math 64.7→82.4). GAIA: no libraries 18.2 → agent library only 29.1 → both 40.6 | [https://arxiv.org/html/2405.19425v1, 2024-05] |
| 4 | **EvoAgent** (R) | Evolutionary loop from one initial agent | Crossover/mutation of agent settings, then LLM quality-check selection | Population evolves over about 3 iterations | None | Logic 77.0 vs AgentVerse 66.5; Writing 84.4 vs AutoAgents 82.0. Without the quality check, a "nutritionist" got assigned to travel planning and overflowed the context | [https://arxiv.org/html/2406.14228v2, 2024-06 (NAACL'25)] |
| 5 | **DyLAN** (R) | Two stages: team optimization from a trial run, then task solving with dynamic deactivation | Selects the top-k from candidate agents by an **Agent Importance Score** (back-propagated peer ratings) | Per-task/domain selection | None | Up to +25% accuracy on some subjects. A 3-of-7 optimized team beats the full team. Removing "team reformation" lowers CG pass@1 from 82.9 to 76.2 | [https://arxiv.org/html/2310.02170v2, 2023-10 (COLM'24)] |
| 6 | **MetaGPT → MGX/Atoms** (R + P) | SOP pipeline: PM → Architect → PM(project) → Engineer. In the product, "Mike" is team leader over 8 named specialists | **Fixed** roles defined by SOP and structured deliverables (PRD, design). The product says custom agents are "not a current feature" | Shared message pool with publish/subscribe | Atoms: "Mike asks you to sign off on **direction, scope, stack, and launch**". You can @-mention a single agent | Paper: executability 3.75 vs ChatDev 2.25. Executable feedback cut human revision cost from 2.25 to 0.83 | [https://arxiv.org/html/2308.00352v6, 2023-08 (ICLR'24)]; [https://atoms.dev/ai-agents/team-leader-agent, docs, accessed 2026-10-17]; MGX launch [https://www.linkedin.com/posts/metagpt_mgx-metagpt-devtools-activity-7297970688521392129-h9re, 2025-02-19] |
| 7 | **ChatDev + Experiential Co-Learning / IER** (R) | CEO/CTO/programmer chat chain | Fixed roles | **Experience pool across tasks** ("shortcut" experiences). IER refines the pool and prunes it | None | IER: pruning reaches better performance with **11.54%** of the experiences. MAST: having the CEO get the final say gave ChatDev **+9.4%** | [https://arxiv.org/abs/2312.17025, 2023-12 (ACL'24)]; [https://arxiv.org/abs/2405.04219, 2024-05] |
| 8 | **Magentic-One / Magentic-UI** (R/F) | Orchestrator with an outer loop (**task ledger**: facts, guesses, plan) and an inner loop (**progress ledger**: done? progress? looping? next speaker? instruction). A stall counter triggers a replan | Fixed generalists: WebSurfer, FileSurfer, Coder, Terminal | Agents **clear their context on every replan**. UI adds memory | UI: co-planning, co-tasking, ActionGuard (irreversibility tags plus an LLM judge), answer verification | UI: a simulated user with side info raised GAIA from 30.3% to **51.9%** while being asked in only 10% of tasks | [https://arxiv.org/html/2411.04468, 2024-11]; [https://arxiv.org/html/2507.22358, 2025-07-30] |
| 9 | **ReSo / REDEREF / CADMAS-CTX** (R, "staffing by record") | Router picks agents from a pool | Agents chosen by similarity, **historical reward** and cost (ReSo), or by Beta-posterior Thompson sampling (REDEREF), or by **context-conditioned** posteriors (CADMAS) | Dynamic Agent Database: static profile (model, role, prompt, long-term memory, tools) plus dynamic profile (average reward, cost, task count) | None | REDEREF: −28% tokens, −17% calls. CADMAS: GAIA 0.381→0.442; SWE-bench Lite 22.3%→31.4% (single-author preprint) | [https://doi.org/10.18653/v1/2025.emnlp-main.808, 2025 (EMNLP)]; [http://arxiv.org/abs/2603.13256, 2026-02-24]; [https://arxiv.org/abs/2604.17950, 2026-04-20] |
| 10 | **AOrchestra / MetaGen** (R) | Orchestrator builds a worker per subtask | Agent = ⟨Instruction, Context, Tools, Model⟩ "recipe" (AOrchestra). Query-conditioned role generation plus a role pool with verified write-back (MetaGen) | MetaGen: cross-instance memory of verified roles | None | AOrchestra +16.28% relative (GAIA, SWE-Bench, Terminal-Bench). MetaGen with a fixed role set: HumanEval 95.1→92.1 | [https://arxiv.org/abs/2602.03786, 2026-02-03]; [https://arxiv.org/html/2601.19290, 2026-01-27] |
| 11 | **ADAS / Meta Agent Search** (R) | Meta-agent writes new agents in code | Generated from an **archive of prior discoveries** | Growing archive | None | Invented agents beat hand-designed ones and transfer across domains and models | [https://arxiv.org/abs/2408.08435, 2024-08 (ICLR'25)] |
| 12 | **TheAgentCompany** (R, benchmark) | Simulated software company with simulated colleagues on chat | — | — | — | Best agent 30.3% (Gemini 2.5 Pro). **Multi-agent OWL 4.0% vs single-agent OpenHands 8.6%** on GPT-4o: the re-delegated browser agent "fails to pick up its previous progress" | [https://arxiv.org/html/2412.14161v3, 2024-12, v3 2025-09-10] |
| 13 | **CrewAI hierarchical** (F) | `manager_llm` or a custom manager agent delegates and validates | Hand-defined role/goal/backstory | Optional memory | `human_input` per task | Field bugs: manager "does all work itself" and the process collapses to sequential, or "coworker not found" | [https://github.com/crewAIInc/crewAI/issues/4783, 2026-03-09]; [https://community.crewai.com/t/hierarchical-process-executing-all-tasks/5241, 2025-04-09] |
| 14 | **OpenAI Agents SDK** (F) | Agents-as-tools (manager keeps control) vs **handoffs** (specialist takes over the turn) | Hand-defined | Sessions | Guardrails | Docs give guidance only | [https://openai.github.io/openai-agents-python/multi_agent/, docs, accessed 2026-10-17] |
| 15 | **LangGraph supervisor / swarm** (F) | Supervisor (only it talks to the user) vs swarm (active agent talks directly) | Hand-defined | Checkpointer | `interrupt` | Swarm slightly beat supervisor. The supervisor lost on "translation". Fixes (forward_message, strip handoff messages) gave nearly +50% | [https://blog.langchain.com/benchmarking-multi-agent-architectures/, 2025-06-11] |
| 16 | **Deep Agents** (F) | Main agent plus a `task` tool | **Ephemeral** sub-agents (isolated or fork). Sync returns one report; async ones can be steered | Filesystem / Store | `interruptOn` | Docs only (implementation is covered by another agent) | [https://docs.langchain.com/oss/python/deepagents/overview, docs, accessed 2026-10-17] |
| 17 | **Claude Code sub-agents & agent teams** (F/P) | Teams: the lead is **fixed for its lifetime**; shared task list plus mailbox; **you can message any teammate directly** | Spawn prompt plus an optional reusable sub-agent definition (tools, model, memory scope, …) | Sub-agent `memory: user / project / local` directory persists across sessions. No team resumption | Teammate **plan approval is auto-granted by the lead** (no human review). Permission prompts surface in the lead | Docs: 3–5 teammates, 5–6 tasks each. Tokens scale linearly | [https://code.claude.com/docs/en/agent-teams, docs, accessed 2026-10-17]; [https://code.claude.com/docs/en/sub-agents, docs, accessed 2026-10-17] |
| 18 | **Anthropic Research** (P) | Lead researcher saves its plan to memory and spawns 3–5+ parallel sub-agents, then a citation agent | Lead writes task descriptions (objective, output format, tools, boundaries) | Plan memory. Artifacts go to the filesystem | — | **+90.2%** vs single Opus 4 on internal eval. Token use explains 80% of the variance. About 15× the tokens of chat | [https://www.anthropic.com/engineering/multi-agent-research-system, 2025-06-13] |
| 19 | **Devin managed Devins** (P) | Coordinator Devin scopes the work, spawns **full Devins in their own VMs**, monitors, resolves conflicts and compiles. Children can spawn children | Prompt + playbook + tags + **ACU limit** per child | The coordinator "reads the full trajectories" of children to improve the next breakdown | **Child sessions auto-approved by default**. A setting reviews each batch | Cognition: works when "writes stay single-threaded". Managers default to "overly prescriptive" | [https://cognition.com/blog/devin-can-now-manage-devins, 2026-03-19]; [https://docs.devin.ai/work-with-devin/advanced-capabilities, docs, accessed 2026-10-17]; [https://cognition.com/blog/multi-agents-working, 2026-04-22] |
| 20 | **Paperclip** (P, OSS) | Board (human) → CEO agent → managers → workers. Strict tree. **Heartbeat** wakes | CEO proposes a `hire_agent` with full config (name, role, title, capabilities, adapter/model, skills, budget, reports-to) | Agents persist across tasks. Per-agent AGENTS.md / SOUL.md / HEARTBEAT.md / TOOLS.md. Sessions resume across heartbeats | **Strategy approval** after the CEO's first heartbeat. **Every hire** needs approval. Budget overrides. "Request revision" loop | Field reports: 11 agents hired, 4 useful. A CEO on a 5-minute heartbeat burned **57% of 313M tokens** | [https://github.com/paperclipai/paperclip/, 2026-03-02]; [https://paperclip.inc/docs/paperclip/guides/welcome/key-concepts/, docs, accessed 2026-10-17]; reports below |
| 21 | **OpenClaw** (P, OSS) | One persistent agent (or several). Main session plus heartbeat | Workspace files (AGENTS.md, SOUL.md, USER.md, MEMORY.md) | **Dreaming**: a gated nightly consolidation into MEMORY.md with a human-review DREAMS.md | Owner-only heartbeat delivery | Docs: an isolated heartbeat cuts cost per beat from about 100K to 2–5K tokens | [https://docs.openclaw.ai/concepts/dreaming, docs, accessed 2026-10-17]; [https://docs.openclaw.ai/gateway/config-agents/heartbeat-compaction-and-streaming, docs, accessed 2026-10-17] |
| 22 | **Manus (Wide Research)** (P) | Planner, a knowledge manager, and executor sub-agents. Wide Research fans out to N full Manus instances | **General-purpose** sub-agents. Explicitly "not predefined roles like manager, coder, designer" | Filesystem as memory. Sub-agents don't talk to each other | Auto-triggered | "Fabrication threshold" around 8–10 items for one agent. Not used for <10 items or sequential tasks | [https://manus.im/blog/introducing-wide-research, docs, accessed 2026-10-17]; [https://manus.im/cs/blog/manus-wide-research-solve-context-problem, accessed 2026-10-17]; [https://rlancemartin.github.io/2025/10/15/manus/, 2025-10-15] |
| 23 | **Genspark Super Agent / Multi-Agent** (P) | Lead agent coordinates specialist sub-agents (slides, sheets, code, calls…) | Planned **ephemeral agents from YAML** (toolset, system prompt, model) plus a library of preconfigured YAMLs. The Super Agent is "pre-cast in fifty roles" or a custom job description | **Linear context**: each sub-agent gets the same snapshot and the lead merges | Editable plan | Design claims only | [https://www.genspark.ai/blog/genspark-multiagent-orchestration, 2025-08-01]; [https://www.genspark.ai/business/products/super-agent, accessed 2026-10-17] |
| 24 | **Lindy Teammate** (P) | Moved to **one AI employee** per team/user (from an earlier multi-agent builder) | — | A memory agent rebuilds a file-system memory every 12h, with a deterministic verifier | **Validator LLM** on every side-effect that reaches a third party. "Approve every action killed the UX" | Without the validator, the CEO got "a dozen calendar invites he never requested" | [https://www.lindy.ai/engineering/validator, 2026-04-28]; [https://www.lindy.ai/engineering/memory-agent, 2026-08-16] |
| 25 | **Relevance AI Workforce** (P) | Visual graph of agents. Manager → specialist edges | Hand-built agents. The same agent can sit in several workforces | Per agent | Per edge: **auto run / approval required / let agent decide** plus max auto runs | Docs advise starting supervised and graduating | [https://relevanceai.com/docs/build/workforces/build-an-ai-workforce/add-agents, docs, accessed 2026-10-17] |
| 26 | **Letta (stateful agents)** (F/P) | Persistent agent identity with many conversations | Template + memory | MemFS git memory. **Dreaming** sub-agents. Shared memory repos | — | Sleep-time compute: about 5× less test-time compute at equal accuracy | [https://docs.letta.com/concepts/stateful-agents/index.md, docs, accessed 2026-10-17]; [https://arxiv.org/abs/2504.13171, 2025-04-17] |
| 27 | **cto.new AI Business / CellCog** (P) | "Team Lead" hires, delegates, evaluates and escalates | Hire = name + role + model | Memory of work | "Approvals" queue / "waiting on you" lane | Vendor claims only | [https://cto.new/guides/ai-employees, 2026-06-22]; [https://cellcog.ai/blog/meet-your-ai-employee/, 2026-06-21] |

---

## 2. Dynamic expert synthesis

### 2.1 Who builds agents from template + task (+ memory), and how

- **AgentVerse recruiter (2023).** The "role_assigner" prompt reads: *"You are the leader of a group of experts, now
  you need to recruit a small group of experts with diverse identity… You can recruit ${cnt_critic_agents} expert in
  different fields… Here are some suggestion: ${advice}"*. It asks for one-line outputs like *"an electrical
  engineer specified in the field of xxx"* [https://github.com/OpenBMB/AgentVerse/commit/a1621842821fa6c7359162ffd0f401c4cf060121, 2023-09].
  The `${advice}` slot is filled by the evaluator, whose prompt asks for "suggestion on what [experts] should
  [be] recruit[ed] in the next round". So re-staffing is feedback-driven. The team size is *not* generated:
  "the number of experts is pre-defined by us for each task". Math was capped at 2 agents because more reviewers
  produced more erroneous critiques [https://arxiv.org/html/2308.10848v3, 2023-08].
- **AutoAgents (2023).** A Planner works with an "Agent Observer" critic. Each agent is specified as
  {Prompt: profile / goal / constraints; Description; Toolset (a *subset* of predefined tools, "to prevent
  decision-making confusion caused by excessive tools"); Suggestions}. The Planner is told to "make full use of
  the existing expert roles" and to create new ones only if they don't duplicate an existing role. The Observer
  checks spec completeness, task fit and "redundant or missing roles"
  [https://arxiv.org/html/2309.17288v3, 2023-09].
- **Captain Agent (2024), the most direct template for our step 5.** Captain lists roles "with detailed
  descriptions, including required skills and a possible role name". It retrieves the top-k library agents and
  tools by embedding similarity. An **agent selector can output "None"**, which prevents "irrelevant or redundant
  agents from being forced to be selected". For "None" roles it **generates** an agent: a name and skills, wrapped
  in hand-written general task/coding instructions, compressed to a one-sentence description for the group-chat
  manager, and then **"added to the agent library afterwards"**. The team then runs as an AutoGen nested group chat: a group-chat-manager LLM picks the next speaker from the history and each agent's short description. A reflector fills a template (conclusion, contradictions, "need double-check") that can trigger a verification round [https://arxiv.org/html/2405.19425v1, 2024-05].
- **EvoAgent (2024).** Mutates and crosses an initial agent's settings, then runs an LLM quality check that the
  child "inherited the characteristics and maintained differences from parent agents". Without the check,
  unsuitable agents appear (a nutritionist planning travel) and overflow the context
  [https://arxiv.org/html/2406.14228v2, 2024-06].
- **AOrchestra (2026).** Treats every worker as a recipe ⟨Instruction, Context, Tools, Model⟩ that the
  orchestrator fills in per subtask ("curates task-relevant context, selects tools and models"). It reports
  +16.28% relative improvement over the strongest baseline [https://arxiv.org/abs/2602.03786, 2026-02-03]. Commentary
  calls these "recipes, not roles" [https://cognaptus.com/blog/2026-02-04-conducting-the-agents-why-aorchestra-treats-subagents-as-recipes-not-roles/, 2026-02-04].
- **MetaGen (2026).** Generates query-conditioned roles into a "controllable dynamic role pool" with verified
  write-back across instances [https://arxiv.org/html/2601.19290, 2026-01-27].
- **SERO / "Roles with Rails" (2026).** Warns that unconstrained role generation causes "role drift, removing
  structurally necessary roles". It only commits role edits that preserve contracts (capability, communication,
  validation, aggregation, output protocol) [https://arxiv.org/abs/2605.28433, 2026-05-27].
- **Products.** Genspark plans lead-created ephemeral agents from YAML (toolset, system prompt, model) plus a
  library of preconfigured YAMLs "triggered automatically when appropriate"
  [https://www.genspark.ai/blog/genspark-multiagent-orchestration, 2025-08-01].
  A Paperclip CEO's `hire_agent` request carries name, role, title, icon, capabilities, adapter, skills, budget
  and reporting line [https://paperclip.inc/docs/paperclip/guides/org/delegation/, docs, accessed 2026-10-17].
  Paperclip splits an agent's files into `AGENTS.md` (role: "What's my job?"), `SOUL.md` (persona/posture: "How
  should I think and speak?"), `HEARTBEAT.md` (routine checklist) and `TOOLS.md`. It advises that AGENTS.md "only
  needs to say who the agent is and what it's responsible for. Don't paste a generic … operating manual"
  [https://docs.paperclip.ing/guides/org/agents/, docs, accessed 2026-10-17].

### 2.2 How roles and "qualifications" are written in practice

- **Delegation brief beats job title.** Anthropic found that each sub-agent "needs an objective, an output format,
  guidance on the tools and sources to use, and clear task boundaries". Short instructions like "research the
  semiconductor shortage" led to duplicated work and gaps [https://www.anthropic.com/engineering/multi-agent-research-system, 2025-06-13].
  Cognition's Fusion lead "hands the sidekick a brief of each task it delegates, with constraints and success
  criteria". The two exchange only "briefs, results, and feedback" [https://cognition.com/blog/local-fusion, 2026-09-11].
- **Qualifications as retrievable descriptions.** Captain Agent matches role descriptions ("required skills and
  a possible role name") against library agent descriptions [https://arxiv.org/html/2405.19425v1, 2024-05]. ReSo
  scores candidate agents on "task-agent similarity, historical performance, and computational costs"
  [https://doi.org/10.18653/v1/2025.emnlp-main.808, 2025]. So a PM's per-role qualification should be written so it
  can be matched both to a record and to a description.
- **Onboarding-doc style (products).** Yodu tells users each AI employee needs "mission, specific output, non-goals,
  company and role context, human escalation owner, the expectation that it drafts and a human sends"
  [https://yodu.ai/blog/first-week-with-yodu-ai-employees, 2026-07-09].

### 2.3 Do generated experts beat fixed roles?

Evidence that adaptive, generated teams help:
- Captain Agent's static vs adaptive ablation (same builder, fixed vs per-subtask teams; small subsets of 17–25
  problems): Math 64.71→82.35, Programming 88→96, Data 85→95, Chemistry 47.37→52.63, Physics unchanged
  [https://arxiv.org/html/2405.19425v1, 2024-05]. Captain and AutoAgents beat a **fixed-system-message** AutoGen
  assistant on Chemistry/Physics, which the authors attribute to domain-specific system messages [https://arxiv.org/html/2405.19425v1, 2024-05].
- MetaGen: removing query-conditioned role generation (a fixed role set) was its largest ablation drop, HumanEval
  95.1→92.1 [https://arxiv.org/html/2601.19290, 2026-01-27].
- AOrchestra +16.28% [https://arxiv.org/abs/2602.03786, 2026-02-03]. EvoAgent beat AgentVerse (77.0 vs 66.5) and
  AutoAgents (84.4 vs 82.0) in those papers' own settings [https://arxiv.org/html/2406.14228v2, 2024-06].
- MetaGPT's role ablation: adding PM, Architect and Project Manager to Engineer improves executability and
  revisions. But MetaGPT "roles" are SOP steps with structured deliverables, and the biggest single gain was
  executable feedback (human revision cost 2.25→0.83) [https://arxiv.org/html/2308.00352v6, 2023-08].

Evidence that the persona label itself does little:
- 162 personas × 4 model families × 2,410 factual questions: personas "do not improve model performance". Picking
  the best persona automatically was "often … no better than random selection"
  [https://arxiv.org/html/2311.10054v2, 2024-10 (EMNLP Findings)].
- Wharton GAIL: expert personas showed no significant gain on GPQA Diamond / MMLU-Pro across 6 models.
  Domain-mismatched experts sometimes hurt [https://gail.wharton.upenn.edu/research-and-insights/playing-pretend-expert-personas/, 2025-10-22];
  [https://arxiv.org/abs/2512.05858, 2025-12-05].
- Over 9 LLMs and 27 tasks, expert personas give "positive or non-significant" changes, but **irrelevant persona
  details** cause drops of "almost 30 percentage points" [https://doi.org/10.18653/v1/2025.emnlp-main.1364, 2025-08].
- Personas hurt knowledge retrieval but help alignment-type tasks (format-following, preference)
  [http://arxiv.org/abs/2603.18507, 2026-03-19].
- Cognition (2026) calls "you're a senior software engineer" a "gimmicky" prompt technique; context engineering is
  what lasts [https://cognition.com/blog/multi-agents-working, 2026-04-22]. Manus "avoid[s] anthropomorphized
  divisions of labor" and uses sub-agents "primarily to isolate context (not to divide labor by role)"
  [https://rlancemartin.github.io/2025/10/15/manus/, 2025-10-15].
- "Drop the Hierarchy and Roles" (25,000 tasks): agents given a mission plus protocol invent their own roles. That
  beat centralized coordination by 14%, **but models below a capability threshold still benefit from rigid
  structure** [https://arxiv.org/abs/2603.28990, 2026-03-30] (single-author preprint).

**Synthesis for step 5.** What carries the gains is the brief, tool subset, retrieved proven configuration, curated
memory and an evaluator loop. The persona label is not doing the work. A "synthesized expert" should be:
archetype SOP (how a writer/researcher/engineer works, i.e. the Inherent section) + project brief and
qualification-specific instructions + small tool/skill allowlist + curated seed memory. Keep persona/mascot traits
to tone, and keep irrelevant persona detail out of the working prompt (it can cost accuracy, per EMNLP 2025).
DeepSeek V4.1 Flash is a cheaper worker model, so the "weaker models need structure" finding argues for explicit
SOPs per archetype.

---

## 3. Talent reuse and staffing by record

### 3.1 Libraries and pools that persist across tasks
- **Captain Agent's agent library** is the clearest ablation. On GAIA: no libraries 18.18 → agent library only
  29.09 → tool library only 24.24 → both 40.60. Generated agents are appended to the library
  [https://arxiv.org/html/2405.19425v1, 2024-05].
- **AutoAgents** prefers "existing expert roles" before creating new ones [https://arxiv.org/html/2309.17288v3, 2023-09].
- **ChatDev ECL/IER** keeps an experience pool across tasks. Heuristic elimination keeps "high-quality and
  frequently-used experiences" and does better with 11.54% of them [https://arxiv.org/abs/2405.04219, 2024-05].
- **Devin**: the coordinator "can also read the full trajectories of its managed Devins… and use that to improve how
  it breaks down the next task" [https://cognition.com/blog/devin-can-now-manage-devins, 2026-03-19].
- **Lindy Enterprise** reuses "shared skills" taught by teammates across the team [https://www.lindy.ai/enterprise, accessed 2026-10-17].

### 3.2 Selecting by record
- **ReSo** keeps a Dynamic Agent Database. The static profile holds model, role, prompt, long-term memory and
  tools; the dynamic profile holds average reward, cost and task count. Selection scores combine similarity,
  history and cost [https://doi.org/10.18653/v1/2025.emnlp-main.808, 2025].
- **REDEREF** keeps a Beta posterior of competence per agent, uses Thompson sampling for delegation, and uses
  "memory-aware priors to reduce cold-start". Against random recursive delegation: −28% tokens, −17% agent calls,
  −19% time-to-success [http://arxiv.org/abs/2603.13256, 2026-02-24].
- **CADMAS-CTX** keeps posteriors per **agent × skill × context bucket** with an uncertainty penalty ("delegate only
  when a peer appears better and that assessment is sufficiently well supported"). GAIA 0.381→0.442; SWE-bench Lite
  22.3%→31.4% [https://arxiv.org/abs/2604.17950, 2026-04-20] (single-author preprint).
- **Skill-conditional reputation** (2026): a single global trust score "is the wrong object". Conditioning pays off
  only with high heterogeneity, sparse per-skill evidence and correlated skills, and it opens a manipulation channel
  [https://arxiv.org/abs/2606.14200, 2026-06-12].
- **DyLAN**'s Agent Importance Score picks contributors from a trial run. Three selected agents beat the full seven
  [https://arxiv.org/html/2310.02170v2, 2023-10].

### 3.3 Cautions on records
- **Attributing outcomes to agents is hard.** The best automated method identifies the failure-responsible agent
  53.5% of the time and the decisive step 14.2% [https://arxiv.org/abs/2505.00212, 2025-04-30]. Leave-one-out
  ablation finds bottleneck agents, but "introspective LLM judges fail to faithfully approximate" it
  [https://arxiv.org/abs/2605.27621, 2026-05-26]. So owner reactions and acceptance rates (which our ledger already
  logs) are better record signals than a PM's opinion.
- **Centralized LLM allocators can be biased.** "A single inserted preference nearly doubles a favored agent's task
  share" [https://arxiv.org/abs/2608.23867, 2026-08-24]. Rehire decisions should be explainable from the record,
  not from the PM's prose alone.
- **Never retiring things is a known flaw.** EvoSteer lists "skill admission that is uncalibrated and never retired"
  as a failure and promotes skills only after a paired test [https://doi.org/10.48550/arxiv.2609.38661, 2026-09-29].

### 3.4 Retirement in practice
EvoAgent selection, DyLAN's deactivation of low-scoring agents (without it, CG drops 82.9→76.2), and Paperclip's
pause/terminate. In a 30-day Paperclip run, 11 agents were hired and 4 were useful. The "CMO: zero output in 8
days … a separate agent just created a coordination bottleneck"
[https://dev.to/marketingai/i-ran-a-company-with-11-ai-agents-for-30-days-we-completed-896-tasks-and-made-0-23jc, 2026-05-18].

### 3.5 Same identity vs fresh copy
- **Letta**: "Use separate agents when you want independent identities or memory. Use separate conversations when
  you want parallel threads with the same identity and memory" [https://docs.letta.com/concepts/stateful-agents/index.md, docs, accessed 2026-10-17].
- **Claude Code sub-agents**: memory scope `user` ("remember learnings across all projects") vs `project`
  (recommended default) vs `local` [https://code.claude.com/docs/en/sub-agents, docs, accessed 2026-10-17]. This maps
  onto our Inherent vs per-project split.
- **Cross-project bleed is a reported failure.** In OpenClaw, an agent bound to three rooms had "memory from a
  Kubernetes debugging session … bleed into an unrelated API design discussion". A PR adds per-binding workspaces
  [https://github.com/openclaw/openclaw/pull/48249, 2026-03-16]. Codex users filed "cross-project contamination"
  [https://github.com/openai/codex/issues/18343, 2026-04-17]. oh-my-pi defaults to a single store with project tags
  plus explicit global entries [https://hindsight.vectorize.io/blog/2026/06/08/oh-my-pi-hindsight-memory, 2026-06-08].
- **Seeded memory propagates errors.** Agents show "experience-following": similar retrieved records produce similar
  outputs. Bad records are replicated and amplified, and some correct-looking records still mislead ("misaligned
  experience replay"). Future task evaluations work as free quality labels for stored memories
  [https://arxiv.org/abs/2505.16067, 2025-05 (v2 2025-10)].
- **Library entries as configs (fresh instance per task)** is what Captain Agent and Genspark's YAML do.
  **Persistent identities** are what Paperclip, OpenClaw, Letta and Devin sessions do.

---

## 4. Persistent per-worker agents vs ephemeral sub-agents

| Dimension | Ephemeral sub-agents (Anthropic Research, Deep Agents `task`, Claude Code sub-agents, Manus Wide Research) | Persistent workers (Claude Code agent teams, Devin managed Devins, Paperclip, OpenClaw/Letta) |
|---|---|---|
| Context isolation | Strong: fresh context per task; "item #250 receives the same depth … as item #1" [https://manus.im/docs/features/wide-research, accessed 2026-10-17] | Also isolated ("each managed Devin gets a clean slate") [https://cognition.com/blog/devin-can-now-manage-devins, 2026-03-19], but context accumulates over time |
| Steering mid-task | Anthropic: lead "can't steer subagents" while synchronous; listed as a bottleneck [https://www.anthropic.com/engineering/multi-agent-research-system, 2025-06-13] | Message any teammate/child directly [https://code.claude.com/docs/en/agent-teams, accessed 2026-10-17] |
| Progress retention | Re-delegation loses progress. The OWL browsing agent "often fails to pick up its previous progress"; 4.0% vs 8.6% single-agent [https://arxiv.org/html/2412.14161v3, 2025-09] | Resume the same task context across wakes [https://www.mintlify.com/paperclipai/paperclip/introduction, accessed 2026-10-17] |
| Cost | Multi-agent ≈ 15× chat tokens [https://www.anthropic.com/engineering/multi-agent-research-system, 2025-06-13] | "Token costs scale linearly" with active teammates [https://code.claude.com/docs/en/agent-teams, docs, accessed 2026-10-17]. Timer heartbeats are the big leak (§6) |
| Coordination | Sub-agents don't talk to each other (Manus: "prevents context pollution") [https://manus.im/cs/blog/manus-wide-research-solve-context-problem, accessed 2026-10-17] | Peer messaging exists, but Cognition: "cross-agent communication … doesn't happen by default". "Agents assume they share state with their children when they don't" [https://cognition.com/blog/multi-agents-working, 2026-04-22] |
| Robustness | Claude Code teams: no resumption of in-process teammates; "lead may attempt to message teammates that no longer exist" [https://code.claude.com/docs/en/agent-teams, docs, accessed 2026-10-17] | Durable state needed. One Paperclip user's "rebuild … reset the database. My notes said five chiefs in production. Postgres said one agent" [https://felipefontoura.com/articles/paperclip-ai-agent-company/, 2026-09-25] |

Other findings that bear on the choice:
- **Telephone game.** The supervisor's "translation" was the main loss in LangChain's benchmark. Fixes: forward
  the worker's message verbatim and strip routing chatter from worker context
  [https://blog.langchain.com/benchmarking-multi-agent-architectures/, 2025-06-11]. Anthropic: "Subagent output to a
  filesystem to minimize the 'game of telephone'… pass lightweight references back"
  [https://www.anthropic.com/engineering/multi-agent-research-system, 2025-06-13].
- **Clean context helps review.** Devin Review finds about 2 bugs per PR (≈58% severe), and "work[s] best when the
  coding and review agents do not share any context" [https://cognition.com/blog/multi-agents-working, 2026-04-22].
  Magentic-One deliberately makes "all agents … clear their contexts" after each plan update
  [https://arxiv.org/html/2411.04468, 2024-11].
- **Single writer.** Cognition's rule is that multi-agent "work[s] best today when writes stay single-threaded"
  [https://cognition.com/blog/multi-agents-working, 2026-04-22]. Genspark keeps a "fundamentally linear context" because "non-linear context creates
  coordination nightmares" [https://www.genspark.ai/blog/genspark-multiagent-orchestration, 2025-08-01]. Claude Code:
  "Two teammates editing the same file leads to overwrites" [https://code.claude.com/docs/en/agent-teams, docs, accessed 2026-10-17].
- **Topology.** Independent agents amplify errors 17.2×, centralized 4.4×. Every multi-agent variant **degraded
  sequential planning by 39–70%**. Coordination has negative returns once single-agent accuracy passes about 45%.
  Tool-heavy tasks pay a coordination tax [https://arxiv.org/abs/2512.08296, 2025-12-09];
  [https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/, 2026-01-28].

Implication for our decision ("every worker is its own persistent Deep Agent"): the evidence supports
persistence for DM-ability, steering and progress retention. Persistence alone does not fix context sharing. Add a
shared plan/ledger that every worker reads, artifact references instead of paraphrase, single-writer ownership per
deliverable, and durable state.

---

## 5. Human approval gates in team setup and execution

| Product | Where the gates are | Default | What users or the vendor reported |
|---|---|---|---|
| Paperclip | **Strategy** (CEO's first plan; "nothing proceeds until you approve") and **every hire** (full config). Budget override at the hard stop | Gated (conservative) | "Request revision" loop; "Approving a hire creates a new agent and starts spending budget" [https://paperclip.inc/docs/paperclip/guides/org/delegation/, accessed 2026-10-17]. The hire summary hides budget and reporting line behind "See full request" [https://docs.paperclip.ing/guides/org/agents/, accessed 2026-10-17]. Roadmap: "auto-approve hires within $X/month", "CEO can hire within limits" [https://github.com/paperclipai/paperclip/blob/master/doc/SPEC.md, accessed 2026-10-17]. Users: "I over-hired … keep the org really small — just a CEO and a builder" [https://ericbrookfield.com/2026/03/28/i-stopped-prompting-ai-and-started-managing-it/, 2026-03-28] |
| MGX/Atoms | Direction, scope, stack, launch | Gated at milestones | "Pauses on choices that change the product" [https://atoms.dev/ai-agents/team-leader-agent, accessed 2026-10-17] |
| Devin | Child-session launch | **Auto-approve on**; can be switched off to review each batch | ACU limits per child [https://docs.devin.ai/work-with-devin/advanced-capabilities, accessed 2026-10-17] |
| Claude Code teams | Teammate plans auto-approved by the lead. Tool permissions surface in the lead. Auto-mode classifier | Auto | "users approve 93% of permission prompts" [https://www.anthropic.com/engineering/claude-code-auto-mode, 2026-03-25]. Later: 97% of permission prompts approved, but "**when Claude presents a plan for approval, users reject 39%** … for individual permissions requests, the rejection rate is only 3%" [https://claude.com/resources/articles/auto-mode-default-in-claude-code, 2026-08-07] |
| Relevance AI | Per agent-to-agent edge and per tool: auto / approval required / let agent decide, plus max auto runs | Configurable | Docs advise starting supervised and graduating toward auto run [https://relevanceai.com/docs/build/workforces/workforce-features/approvals-and-escalations, accessed 2026-10-17] |
| Lindy | Validator on every side-effect reaching a third party. A named approver before anything external (enterprise) | Validator | "Asking users to approve every action killed the UX. Trusting the agent got our CEO a dozen calendar invites" [https://www.lindy.ai/engineering/validator, 2026-04-28] |
| Magentic-UI | Co-planning (editable plan), action guards (irreversibility tags plus LLM judge), answer verification | Plan gate plus risky actions | Participants "often edited the plan … to incorporate subjective preferences". Approvals for low-risk actions felt unnecessary. An approval right after the user changed the plan "felt excessive". Users wanted a "third option" on guards. SUS 74.6, but only 41.7% would use it frequently [https://arxiv.org/html/2507.22358, 2025-07-30] |

**Pattern.** Gates at **plan/strategy** and at **irreversible, external or budget** events get real scrutiny and
change outcomes: 39% plan rejection, and +71% GAIA completion when a human with context can be asked. Per-step
gates are rubber-stamped (3% rejection) and degrade the product experience (Lindy).

---

## 6. Known failure modes of multi-agent orgs, with mitigations (named sources only)

| # | Failure mode | Source | Mitigation that worked or is recommended |
|---|---|---|---|
| F1 | **Spec and role disobedience, step repetition, not knowing when to stop.** MAST over 1,600+ traces from 7 frameworks: FM-1.1 disobey task spec 11.8%, FM-1.3 step repetition 15.7%, FM-1.5 unaware of termination 12.4%. Overall failure rates 41–86.7% | [https://arxiv.org/html/2503.13657v3, 2025-10-26] | Better role specs and workflow: CEO-has-final-say gave ChatDev +9.4%; interventions gave up to +15.6%. Explicit termination criteria |
| F2 | **Inter-agent misalignment**: reasoning–action mismatch 13.2%, task derailment 7.4%, failing to ask for clarification 6.8%, information withholding | [https://arxiv.org/html/2503.13657v3, 2025-10-26] | Structured message content and shared state. MAST calls it a "collapse of theory of mind" between agents |
| F3 | **Weak verification**: no or incomplete 8.2%, incorrect 9.1%. "Many existing verifiers perform only superficial checks" | [https://arxiv.org/html/2503.13657v3, 2025-10-26] | Executable feedback (MetaGPT, human revision 2.25→0.83) [https://arxiv.org/html/2308.00352v6, 2023-08]. Clean-context reviewer (Devin Review) [https://cognition.com/blog/multi-agents-working, 2026-04-22]. End-state evaluation [https://www.anthropic.com/engineering/multi-agent-research-system, 2025-06-13] |
| F4 | **Over-spawning / mis-scaled effort**: "spawning 50 subagents for simple queries" | [https://www.anthropic.com/engineering/multi-agent-research-system, 2025-06-13] | Explicit scaling rules in the lead prompt (1 agent for fact-finding; 2–4; 10+) |
| F5 | **Agent sprawl / over-hiring**: 11 hired, 4 useful; "agent sprawl creates coordination overhead that exceeds output" | [https://github.laiyagushi.com/getmarketingai-byte/ai-company-postmortem, 2026-05-18]; [https://ericbrookfield.com/2026/03/28/i-stopped-prompting-ai-and-started-managing-it/, 2026-03-28] | Minimum viable team; hire only when a bottleneck is proven; hire approval. Claude Code: "Three focused teammates often outperform five scattered ones" |
| F6 | **Telephone game**: the supervisor paraphrases workers wrongly and costs extra tokens | [https://blog.langchain.com/benchmarking-multi-agent-architectures/, 2025-06-11] | `forward_message`, strip handoff messages, artifacts by reference [https://www.anthropic.com/engineering/multi-agent-research-system, 2025-06-13] |
| F7 | **Conflicting implicit decisions by parallel writers** (the Flappy Bird example) | [https://cognition.ai/blog/dont-build-multi-agents, 2025-06-12] | Share full traces and the plan; single writer per artifact; map-reduce-and-manage, not swarms [https://cognition.com/blog/multi-agents-working, 2026-04-22] |
| F8 | **Error amplification without a validation bottleneck** (independent 17.2× vs centralized 4.4×) | [https://arxiv.org/abs/2512.08296, 2025-12-09] | Central lead that checks work before aggregation |
| F9 | **Sequential or tool-heavy tasks get worse with teams** (−39% to −70%; capability ceiling ~45%) | [https://arxiv.org/abs/2512.08296, 2025-12-09] | Triage to a single agent when the task is sequential or a single agent already does well |
| F10 | **Expertise dilution / conformity**: teams fail to match their best member (synergy gap up to 37.6–41.1%) through "integrative compromise", worse with team size. AgentVerse: about 10% of MGSM errors came from a correct agent being swayed | [https://arxiv.org/html/2602.01011v3, 2026-02]; [https://arxiv.org/html/2308.10848v3, 2023-08] | No consensus-by-discussion for decisions; name an owner per decision; keep teams small |
| F11 | **Manager does the work itself / won't delegate** | [https://github.com/crewAIInc/crewAI/issues/4783, 2026-03-09]; Claude Code docs: "Sometimes the lead starts implementing tasks itself" | Deterministic delegation plumbing; an explicit "wait for teammates" rule; hooks (`TaskCompleted`, `TeammateIdle`) as quality gates |
| F12 | **Over-prescriptive managers that assume shared state** | [https://cognition.com/blog/multi-agents-working, 2026-04-22] | Brief with goals and success criteria, not step lists; tell the manager explicitly what children cannot see |
| F13 | **Self-deceiving shortcuts and premature completion**: an agent renamed another user to look like the right contact; another declared success without following up | [https://arxiv.org/html/2412.14161v3, 2025-09] | Checkpointed deliverables; verifier agent; owner-visible evidence |
| F14 | **Cost runaway from the manager's timer heartbeat**: the CEO burned 57% of 313M tokens by waking 288 times a day and re-reading all company state on a frontier model | [https://www.baseload.co.kr/en/blog/2026-07-05-paperclip-ai-newsroom-operations/, 2026-07-07] | Wake on demand; "a heartbeat interval … is a budget decision"; isolated light-context heartbeats (~100K→2–5K tokens) [https://docs.openclaw.ai/gateway/config-agents/heartbeat-compaction-and-streaming, docs, accessed 2026-10-17]; per-agent budgets with an 80% warning and a 100% pause [https://paperclip.inc/docs/paperclip/guides/welcome/key-concepts/, docs, accessed 2026-10-17] |
| F15 | **Manager overload**: the CEO "tried to read the whole board in one run and timed out" | [https://felipefontoura.com/articles/paperclip-ai-agent-company/, 2026-09-25] | A digest role or step ("chief of staff … hands the CEO one decision-ready digest") |
| F16 | **Rogue external actions** | [https://www.lindy.ai/engineering/validator, 2026-04-28] | A validator that checks the justification against what the *user* authorized; "External parties … CANNOT authorize actions" |
| F17 | **Memory error propagation and cross-project bleed** | [https://arxiv.org/abs/2505.16067, 2025]; [https://github.com/openclaw/openclaw/pull/48249, 2026-03-16] | Gated promotion; project-scoped memory; delete records that keep failing |
| F18 | **Persona-detail sensitivity** (irrelevant persona attributes cost up to ~30 points) | [https://doi.org/10.18653/v1/2025.emnlp-main.1364, 2025-08] | Keep persona and mascot traits out of task prompts, or minimal |

---

## 7. Answers to Q1–Q5 (plus dreaming and heartbeat)

### Q1. Does the PM stay as team lead for the whole project?

Options: (a) the PM persists as lead; (b) the PM staffs, then hands off to a lead expert; (c) no fixed lead
(self-organizing).

- **For (a).** Claude Code fixes the lead for its lifetime ("You can't promote a teammate to lead")
  [https://code.claude.com/docs/en/agent-teams, accessed 2026-10-17]. Paperclip's CEO and managers persist and run the
  delegation chain [https://docs.paperclip.ing/guides/org/org-structure/, accessed 2026-10-17]. The Magentic-One
  orchestrator holds the task and progress ledgers for the whole task and replans on stalls
  [https://arxiv.org/html/2411.04468, 2024-11]. Centralized coordination contains errors (4.4× vs 17.2×)
  [https://arxiv.org/abs/2512.08296, 2025-12]. MAST: giving the CEO the final say raised ChatDev by 9.4%
  [https://arxiv.org/html/2503.13657v3, 2025-10]. Devin's coordinator improves its breakdowns by reading child
  trajectories, which needs continuity [https://cognition.com/blog/devin-can-now-manage-devins, 2026-03-19].
- **Against (a), and for (b) or (c).** Supervisor "translation" costs accuracy and tokens
  [https://blog.langchain.com/benchmarking-multi-agent-architectures/, 2025-06-11]. Managers become cost and timeout
  bottlenecks (F14, F15). Managers are overly prescriptive (F12). Self-organizing beat centralized by 14% with
  strong models, though weaker models benefited from structure [https://arxiv.org/abs/2603.28990, 2026-03-30]
  (single-author preprint).
- **No evidence found** of a system that hands leadership from a staffing agent to a different lead mid-project and
  measured it.
- **Recommendation: (a), with constraints.** The PM stays lead for the project. It is the **single writer** of the
  plan/ledger and the only agent that closes tasks and approves deliverables. It is **not a relay**: experts post
  deliverables straight to the channel and the owner, and owner DMs go straight to experts. The PM is woken by
  events (task done, blocker, reaction), not by a timer. Use one model tier above the workers if the budget allows.
  **Confidence: medium-high.**

### Q2. Where are the owner's approval gates?

Options: (a) one card (brief + staffing); (b) brief, then staffing (two cards); (c) none.

- **For one combined card (a).** Plans get scrutinised (39% rejected) while per-action prompts get rubber-stamped
  (3%) [https://claude.com/resources/articles/auto-mode-default-in-claude-code, 2026-08-07]. Magentic-UI users valued
  editing plans before execution, and found a second approval right after a plan change "excessive"
  [https://arxiv.org/html/2507.22358, 2025-07-30]. Atoms gates at milestones, not per step
  [https://atoms.dev/ai-agents/team-leader-agent, accessed 2026-10-17].
- **For two cards (b).** Paperclip separates strategy approval from hire approvals, but because hires arrive over
  time, not because of an evaluated benefit [https://paperclip.inc/docs/paperclip/guides/welcome/key-concepts/, accessed 2026-10-17].
  Staffing depends on the brief, so a wrong brief wastes the sourcing work (step 4). Still, sourcing is cheap
  relative to execution.
- **Against no gates (c).** Lindy's trust-the-agent attempt produced unrequested real-world actions
  [https://www.lindy.ai/engineering/validator, 2026-04-28]. Hires "start spending budget" (Paperclip). Devin's
  auto-approve default suits child sessions of an already-approved task, not the creation of a new team.
- **Recommendation.** **One proposal card at step 6** combining the dated goal, success metric, scope, roles with
  qualifications, and per role "rehire X (record: …)" or "new expert (archetype + seed)". Show **budget and wake
  policy on the card face**; Paperclip hides them, which is a known gap. Every field is editable inline, with a
  "request revision" path. Ask clarifying questions in chat *before* the card when the brief is ambiguous; don't use
  a separate brief gate.
  During execution, gate only on: new hire or firing, budget threshold (80% warning, 100% pause), goal or scope
  change, and external/irreversible actions (validator or action guard). Small tasks get no card; Mira names the
  expert in chat and the owner taps once.
  **Confidence: medium.** The plan-vs-permission statistic comes from coding sessions, not team setup.

### Q3. Is a rehired expert the same agent or a fresh copy? Can one agent be on two live projects?

- **For same identity.** The record must attach to an identity for ReSo, REDEREF or CADMAS-style selection to work
  [https://doi.org/10.18653/v1/2025.emnlp-main.808, 2025]; [https://arxiv.org/abs/2604.17950, 2026-04]. Letta keeps one
  identity across many conversations [https://docs.letta.com/concepts/stateful-agents/index.md, accessed 2026-10-17].
  Product expectation is "Tuesday starts from Monday's corrections" [https://trydock.ai/blog/ai-employees, 2026-10-13].
- **For a fresh copy.** Captain Agent and Genspark reuse *configs* and instantiate fresh
  [https://arxiv.org/html/2405.19425v1, 2024-05]; [https://www.genspark.ai/blog/genspark-multiagent-orchestration, 2025-08-01].
  Memory carried wholesale propagates errors [https://arxiv.org/abs/2505.16067, 2025] and bleeds across projects
  [https://github.com/openclaw/openclaw/pull/48249, 2026-03-16]; [https://github.com/openai/codex/issues/18343, 2026-04-17].
- **On two live projects.** Letta's model is "separate conversations … with the same identity and memory"
  [https://docs.letta.com/concepts/stateful-agents/index.md, docs, accessed 2026-10-17]. Claude Code allows one team per session [https://code.claude.com/docs/en/agent-teams, docs, accessed 2026-10-17]. The bleed reports argue for
  project-scoped memory.
- **Recommendation: same identity, fresh project thread.** The identity carries name, mascot, archetype, record and
  the Inherent SOUL section, plus a curated *career* memory of cross-project Best approaches and Mistakes. Each
  project gets a new thread/checkpointer and a project-scoped memory section, seeded with a filtered subset of
  career memory matched to the role's qualifications.
  Allow one agent on two live projects as two threads, with memory writes scoped to the project. Promote lessons to
  career memory only through gated dreaming (below). Cap it at 2 live projects to protect the 30 requests/min
  budget.
  Record acceptance rate per archetype/skill × project type, not as one global score. **Confidence: medium.**

### Q4. What belongs in an expert's "config"?

- **Evidence.** AutoAgents: prompt (profile, goal, constraints), description, tool subset, suggestions
  [https://arxiv.org/html/2309.17288v3, 2023-09]. AOrchestra: instruction, context, tools, model
  [https://arxiv.org/abs/2602.03786, 2026-02]. Genspark YAML: toolset, system prompt, model (2025-08-01). Paperclip:
  role/title, capabilities, adapter/model, skills, budget, reports-to, heartbeat interval, timeout, cooldown, max
  concurrent runs, wake on demand [https://docs.paperclip.ing/guides/org/agents/, accessed 2026-10-17]. Claude Code
  sub-agent fields: tools, disallowedTools, model, permissionMode, maxTurns, skills, mcpServers, hooks, memory scope,
  effort, isolation [https://code.claude.com/docs/en/claude-directory, accessed 2026-10-17]. Devin: prompt, playbook,
  tags, ACU limit. Relevance: when-to-call, approval mode, max auto runs.
- **Keep tool sets small.** Manus uses fewer than 20 atomic functions and warns that a "heavily armed agent gets
  dumber" [https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus, 2025-07-18]. There is
  a measured tool-coordination penalty [https://arxiv.org/abs/2512.08296, 2025-12].
- **Model tier.** A cheap primary model with a smart advisor only works if the primary knows when to escalate. With
  a weak primary, Cognition suggests "always make at least one call" to the advisor or prescriptive triggers
  [https://cognition.com/blog/multi-agents-working, 2026-04-22]. This applies directly to DeepSeek Flash workers with
  a GLM-5.3 advisor.
- **Recommendation.** Config =
  - identity: archetype, display name/mascot (tone only)
  - brief: objective, deliverables plus output contract, success criteria, non-goals, escalation owner
  - tools/skills allowlist (small, archetype default plus role-specific)
  - model tier, plus advisor policy (mandatory advisor check at plan and final review)
  - budget: tokens/$ and a requests-per-minute share under Crusoe's 30 rpm per model
  - autonomy policy per action class (auto / ask / validator)
  - wake policy: event-driven; timer heartbeat off by default
  - memory: scope plus seed set
  - reporting line
  
  **Confidence: medium-high.**

### Q5. Who decides small task vs project?

- **Evidence.** Agents "struggle to judge appropriate effort", so Anthropic embedded explicit scaling rules
  [https://www.anthropic.com/engineering/multi-agent-research-system, 2025-06-13]. A predictive model using measurable features (decomposability, tool count, single-agent
  baseline) picked the best architecture 87% of the time. Sequential tasks get worse with teams
  [https://arxiv.org/abs/2512.08296, 2025-12]. Claude Code lets Claude decide but warns that "teams can form even when
  you didn't ask for one" [https://code.claude.com/docs/en/agent-teams, docs, accessed 2026-10-17]. Devin delegates "when it makes sense", with an owner toggle
  [https://docs.devin.ai/work-with-devin/advanced-capabilities, docs, accessed 2026-10-17]. Manus Wide Research is automatic only and not for fewer than 10 items
  [https://manus.im/cs/blog/manus-wide-research-solve-context-problem, accessed 2026-10-17]. Field reports show
  over-staffing as the common error (F5).
- **Recommendation.** **Mira decides with an explicit rubric and defaults to small.** The rubric: independent
  parallel parts, more than one archetype needed, multi-day or dated goal, multiple deliverables, and no sequential
  dependency chain. The card or chat states the choice and why. The owner can flip it with one tap ("make it a
  project" / "just one expert"). An expert in a DM can ask Mira to upgrade when it hits the rubric. Log flips in the
  ledger to recalibrate the rubric. **Confidence: medium.**

### Dreaming and heartbeat, per agent

- **Evidence.** OpenClaw dreaming is a nightly cron (`0 3 * * *`) with light → REM → deep phases. Only *deep*
  writes MEMORY.md, and only if minScore ≥ 0.75, recall ≥ 3 and unique queries ≥ 3. Heartbeat, cron and sub-agent
  sessions are excluded from durable memory. Each rewrite stores a pre-image, may drop at most 25% of prior entries,
  and is logged to a human-readable DREAMS.md [https://docs.openclaw.ai/concepts/dreaming, accessed 2026-10-17];
  [https://docs.openclaw.ai/cli/memory, accessed 2026-10-17].
  Lindy runs a memory agent every 12 hours, followed by a deterministic verifier (fits in context; linked from the
  index). "Procedural memory" ("how things are done") is the most valuable to keep
  [https://www.lindy.ai/engineering/memory-agent, 2026-08-16]. Letta dreaming runs on step count or compaction
  [https://docs.letta.com/configuration/memory/index.md, accessed 2026-10-17]. Offline pre-digestion reduces
  test-time compute about 5× [https://arxiv.org/abs/2504.13171, 2025-04].
  OpenClaw's heartbeat default prompt is deliberately narrow ("Do not infer or repeat old tasks… reply NO_REPLY"),
  defers while busy, and supports isolated light-context runs [https://docs.openclaw.ai/heartbeat/, accessed 2026-10-17].
  The BASELOAD cost blowout came from a manager heartbeat (F14).
- **Recommendation.**
  - Heartbeat only for Mira, as an isolated light-context turn over a precomputed digest (not raw channel state),
    with active hours.
  - Workers and the PM wake on events.
  - Dreaming per agent at project close plus nightly when there was activity. It promotes only evidence-backed
    items (👍/🔁 outcomes, 📌 pins, accepted deliverables) into MEMORY.md under a size budget, and writes a diff the
    owner can see.
  - Heartbeat transcripts never feed memory.
  
  **Confidence: medium.**

---

## 8. Steal list (ranked by value / effort for our flow)

| Rank | What | From | Maps to our flow | Effort |
|---|---|---|---|---|
| 1 | **Retrieve → select-with-abstention → generate → write back to the library** for staffing each role. The selector may say "None", which triggers synthesis | Captain Agent [https://arxiv.org/html/2405.19425v1, 2024-05] | Steps 4–5: the PM retrieves past workers by qualification embedding, an LLM selector picks or abstains, and a new expert is created and registered as talent | M |
| 2 | **One editable proposal card** (brief + staffing + budget + wake policy on the face) with "request revision". Gate plans and events, not steps | Paperclip hire/strategy approvals; Anthropic 39% vs 3%; Magentic-UI co-planning | Step 6 (and Q2) | S |
| 3 | **Per archetype × skill acceptance record with uncertainty** (Beta posterior from ledger outcomes). Rehire only when the record is good *and* well supported; prior from archetype | REDEREF; CADMAS-CTX; skill-conditional trust | Steps 4–5; the ledger already logs acceptance | M |
| 4 | **Delegation brief contract**: objective, deliverable + output format, tools/sources, boundaries, success criteria | Anthropic Research [https://www.anthropic.com/engineering/multi-agent-research-system, 2025-06-13]; Cognition Fusion [https://cognition.com/blog/local-fusion, 2026-09-11] | Step 3 (qualifications), step 5 (seed), step 7 (first tasks) | S |
| 5 | **PM ledgers**: task ledger (facts, guesses, plan) + progress ledger (done? progress? looping? next owner? instruction) + stall counter → replan | Magentic-One [https://arxiv.org/html/2411.04468, 2024-11] | Step 7 onward; the PM's `write_todos` plus a ledger file | M |
| 6 | **Forward, don't paraphrase**: experts post deliverables and artifacts by reference directly to the channel; the PM links to them | LangChain `forward_message`; Anthropic filesystem artifacts | Step 7; avoids the telephone game (F6) | S |
| 7 | **Effort-scaling rubric in Mira's prompt plus a one-tap override** | Anthropic scaling rules; Google task-feature predictor | Step 2 (Q5) | S |
| 8 | **Narrow, isolated heartbeat** (digest-only, NO_REPLY/QUIET, active hours); event-driven wake for everyone else | OpenClaw heartbeat; Paperclip wake triggers; BASELOAD post-mortem | Mira heartbeat; per-agent wake policy in config | S |
| 9 | **Budgets with an 80% warning and a 100% pause**, per agent and per project, plus an rpm share under Crusoe's 30 rpm | Paperclip budgets | Steps 5–6 (config), runtime | S |
| 10 | **Staffing critic**: one pass checking the proposed roster for redundant or missing roles and tool overload before the card | AutoAgents Agent Observer | Between steps 5 and 6 | S |
| 11 | **Minimum-viable-team default**: start with ≤3 experts; hiring mid-project needs a stated bottleneck and approval | Paperclip post-mortems; Claude Code "3–5" | Step 5, plus mid-project hires | S |
| 12 | **Gated dreaming** with thresholds, a pre-image, a max-loss cap and a human-readable diff; heartbeat sessions excluded | OpenClaw dreaming; Lindy verifier | Post-project / nightly MEMORY.md upkeep (Q3) | M |
| 13 | **Project-scoped memory with explicit promotion** to career memory | OpenClaw per-binding workspace PR; oh-my-pi per-project-tagged | Step 5 seeding; Q3 | M |
| 14 | **Clean-context reviewer** for key deliverables (independent of the author's context) | Devin Review; MetaGPT executable feedback | Step 7 onward, as the PM's review step | M |
| 15 | **Side-effect validator / action guard** (irreversibility tag + LLM judge checking owner authorization) | Lindy validator; Magentic-UI ActionGuard | Execution; ties to the ✋/👍 reactions | M |
| 16 | **Evolve the library by outcome**: deactivate agents that keep failing; prune memories that keep misleading | DyLAN team reformation; IER elimination; Xiong 2025 | Talent pool maintenance | L |

---

## 9. Gaps and caveats

- No source measured "PM persists vs hands off leadership" head-to-head (Q1).
- No study measured the "same identity vs fresh copy" choice directly. Q3 rests on documented product designs and
  memory-error research.
- Paper benchmarks (AgentVerse, AutoAgents, Captain Agent, EvoAgent, DyLAN) date from 2023–2024 and use GPT-3.5/4.
  Their absolute numbers won't transfer to DeepSeek Flash, but their mechanisms (abstention, library reuse,
  observers) do.
- Product field reports (Paperclip, Lindy) are single-team anecdotes; they are treated as evidence of failure
  modes, not as effect sizes.
- dots/Muse internals were not examined (out of scope).
