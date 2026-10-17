# Decisions

What we decided and why, kept short. Change a line here when a decision changes.

## Models (`src/lib/models.ts`)

A fixed set. Nothing outside it is called.

| Tier | Model | Used for | When it fails |
| --- | --- | --- | --- |
| main | DeepSeek V4.1 Flash | Every agent, leads and workers | Falls back to advisor |
| cheap | Nemotron 3.5 Lightning | Labeling, status lines | Retries only. Never falls back: every other model costs more |
| advisor | GLM-5.3 | Occasional second opinion | Falls back to main |
| vision | Nemotron 3.5 Super VL | Image work | Nothing after it |

- Vision is routing, not a fallback. An image stays on the current model if it can see (main can), goes to vision if it can't, and goes to vision if main fails on it.
- Reasoning is set per request: off for chat replies, on for agent loops. V4.1 Flash thinks by default, and a small `max_tokens` then returns an empty reply.
- Not used: DeepSeek V4 Flash and V4 Pro, gpt-oss, Gemma, Qwen, Nemotron 3 Super and Nano.
- GLM-5.3 is often at capacity on Crusoe: on 2026-10-16 it returned 429 even to single requests.

## Runtime

- Agents run on LangChain Deep Agents JS inside the Next.js server, with `ChatOpenAI` pointed at Crusoe.
- NemoClaw (Nemo Cloud) is optional, only for running agent code in a sandbox.
- LangChain throws on a 429 with no retry header, so every agent gets retry with backoff before its fallback.

## Records and stats

- **Ledger:** `.data/ledger.jsonl` is the source of truth for performance. It records:
  - every model call: tokens in, cached and out; latency; cost; model asked vs answered; ok
  - every reaction order
  - every approval
- **Stats API:** `GET /api/stats?team=`, `?agent=`, or no parameter for all teams. The Performance tabs read it, and the HR agent will too.
- **Acceptance:** (👍 + approvals) / (👍 + approvals + 🔁 + declines).
- **LangSmith** (project `agent-teams`) holds the full traces, linked to ledger calls by `trace`:
  - Deep Agents runs are traced automatically.
  - Chat replies are traced with Crusoe usage plus agent and team metadata.
  - Reactions become feedback with key `order`.
  - The free tier keeps traces for only 14 days, so long-term stats live in the ledger.
- `langsmith` comes with deepagents. Don't `npm i` it: deepagents needs a version below 0.10 and core uses 0.11.

## Deploy

- Vercel project `agent-teams` (blueif16's projects): https://agent-teams-mu.vercel.app. Deploy with `vercel deploy --prod`. Until there are real users, deploy to production after every change without asking; the owner will say when to stop. Env vars are set for Production only. `.vercelignore` keeps `.env*.local` and `.data` out.
- Vercel's disk is read-only except `/tmp`, and each instance has its own. So on Vercel the ledger, 📌 and SOUL/MEMORY edits are temporary and differ between instances. The Performance tabs can show different numbers on refresh. The fix is a durable store; not done yet.
- LangSmith traces are complete on Vercel: replies flush their trace inside `after()`.
- The site is public, and so is the chat API that spends the Crusoe key (expires 2026-10-18).

## Mira, the CEO agent

- **Who she is:** the top-level agent over every team, like a CEO while you're away.
  - `CHIEF_ID` in `src/lib/data.ts`; she has her own "company" team, kept out of the channel list.
  - She runs on the main model like every agent.
- **Where she is:**
  - Bottom of the rail. Clicking her opens shortcuts: progress, best performers, reschedule, reorganize, start a project, open chat.
  - Her DM is pinned first.
- **What she knows:** her prompt (`src/lib/chief-prompt.ts`) gets the live state the browser shows (statuses, "now" lines, pending approvals), ledger stats per team, and a roster to staff from.
- **Starting a project:**
  - She replies with a ` ```project ` JSON block, which becomes a proposal card: the A-team, assignments and a spec.
  - **Launch** creates the channel, puts the members to work on it, and the lead posts a live kickoff.
  - Launched teams live only in the browser and are lost on refresh. They send their context with every message.
- **Heartbeat:** 25 s after load, then every 20 min while the tab is visible.
  - She replies QUIET unless something needs you.
  - A note shows as a badge, a toast and at the top of her menu.
  - Pausing her in her profile stops it.
- **You:** a flat accent disc, because humans are flat and agents are plush. It appears:
  - at the top of All agents, as the org chart You → Mira
  - on approvals in Activity, as the agent handing off to you

## Replies: Markdown and charts

- **Markdown:** agent replies render with Streamdown (`src/components/Markdown.tsx`). It's built for streamed AI text, so a half-open `**`, a table mid-row or an unclosed fence still renders cleanly. Code blocks use `@streamdown/code` (Shiki). `[label](artifact:id)` links still open in the workspace; the sanitizer is told to allow `artifact:`. Your own bubbles stay plain.
- **The chart tool:** an agent writes a ` ```chart ` block holding one small JSON object, and the app draws it from a fixed template:
  - The six templates are stats, bar, line/area, breakdown, progress and timeline (`src/lib/charts.ts`, `src/components/Charts.tsx`).
  - The model supplies data, never drawing code. Every agent's prompt, Mira's included, carries `CHARTS_NOTE`.
  - It's a fenced block, not function calling, for three reasons: it works on every model in the set, it streams (a skeleton shows until the block closes), and it's the same pattern as Mira's ` ```project ` block.
  - Each chart is its own card between the text bubbles, with a chart/table toggle.
- **Chart rules:** follow the dataviz method.
  - Series 1 is the accent, then the validated categorical order (checked on white).
  - Thin marks, a legend for 2+ series, and the table view on every plotted chart.
  - Each chart uses one unit. Metrics in different units go in stats: on 2026-10-17 Gus put DAU and percentages on one axis, so the prompt now says this.
- Recharts draws bar, line and area; everything else is plain React and SVG. Recharts needs `react-is` matching React (19.3.0).
- `#data-pulse` seeds three charts (stats, a highlighted bar, a two-series line) so the demo shows them without a live call.

## Agent identity (`agents/<id>/`, after Muse)

- **SOUL.md** is how the agent works:
  - **Inherent:** how its type does the job best. The types are lead, writer, researcher, analyst, engineer and coordinator. This section changes slowly.
  - **In #channel:** what to master on this project, plus standing instructions added with 📌.
- **MEMORY.md** is what it has learned by doing: Done, Mistakes, Best approaches.
- Both go into the agent's prompt, early, so Crusoe's cache keeps hitting.
- Both are editable in the profile's Soul and memory tab.

## Product

- 8 teams. Reactions are orders: 👍 go, 👀 dig in, 🔁 redo, ✋ hold, 📌 remember.
- The UI copies OpenAI dots and Meta Muse, and every click gets feedback.
- A mascot always opens that agent; only `#channel` opens the team panel.
- Each agent's status and "now" line live in one place (`AgentTeams` state). The chat, side panel and sidebar all read it, so their mascots and chips always match.
- Next: a default HR agent on every team. It reads `/api/stats` and decides whether to hire, replace, or add workers.
