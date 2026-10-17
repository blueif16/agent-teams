# L. Test mode UX for Agent Teams: Stripe sandboxes, agent simulations, replay players

Research date: 2026-10-17. Every claim below links to a numbered source. If a claim comes only from a third party or could not be confirmed, it is listed under `## Unverified` instead of being stated as fact.

## Sources

Undated docs pages show "n.d." plus the access date (2026-10-17).

**Stripe (primary, docs.stripe.com unless noted)**
1. Sandboxes. https://docs.stripe.com/sandboxes (n.d., accessed 2026-10-17)
2. Testing use cases (test mode sandbox vs general sandboxes vs live). https://docs.stripe.com/test-mode (same page as https://docs.stripe.com/testing-use-cases) (n.d., accessed 2026-10-17)
3. API keys. https://docs.stripe.com/keys (n.d., accessed 2026-10-17)
4. Manage sandboxes. https://docs.stripe.com/sandboxes/dashboard/manage (n.d., accessed 2026-10-17)
5. Sandbox settings (what is copied). https://docs.stripe.com/sandboxes/dashboard/sandbox-settings (n.d., accessed 2026-10-17)
6. Use Simulations to simulate Billing objects (test clocks). https://docs.stripe.com/billing/testing/test-clocks (n.d., accessed 2026-10-17)
7. Simulate subscriptions. https://docs.stripe.com/billing/testing/test-clocks/simulate-subscriptions (n.d., accessed 2026-10-17)
8. Test clocks: API and advanced usage. https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage (n.d., accessed 2026-10-17)
9. Testing (test card numbers, PaymentMethods, bank accounts). https://docs.stripe.com/testing (n.d., accessed 2026-10-17)
10. Stripe CLI reference: `trigger`. https://docs.stripe.com/cli/trigger (n.d., accessed 2026-10-17)
11. Stripe CLI reference: `fixtures`. https://docs.stripe.com/cli/fixtures (n.d., accessed 2026-10-17)
12. How Workbench works. https://docs.stripe.com/workbench/overview (n.d., accessed 2026-10-17)
13. Workbench use cases. https://docs.stripe.com/workbench/guides (n.d., accessed 2026-10-17)
14. Shell and API Explorer. https://docs.stripe.com/workbench/shell (n.d., accessed 2026-10-17)
15. Stripe Developer Digest (June 2024): Join the Sandboxes private beta. https://stripe.dev/blog/stripe-developer-digest-june-2024-join-the-sandboxes-private-beta (June 2024)
16. Stripe Developer Digest (August 2024): Workbench is now available to everyone; Sandboxes in public beta. https://stripe.dev/blog/stripe-developer-digest-august-2024-workbench-is-now-available-to-everyone (August 2024)
17. Crush errors with Sandbox testing (stripe.dev blog). https://stripe.dev/blog/crush-errors-with-sandbox-testing (n.d.)
18. Stripe Sandboxes are here! (Stripe Insiders forum). https://insiders.stripe.dev/t/stripe-sandboxes-are-here/84 (2024-04-19)

**Agent and conversational-AI products**

