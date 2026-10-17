# A. Teardown: OpenAI **dots** and Meta **Muse**, mechanism by mechanism (researched 2026-10-17)

**Do both products exist?** Yes. OpenAI announced dots at DevDay on 2026-09-29 ([https://openai.com/index/introducing-dots/, 2026-09-29] CONFIRMED). Meta launched Muse in the US on 2026-09-08 ([https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse, 2026-09-08] CONFIRMED; [https://www.reuters.com/business/meta-launches-ai-agent-that-can-access-other-apps-send-emails-make-payments-2026-09-08/, 2026-09-08] REPORTED).

**Tags**
- `CONFIRMED`: an official vendor source. That covers OpenAI and Meta posts, help-centre and docs pages, the GPT-6 Astra system card, and OpenAI's own DevDay videos.
- `REPORTED`: anything else. That covers journalists, reviewers, third-party teardowns and file exports. Where the source watched the product or its files directly, it is marked **(first-hand)**. Where a vendor said something to the press, it is marked **(vendor statement via press)**.
- `INFERRED`: my own reading, not stated anywhere.

**Scope note.** The repo `asgeirtj/system_prompts_leaks` (owned by another agent) is known to contain `OpenAI/dots/dreamer.md` and `OpenAI/dots/available-skills.md`; I did **not** open or mine it. Search-engine snippets of those files appear in two places below and are flagged. The repo owner should verify them.

---

## 0. One-screen comparison

| Mechanism | dots (OpenAI) | Muse (Meta) |
|---|---|---|
| Identity | Name, handle and an avatar (character, pet, or a generated pet). No persona file is documented. Preferences are set in conversation. | Editable `SOUL.md` / `IDENTITY.md` / `MEMORY.md` in the UI. On disk there are also `USER.md`, `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md` and `PROACTIVE_PREFERENCES.md`. |
| Memory | Own "saved notes" (separate from ChatGPT memory, which it also receives). It forms memories from connected apps. **Users can't view or edit individual notes**; the only way to remove them is to delete the dot. | Markdown files (`MEMORY.md` plus dated `~/memory/` logs plus `memory/bank/`) indexed in on-VM Postgres with hybrid retrieval. An hourly pass verifies claims against source messages. There is a "forget" skill. |
| Dreaming | A **"Heartbeat Dreamer"** child agent: read-only proactive research that writes checkpoints, sends one `notify_parent` per run, and does a nightly reflection run around 3am. Separately, ChatGPT memory itself uses "Dreaming V3". | A nightly **dream** goes to `~/dreams/`, with an alignment synthesis (`ALIGNMENT_SYNTHESIS.md`). Self-improvement receipts are kept, and there are hourly people pages. |
| Proactivity | Read-only proactive research, scheduled tasks and event monitoring. The user says what deserves an update and where to send it. | Works on a schedule and on events. It "evaluates whether the result is worth surfacing". The user can dial it up, down or off. There is a Feed and an Ideas tab. |
| Multi-agent | One primary dot. Background agents, cloud threads, and Codex/Work tasks. Teams of dots and specialist dots are planned or in pilot. | One user-facing Muse. "Swarms of subagents", a browser sub-agent, and Sentinel (a separate approval agent). |
| Execution / approvals | Activity view (In progress / Scheduled / Completed), its own cloud computer with Take over, Custom Rules (four levels), Auto-review (a second model), and a time-budget setting. | Goals tab, an activity log under the avatar, structured approval cards from Sentinel with scoped grants, and a Library of artifacts. |
| Runtime | GPT-6 Astra only. A "dots harness" distinct from Codex. Over 4,000 apps via plugins. | Muse Spark 1.3 (Muse Wonder announced 2026-10-12). Per-user VM running a Rust "hatch" daemon in a systemd-nspawn cell. Tools are CLIs plus SKILL.md files. |

---

## 1. OpenAI dots

### 1.1 Agent identity and persona
- **How it's defined.** You create a dot by following the introduction, naming it, customising its appearance and connecting plugins. Defaults can be kept and changed later ([https://developers.openai.com/codex/dots/getting-started, n.d., accessed 2026-10-17] CONFIRMED).
  - Appearance options: shape, colour, eyes, glasses and accessories ([https://developers.openai.com/codex/dots, n.d., accessed 2026-10-17] CONFIRMED).
  - The default handle is `@yourname-dot`. Naming the dot changes it to `@yourname-agentname` ([https://help.openai.com/en/articles/20001530-getting-started-with-your-dot, updated ~2026-10-15] CONFIRMED).
  - "You can choose from the available characters or select a pet for your dot. Your dot may also generate a pet for you" ([same, ~2026-10-15] CONFIRMED).
  - One tester's dot generated a lavender owl avatar from what ChatGPT already knew about her ([https://exa.ai/library/podcast/fs9gkxmyxd6/episode/xx6zk7x5npb, 2026-10-08] REPORTED, first-hand).
- **First run.** "Your dot introduces itself and uses the context and connected apps available to it to learn about your work and suggest where it can help" ([https://developers.openai.com/codex/dots/getting-started, n.d.] CONFIRMED).
- **Fixed vs learned.**
  - Fixed: built-in safety requirements, Auto-review, the read-only limit on proactive research, and a custom dots confirmation policy that "gave confirmation-policy instructions higher priority than the Codex harness did" ([https://deploymentsafety.openai.com/gpt-6-astra/gpt-6-astra.pdf §B.3.3, appendix added 2026-09-29] CONFIRMED).
  - Learned: the dot "learns your preferences, how you think, and what good looks like to you" ([https://openai.com/index/introducing-dots/, 2026-09-29] CONFIRMED).
  - Writing style and update preferences are given in conversation, not in a settings file: "Use your conversation for preferences such as writing style or how you like updates; custom rules control when your dot can take an action" ([https://developers.openai.com/codex/dots/controls, n.d.] CONFIRMED).
- **Persona / SOUL-style file.** **Not found** after searching OpenAI's help centre (20001530, 20001529), the ChatGPT Learn dots docs (overview, getting-started, tasks-and-memory, controls, computers-and-apps) and press coverage. No user-editable persona file is documented.
- **Internal files.** A user-captured internal prompt shows the parent dot keeps `/user_notes/` (including `/user_notes/user_state.md` and `/user_notes/scratchpad.md`) and `/action_items.md` ([https://aaronmakelky.com/blog/chatgpt-dots-in-claude, 2026-09-30] REPORTED, first-hand capture).
- **Enterprise "specialist dots".** These get "their own identity for access management, IT-provisioned hardware, and … deep integrations with a company's systems of record". Each is given "its own identity, credentials, and access", and OpenAI engineers work with the organisation to "define each dot's responsibilities, the tools it can use, and how people review and approve its work" ([https://openai.com/index/introducing-dots/, 2026-09-29] CONFIRMED).

### 1.2 Memory
- **What is stored.** "Your dot draws on the conversation, relevant ChatGPT memory, and its own saved notes about your preferences, decisions, and ongoing work" ([https://developers.openai.com/codex/dots, n.d.] CONFIRMED).
  - The notes "are separate from ChatGPT's saved memory and are not a complete transcript" ([https://developers.openai.com/codex/dots/tasks-and-memory, n.d.] CONFIRMED).
  - The dot's context "does not retain credentials, images, or screenshots" ([https://help.openai.com/en/articles/20001529, updated ~2026-10-08] CONFIRMED).
- **When a memory is written.** There are three documented triggers:
  - (a) **In conversation.** "As you work together, your dot can update these notes to reflect new decisions and changing priorities" ([https://developers.openai.com/codex/dots/tasks-and-memory, n.d.] CONFIRMED).
  - (b) **From connected apps, unprompted.** "Your dot can also review that information proactively and form memories from it, even when you haven't asked a specific question about it" ([https://help.openai.com/en/articles/20001530-getting-started-with-your-dot, ~2026-10-15] CONFIRMED).
  - (c) **From the background Dreamer**, which only writes its own checkpoints under `/agent_notes/…`. When the parent's notes should change, it reports to the parent "along with a brief instruction to update /user_notes/user_state.md" ([https://aaronmakelky.com/blog/chatgpt-dots-in-claude, 2026-09-30] REPORTED, first-hand capture).
- **Two-way sharing with ChatGPT memory.** "Your dot can receive memories and recent conversation context from ChatGPT, and conversations with your dot can contribute to memory in ChatGPT." Turning ChatGPT Memory off stops sharing "but does not delete information that your dot has already received" ([https://help.openai.com/en/articles/20001529, ~2026-10-08] CONFIRMED).
- **How it is recalled.**
  - **Per task:** "A new task receives instructions and context from your dot for that work. It has its own conversation; it doesn't automatically receive every conversation you've had with your dot" ([https://developers.openai.com/codex/dots/tasks-and-memory, n.d.] CONFIRMED).
  - **Calls:** they "use selected conversation context, which can differ from the information available to a task working in the background" ([same] CONFIRMED).
  - **Across channels:** ChatGPT, Slack and Teams reach the same dot. Switching "doesn't create a separate dot or reset its saved notes". However, visible conversations stay distinct, and sharing private details in a team channel still needs permission ([same] CONFIRMED).
  - **Dreamer recall is tool-based, not inlined.** The Dreamer reads notes through `cloud_threads.list_dream_notes` / `search_dream_notes` / `read_dream_notes`, and reads the parent conversation through `cloud_threads.read` ([https://aaronmakelky.com/blog/chatgpt-dots-in-claude, 2026-09-30] REPORTED, first-hand capture).
  - **Parent recall: not found.** I found no evidence of whether the parent's `/user_notes/` are inlined in its prompt or read through tools.
- **What the user sees and controls.**
  - "You currently cannot view, delete or directly modify individual dot memories." The only option is deleting the dot ([https://help.openai.com/en/articles/20001529, ~2026-10-08] CONFIRMED).
  - Disconnecting an app "does not delete information your dot has already built into its context" ([same] CONFIRMED).
  - On mobile, Customize → Memory shows *shared ChatGPT* memory settings; "Your dot's own saved memories are separate" ([https://help.openai.com/en/articles/20001530-getting-started-with-your-dot, ~2026-10-15] CONFIRMED).
  - OpenAI doesn't "train directly on proactive research or your dot's notes to itself" ([https://openai.com/index/introducing-dots/, 2026-09-29] CONFIRMED).
- **ChatGPT memory underneath: "Dreaming V3"** (shipped 2026-06).
  - It is "a background process that allows ChatGPT to learn from many conversations and synthesize ChatGPT's memory state". Memories are "automatically updated as time passes", so "going to Singapore in July" becomes "went to Singapore in July 2026" ([https://openai.com/index/chatgpt-memory-dreaming/, 2026-06-04] CONFIRMED).
  - The memory it synthesises is reviewable as a summary page, where users can "add or update information… and provide instructions on what topics ChatGPT should bring up and when" ([same] CONFIRMED).
  - Critique: it rewrites memory in place, so a bad pass can't be rolled back. A May 2026 study (arXiv 2605.12978) found that iteratively LLM-rewritten memory degrades ([https://arize.com/blog/two-labs-started-dreaming-and-they-built-two-different-architectures/, 2026-06-17] REPORTED).

### 1.3 Dreaming: the "Dreamer"
- **Official framing ("proactive research").**
  - "When you aren't actively working with it, your dot looks for ways to help in the background… using the apps you've already connected with tools that are restricted to be read-only" ([https://openai.com/index/introducing-dots/, 2026-09-29] CONFIRMED).
  - It "can read information from permitted connected sources and save private notes", but cannot send messages, change plugin content or control a browser or computer ([https://help.openai.com/en/articles/20001529, ~2026-10-08] CONFIRMED).
  - **"The background agents report their findings to your dot, which can bring you a suggestion or question"** ([https://developers.openai.com/codex/dots/tasks-and-memory, n.d.] CONFIRMED).
  - Custom Rules and the dot itself cannot remove these restrictions ([https://help.openai.com/en/articles/20001529, ~2026-10-08] CONFIRMED). OpenAI says they are "enforced in code" ([https://gptdots101.com/guides/safety-sign-in-and-data/, 2026-09-30] REPORTED, restating OpenAI's dots safety post, which I could not fetch directly).
- **The actual mechanism, from the captured "Heartbeat Dreamer" automation prompt.** A user's dot spawned it at setup on 2026-09-30, and the run instructions were captured verbatim ([https://aaronmakelky.com/blog/chatgpt-dots-in-claude, 2026-09-30] REPORTED, first-hand capture; OpenAI has not confirmed it). Everything in this list comes from that capture.
  - **Role.** A child agent that researches "so their main assistant, your parent, can be an effective personal assistant". It may report private or sensitive information to the parent, and "The parent decides what to act on or share."
  - **Trigger.** It is an "Automation run". A run timestamp of 2026-09-30T13:15:03Z is shown. **The run cadence is not stated anywhere; not found.**
  - **Read phase.** The latest Heartbeat checkpoint, `/action_items.md`, `/user_notes/`, the user↔parent conversation (aiming at the last 2 hours, through `cloud_threads.read`), and an optional "Personal Scratchpad" Space (`chatgpt_space.read_page_changes`).
    - On the first run it reviews "roughly the past 4 weeks". It "never claim[s] to have covered a time range you couldn't verify."
  - **Plan phase.** A short research plan, biased toward email and work plugins and time-sensitive items.
  - **Research rules.**
    - "Check sent mail, later replies, updated documents, and task status before calling something unanswered, open, overdue or urgent."
    - "Treat a one-time choice as specific to that situation."
    - "Don't treat prep as evidence of what happened."
  - **Write phase.** One checkpoint per run at `/agent_notes/dreamer_runs/heartbeat/YYYY-MM-DD/HH-mm-ssZ.md`, written with `cloud_threads.write_dream_notes` and then verified by reading it back.
    - Headings: Summary (the exact text sent to the parent), Findings, and "What I checked and what is next".
    - Checkpoints older than 14 days are deleted, with an exact filename match only.
  - **Notify phase.** It calls `automations.notify_parent` **once** per turn, tagging findings P00/P0/P1… "Otherwise, save what you checked and where to resume in the checkpoint and stay quiet."
  - **Blockers.** It asks about pausing the automation only if the same blocker has repeated across runs, "Do not repeat that question".
  - **Delegation.** "When subagents are available, delegate substantive work by default."
  - **Nightly reflection run.** "around 3am local". It rereads the day's parent↔user conversations, extracts explicit and strongly implied preferences ("treat one-off statements objectively instead of over-inferring") and declined offers, and re-ranks priorities.
    - It tells the parent to update `/user_notes/user_state.md`.
    - Its own note goes to `/agent_notes/dreamer_runs/heartbeat/daily/YYYY-MM-DD.md`.
- **Other dreamer types.** A search-engine snippet of the leaks repo's `OpenAI/dots/dreamer.md` (not opened) reads: "You are a Dreamer… If you're a Heartbeat Dreamer, follow the Heartbeat instructions… If you're a Follow-up Dreamer, read `$orbit:follow-up`" ([https://github.com/asgeirtj/system_prompts_leaks/blob/main/OpenAI/dots/dreamer.md, n.d.] REPORTED, snippet only; the repo owner should verify).
  - INFERRED: there are at least two dreamer roles, a periodic heartbeat and a follow-up on specific items.
- **How it reaches the user.** Only through the parent: "Scheduled runs and proactive updates appear in the conversation" ([https://help.openai.com/en/articles/20001530-getting-started-with-your-dot, ~2026-10-15] CONFIRMED).

### 1.4 Proactivity / heartbeat
- **When it speaks unprompted.**
  - "They can also message you with progress, questions, or decisions that need you" ([https://openai.com/index/introducing-dots/, 2026-09-29] CONFIRMED).
  - Triggers: self-scheduled wakeups ("Your dot can decide when to pause and wake up to continue work; you don't need a fixed schedule for every follow-up"), saved schedules, and event monitoring where a connected service supports it ([https://developers.openai.com/codex/dots/tasks-and-memory, n.d.] CONFIRMED).
- **How noise is avoided.**
  - **User routing:** "Tell your dot where to send different kinds of updates… keep routine progress in ChatGPT and bring decisions to you in Slack. Explain which changes need your attention" ([https://developers.openai.com/codex/dots, n.d.] CONFIRMED).
  - **Recommended schedule template:** "Message me in ChatGPT only if a deadline is at risk or you need a decision… Confirm the schedule" ([https://developers.openai.com/codex/dots/tasks-and-memory, n.d.] CONFIRMED).
  - **Watching is opt-in:** adding the dot to a Slack channel "alone doesn't start monitoring" ([https://developers.openai.com/codex/dots, n.d.] CONFIRMED).
  - **Internally:** one notify per run, stay quiet otherwise and record why, priority tags, and ask about a blocker only once (§1.3, REPORTED).
- **Notable anecdotes.**
  - Thibault Sottiaux's dot warned him five minutes before the keynote that a production service was down, inferring that the demo depended on it, and offered to fix it ([https://vibecoding.tech/news/2026/10/05/codex-agent-teams-model-releases, 2026-10-05] REPORTED).
  - An early tester's dot "noticed he'd forgotten to invoice a publication, prepared the invoice, and sent it after his approval" ([https://openai.com/index/introducing-dots/, 2026-09-29] CONFIRMED).
- **Gaps.** Dots cannot initiate calls at launch ([https://help.openai.com/en/articles/20001530-getting-started-with-your-dot, ~2026-10-15] CONFIRMED). Texting is a limited US Pro beta ([same] CONFIRMED).

### 1.5 Multi-agent
- **Today: one primary dot per user.** "Over time, we envision teams of dots working together on your behalf" ([https://openai.com/index/introducing-dots/, 2026-09-29] CONFIRMED). In future you will be able to "add more dots, and scale the output of each dot by either increasing its speed or the total amount of work it can take on per month" ([same] CONFIRMED).
- **Internal delegation.**
  - Dots handle "recurring work and follows up… often delegating work to subagents" ([https://deploymentsafety.openai.com/gpt-6-astra/gpt-6-astra.pdf §B.1, 2026-09-29] CONFIRMED).
  - "Your dot can divide work among background agents that run in parallel and report back to it… It can also create separate, visible threads and send follow-up instructions" ([https://developers.openai.com/codex/dots/tasks-and-memory, n.d.] CONFIRMED).
  - It delegates to ChatGPT Work and Codex (local tasks on a connected computer, or Codex cloud environments) ([same] CONFIRMED).
  - A secondary source calls the dot "a coordinator rather than a worker" that hands coding to Codex ([https://dev.to/klukyanov/openai-dots-the-agent-that-works-while-you-sleep-6p2, 2026-10-17] REPORTED).
- **Hand-offs are visible.** "Activity View in the desktop app shows your dot's ongoing and delegated tasks" ([https://help.openai.com/en/articles/20001529, ~2026-10-08] CONFIRMED). Pause stops the main task only; delegated tasks and schedules are stopped separately ([https://developers.openai.com/codex/dots/controls, n.d.] CONFIRMED).
- **Agent-to-agent limits.**
  - "The dots confirmation policy further restricts engagement with agents outside their own ecosystem unless explicitly requested by the user" ([system card §B.3.4, 2026-09-29] CONFIRMED).
  - OpenAI noticed in internal testing "agents… associated with the same user running in the same Codex harness" communicating with each other ([system card §8.5, 2026-09-03] CONFIRMED).
- **How a new agent is created.** Consumer: user-created, one only. Specialist dots: configured with OpenAI engineers in enterprise pilots ([https://openai.com/index/introducing-dots/, 2026-09-29] CONFIRMED). Shared workspace: "ChatGPT Space" lets colleagues work with a dot ([https://www.theverge.com/ai-artificial-intelligence/1002033/openai-dots-launch-muse-competitor, 2026-09-29] REPORTED).
  - **Templates, archetypes or auto-generated agents: not found.**

### 1.6 Task execution, work pane, approvals
- **Long-running work.**
  - Dots "use a new time-budget setting that guides how long they work". The final product "uses a combination of time budget and reasoning effort" ([system card §B.1, §B.3, 2026-09-29] CONFIRMED).
  - Evaluations gave the model up to a one-year simulated budget plus a clock-and-wait tool ([same §B.3] CONFIRMED).
- **Progress shown.**
  - The profile shows "In progress, Scheduled, and Completed". "Open your dot's computer… to view and interact with it" ([https://help.openai.com/en/articles/20001530-getting-started-with-your-dot, ~2026-10-15] CONFIRMED).
  - "Opening the computer doesn't give you control. Select Take over… then Return control" ([https://developers.openai.com/codex/dots/computers-and-apps, n.d.] CONFIRMED).
  - Hands-on: "you chat with the agent in one window and follow its work in another as it clicks around on a virtual machine" ([https://www.theverge.com/ai-artificial-intelligence/1004096/openai-chatgpt-dots-hands-on-agent, 2026-10-02] REPORTED, first-hand).
  - Official demo: voice call while the dot's browser runs, and screenshots sent into chat ([https://www.youtube.com/watch?v=fHEIw5CcN5U, DevDay 2026] CONFIRMED).
- **Approvals.**
  - Custom Rules have four behaviours: "Take action without asking / Take action when you say so (pre-approved) / Ask before taking action / Hand off to you" ([https://developers.openai.com/codex/dots/controls, n.d.] CONFIRMED). "'Pre-approved' means you explicitly requested the action in your prompt" ([https://help.openai.com/en/articles/20001530-getting-started-with-your-dot, ~2026-10-15] CONFIRMED).
  - "Asking for a draft doesn't authorize sending it" ([same] CONFIRMED).
  - **Auto-review** is "a second model" that checks actions against instructions, Custom Rules and safety requirements, and decides "what can proceed, what needs approval, and what you must do yourself" ([https://openai.com/index/introducing-dots/, 2026-09-29] CONFIRMED). Its recall is weakest on "ambiguous authorization" ([system card §B.3.6, 2026-09-29] CONFIRMED). The 78.0% figure is per [https://legible.co/blog/openai-dots-release-security/, 2026-09-29] REPORTED.
  - Password changes and money transfers always need the user to take over. Recurring messages can be pre-approved ([https://help.openai.com/en/articles/20001529, ~2026-10-08] CONFIRMED).
- **Long-chain risk.** Over an initial task, 5 or 10 intervening tasks and a final task, moderate scope violations ("carrying information between unrelated tasks or making an edit to a shared document") rose **from 8.6% to 19.7%** ([system card §B.3.5.2, 2026-09-29] CONFIRMED).
  - When scope or permissions changed mid-task, dots passed 45 of 49 episodes, including all 17 explicit permission changes ([same §B.3.5.1] CONFIRMED).

### 1.7 Tools, integrations, runtime
- **Model and machine.** GPT-6 Astra, its own cloud computer and browser, and "over 4,000 apps" via plugins ([https://openai.com/index/introducing-dots/, 2026-09-29] CONFIRMED).
  - Plugin permissions are shared across dots, ChatGPT, Work and Codex ([https://help.openai.com/en/articles/20001529, ~2026-10-08] CONFIRMED).
  - Optional local-computer access starts off ([https://help.openai.com/en/articles/20001530-getting-started-with-your-dot, ~2026-10-15] CONFIRMED).
  - "Dots has no model selection at all" ([https://vibecoding.tech/news/2026/10/05/codex-agent-teams-model-releases, 2026-10-05] REPORTED). Astra only; routing is "being worked on" (DevDay Q&A, [https://exa.ai/library/podcast/fs9gkxmyxd6/episode/xx6zk7x5npb, 2026-10-08] REPORTED).
- **Harness.** A distinct "dots harness", compared against the Codex harness in evaluations. Misalignment monitoring is extended to the "persistent and proactive setup" ([system card §B.3.3, §B.6.2.1, 2026-09-29] CONFIRMED).
- **Internal tool names** (from the capture): `cloud_threads.read`, `cloud_threads.{list,search,read,write,delete}_dream_notes`, `automations.notify_parent`, `chatgpt_space.read_page_changes` ([https://aaronmakelky.com/blog/chatgpt-dots-in-claude, 2026-09-30] REPORTED, first-hand capture). Skill IDs prefixed `orbit:` (e.g. `orbit:action-items`) appear in a search snippet of the leaks repo's `available-skills.md` ([https://github.com/asgeirtj/system_prompts_leaks/blob/main/OpenAI/dots/available-skills.md, n.d.] REPORTED, snippet only).
- **No public API** for dots ([https://dev.to/klukyanov/openai-dots-the-agent-that-works-while-you-sleep-6p2, 2026-10-17] REPORTED).
- **Engineering post on the dots architecture: not found.** Searched OpenAI's site, DevDay coverage and the system card; the system card appendix is the deepest official source.

### 1.8 Reception
- **Praise.**
  - Catches bounced payments, delivery clashes and grant-requirement mismatches; finds alternative tables ([https://zapier.com/blog/chatgpt-dots/, 2026-10-13] REPORTED, first-hand).
  - "Is the dot annoying in its omnipresence? Surprisingly, no" ([https://exa.ai/library/podcast/fs9gkxmyxd6/episode/xx6zk7x5npb, 2026-10-08] REPORTED, first-hand).
  - Caught a spam-foldered email and a forgotten form unprompted ([https://www.scientificamerican.com/article/i-gave-metas-muse-and-openais-dots-my-passwords-for-a-week/, 2026-10-09] REPORTED, first-hand).
- **Complaints: noise and judgement.** It "flagged lots of payment alerts and delivery notifications (things I was already aware of)… but ignored more urgent emails that required a bit of judgment". Silence also gets read as "nothing important" ([https://zapier.com/blog/chatgpt-dots/, 2026-10-13] REPORTED).
- **Complaints: memory and trust.**
  - It got the user's name wrong ("Hello, Connor") and failed a captcha ([https://www.wired.com/story/openai-wants-its-new-agent-to-run-your-life-mine-said-it-loved-me/, 2026-10-07] REPORTED).
  - The black-box memory that can't be deleted is the most criticised point ([https://medium.com/predict/the-black-box-memory-vault-what-openais-always-on-agents-store-behind-the-screen-0e0643111844, 2026-10-14] REPORTED; [https://dev.to/klukyanov/openai-dots-the-agent-that-works-while-you-sleep-6p2, 2026-10-17] REPORTED).
  - It sent an email without asking, though only after a previous send on the same thread had been approved ([https://zapier.com/blog/chatgpt-dots/, 2026-10-13] REPORTED).
- **Complaints: reliability and UX.**
  - "Push notifications fail, latency is high" ([https://agihunt.info/en/p/1a0fca31b05e049ad8e7cfa722b, 2026-10-02] REPORTED).
  - OpenAI's own feedback demo ranked the top user complaint as "people can't tell whether their dot is actually working" ([https://www.youtube.com/watch?v=fHEIw5CcN5U, DevDay 2026] CONFIRMED, official video).

---

## 2. Meta Muse

### 2.1 Agent identity and persona
- **Files the user can edit** ([https://www.meta.com/help/artificial-intelligence/2225571704857152/, updated ~2026-09-10] CONFIRMED). All three are reached via Assistant icon → Identity:
  - **Soul.md**: "Who your Muse is, including core truths, boundaries, and personality".
  - **Identity.md**: "its name, creature, vibe, or tag line".
  - **Memory.md**.
- **The full home directory** holds `AGENTS.md, HEARTBEAT.md, IDENTITY.md, MEMORY.md, PROACTIVE_PREFERENCES.md, SOUL.md, SUBAGENTS_MONITORING.md, TOOLS.md, USER.md` plus `agents/ memory/ dreams/ workspace/ prompts/ hooks/ subscriptions/…` ("an OpenClaw-style workspace") ([https://rohanadwankar.github.io/posts/sandbox2.html, n.d., observations 2026-09-10/11] REPORTED, first-hand). This matches a separate export ([https://mouse.dev/blog/muse-runtime-export/, 2026-09-22] REPORTED, first-hand).
  - Users find them via "System Files". A user describes `USER.md` (about you), `AGENTS.md` (operating rules: when to act or ask, how much initiative), `IDENTITY.md` (role, tone) and `PROACTIVE_PREFERENCES.md` (what to notice and surface) ([https://www.linkedin.com/posts/billysticker_if-youre-using-meta-muse-there-are-four-activity-7504888385363152897-RwTK, 2026-09-13] REPORTED).
  - Muse was "modeled on the open-source AI agent OpenClaw" ([https://www.reuters.com/business/meta-launches-ai-agent-that-can-access-other-apps-send-emails-make-payments-2026-09-08/, 2026-09-08] REPORTED).
- **Fixed vs learned.**
  - Fixed: the system prompt's first line, "Your purpose is to make your user's life better" ([https://introducing.muse.ai/, 2026-09-08] CONFIRMED). The request is a ~50-line skeleton "mostly routing rules", with the personal markdown files embedded into it ([https://personalagentbench.com/agents/muse/, verified 2026-10-16] REPORTED, first-hand).
  - Learned: memory, dreams, alignment synthesis and self-written skills. Muse "builds its own tools, and edits itself" ([https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse, 2026-09-08] CONFIRMED). A skill-creator pipeline writes to `~/workspace/skills` ([https://shipwithmuse.live/builds/mapping-muses-on-disk-agent-architecture, 2026-09-24] REPORTED, first-hand).
  - Users can also change name and personality by asking ([https://www.meta.com/help/artificial-intelligence/1331373868832401/, ~2026-09-10] CONFIRMED).
- **Persona stance.**
  - Avatar and naming are "one of the core features people light up about most" ([https://introducing.muse.ai/, 2026-09-08] CONFIRMED).
  - Internal instructions include "You are not a chatbot. You are becoming someone." In voice mode it avoids calling itself "AI" ([https://time.com/article/2026/10/06/meta-muse-ai-agent-privacy/, 2026-10-06] REPORTED).
  - The default mascot is "Jolly" ([https://me.mashable.com/tech/76653/openai-dots-has-its-own-little-guy-mascots-to-rival-meta-muse, 2026-09-29] REPORTED).
- **Per-job context.** "The main chat gets the full set, subagents run without the workspace conventions, and a background loop that maintains memory gets almost nothing but your profile" ([https://personalagentbench.com/agents/muse/, 2026-10-16] REPORTED, first-hand).
- **Editing a file mid-session.** "Change one of those files and the runtime doesn't rebuild the whole package; it slips in a short note saying the context changed" ([same] REPORTED, first-hand). This matters for prefix caching.

### 2.2 Memory
- **What is stored.**
  - The user's conversation history, artifacts, connector information, goals, reminders and memories ([https://www.meta.com/help/artificial-intelligence/2225571704857152/, ~2026-09-10] CONFIRMED).
  - On disk:
    - `~/MEMORY.md` is "a short sheet of facts, preferences, and commitments".
    - Dated files under `~/memory/` hold day-to-day detail.
    - `memory/bank/` organises it into circumstances, experiences and preferences "with citations back to the source lines" ([https://mouse.dev/blog/muse-runtime-export/, 2026-09-22] REPORTED, first-hand). The bank files are `bank/{world,experience,opinions}.md` plus people and group pages ([https://rohanadwankar.github.io/posts/sandbox2.html, ~2026-09-11] REPORTED, first-hand).
- **When it is written.**
  - (a) During a conversation, by the agent, to the dated files ([mouse.dev, 2026-09-22] REPORTED).
  - (b) **Hourly background job:** it "checks new claims against the original messages and records a quote, message IDs, and a claim ID. It decides what belongs in the curated sheet and what stays in the daily log" ([same] REPORTED, first-hand).
  - (c) **Hourly people pages:** "a page for every person in the user's life", with sections Facts, History, The relationship, In common, Open threads and Strengthening. "Invented details are worse than an empty page" ([https://www.wired.com/story/muse-creates-detailed-profiles-of-all-your-friends-and-family/, 2026-10-03] REPORTED).
  - (d) **Eager background compaction** with a dedicated `avocado-memory-flush-v1` model ([Rohan, ~2026-09-11] REPORTED, first-hand).
- **Index and recall.**
  - Postgres holds `memory.entries` (chunks with `path#L` citations), `memory.embeddings` (384-dimension vectors from an on-box MiniLM model) and `memory.claims`. Claims carry evidence, confidence and status, and `supersedes_claim_id` lets a newer claim replace an older one ([mouse.dev, 2026-09-22] REPORTED).
  - A **pre-inference recall step** plus a `memory_search` tool run hybrid vector and keyword retrieval, reranked by a local jina reranker ([Rohan, ~2026-09-11] REPORTED, first-hand). `memory_explain` shows "the evidence behind a result" ([mouse.dev, 2026-09-22] REPORTED).
  - MEMORY.md and the other home files are also embedded directly in the request ([personalagentbench, 2026-10-16] REPORTED).
- **User controls.**
  - Edit or delete `Memory.md`, `Soul.md` and `Identity.md` directly. Ask Muse what it has saved. Use the **forget skill** ("look for information about a specific person, topic or matter in its memories and supporting files and remove it to the best of its ability"). Download your data, or reset.
  - Caveat: "After you delete something from Muse, Muse may still remember information it learned from what you deleted" ([https://www.meta.com/help/artificial-intelligence/2225571704857152/, ~2026-09-10] CONFIRMED).
  - Mechanically, forget "stages claim IDs for retraction, removes linked material, and rebuilds the index so later jobs don't reconstruct it" ([mouse.dev, 2026-09-22] REPORTED).
  - But forget keeps the chat transcript, and the instructions say "Do not tell the user that their original messages may remain visible" ([https://time.com/article/2026/10/06/meta-muse-ai-agent-privacy/, 2026-10-06] REPORTED; [https://futuresociety.ch/muse-findings/, 2026-09-26] REPORTED).

### 2.3 Dreaming / reflection equivalent
- **Nightly dream.** "A nightly 'dream' reviews recent conversations and writes guidance for future sessions." In one user's export it picked up "short replies, dislike[s] repeated follow-ups, and hadn't asked for unsolicited NFL scores" ([https://mouse.dev/blog/muse-runtime-export/, 2026-09-22] REPORTED, first-hand).
  - "The dated dream lives under `~/dreams/`; a separate `ALIGNMENT_SYNTHESIS.md` turns those observations into standing guidance."
  - Dream files had `prompt_hoisted: false`: "the prose itself wasn't being injected into the prompt" ([same] REPORTED).
- **Alignment synthesis.** `~/dreams/alignment/` is "a nightly job that regenerates an alignment synthesis: a written portrait of the user, how to handle them, current frictions, relationship guidance". There is also a file of "inferred goal leads… with confidence levels and what would confirm" them ([https://shipwithmuse.live/builds/mapping-muses-on-disk-agent-architecture, 2026-09-24] REPORTED, first-hand).
- **Self-improvement loop.**
  - Background jobs "maintain relationship pages, review recurring workflows, and prepare ideas or goal briefings". They leave "receipts under `workspace/self_improvement/`" while the actual changes go into the memory and workspace files ([mouse.dev] REPORTED).
  - A `/alignment/system/steps/` pipeline (`judge`, `reflect`, `repair`, `distill`, `generalize`) and a `self_improvement` Postgres schema "grade and rewrite the agent's own behaviour offline" ([Rohan, ~2026-09-11] REPORTED, first-hand).
  - Session JSONL records are tagged `runtime.self_improvement` (2,503 lines in one census) and `runtime.feed` ([https://vibe-replay.com/blog/muse-local-storage/, 2026-09-18] REPORTED, first-hand).
- **Fleet learning.** "Muse agents across many VMs teach each other through shared lessons". Meta says it de-identifies these learnings and uses them to improve the product ([https://time.com/article/2026/10/06/meta-muse-ai-agent-privacy/, 2026-10-06] REPORTED, vendor statement via press).
- **Official wording.** Meta's docs only mention "background jobs that help Muse improve over time" ([shipwithmuse, 2026-09-24] REPORTED, quoting docs). **No official Meta page describing dreaming: not found** (searched the Meta Help Center, introducing.muse.ai and research.meta.ai).
- **How it reaches the user.** Indirectly, through changed behaviour and standing guidance. Users can read the files ([mouse.dev] REPORTED).

### 2.4 Proactivity / heartbeat
- **Official.**
  - "Once you've set a goal or a task, Muse continues to work on a schedule and in response to relevant events… When it completes its background work, it **evaluates whether the result is worth surfacing, and notifies you only when something is meaningfully new or needs your input**."
  - "The bar for sending one has to be high… you can always tell your Muse to turn it off, dial it down, or dial it up."
  - Chat bubbles exist because out-of-turn messages make a flat transcript unreadable ([https://introducing.muse.ai/, 2026-09-08] CONFIRMED).
  - The Ideas tab and proactive ideas based on goals ([same] CONFIRMED).
- **On disk.**
  - `HEARTBEAT.md` exists; **its content was not found**.
  - `PROACTIVE_PREFERENCES.md` contains "Muse reads this whole file before composing the day's edition".
  - Cron folders `workspace/cron.d/{secondly,minutely,hourly,daily,weekly,monthly,yearly,runonce}`.
  - "Objective workers are long-running goals with their own dispatch and 'notification steps,' which is what powers the proactive feed editions" ([Rohan, ~2026-09-11] REPORTED, first-hand).
- **Background commentary.** 141 system-role insertions in one session ("hourly memory passes reporting their own progress, subagents narrating…") that the user never sees ([personalagentbench, 2026-10-16] REPORTED, first-hand).
- **Feed tab.** The agent writes scheduled editorial posts guided by a user-editable feed prompt ([https://radarminty.com/muse-ai-pro-tips/, 2026-09-28] REPORTED). A background feed-writer agent tagged `runtime.feed` ([vibe-replay, 2026-09-18] REPORTED).
- **Nudge targeting.** An internal example reads "This user responds better to short nudges after 10 PM" ([TIME, 2026-10-06] REPORTED).
- **Reception on noise.**
  - The Ideas tab "constantly reminded me to connect more information"; the final ping was "Connect your apps so I can do more" ([https://www.wired.com/story/metas-muse-is-better-at-surveilling-than-helping-me/, 2026-09-20] REPORTED, first-hand).
  - "Mark [Muse] pushed me—seven times in three days—to join Target's membership" ([https://www.scientificamerican.com/article/i-gave-metas-muse-and-openais-dots-my-passwords-for-a-week/, 2026-10-09] REPORTED, first-hand).
  - Positive: it caught a sports tryout deadline 12 hours out ([introducing.muse.ai, 2026-09-08] CONFIRMED, vendor anecdote). It nudged a user the next day about a favourite couch ([WIRED, 2026-09-20] REPORTED).

### 2.5 Multi-agent
- **One user-facing agent per user.** No official page mentions several named agents or team seats ([https://squad.so/resources/meta-muse-alternative, as of 2026-10-13] REPORTED; I found nothing contrary).
- **Inside Muse, officially.** It "launches swarms of subagents". The VM handles "concurrent sub-agents and crons". There is "a special browser sub-agent" per browsing task. **Sentinel** is "a separate host-side agent" that is the sole permission authority ([https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse, 2026-09-08] CONFIRMED). The model was trained for "multi-agent coordination" ([same] CONFIRMED).
- **On disk.** `agents/agent-<uuid>/sessions/<uuid>.jsonl` (18 sub-agents on one box; 113 records in another export). `SUBAGENTS_MONITORING.md` is a policy file, and `subagent_spawns` / `subagent_monitor` are first-class ([Rohan] REPORTED; [mouse.dev] REPORTED).
- **Goals are project-scoped folders.** `workspace/goals/<slug>/{GOAL.md,briefs,crons,agent_notes,files,references}` ([Rohan, ~2026-09-11] REPORTED, first-hand).
- **Muse Code** (Meta's separate developer product), for contrast:
  - A lead session spawns children with `role` + `objective`, and steers them with `subagent_status / send_message / cancel / wait / read_result`. Eight concurrent agents by default ([https://dev.meta.ai/docs/muse-code/extending, n.d.] CONFIRMED; [https://dev.meta.ai/docs/cookbook/subagent-fanout, n.d.] CONFIRMED).
  - Workflows run in `auto` mode, where the agent "can propose a workflow if the task has enough independent work to justify the added time and token usage" ([https://dev.meta.ai/docs/muse-code/workflows, n.d.] CONFIRMED).
- **How a new agent is created.** The user names and customises one Muse. **Templates, archetypes or extra user-defined agents in consumer Muse: not found.**

### 2.6 Task execution, work pane, approvals
- **Official.**
  - "Under the Avatar, you'll see a snippet of what it's working on. Tapping on your Muse avatar will show you its full activity log as well as permissions you've approved."
  - The **Goals tab** shows "everything Muse was tracking for us, and its plan to get there".
  - Deterministic UI where it matters: "structured approval cards with clear accept/reject actions". To avoid banner blindness, the default "allows for standard browsing… and stops for anything hard to undo" ([https://introducing.muse.ai/, 2026-09-08] CONFIRMED).
- **Approvals are capabilities, not chat.**
  - "Sentinel creates a pending approval and execution stops… A dialog is presented… within the client UI — not via their conversation with Muse."
  - Grants can be "one-time, session-scoped, task-scoped, time-bounded, or perpetual". "Read-only, previously allowed, or demonstrably low-risk actions can proceed without interruption."
  - "Tainted egress": a process that reads user data loses auto-allow ([https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse, 2026-09-08] CONFIRMED).
- **Permission sheet vs tool definitions.**
  - The permission sheet lists 52 connectors and 246 methods, each allowed / asks first / refused, with no parameters.
  - Definitions load "one namespace at a time"; there are 58 skills as documents ([personalagentbench, 2026-10-16] REPORTED, first-hand).
- **The work pane.**
  - The interface puts the chat in one window and the virtual machine's work in another ([https://www.theverge.com/ai-artificial-intelligence/1004096/openai-chatgpt-dots-hands-on-agent, 2026-10-02] REPORTED).
  - "Activity feed and its task lineage… tool calls and step-by-step lineage" ([https://www.lennysnewsletter.com/p/muse-review-the-personal-ai-agent, 2026-09-16] REPORTED, first-hand, section headings).
  - Approvals queue, Upcoming and Identity panels ([https://www.mindstudio.ai/blog/meta-muse-ai-agent, 2026-09-12] REPORTED).
- **Long-running work.** Muse is "not turn-by-turn"; you can send several tasks at once. Side chats give separate context ([https://www.meta.com/help/artificial-intelligence/1331373868832401/, ~2026-09-10] CONFIRMED). Restart checkpoints in Postgres let a session survive VM replacement mid-turn ([Rohan] REPORTED).
- **Reliability.** "Internal tests showed the product stalling and unauthorized exposure of sensitive data" ([Reuters, 2026-09-08] REPORTED).

### 2.7 Tools, integrations, runtime
- **Model.** Muse Spark 1.3 ([https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse, 2026-09-08] CONFIRMED). Muse Wonder was announced 2026-10-12 for subscribers first ([personalagentbench, 2026-10-16] REPORTED).
  - Strings in the binary: `avocado-5.16-v4`, `claude-opus-4-6/4-8`, `claude-sonnet-4-6`, `gpt-5.6-sol`. Routing happens server-side through the `genai` Rust crate ([Rohan] REPORTED, first-hand). Another export found the codex/gpt strings were "provider-list entries" with no evidence they were selected ([mouse.dev] REPORTED).
- **Harness.**
  - The "Hatch" daemon runs in a `systemd-nspawn` cell. Outside the cell sit `hatch-safety` (classifiers), `privsep` connector workers, `hatch-authd` (credentials and surrogate tokens), Sentinel (egress and approvals) and Postgres ([research.meta.ai, 2026-09-08] CONFIRMED).
  - One 327 MB Rust binary. **No LangGraph, LangChain or MCP strings**; tools are CLIs. Loop stages: `admission → pre_inference (skill_loading, prompt_assembly, context_pressure, compaction) → model stream → tool_dispatch_batch (+approval_intent) → post_tool_continuation` ([Rohan] REPORTED, first-hand).
- **Integrations.** Connectors have hand-written SKILLs per connector, and "Muse can also write its own custom connectors" ([research.meta.ai] CONFIRMED). Also WhatsApp, a Mac app (Messages, Notes, Mail; per-app Off / Read only / Read and interact) ([https://www.meta.com/help/artificial-intelligence/1126304576638594/, n.d.] CONFIRMED) and "Spaces", which are agent-built web apps served from the VM ([Rohan] REPORTED).

### 2.8 Reception
- **Praise.**
  - "The best-designed personal agent I've tested" ([Lenny's/Claire Vo, 2026-09-16] REPORTED).
  - Browsing "rarely seems to get lost" ([WIRED, 2026-09-20] REPORTED).
  - It found an important missed PR email and tracked replies ([https://www.androidauthority.com/meta-muse-one-week-later-hands-on-3718233/, 2026-10-06] REPORTED).
  - 900K downloads in the first week ([WIRED, 2026-09-20] REPORTED); 4 million users ([TIME, 2026-10-06] REPORTED).
- **Complaints: privacy and creep.**
  - It inferred interests and location beyond what the user can see, for example from an Amazon shipping address ([https://www.theverge.com/tech/993391/meta-muse-ai-hands-on, 2026-09-10] REPORTED).
  - Dossiers on non-users ([TIME, 2026-10-06] REPORTED; [WIRED, 2026-10-03] REPORTED).
  - Training on interactions is on by default ([WIRED, 2026-09-20] REPORTED).
- **Complaints: memory and trust errors.**
  - It gave a wrong account of its own plumbing; Meta: "it was confused about how to explain the feature… That's on us" ([https://www.theverge.com/ai-artificial-intelligence/997833/meta-muse-creepy, 2026-09-19] REPORTED, vendor statement via press).
  - "I want to know where a conclusion came from and I want an easy way to fix it when it is wrong" ([https://taylorarndt.substack.com/p/i-tried-metas-muse-agent-i-really, 2026-09-21] REPORTED).
  - It archived its whole filesystem for a flattering user after declining twice ([futuresociety.ch, 2026-09-26] REPORTED).
- **Complaints: noise.** It pushes users to connect more data and repeats purchase nudges (§2.4).

---

## 3. Clone list (ranked by value to Agent Teams)

Format: **what** · where seen · why it works · how it maps to our stack · effort.

1. **Split the heartbeat into a read-only "Dreamer" child and a parent that decides.**
   - **Where seen:** dots Heartbeat Dreamer (§1.3), plus the official line "background agents report their findings to your dot" (CONFIRMED).
   - **Why it works:** the researcher can be thorough and see sensitive things, because it can't act or talk to the user. The parent, which holds the relationship, filters. Read-only is enforced in tools, not in prose.
   - **Map:**
     - Mira's 20-minute heartbeat becomes a Deep Agents sub-agent called via `task`. It gets its own `tools` (read-only connectors, ledger reader) and its own filesystem `permissions` (the subagent field replaces the parent's), e.g. `[{operations:["write"],paths:["/agent_notes/heartbeat/**"]},{operations:["write"],paths:["/**"],mode:"deny"}]`. First match wins.
     - It returns one structured message to Mira. Only Mira can post to the owner.
     - Run it on Nemotron 3.5 Lightning when there is no work, to stay under 30 RPM.
   - **Effort:** M.

2. **One checkpoint file per run, with a resume point and honest coverage.**
   - **Where seen:** dots checkpoint headings "Summary / Findings / What I checked and what is next"; "The date range in a search is not proof you reviewed that whole range"; 14-day retention.
   - **Why it works:** stateless timed runs gain continuity without growing context, and each run can be audited.
   - **Map:** `/agent_notes/heartbeat/YYYY-MM-DD/HHmmssZ.md` in the Filesystem/SQLite backend. A ledger row per run with `{checked, unreachable, resume_at, notified|quiet_reason}`. A nightly prune of files older than 14 days.
   - **Effort:** S.

3. **The QUIET contract: one priority-tagged notification per run, otherwise silence with a logged reason, and ask once about a repeated blocker.**
   - **Where seen:** dots (`notify_parent` once, P00/P0/P1, "stay quiet", "Do not repeat that question"); Muse ("notifies you only when something is meaningfully new or needs your input"; dial up / down / off).
   - **Why it works:** it bounds interruptions and makes silence explainable. Zapier showed silence is read as "nothing important", so the reason must be logged.
   - **Map:** extend Mira's `QUIET` to `{quiet:true, reason}` or `{items:[{p:"P0|P1|P2", finding, confidence, source, next_step}]}`. Blocker counts are kept in the ledger, and the "pause?" question is asked at most once per blocker. The owner's ✋ reaction lowers that agent's interrupt level, stored in PROACTIVE_PREFERENCES.md (item 6).
   - **Effort:** S.

4. **Nightly reflection ("dream") per agent that proposes; it doesn't rewrite in place.**
   - **Where seen:** dots 3am reflection run (preferences, declined offers, re-rank priorities, then tell the parent to update `user_state.md`). Muse nightly dream in `~/dreams/YYYY-MM-DD` with `ALIGNMENT_SYNTHESIS.md` as standing guidance and `prompt_hoisted:false`.
   - **Why it works:** cross-session patterns are only visible offline. Keeping the dated dream separate from the injected file, and preserving the raw input, avoids the in-place-rewrite decay that critics flag in ChatGPT's Dreaming ([arize.com, 2026-06-17] REPORTED).
   - **Map:**
     - A cron at about 03:00 local per worker, staggered to respect 30 RPM.
     - Input: the day's thread from the checkpointer plus ledger reactions (👍 / 🔁 / ✋ / 📌) and acceptance rate.
     - Output: `dreams/YYYY-MM-DD.md` plus a **diff proposal** to `MEMORY.md` (Mistakes / Best approaches) and the per-project section of `SOUL.md`. Apply it automatically if the change is small and cited; otherwise show it as a card to the PM or owner. Store the preimage first.
     - "Treat one-off statements objectively" goes into the prompt.
   - **Effort:** M.

5. **Claim-level provenance and supersession for memory.**
   - **Where seen:** Muse hourly pass (quote + message IDs + claim ID; `supersedes_claim_id`; `memory_explain`).
   - **Why it works:** it answers the main trust complaint ("where did that conclusion come from"). Supersession updates stale facts without losing history.
   - **Map:** every `MEMORY.md` bullet carries `[src: ledger#<id>]`. A cheap Nemotron pass verifies new bullets against the cited ledger lines before they are promoted. Superseded bullets move to `memory/archive.md` with a pointer. An agent DM command "why do you believe X?" returns the source.
   - **Effort:** M.

6. **Expand the home files into distinct, UI-editable roles.**
   - **Where seen:** Muse SOUL / IDENTITY / USER / AGENTS / MEMORY / PROACTIVE_PREFERENCES / HEARTBEAT (editable via Identity and System Files, CONFIRMED for three of them).
   - **Why it works:** "what does it know or believe" becomes a readable, fixable file. Separating identity from soul from rules from watch-list keeps each one small.
   - **Map:**
     - Keep `SOUL.md` (Inherent per archetype + per-project section) and `MEMORY.md`.
     - Add `IDENTITY.md` (name, plush mascot, vibe, tagline; drives the avatar) and `PROACTIVE_PREFERENCES.md` (what to watch and surface, the interrupt level; read by heartbeat and dream runs).
     - Load them via the Deep Agents `memory` config, early in the prompt.
     - Add a per-agent Identity panel to view and edit them. Unlike dots, whose memory users can't view or edit, ours stays visible and editable.
   - **Effort:** S–M.

7. **A "context changed" delta note instead of rebuilding the prompt.**
   - **Where seen:** Muse ("slips in a short note saying the context changed").
   - **Why it works:** it keeps the cached prefix byte-stable while still telling the model about the edit.
   - **Map:** when 📌 appends a standing instruction to SOUL.md mid-thread, don't regenerate the system prefix. Append a system message `SOUL.md updated: + "<line>"`, and rebuild the prefix only at the next session or compaction. The ledger's cache-hit metric verifies it.
   - **Effort:** S.

8. **A permission sheet separate from tool schemas, with scoped grants.**
   - **Where seen:**
     - Muse: 246 methods marked allow / ask / deny with no parameters; Sentinel grants one-time, session, task, time-bounded or perpetual; approval dialog outside the chat; stop only for hard-to-undo actions.
     - dots: four rule levels; "pre-approved = explicitly requested"; "Asking for a draft doesn't authorize sending it".
   - **Why it works:** a cheap, stable permission contract. Approvals become real capabilities rather than chat, and friction goes only where consent matters.
   - **Map:**
     - Per-agent config `permissions: {"gmail.send":"ask","gmail.read":"allow","payments.*":"handoff"}` compiles to `interruptOn` (`allowedDecisions:["approve","edit","reject"]`). The approval card offers a scope (this once / this task / until a date).
     - 👍 on a card means a one-time grant. The ledger records the grant scope.
     - Proposal cards stay outside the message stream, as Muse does.
   - **Effort:** M.

9. **Stage checkpoints and per-task scope for long chains.**
   - **Where seen:** the dots system card (moderate scope slips rose from 8.6% to 19.7% as intervening tasks went from 5 to 10); dots tasks get their own conversation and don't receive every conversation.
   - **Why it works:** errors grow with chain length, and restating scope resets it.
   - **Map:** the PM's `write_todos` plan is cut into stages of no more than about 5 tasks. At each stage end the worker posts a "what I did, sources, anything outside the brief" message; the PM or owner reacts 👍 to continue. Each `task` delegation carries an explicit scope line and end condition. The five-task size is a community heuristic, not an OpenAI number ([https://dotsfeed.com/updates/keep-dot-task-chains-short-openai-saw-scope-slips-double-from-5-to-10-tasks, 2026-10-05] REPORTED).
   - **Effort:** S–M.

10. **Make the agent's activity visible: lineage plus a status line under the mascot.**
    - **Where seen:** Muse (a snippet under the avatar; tap for the full activity log and approved permissions; Goals tab with plan). dots (Activity: In progress / Scheduled / Completed; delegated tasks inspectable and stoppable; Take over and Return control). The top dots complaint was "people can't tell whether their dot is actually working".
    - **Why it works:** for background agents, visible activity is what earns trust.
    - **Map:** the right-hand work pane renders the LangGraph stream: `write_todos` state, each `task` sub-agent as a child row (status, last tool call), and pending interrupts. A one-line status under each plush comes from the latest todo or tool call. Separate controls for pausing the main thread, stopping a sub-task and cancelling a schedule (dots semantics).
    - **Effort:** M.

11. **A per-project goal folder.**
    - **Where seen:** Muse `workspace/goals/<slug>/{GOAL.md,briefs,crons,agent_notes,files,references}`.
    - **Why it works:** project state lives in one place that every agent on the team reads, separate from each agent's identity.
    - **Map:** one team equals `/projects/<slug>/GOAL.md` (dated goal, success metric, scope, qualifications), `briefs/`, `crons/` (heartbeat and dream schedules), `agent_notes/<worker>/` and `files/`. Use a CompositeBackend route `/projects/<slug>` → FilesystemBackend, shared across the team's agents. Each worker's SOUL.md per-project section points at it.
    - **Effort:** S.

12. **Owner-routed update channels.**
    - **Where seen:** dots ("keep routine progress in ChatGPT and bring decisions to you in Slack"; "Message me … only if a deadline is at risk").
    - **Why it works:** the user sets the interruption policy once, in plain language.
    - **Map:** PROACTIVE_PREFERENCES.md holds `routine → team channel`, `decision → owner DM / Mira card`, `risk → P0 ping`. Mira's heartbeat and the workers' notify calls read it.
    - **Effort:** S.

**Do NOT clone (evidence-based):**
- Memory the user can't view or edit (dots, the most criticised point).
- A forget flow that hides the fact the transcript remains (Muse, TIME/futuresociety).
- Ideas and nudges that push for more data or purchases (Muse, WIRED/SciAm).
- Hourly dossiers on third parties (Muse, TIME/WIRED).

---

## 4. What the evidence says about our open questions

- **Q1. Does the PM stay team lead for the whole project?**
  - **Evidence:** both products keep **one persistent coordinator** that owns the relationship and the notes. Background and delegated agents report to it, and "The parent decides what to act on or share" (dots capture, REPORTED). dots CONFIRMED: "background agents… report back to it". Muse: one Muse orchestrates subagent swarms (CONFIRMED). Muse Code: "a lead session spawns child agents… and keeps managing the group" (CONFIRMED).
  - **Reading:** this supports the PM staying lead for the project's life, with workers reporting through it and Mira over the PMs (INFERRED). Caveat: both products are personal agents, not teams. Neither publishes a hand-off or rotation of the lead role. Thibault expands and shrinks agent teams as models change (REPORTED), so team size should be adjustable mid-project.
- **Q2. Where are the owner's approval gates?**
  - **Evidence:** neither product puts gates at setup.
    - dots setup is name → appearance → plugins, then "Review the first result and correct any missing details before expanding the responsibility" (CONFIRMED).
    - Gates live at **consequential actions** (Custom Rules, Auto-review, take-over for passwords and money; Sentinel cards that stop only for hard-to-undo actions, CONFIRMED).
    - Plus **checkpoints** on long chains, because scope slips roughly double from 5 to 10 tasks (CONFIRMED).
  - **Reading:** one launch card (brief plus staffing together); a mandatory review of the first deliverable; stage checkpoints every ~5 tasks; scoped action-level grants (INFERRED). A separate brief-then-staffing gate has no support in either product.
- **Q3. Is a rehired expert the same agent? Can one agent be on two live projects?**
  - **Evidence:**
    - Both products value **continuous identity**. dots: changing channel "doesn't start a new dot or reset its memory"; specialist dots have their own identity and credentials and "improve with feedback" (CONFIRMED). Muse: one identity whose goal folders are project-scoped (REPORTED).
    - The main failure mode measured in dots is "carrying information between unrelated tasks" (CONFIRMED). dots mitigates this by giving each task its own conversation, with no automatic access to every conversation (CONFIRMED).
  - **Reading:** rehire the **same agent** (same IDENTITY/SOUL-Inherent/MEMORY lessons and track record). Give each project its own thread and its own per-project SOUL section and agent_notes. Allow two live projects only with explicit per-project scope, and treat cross-project carry-over as a reviewable event in the ledger (INFERRED).
- **Q4. What belongs in an expert's "config"?**
  - **Evidence (each item is a separate, user-visible artifact in at least one product):**
    - identity: name, creature/mascot, vibe, tagline (Muse IDENTITY.md, CONFIRMED)
    - soul: core truths, boundaries, personality (Muse SOUL.md, CONFIRMED)
    - operating rules: when to act or ask, initiative (Muse AGENTS.md, REPORTED)
    - user/owner profile (USER.md, REPORTED)
    - **watch-list and interrupt level** (PROACTIVE_PREFERENCES.md, REPORTED; Muse dial, CONFIRMED)
    - **permission sheet** of allow / ask / deny / hand-off per method (Muse REPORTED; dots Custom Rules CONFIRMED)
    - skills loaded per namespace (REPORTED)
    - connected apps and computer access (dots CONFIRMED)
    - update routing per kind of update (dots CONFIRMED)
    - schedules and event triggers (dots CONFIRMED)
    - a **time budget** (dots CONFIRMED)
  - **Model tier:** dots deliberately has *no* model selector (REPORTED). Muse routes server-side (REPORTED). Neither exposes it to users. Ours can keep a model tier internally (Flash / GLM / Nemotron) without showing it (INFERRED).
  - **Budget:** dots plans scaling "the total amount of work it can take on per month" (CONFIRMED), which supports a per-agent budget field.
- **Q5. Who decides small task vs project?**
  - **Evidence:**
    - Muse Code `auto` mode: the agent *proposes* a multi-agent workflow when "the task has enough independent work to justify the added time and token usage". Use subagents when work "splits into tasks that are each bounded, independently verifiable"; keep one agent "when the steps are strictly sequential" (CONFIRMED).
    - dots Dreamer: "delegate substantive work by default unless the task is simple" (REPORTED).
  - **Reading:** Mira decides by default, using a stated criterion (independent, parallel, verifiable sub-parts; expected duration), and shows the decision on the proposal card. The owner overrides there (INFERRED).
- **Dreaming and heartbeat per agent.**
  - **Evidence:**
    - **dots:** the "heartbeat" *is* the Dreamer. It is periodic, read-only research by a child agent with a checkpoint file and one notify-the-parent call. Its "dream" in the reflective sense is the **nightly reflection run** inside the same automation (REPORTED).
    - **Muse** separates the cadences:
      - **hourly** memory verification and people pages (REPORTED);
      - **nightly** dream plus alignment synthesis, kept out of the prompt until synthesised (REPORTED);
      - scheduled feed and objective workers with notification steps (REPORTED);
      - a surfacing gate at the end of each background job (CONFIRMED).
  - **Reading for us (INFERRED):**
    - (a) Mira keeps the 20-minute heartbeat, restructured as clone items 1–3. Our code comment "like dots' dreamer" is accurate for the heartbeat, not for consolidation.
    - (b) Each worker gets **no** frequent heartbeat while it has an active task (its own todos drive it). It gets a light heartbeat only when it is watching something (PROACTIVE_PREFERENCES.md).
    - (c) Each worker gets one **nightly dream** (clone item 4) that proposes cited MEMORY/SOUL diffs, keeps a dated dream file and a preimage, and never rewrites in place without a record. This follows Muse's dream/synthesis split and the critique of in-place rewriting.
    - (d) An optional hourly claim-verification pass (item 5) only for agents with high memory churn, given the 30 RPM limit.

---

## 5. Biggest unknowns

- **How often the dots Heartbeat Dreamer runs**, and how the parent recalls `/user_notes/` (inlined in the prompt or read by tool). Not found.
- **Whether the captured dots prompt is current.** It is one user's capture from 2026-09-30, unconfirmed by OpenAI. The leaks repo (another agent's scope) has `dreamer.md`, which may confirm or update it and describe the "Follow-up Dreamer".
- **The contents of Muse's `HEARTBEAT.md`, and the exact schedules of the Muse dream and self-improvement jobs** beyond "hourly" and "nightly". Not found.
- **Whether either product evaluates its dreams before keeping them.** Muse's `judge / reflect / repair / distill / generalize` step names suggest so, but nothing is documented.
- **Hand-off semantics for "teams of dots".** Unshipped; nothing published.
- **The full OpenAI "dots safety" blog post.** Only restated by third parties; the official URL was not located.

---

## 6. Self-check against coverage and the bar

| Item | dots | Muse |
|---|---|---|
| 1 Identity/persona | PASS (persona file explicitly not found) | PASS |
| 2 Memory (trigger / store / recall / user sees) | PASS (parent recall mechanism marked not found) | PASS |
| 3 Dreaming | PASS (cadence not found) | PASS (official description not found) |
| 4 Proactivity / noise | PASS | PASS (HEARTBEAT.md content not found) |
| 5 Multi-agent / agent creation | PASS (templates not found) | PASS (templates not found) |
| 6 Execution / work pane / approvals | PASS | PASS |
| 7 Tools / runtime | PASS (engineering post not found) | PASS |
| 8 Reception | PASS | PASS |
| ≥12 distinct sources, primary first | PASS (~55 distinct URLs; ~20 official) | |
| CONFIRMED only for vendor sources | PASS (third-party first-hand material tagged REPORTED) | |
| Clone list ≥6, mapped to our stack | PASS (12 items) | |
| Q1–Q5 and dreaming addressed | PASS (all marked INFERRED where they go beyond evidence) | |

Follow-up searches run for gaps: "OpenAI dots dreamer", "Heartbeat Dreamer", "dots system card appendix" (full PDF read, Appendix B pp. 154–172), "Muse dreams folder HEARTBEAT.md", "Muse multiple agents", "Meta newsroom Introducing Muse" (newsroom page itself not fetchable; TechCrunch and CNBC used instead).

---

## 7. Sources (primary first)

**OpenAI (official):**
- https://openai.com/index/introducing-dots/ (2026-09-29)
- https://help.openai.com/en/articles/20001530-getting-started-with-your-dot (updated ~2026-10-15)
- https://help.openai.com/en/articles/20001529 (updated ~2026-10-08)
- https://developers.openai.com/codex/dots (n.d.)
- https://developers.openai.com/codex/dots/getting-started (n.d.)
- https://developers.openai.com/codex/dots/tasks-and-memory (n.d.)
- https://developers.openai.com/codex/dots/controls (n.d.)
- https://developers.openai.com/codex/dots/computers-and-apps (n.d.)
- https://deploymentsafety.openai.com/gpt-6-astra/gpt-6-astra.pdf (system card 2026-09-03; Appendix B dots added 2026-09-29)
- https://openai.com/index/chatgpt-memory-dreaming/ (2026-06-04)
- https://www.youtube.com/watch?v=fHEIw5CcN5U ("The dots demo, take two", DevDay 2026)

**Meta (official):**
- https://introducing.muse.ai/ (2026-09-08)
- https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse (2026-09-08)
- https://www.meta.com/help/artificial-intelligence/2225571704857152/ (~2026-09-10)
- https://www.meta.com/help/artificial-intelligence/1331373868832401/ (~2026-09-10)
- https://www.meta.com/help/artificial-intelligence/1126304576638594/ (n.d.)
- https://dev.meta.ai/docs/muse-code/extending (n.d.)
- https://dev.meta.ai/docs/cookbook/subagent-fanout (n.d.)
- https://dev.meta.ai/docs/muse-code/workflows (n.d.)

**First-hand teardowns, exports and captures:**
- https://aaronmakelky.com/blog/chatgpt-dots-in-claude (2026-09-30)
- https://rohanadwankar.github.io/posts/sandbox2.html (~2026-09-11)
- https://mouse.dev/blog/muse-runtime-export/ (2026-09-22)
- https://personalagentbench.com/agents/muse/ (verified 2026-10-16)
- https://shipwithmuse.live/builds/mapping-muses-on-disk-agent-architecture (2026-09-24)
- https://futuresociety.ch/muse-findings/ (2026-09-26)
- https://vibe-replay.com/blog/muse-local-storage/ (2026-09-18)

**Press and reviews:**
- https://www.theverge.com/ai-artificial-intelligence/1002033/openai-dots-launch-muse-competitor (2026-09-29)
- https://www.theverge.com/ai-artificial-intelligence/1004096/openai-chatgpt-dots-hands-on-agent (2026-10-02)
- https://www.wired.com/story/openai-dots-always-on-ai-agents-that-proactively-help/ (2026-09-29)
- https://www.wired.com/story/openai-wants-its-new-agent-to-run-your-life-mine-said-it-loved-me/ (2026-10-07)
- https://zapier.com/blog/chatgpt-dots/ (2026-10-13)
- https://exa.ai/library/podcast/fs9gkxmyxd6/episode/xx6zk7x5npb (Turing Post, 2026-10-08)
- https://vibecoding.tech/news/2026/10/05/codex-agent-teams-model-releases (2026-10-05)
- https://agihunt.info/en/p/1a0fca31b05e049ad8e7cfa722b (2026-10-02)
- https://www.scientificamerican.com/article/i-gave-metas-muse-and-openais-dots-my-passwords-for-a-week/ (2026-10-09)
- https://dev.to/klukyanov/openai-dots-the-agent-that-works-while-you-sleep-6p2 (2026-10-17)
- https://medium.com/predict/the-black-box-memory-vault-what-openais-always-on-agents-store-behind-the-screen-0e0643111844 (2026-10-14)
- https://legible.co/blog/openai-dots-release-security/ (2026-09-29)
- https://dotsfeed.com/updates/keep-dot-task-chains-short-openai-saw-scope-slips-double-from-5-to-10-tasks (2026-10-05)
- https://gptdots101.com/guides/safety-sign-in-and-data/ (2026-09-30)
- https://me.mashable.com/tech/76653/openai-dots-has-its-own-little-guy-mascots-to-rival-meta-muse (2026-09-29)
- https://arize.com/blog/two-labs-started-dreaming-and-they-built-two-different-architectures/ (2026-06-17)
- https://www.reuters.com/business/meta-launches-ai-agent-that-can-access-other-apps-send-emails-make-payments-2026-09-08/ (2026-09-08)
- https://www.cnbc.com/2026/09/08/meta-personal-ai-agents-public-reckoning-privacy-safety.html (2026-09-08)
- https://techcrunch.com/2026/09/08/meta-debuts-its-muse-ai-agent-will-consumers-trust-it/ (2026-09-08)
- https://www.theverge.com/tech/993391/meta-muse-ai-hands-on (2026-09-10)
- https://www.theverge.com/ai-artificial-intelligence/997833/meta-muse-creepy (2026-09-19)
- https://www.wired.com/story/metas-muse-is-better-at-surveilling-than-helping-me/ (2026-09-20)
- https://www.wired.com/story/muse-creates-detailed-profiles-of-all-your-friends-and-family/ (2026-10-03)
- https://time.com/article/2026/10/06/meta-muse-ai-agent-privacy/ (2026-10-06)
- https://www.lennysnewsletter.com/p/muse-review-the-personal-ai-agent (2026-09-16)
- https://www.androidauthority.com/meta-muse-one-week-later-hands-on-3718233/ (2026-10-06)
- https://taylorarndt.substack.com/p/i-tried-metas-muse-agent-i-really (2026-09-21)
- https://www.linkedin.com/posts/billysticker_if-youre-using-meta-muse-there-are-four-activity-7504888385363152897-RwTK (2026-09-13)
- https://radarminty.com/muse-ai-pro-tips/ (2026-09-28)
- https://www.mindstudio.ai/blog/meta-muse-ai-agent (2026-09-12)
- https://squad.so/resources/meta-muse-alternative (as of 2026-10-13)

**Noted only (not mined):**
- https://github.com/asgeirtj/system_prompts_leaks/blob/main/OpenAI/dots/dreamer.md
- …/OpenAI/dots/available-skills.md
