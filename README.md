# Agent Teams

Agent teams with cool UI. A cuter Slack for long-running agents: every channel is a team working toward one goal, and every agent has a mascot, a plan, and a live status. Built for the Crusoe x Cerebral Valley Recursive Agents Hackathon (Oct 17, 2026).

The visual language follows OpenAI's dots (plush mascots, iMessage-style bubbles, chat on the left and the agent's work on the right) and Meta's Muse.

## Run it

```bash
cp .env.example .env.local   # add your Crusoe key
npm install
npm run dev                  # http://localhost:3000
```

Without `CRUSOE_API_KEY` the UI still works; sending a message shows how to turn live replies on.

Live at https://agent-teams-mu.vercel.app. Redeploy with `vercel deploy --prod`. On Vercel, records and file edits last only as long as the instance; `DECISIONS.md` has the details.

## What's here

| Area | Where |
| --- | --- |
| 8 teams, 26 agents, messages, artifacts (seed state) | `src/lib/data.ts` |
| Live agent replies, streamed from Crusoe | `src/app/api/chat/route.ts`, `src/lib/prompt.ts` |
| Mascots (placeholder SVG plushies: shape, color, eyes, accessory) | `src/components/Mascot.tsx` |
| Rive mascots for looks with `rig` set (Felipe for now): the look's own SVG plushie animated in Rive, same fuzz texture; the view model's `action` takes the status directly (idle, working: keyboard + mittens, needs-you, done). Live at 48 px and up; smaller sizes draw the SVG. Built in `/home/ran/rive/felipe-rig` (`tools/export_app.sh` re-exports) | `src/components/RiveMascot.tsx`, `public/rive/` |
| App shell: rail, sidebar, conversation, workspace | `src/components/AgentTeams.tsx` |
| Deep Agents (LangChain) on Crusoe: lead → performance-reviewer sub-agent, skill, memory, per-call usage, LangSmith trace link. Run `node --env-file=.env.local scripts/check-deepagents.mts` | `scripts/check-deepagents.mts` |
| Tracing: LangSmith, on with the `LANGSMITH_*` vars in `.env.local` (project `agent-teams`). `langsmith` comes with deepagents; don't `npm i` it, since deepagents needs <0.10 and core uses 0.11 | `.env.example`, `src/lib/tracing.ts` |
| Performance ledger: every call, order and approval, one JSON line each | `.data/ledger.jsonl`, `src/lib/ledger.ts` |
| Stats API for the Performance tabs and the HR agent: `GET /api/stats?team=` / `?agent=` / all | `src/app/api/stats/route.ts`, `src/lib/stats.ts` |
| Performance tabs (team and agent): spend, tokens, cache hit, acceptance, latency, charts | `src/components/Performance.tsx` |
| Each agent's SOUL.md and MEMORY.md, and the Soul and memory tab | `agents/<id>/`, `src/lib/agent-files.ts`, `src/components/Identity.tsx` |
| Mira, the CEO agent: rail button with shortcuts, her DM, cross-team answers from live state and the ledger, project kickoff (proposal card → new channel), heartbeat notes | `src/components/Chief.tsx`, `src/lib/chief-prompt.ts`, `src/lib/project.ts` |
| Decisions, kept short | `DECISIONS.md` |
| Crusoe hackathon sample, copied as-is | `crusoe/` |
| Same skill file, installed for Claude Code | `.claude/skills/crusoe-recursive-agents-hackathon/SKILL.md` |

## Reactions are orders

Hover an agent's message for the quick bar; click or right-click it for the full menu. The emoji are instructions the agent acts on, not decoration:

| | Order | Effect |
| --- | --- | --- |
| 👍 | Go ahead | Proceed with what you proposed |
| 👀 | Dig in | Look deeper and report back |
| 🔁 | Redo | Take another pass |
| ✋ | Hold | Pause until you say go (agent goes idle) |
| 📌 | Remember | Added as a standing instruction in the agent's SOUL.md |

The agent replies live, quoting the order. The menu also has Message, Ask about this, Hand off to a teammate, Check in later, View profile and Copy text. UI conventions (including click feedback) are in `.claude/skills/agent-teams-ui/SKILL.md`.

In a channel, `@Name` routes your message to that agent; otherwise the team lead answers. Models are a fixed set of four, in `src/lib/models.ts`; `DECISIONS.md` has the routing rules. In short: every agent runs on DeepSeek V4.1 Flash (falls back to GLM-5.3, and back), Nemotron 3.5 Lightning does cheap labeling and never falls back, and image work goes to V4.1 Flash or, when it can't, to Nemotron 3.5 Super VL. `/api/chat` accepts `images` (URLs or data URLs) on the newest message. All IDs were checked against `GET /v1/models` on 2026-10-16.

## Not built yet

Agents don't execute work yet: plans, progress, handoffs, approvals, check-ins and pause/hold are UI state only (nothing runs on a schedule). Replies come from the real model, in character, using the team context. The orchestrator that runs each team's workflow is the next step.