19. Sierra: Simulations, the secret behind every great agent. https://sierra.ai/blog/simulations-the-secret-behind-every-great-agent (2025-08-19)
20. Sierra: Voice Sims, testing real conversations before real customers. https://sierra.ai/jp/blog/voice-sims-test-agents-in-real-world-conditions-before-they-talk-to-your-customers (2025-09-11, English text)
21. Sierra: How Voice Sims work. https://sierra.ai/blog/how-voice-sims-work (2025-09-23)
22. Sierra: The Agent Development Life Cycle. https://sierra.ai/blog/agent-development-life-cycle (2024-06-03)
23. Sierra: τ-Bench, benchmarking AI agents for the real world. https://sierra.ai/blog/benchmarking-ai-agents (2024-06-20)
24. MLOps Community: How Sierra AI does context engineering (interview transcript). https://home.mlops.community/en/public/videos/how-sierra-ai-does-context-engineering (2025-12-10)
25. Intercom: Run Simulations for Fin Procedures. https://www.intercom.com/help/en/articles/12599517-run-simulations-for-fin-procedures (n.d., "updated this week" as of 2026-10-17)
26. Intercom: Simulations vs. Batch tests vs. Previews. https://www.intercom.com/help/en/articles/14077180-simulations-vs-batch-tests-vs-previews (2026-07-31)
27. Fin updates: Safely test and validate Procedure behaviour (Simulations GA). https://fin.ai/updates/simulations-for-procedures (April 2026)
28. Fin Academy: Simulate a procedure. https://academy.fin.ai/simulate-a-procedure (n.d.)
29. Coval: Simulated Conversations. https://docs.coval.ai/concepts/simulations/overview (n.d.)
30. Coval: Runs & Schedules. https://docs.coval.ai/concepts/runs/overview (n.d.)
31. Coval: Dashboards. https://docs.coval.ai/concepts/dashboard/overview (n.d.)
32. Coval: Add your first metric. https://docs.coval.ai/concepts/metrics/quickstart (n.d.)
33. Coval CLI: Simulated Conversations (audio download). https://docs.coval.ai/cli/simulated-conversations (n.d.)
34. Vapi: Simulations quickstart. https://docs.vapi.ai/observability/simulations-quickstart (n.d.)
35. Vapi: Voice testing (Evals vs Simulations). https://docs.vapi.ai/test/voice-testing (n.d.)
36. Vapi: Test Suites (deprecated). https://docs.vapi.ai/test/test-suites (n.d.)
37. Vapi: Path to production. https://docs.vapi.ai/quickstart/path-to-production (n.d.)
38. Cekura: Runs & Results (CLI/SDK). https://docs.cekura.ai/cli-sdk/runs (n.d.)
39. Cekura: Evaluators overview. https://docs.cekura.ai/documentation/key-concepts/evaluators/overview (n.d.)
40. Cekura API: Rerun Results. https://docs.cekura.ai/api-reference/test_framework/rerun-results (n.d.)
41. LangSmith Studio. https://docs.langchain.com/langsmith/studio (n.d.)
42. How to use Studio. https://docs.langchain.com/langsmith/use-studio (n.d.)
43. LangGraph: Use time-travel. https://docs.langchain.com/oss/python/langgraph/use-time-travel (n.d.)
44. LangSmith: Configure threads. https://docs.langchain.com/langsmith/threads (n.d.)
45. LangSmith: View traces (Trajectory / Turns / Details). https://docs.langchain.com/langsmith/view-traces (n.d.)
46. OpenAI: Agent Builder. https://developers.openai.com/api/docs/guides/agent-builder (n.d.)
47. OpenAI: Evaluate agent workflows. https://developers.openai.com/api/docs/guides/agent-evals (n.d.)
48. OpenAI: Trace grading. https://developers.openai.com/api/docs/guides/trace-grading (n.d.)
49. OpenAI: Getting started with datasets. https://developers.openai.com/api/docs/guides/evaluation-getting-started/ (n.d.)
50. OpenAI: Introducing AgentKit. https://openai.com/index/introducing-agentkit/ (2025-10-06; deprecation update 2026-06-03)

**Replay players**

51. PostHog: How to watch recordings. https://posthog.com/docs/session-replay/how-to-watch-recordings (n.d.)
52. PostHog PR #30159 "allow one point five speed". https://github.com/PostHog/posthog/pull/30159 (2025-03-19)
53. PostHog PR #24483 "replay UX wins" (player settings menu, seekbar pageview ticks). https://github.com/PostHog/posthog/pull/24483 (2024-08-27)
54. PostHog commit e04eaca "show duration when sped up". https://github.com/PostHog/posthog/commit/e04eacae41ecbe0b81b3ecdbbbe48c2eeedf5cc8 (2024-12-13)
55. DeepWiki: PostHog Session Recordings (secondary; quotes `PLAYBACK_SPEEDS`). https://deepwiki.com/PostHog/posthog/8.2-session-recordings (2026-06-19)
56. LogRocket: Session Replay. https://docs.logrocket.com/docs/session-replay (n.d.)
57. LogRocket: Using LogRocket Live. https://docs.logrocket.com/docs/using-logrocket-live (n.d.)
58. LogRocket: Filters (timeline filter markers). https://docs.logrocket.com/docs/logrocket-filters (n.d.)
59. Fullstory: Getting Started with Session Replay. https://help.fullstory.com/hc/en-us/articles/360020828573-Getting-Started-with-Session-Replay (n.d.)
60. Fullstory: What do the symbols represent in Session Replay? https://help.fullstory.com/hc/en-us/articles/360060315173-What-do-the-symbols-represent-in-Session-Replay (n.d.)
61. Fullstory: What defines a session? https://help.fullstory.com/hc/en-us/articles/360020624614-What-defines-a-session-in-Fullstory (n.d.)
62. Fullstory: Can I search for events while watching a session? https://help.fullstory.com/hc/en-us/articles/360053144654-Can-I-search-for-events-while-watching-a-session (n.d.)
63. Playwright: Trace viewer. https://playwright.dev/docs/trace-viewer (n.d.)
64. Playwright: UI Mode. https://playwright.dev/docs/test-ui-mode (n.d.)
65. Playwright: Tracing API (`live` option, v1.59). https://playwright.dev/docs/api/class-tracing (n.d.)

**Third-party (used only under `## Unverified`)**

