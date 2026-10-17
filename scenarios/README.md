# Test-mode scenarios

Each scenario runs three times in the shared test company (`docs/design/test-mode.md`). The `.yaml` is the
contract: the opening request, what the simulated owner knows, scripted moves, the rubric and the bar the next run
must clear. `studio.md` and each client's `brief.md` are for the harness and the grader only; the team gets the
files listed under `inputs`.

| | Market report (`market-report.yaml`) | Launch kit (`launch-kit.yaml`) |
|---|---|---|
| Client | Tern: meeting notes for in-person sales reps | Bookbird: booking and reminders for small clinics |
| Team expected | PM + researcher, analyst, writer | PM + researcher, writer, designer |
| Deliverables | `plans.csv` (≥ 12 plans, ≥ 8 vendors, sourced and quoted) · `costs.csv` (every vendor × profile, math checks) · `memo.md` (≤ 500 words, price per tier backed by the table) | `teardown.csv` (≥ 4 competitor pages, sourced) · `copy.md` (S1–S5, every number tagged with a fact, no hype words) · `mockup.html` (copy word for word, one primary button, offline) |
| Owner's moves | asks the PM for the plan · adds a `team-15` profile after the pricing table · asks the analyst a direct question | asks the PM for the plan · switches the button to "Start free" after the teardown · 📌 a voice rule for the writer · DMs the designer for the phone view |
| Gates | approves the launch card; declines exhaustive/frontier research; approves research up to $0.30 | approves the launch card; declines exhaustive/frontier research |
| Rubric | 10 code checks + 1 judge | 12 code checks + 1 judge |
| Limits | 30 min · $1.50 · 3M tokens · 20 owner moves | 30 min · $1.50 · 3M tokens · 20 owner moves |
| Next run must | raise quality by 10 points (or hold ≥ 95%), cut time to done by 20% and tokens by 15% | same |

Inputs are attached to the opening DM to Mira. Changing any file a scenario names changes its hash and starts a new
series at run 1.
