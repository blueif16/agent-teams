---
name: agent-teams-ui
description: UI rules for the Agent Teams app (dots-style agent chat with Slack structure). Use whenever adding or changing any component, page, button, menu, animation or styling in this repo, so new UI matches the reference look and gives proper click feedback.
---

# Agent Teams UI

The look copies OpenAI's dots (plush mascots, iMessage bubbles, chat left and the agent's work in a browser-style pane right) with Slack's structure (rail, channel sidebar, threads). Don't invent a new visual language; extend this one.

## Tokens (src/app/globals.css `@theme`)

| Token | Value | Use |
| --- | --- | --- |
| `frame` | #e5e5e5 | window chrome, rail, sidebar |
| `surface` | #fff | chat panel |
| `bubble` | #f4f4f4 | agent bubbles, hover fills |
| `accent` | #4166eb | your bubbles, primary buttons, selection |
| `accent-soft` | #a9b7f6 | disabled send |
| `pane` | #f9fbfc | workspace pane |
| `cobalt` / `paper` | #2033a4 / #fbf9f5 | slide art |

Type: Inter at 15px/22px for messages, 13–14px for UI, 12.5px for meta. Bubbles are radius 20px; pills are fully round; menus are radius 16–20px with a soft shadow.

## Every click gets feedback

Nothing clickable is silent. Use the CSS utilities for hover and press, and `motion` for what changes after the click.

| Element | Class / pattern |
| --- | --- |
| Icon buttons, pills, small buttons | `tap` (press shrinks to 0.93, springs back) plus a hover fill |
| Full-width rows, list items, menu items | `tap-soft` (press 0.985) plus `hover:bg-black/[0.05]` or `hover:bg-bubble` |
| Cards that open something | `lift` (rises 2px on hover) plus a deeper shadow on hover |
| Mascots | `squish` (tilt on hover, plush squash on press); inside a `group` row use `squish-group` |
| Reaction emoji | `emoji-btn` (grows to 1.22 on hover) |
| Selected item in a list (rail, sidebar, tabs) | a `motion.span` with a shared `layoutId` so the highlight glides |
| New thread items | `motion.div` enter: opacity 0, y 12, scale 0.97 → rest, `ENTER` spring |
| Popovers and menus | `AnimatePresence` + scale 0.94 → 1 from the anchor's corner |
| State changes (status chip, badges, approvals) | key on the state so it pops (`POP` spring); approvals flash green and draw the check |
| Confirmations with no visible change (copy, download, pause) | `Toast` via `notify()` |

Springs live in `src/components/ui.tsx`: `SPRING` for highlights and panels, `POP` for pop-ins. `MotionConfig reducedMotion="user"` wraps the app, and globals.css turns off transforms under `prefers-reduced-motion`.

## Agent replies and charts

- Agent text goes through `Markdown` (Streamdown), never `RichText`; `RichText` is for your own bubbles and one-line previews. Previews and copy use `withChartSummaries()` so a chart reads as one "📊 title: …" line.
- A ` ```chart ` block becomes a card from `Charts.tsx`: white, radius 20px, hairline ring, no `lift` (it doesn't open anything). A click inside a card doesn't open the message's quick actions. The chart/table toggle is an icon pair with a gliding `layoutId` highlight.
- Bars, meters and sparklines grow in on mount (`SPRING`, or Recharts at about 700ms). Recharts animation turns off under reduced motion.
- New templates follow the dataviz skill: run its palette validator, use one unit per chart, and include a table view.

## Agents and teams

- A mascot always opens that agent's panel, wherever it appears. Only `#channel` (the pill, the `#` button) opens the team panel.
- Status and the "now" line come from the shared `status` and `doing` state in `AgentTeams.tsx`. Pass `status` to every mascot at 48 px or more, so its Rive action matches the chat. Never read `agent.status` or `agent.task` from seed data in a view.

## Reactions are orders

Reactions on agent messages are quick orders, not decoration. The set is fixed in `src/lib/orders.ts`. Add one only if it means a distinct instruction:

👍 Go ahead · 👀 Dig in · 🔁 Redo · ✋ Hold · 📌 Remember

Reacting sends the order to the agent (it replies live with a quote line), drops a labeled chip under the message, and applies the side effect: ✋ sets the agent idle, 📌 adds to its Remembers list. Hovering a message shows the bar; clicking or right-clicking it opens the quick-actions menu, which has the orders plus message, ask, hand off, check in, profile and copy.

## Gotchas found in this repo

- Unlayered CSS in globals.css beats Tailwind utilities regardless of specificity. Never set `display` (or other layout) in a custom class; use utilities on the element.
- `motion` writes `transform` inline, which overrides CSS `:hover`/`:active` transforms on the same element. Put `tap`/`squish`/`emoji-btn` on an inner element, `motion.*` on the wrapper.
- Transforms don't apply to plain inline elements. A `squish` span must be a flex/grid item or have `block`/`inline-block`.
- Next 16 rejects `Date.now()`/`Math.random()` during render in client components. Use them only in event handlers or effects.
- Turbopack on WSL sometimes stops picking up globals.css edits. If served CSS looks stale, stop the dev server, `rm -rf .next`, restart.

## Check your work

Run `npx tsc --noEmit && npx eslint src`, then drive the change in a headless browser (Playwright) and look at a screenshot, including one taken mid-animation (~90ms after a click) and one at 390px wide.