66. RapidDev: Enable Test Mode in Stripe. https://www.rapidevelopers.com/stripe-guide/how-to-enable-test-mode-in-stripe (n.d.)
67. Zapier Help: How to use test mode data with Stripe on Zapier. https://help.zapier.com/hc/en-us/articles/31812286026253-How-to-use-test-mode-data-with-Stripe-on-Zapier (n.d.)
68. WP Simple Pay: Using Test Mode. https://wpsimplepay.com/doc/using-test-mode/ (2026-06-30)

---

## Stripe test mode, sandboxes, test clocks

### Test vs live: keys, isolation, what is shared
- **Two kinds of key, two worlds.** Each mode has its own API keys. Sandbox keys start with `pk_test_`, `rk_test_`, `sk_test_` and live keys start with `pk_live_`, `rk_live_`, `sk_live_` [3]. "Objects in one mode aren't accessible to the other. For example, a sandbox product object can't be part of a live mode payment" [3][2].
- **The key decides the behavior, not the UI.** "Being in a sandbox in the Dashboard doesn't affect your integration code. Your test and live mode API keys affect the behavior of your code" [2].
- **What a sandbox doesn't do.** In a sandbox, card networks and payment providers don't process payments. API calls return simulated objects. Identity runs no verification checks [2][3]. By default, Stripe doesn't email customers in sandboxes [2].
- **Old "test mode" is now one special sandbox and leaks settings.** Every account has a *test mode sandbox* that "shares settings between live mode and the test mode sandbox". It grants all users the same roles as live and can't be deleted [2]. Stripe's warning: "If you don't see the notification, assume any changes made in the test mode sandbox affect live mode settings (unless you see a test data banner)" [2].
- **What is shared across all sandboxes:** the same test card numbers and the same rate limits [2].
- **Sandbox-only conveniences.** In sandbox mode you can always reveal every API key. In live mode a key you created yourself is shown only once [3]. The Workbench Shell "is read-only in live mode. Switch to a sandbox to run API requests that create, modify, or delete API objects" [12][14].

### Sandboxes (launched 2024)
- **Timeline.** Stripe showed them at Sessions in April 2024 (Insiders post dated 2024-04-19 [18]), opened a private beta signup in June 2024 [15], and reported "Sandboxes is now in public beta" in August 2024 [16].
- **How many.** "Up to five sandboxes. The test mode sandbox doesn't count toward the limit of five" [2][4].
- **How they're created.** Account picker > **Switch to sandbox** > **Create sandbox**, then enter a name (e.g. "Staging"). Next choose **Copy your account** (the default, which copies settings and capabilities) or **Create an account from scratch** (copies nothing) [4][5]. The creator gets the Super Administrator role [4]. New sandboxes default to **Private** access [2].
- **What's copied.** Settings are copied once at creation and then not synchronized: "We don't synchronize settings and capabilities. As a result, they can diverge from live settings" [5].
  - Copied: capabilities such as payouts, Link, ACH and transfers; enabled or pending payment methods; payout schedule and currencies; Capital and Financial Connections settings [5].
  - Not copied: domains, Billing automations, Radar and Sigma settings, Issuing webhooks, and head-office tax address. Placeholder business data is provided instead [5].
- **How they're reset or removed.** No "reset" button is documented.
  - **Delete test data**: in the sandbox, Developers > Overview > Review test data > Delete test data. This is irreversible, and "Sandboxes are temporarily unusable while the deletion process occurs" [2].
  - **Delete the sandbox**: overflow menu (⋯) > Delete. This deletes all of its data and removes members' access [4].
- **CLI.** Run `stripe login`, then pick the sandbox in the browser [4].

### Test clocks ("Simulations")
- **Model.** "Simulations use test clocks to control time" [6]. You create a clock and set its **frozen time**, which can be past or future, "but after you set it, you can only move it forward in time" [8].
- **How a user advances time in the Dashboard.**
  - Path: Billing > Subscriptions > **Simulations** link in the banner > **Create simulation** (name + frozen time) > **Add customer / Add subscription** > **Advance time** > pick a date in the calendar modal > **Advance** [8].
  - Shortcut from a subscription page: "Click **Run simulation** in the banner at the top of the page… set the date and time… click **Advance time**… When the simulation is done, the banner updates and displays the current time" [7].
- **Step limits.** You can advance "in intervals of up to two" of the shortest billing period, so a monthly subscription moves at most 2 months per step. With no subscriptions the limit is two years [8].
- **Object limits.** A simulation holds at most 3 customers, 3 subscriptions per customer and 10 unattached quotes [8].
- **What fires.** Time moves forward "in a few seconds". Two clock events bracket the move: `test_helpers.test_clock.advancing` and `test_helpers.test_clock.ready`. You can also poll the clock's `status` [8]. The docs' worked examples show billing events from the skipped window firing during the move [8]:
  - an invoice is created at renewal and stays `draft` for about an hour (advance one more hour to finalize it);
  - `customer.subscription.trial_will_end` fires 3 days before a trial ends;
  - proration items appear after a mid-cycle upgrade.
- **Cleanup.** **Finish simulation** deletes every object linked to the clock. "It doesn't affect live mode" [7]. Simulations auto-delete after 30 days [8].
- **Hidden by default.** List calls don't return objects made by a test clock unless you filter by customer, clock or subscription [8].

### Magic test values
- **Happy path.** `4242 4242 4242 4242` with any future expiry and any CVC [9].
- **Cards that force a specific outcome** [9]:
  - generic decline `4000000000000002` (`generic_decline`)
  - insufficient funds `4000000000009995`
  - lost card `4000000000009987`
  - stolen card `4000000000009979`
  - expired card `4000000000000069`
  - incorrect CVC `4000000000000127`
  - processing error `4000000000000119`
  - Radar always-block `4100000000000019`
  - 3DS required `4000000000003220`
  - dispute: fraudulent `4000000000000259`
- **Stand-in values beyond cards.**
  - Dispute evidence strings `winning_evidence` and `losing_evidence` force how a dispute ends [9].
  - Tokens and PaymentMethods such as `tok_visa` and `pm_card_visa` [9].
  - ACH test accounts such as `pm_usBankAccount_insufficientFunds` [9].
- **Use PaymentMethods in code.** Stripe advises against raw card numbers in server code even in tests ("your code might not be PCI-compliant when you go live") and recommends `pm_card_visa` instead [9].

### `stripe trigger` and fixtures
- **`stripe trigger <event>`** fires a sample webhook "based on real API objects", and it can set off other events too: "triggering `payment_intent.succeeded` also triggers `payment_intent.created`".
  - "Triggering events causes side effects: all necessary API objects will be created in the process" [10].
  - Flags: `--override`, `--add`, `--remove`, `--skip` and `--edit` (edit the fixture in your IDE before it runs).
  - The output lists each step: "Setting up fixture for: customer … Trigger succeeded! Check dashboard for event details" [10].
- **`stripe fixtures file.json`** runs a JSON list of API requests (`name`, `path`, `method`, `params`). A later step can reference an earlier response, e.g. `${cus_jenny_rosen:id}`, and env vars with defaults, e.g. `${.env:EMAIL|jane@stripe.com}`. `expected_error_type` marks a step that is supposed to fail [11].

### Workbench, event logs and request logs
- **Where it lives.** Workbench is a pane docked at the bottom of every Dashboard page. You can resize it, maximize it, minimize it to a taskbar with a notification tray, and toggle it from anywhere with the **~** key. **Copy link** shares the current view [12].
- **Tabs** [12][13]:
  - **Overview**: keys, API versions, request and webhook graphs, recent errors.
  - **Errors**: grouped, with occurrence counts.
  - **Inspector**: the JSON of any object, a Data map of related objects, and that object's Logs and Events. Auto-inspect follows the page you're on. In a sandbox, "Edit in API Explorer" is available.
  - **Logs**: request logs filterable by date, status, method, endpoint, source (Dashboard vs API), version and error code. Logs don't refresh live; you click **Refresh logs**.
  - **Events**: filterable by type with wildcards (`customer.*`). The detail pane shows the payload and each delivery attempt, with **Resend**.
  - **Webhooks**: event destinations.
  - **Shell**: plus an API Explorer.
- **Which requests are logged.** Every API request is logged, including requests that `stripe trigger` makes, and you can filter by source [13].

### Visual signals (what docs.stripe.com actually says)
- **Banner.** "The banner at the top of the Dashboard indicates that you're in a sandbox" [4]. The docs also refer to a "test data banner" and to per-page "notification boxes" that disable live-mode settings while you're in the test mode sandbox [2].
- **Switching.** Sandboxes live in the **account picker**: "You can access your sandboxes using the account picker"; to go live, "exit your sandbox with the account picker" [2][1].
- **Simulated time** appears in the subscription's banner, which "updates and displays the current time" [7].
- The banner **color** (orange) and the old top-right toggle come only from third-party sources. See `## Unverified`.

---

## Agent products with simulations

| Product | How a run is started | What the owner watches | How results / pass-fail are shown | Can runs be replayed? | Source |
|---|---|---|---|---|---|
| **Sierra** (Agent OS / Agent Studio) | Test cases are generated automatically from SOPs, knowledge bases, past transcripts and flows when you create an agent. You can also turn any annotated real conversation into a "conversation test" against mock APIs. Runs happen in Agent Studio (no code) or from the CLI in CI/CD, gating releases "just like unit tests". | Simulated conversations between the agent and a mock persona (goal, mood, language, patience). For voice: "inspect transcripts alongside audio recordings, scrub through playback, and jump directly to a point of failure". | A separate judge agent grades each conversation: goal achieved, SOP followed, on brand, accurate. Pass or fail against success criteria. Conversations "can be run multiple times" (τ-bench's pass^k metric measures reliability across k trials). | Yes. "Since the whole thing is reproducible, you can replay the same call again and again." Voice runs offer "Replay audio, scrub through waveforms". | [19][20][21][22][23] (interview detail on "critical simulations" gating merges: [24]) |
| **Intercom Fin** (Procedures → Simulations) | Open a Procedure, click **Test** (top right of canvas), then the **Simulations** tab in the right panel. Run an AI-suggested scenario with its **Play** icon, add your own with **+ New** (name, "Simulate as" user, opening message, extra details, channel, **Simulation time**, attribute and connector values, criteria), or click **Run all**. | Status per test: Running, Passed, Failed, Queued. **See conversation** opens the full transcript between the simulated customer and Fin, with "Fin's thoughts" expandable at each step and conversation events (attribute updates, connector calls, handoffs) shown inline. Fin's GA note says you "watch a realistic back-and-forth". | Pass/fail per test against criteria you define: what Fin replied, attribute set or equal, data connector triggered or triggered exactly X times, instruction outcome (finished, handed off, switched Procedure). After a run, the result is "evaluated, highlighting what went right, what went wrong… with a suggestion". | Rerun: "click **Run** on the same simulation to re-test immediately". Saved simulations rerun on every update to catch regressions. No playback player is documented, only the transcript. | [25][26][27][28] |
| **Coval** | Simulate page: click **+** beside Simulated, or **New Simulation**. Pick a saved **Template** for "a one-click launch", or configure manually (agent, persona, test set, metrics, tags), then click **Launch**. Runs can also be **scheduled** (every 15 min to 30 days, or at a time of day). | Not found: the docs don't describe a live in-progress view. After launch, "the run appears on the Simulated Conversations page". | A results table with one row per simulated conversation and one column per metric. Each simulation has a metric card; click in to see "the score explained against the transcript". Dashboards chart metrics over time and drill down to individual calls. | Partly. **Resimulate** "run[s] it again in place… This overwrites the previous result". Audio recordings can be downloaded via the CLI. No in-app replay player is documented. | [29][30][31][32][33] |
| **Vapi** (Simulations; Test Suites deprecated) | Build a suite, then **Save & run**. In **Run suite**, pick the assistant, the mode (**Chat** "faster and costs less", or **Voice**) and the iteration count, then **Confirm**. | Run status moves through "queued, running, and ended". The Runs list shows status, result, suite, iterations and date. Voice runs have a recording. | The header shows the overall result (`Passed` or e.g. `1/1 failed`). On the left, one entry per simulation × iteration. A **Success criteria** panel sits next to the **Transcript**. Old Test Suites showed check marks and x-marks plus the LLM's reasoning per attempt. | **Rerun** re-executes the suite. You can listen to voice recordings. Warning: "Simulations run unmocked tools for real." | [34][35][36][37] |
| **Cekura** | CLI `cekura run start --agent-id … --scenario-ids … --mode text|voice` (or SDK/API). `--wait --fail-on-threshold 1.0` gates CI. | `cekura run watch <result-id>`. While a voice run is live: `runs listen-url` gives a live listen link, and `runs end-call` ends the call. | Results report `success_runs_count` out of `total_runs_count` and a success rate (0–100). The expected outcome is "met or not met", plus metrics (latency, relevancy, …). The docs say `completed` "does not mean the runs passed". Reviewers can thumbs up or down each metric verdict. | **Rerun** a result via the API. **Re-evaluate without re-running**: re-score existing runs against changed metric definitions. A transcript is stored per run. | [38][39][40] |
| **LangSmith Studio** (+ LangSmith threads) | Submit input in **Graph mode** (nodes and state) or **Chat mode** (for business users), or "run experiments over a dataset". | Graph mode shows "the nodes traversed, intermediate states". Thread history has a detail slider and Pretty/JSON views. Thread view offers **Trajectory** (chat-style), **Turns** (cards) and **Details** (one run), with turn count, latency and a cost breakdown. | Experiments over datasets, with feedback scores shown in the threads table. | **Fork** (edit a node's state) or **Re-run from here** at any checkpoint. "Replay re-executes nodes—it doesn't just read from cache. LLM calls… fire again and may return different results." | [41][42][43][44][45] |
| **OpenAI Agent Builder** (being shut down 2026-11-30) | **Preview** runs on live data in the canvas. **Evaluate** in the top navigation selects traces and runs graders on them. **Grade all** creates an eval run. | The trace: model calls, tool calls, guardrails and handoffs, with inputs and outputs for every node. | Datasets show "pass/fail ratings… in a dedicated column for each grader". Graders can be string match, similarity, score model, label model or Python. | Not found as playback. Re-grading traces and re-running datasets is supported. | [46][47][48][49][50] |

**Patterns that recur across products.**
- Every product uses the same three parts: the agent under test, a simulated user, and a judge [19][21][29][34].
- Scenarios are saved and rerun after every change [19][25][34].
- The simulated user is described in two separate parts: who they are (persona) and what they want (task) [29].
- Products differ in how they keep tests from touching real systems.
  - Fin: "Simulations never call external systems" and "Simulations don't create inbox conversations" [25][26].
  - Vapi: "Simulations run unmocked tools for real" [34][37].
- Vapi warns that "a tool reporting success does not independently prove that an external system changed" [35]. τ-bench grades by comparing database state after the task with the expected state [23].

---

## Replay player patterns

| Pattern | Who does it (source) | Detail |
|---|---|---|
| Speed control | PostHog [51][52][55], Fullstory [59] | PostHog's control is a "1x" button. Its speed list is reported as 0.5 / 1 / 1.5 / 2 / 3 / 4 / 8 / 16 (1.5 was added in PR #30159) [52][55]. Fullstory's speed control sits at the bottom right of the player [59]. |
| Skip inactivity | PostHog [51], Fullstory [61] | PostHog: a **Skip inactivity** toggle in the player's "…" menu. Fullstory marks stretches with no activity as inactive periods "you can skip during playback" [61]. |
| Show real duration at the current speed | PostHog [54] | Commit "show duration when sped up". |
| Activity-density time bar | LogRocket [56][58] | "White represents no activity, and dark gray indicates greater user activity." |
| Colored event markers on the scrubber | LogRocket [56][58], PostHog [53], Playwright [64] | LogRocket: errors are red lines, tab switches purple, and search or filter matches green. PostHog: pageview ticks on the seekbar. Playwright: the timeline uses "different colors to highlight navigation and actions". |
| Event list that seeks the player | LogRocket [56], Fullstory [62], PostHog [51] | Clicking an event jumps the video to it. LogRocket auto-scrolls the list to the event nearest the current time and bolds it [56]. Fullstory's event list can be filtered by type [62]. |
| Live edge | LogRocket Live [57], Fullstory [59], Playwright [65] | LogRocket's **Go Live** jumps to the newest events, shows "User is Active/Inactive", and runs under 10 s behind. Fullstory shows a solid blue play button while a session is still recording. Playwright's `live` tracing option writes the trace in real time. |
| Before / Action / After snapshots and a film strip | Playwright [63][64] | Hover any action to see the DOM at that moment. Drag on the timeline to select a range, which also filters the logs. |
| Comments pinned to a timestamp, clips, share links | PostHog [51], Fullstory [59] | PostHog: comment (C), clip (x), screenshot (s), cinema mode (t), fullscreen (f), public link. Fullstory's "Note and share" adds a note as an event on the timeline. |
| Demo / kiosk mode | PostHog [51] | "Plays recordings continuously in fullscreen without user interaction". Recordings play back-to-back and loop. A bookmarkable URL with `play=1` skips the setup screen. |
| Rewind a fixed step | Fullstory [60] | The rewind button goes back 7 seconds. |
| Trace layers for agents | LangSmith [44][45] | **Trajectory** shows the chat with tool calls, thought blocks collapsed by default, nested subagents, and token, cost and model per block. **Turns** and **Details** give coarser and finer views. Shortcuts T and D switch views. The thread can be exported to Markdown. |
| Jump to the failure | Sierra [20] | "Scrub through playback, and jump directly to a point of failure." |

**Key distinction for Agent Teams.** Session-replay players (PostHog, LogRocket, Fullstory) play back a **recording**, so nothing runs again. LangGraph/LangSmith "replay" **re-executes** from a checkpoint and calls the model again [43]. Job (2), a sped-up demo with no model wait, needs the first kind. The second kind fits a different action, "fork from here", which costs tokens.

---

## Proposed test-mode spec for Agent Teams

Tags in brackets name the source idea; the numbers point to `## Sources`.

**1. Entry point.**
- A **"Switch to test mode"** item in the workspace switcher at the top of the rail [Stripe account picker, 2][4]. It opens a **Test runs** home with three tabs: Scenarios / Runs / Recordings.
- A secondary **Test** button in the Mira DM header jumps straight to the scenario picker [Fin "Test" button on the canvas, 25].
- **~** toggles a bottom **Run log** drawer anywhere in test mode [Stripe Workbench, 12].

**2. Scenario picker (cards in a grid; "Run" on each card, plus "Run all").** Each card shows:
- the owner's opening DM, quoted;
- the **owner persona** (tone, patience, how picky) and a **reaction script** (e.g. "🔁 the first charter, then 👍; ✋ once at budget warning; 📌 one preference") [Coval persona ≠ test case, 29][Sierra personas, 19];
- the expected team shape (PM + ≤3 experts);
- the **claims it checks** (count + names);
- the **time skips it includes** (heartbeat, 02:00 dream, budget 80% / 100%);
- an estimated token cost and duration [Vapi chat-vs-voice cost note, 34];
- the last result (e.g. "5/6 claims · pass^3 2/3 · 2 days ago") [τ-bench pass^k, 23].

Ways to get and edit scenarios:
- **AI-suggested scenarios** sit at the top, generated from the charter templates and rules [Sierra auto-generation, 19][Fin suggestions, 25].
- **"Magic" scenarios** each force one outcome: "Budget breaker" (hits 80% then 100%), "Ambiguous ask" (forces Mira to triage and ask back), "Owner says ✋ at the launch card" [Stripe magic card numbers, 9].
- A scenario is a JSON file of steps. A step can reference an earlier one's output (`${launch_card:id}`), and a step can expect a failure [Stripe fixtures `${name:field}` and `expected_error_type`, 11].

**3. Run view (live).** It is the normal app UI (chat left, work right) inside the test workspace, plus a **director strip** pinned under the banner. The strip shows:
- **Simulated owner now**: "reading Mira's reply…", "will react 🔁 on Charter v1 (script step 3)", and the next scripted step [Fin's transcript shows thoughts, 25];
- the **phase**: Triage → Charter → Launch card → Working → Done;
- **cost so far** (tokens and $) against the scenario's test budget, plus elapsed wall time [LangSmith per-thread cost and turn stats, 44];
- a **● LIVE** pill that becomes **REPLAY** when the run is opened later [LogRocket Go Live, 57][Fullstory live indicator, 59].

Controls:
- **Pause owner**;
- **Take over** (you type as the owner, like Fin Preview vs Simulation, 26);
- **End run** [Cekura end-call, 38].

The Run log drawer lists every message, card, order, timer firing, tool call and token charge. Rows are filterable by type with wildcards (`order.*`), and each one opens its full JSON [Workbench Events and Inspector, 12].

**4. "This is test mode" signal.**
- A full-width **banner on every screen**: "TEST MODE: simulated owner · isolated workspace · real tokens are being spent" [Stripe sandbox banner, 4][2].
- A test-only accent color used nowhere else in the plush palette. This is our choice; Stripe's orange is unverified.
- The simulated owner's avatar and every message it sends carry a **"Sim owner"** chip.
- Every test object's ID starts with `test_` [Stripe `sk_test_`, 3].
- In replay, the banner reads "REPLAY · 4× · recorded 2026-10-17" so a demo audience never mistakes it for live work.

**5. Data isolation rule.** Test runs live in a separate store and never write to live data.
- At creation, the store **copies** a snapshot of live agents, souls, skills and rules, and **never syncs back** [Stripe "Copy your account", no sync, 5]. Never share settings the way Stripe's old test mode did [2].
- Never write to live `MEMORY`/soul files, the ledger or stats. Never appear in live channels or the inbox [Fin: simulations "don't create inbox conversations", 26].
- External tools are **mocked by default**. Unmocked tools need an explicit opt-in per scenario [Fin "never call external systems", 25][Vapi warning, 34].
- Test spend goes into a **separate test budget**.
- Live lists exclude test objects unless asked [Stripe test-clock objects omitted from lists, 8].
- **Finish run / Delete test data** removes every object the run created [Stripe Finish simulation, 7][Delete test data, 2].

**6. Time-skip control.**
- Each run has a **run clock**. It starts frozen at the scenario's start time (e.g. 01:40) and can only move forward [Stripe frozen time, forward-only, 8].
- An **Advance time ▾** button offers: "→ next heartbeat (+20m)", "→ 02:00 dream", "→ +1 day", or a custom time. A jump is capped at two of the shortest timer intervals so nothing is silently skipped [Stripe ≤2 intervals, 8].
- During a jump the banner shows "Advancing…" and then "Ready · sim 02:00". Every timer that fell inside the skipped window fires in order and appears in the log [Stripe `advancing`/`ready`, 8][the banner shows the current time, 7].
- A **Trigger ▾** menu fires one event with all its real side effects: "budget → 80%", "budget → 100%", "heartbeat now", "dream now" [`stripe trigger` creates the necessary objects, 10].
- Rule: everything time-based must read the run clock. Fin warns that code calling `datetime.now()` ignores Simulation time [26]. A run that reads wall time should be flagged as a failure.

**7. Result view (claims checked).**
- The header shows overall **Passed** or "**2/7 claims failed**", plus tokens, $, wall time and simulated time [Vapi header, 34].
- Each claim is a row with a pass/fail chip, the judge's one-line reasoning, and an **evidence link** that opens the replay at that moment [Sierra jump to failure, 20][Fin "See conversation", 25].
- Claim types:
  - said or did X;
  - state was set (charter has ≤3 experts);
  - an event fired N times (heartbeat fired 3×; dream ran at 02:00);
  - an outcome was reached (launch card approved; paused at 100%).

  [Fin criteria types, 25]
- Claims are proven by **state, not by an agent saying so** [Vapi tool-success caveat, 35][τ-bench state comparison, 23].
- **Run ×k** shows pass^k for reliability [23][Sierra multiple runs, 19].
- **Re-grade** scores a stored recording against edited claims without re-running the model [Cekura re-evaluate, 38].
- 👍/👎 on any verdict marks it as reviewed [Cekura votes, 38].
- A Runs tab trends claim pass rates over time [Coval dashboards, 31].

**8. Replay player controls** (playback reads the recorded event log; it never calls the model) [43 vs 51].
- Play/pause and speed **1× 2× 4× 8× 16×** [PostHog speeds, 52][55]. The duration label updates to match the speed [54].
- **Skip idle** is on by default and squeezes model-wait gaps and quiet timer stretches down to about 1 s [PostHog / Fullstory, 51][61].
- **Scrubber**:
  - activity shading [LogRocket, 56];
  - colored markers: owner orders (emoji), approval cards, ⏱ heartbeat, 🌙 dream, 💰 budget warning or pause, and red failed claims [LogRocket colors, 56][PostHog ticks, 53];
  - phase chapters along the scrubber;
  - a hover preview of the channel at that moment [Playwright film strip, 63].
- An **event list** beside the player: clicking a row seeks the player, and the list auto-scrolls to the event nearest the current time [LogRocket, 56][Fullstory, 62].
- **Next failure ⏭** [Sierra, 20].
- **← 7s** [Fullstory, 60].
- Comment at a timestamp and **Copy link at time** [PostHog, 51][Workbench Copy link, 12].
- **Demo mode**: fullscreen, autoplay, loop, URL `?play=1&speed=4` [PostHog kiosk, 51].
- **Fork from here** starts a new *live* run from that checkpoint. It is labeled "uses real tokens" [LangSmith Re-run from here / Fork, 42][43].

**How this covers the three jobs.**
1. One click on a scenario starts a live run driven by the simulated owner, using real tokens (items 2–3).
2. Every live run records itself, and replay plays the recording fast with no model calls (item 8).
3. Claims plus pass^k plus re-grading show whether the team performs well (item 7).

**Implementation hooks seen in the repo (read-only look).**
- `src/server/cache/bus.ts` carries only `{topic, version}`, "never the data". The recorder therefore has to capture full payloads itself; tapping the bus is not enough.
- `src/server/runtime/checkpointer.ts` uses LangGraph `SqliteSaver`, so "Fork from here" can use LangGraph's checkpoint time travel [43].
- `src/server/runtime/limiter.ts` ranks heartbeats and dreams as the `background` lane and limits each model's requests per minute (RPM). Live test runs will be throttled the same way; replay is not, which is one more reason demos should use replay.

---

## Unverified

- **Stripe banner color and toggle placement.** Third-party guides say the Dashboard turns **orange** in test mode, and older guides put a "Test mode" toggle at the top right [66][68]. Zapier quotes the banner text as "Test mode. You're using test data. No real transactions will be processed." [67]. docs.stripe.com says only that a banner at the top shows you're in a sandbox [4], and that you switch modes through the account picker [2]. Color and exact wording are not confirmed by Stripe.
- **Stripe "reset" a sandbox.** No reset button was found. The documented options are Delete test data [2] and deleting the sandbox [4].
- **Sandboxes general-availability date.** Confirmed: Sessions in April 2024 [18], private beta in June 2024 [15], public beta in August 2024 [16]. A GA date was not found.
- **PostHog exact speed list** (0.5–16×) comes from a PR and DeepWiki's reading of the source code [52][55], not from PostHog's docs page.
- **Fullstory speed values** and **LogRocket speed or skip-inactivity controls** were not found in the docs I fetched.
- **Sierra product UI details** (how results are laid out in Agent Studio) come from blog posts, not product docs [19][20][21]. The "critical simulations" that gate merges come from an interview [24].
- **Fin "watch… unfold"** [27]: it is unclear whether conversations stream live during a run or are only viewable afterwards. The help article only documents statuses and **See conversation** [25].
- **Coval** live in-progress view and in-app audio player: not found (only CLI audio download [33]).
- **Decagon, Hamming, Bland, Retell, Vercel v0**: not researched. Nothing is claimed about them.
- **OpenAI Agent Builder** is scheduled to shut down on 2026-11-30 [46][50]. Its UI may change or disappear soon.
