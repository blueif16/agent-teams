# H. Archetype toolsets: curated tools, with presentation tools first-class

Research agent H, 2026-10-17. Scope: the owner's requirement that "each archetype has a unique, curated set of
high-quality tools it uses most often", presentation tools included ("a designer archetype can have an infinite
canvas tool and all the tools associated with it, inherited whenever it presents anything"). Inputs taken as given:
`docs/design/team-setup.md` §2, §3, §3b, §6, §8, §8b; `src/lib/charts.ts`, `src/components/Charts.tsx`,
`src/components/Workspace.tsx`, `src/lib/skills/types.ts`, `src/lib/policy/types.ts`; DECISIONS.md "Replies:
Markdown and charts"; `docs/research/A-dots-muse.md` §1.6, §2.6, §2.7; the local canvas skills
(`~/.claude/skills/{tldraw-skill,excalidraw,excalidraw-diagram-generator,excalimate-core}`).

**How claims were checked (all on 2026-10-17).**
- **npm registry** (`npm view <pkg> version license peerDependencies time`): versions, licenses, React peer ranges.
- **Peer resolution with our exact stack**: `npm install --dry-run next@16.4.2 react@19.3.0 react-dom@19.3.0
  @excalidraw/excalidraw@0.18.1 tldraw@5.5.2 @xyflow/react@12.12.0 @streamdown/mermaid@1.0.3` in `/tmp/canvas-peer`:
  resolved 718 packages, exit 0, no ERESOLVE. A real `next build` with Turbopack was **not** run: **UNVERIFIED**.
- **Bundle sizes**: `bundlephobia.com/api/size` (minified / gzip of the package's main entry).
- **License text**: `raw.githubusercontent.com/.../LICENSE` files and the vendors' own license pages (§8).
- Labels: **EXISTS** (in this repo now), **ADOPT** (a library or MCP pattern we wrap), **BUILD** (ours). Tiers are
  the policy tiers of team-setup §6 (T0 internal read · T1 internal write · T2 memory · T3 public read egress ·
  T4 communicate · T5 state-changing APIs · T6 money/credentials · T7 shell, denied without a sandbox).

---

## 0. The answers in one screen

- **Mechanism rule.** A *fence* (a block in the reply that the app draws, like ` ```chart `) for a read-once view
  of data the agent already holds that fits in one small JSON object. An *artifact* (tool calls that edit a
  stateful, versioned file shown as a tab in the work pane) for anything that persists, gets revised, or that the
  owner edits, comments on or approves. A *derived view* (an artifact whose file is written by other tools or by
  code, e.g. `dag.json`) whenever the state already exists, so the agent spends zero tokens presenting it.
- **Canvas: Excalidraw** (`@excalidraw/excalidraw@0.18.1`, **MIT**, React `^19.0.0` peer). No license key, no
  watermark, no production restriction. Driven by an 8-op schema (`frame · shape · text · note · image · connect · update ·
  delete`) that code turns into standard Excalidraw elements, stored as a plain `.excalidraw` file in the vault.
  tldraw (`tldraw@5.5.2`) has the stronger agent kit, but its license allows development use only; production
  needs a license key (a 100-day trial, a commercial license through sales, or a discretionary non-commercial hobby
  license that must show the watermark), and without a key the editor stops rendering after 5 s.
- **Registry.** One `ToolDef` list in `src/lib/tools/registry.ts`. `ArchetypeDef.tools` holds registry ids.
  Renderers are keyed by artifact type, so any agent built from an archetype gets the tools, the prompt notes and
  the panes with no per-agent config. A composition adds tools only through `extraTools`, approved on the launch card.

---

## 1. Mechanism: fence vs stateful artifact

### 1.1 Prior art

| Product | Mechanism | How the model writes | How it revises | What the human does | Lesson for us |
|---|---|---|---|---|---|
| **Our charts and ` ```project `** (EXISTS) | Fence | One JSON object in a fenced block; 6 fixed templates; tolerant parser (`parseChart`) | Writes a new block | Toggles chart/table; launches the proposal card | Works on every model, streams (skeleton until the fence closes), costs no round trip |
| **Claude artifacts** | Started as in-text `<antArtifact identifier type title>` tags (a fence, extracted to a side panel) [Barber 2024-06-23]; later an `artifacts` tool with `create` · `update(old_str,new_str)` · `rewrite`, update "at most 4 times in a message", `old_str` must be unique [Claude 3.7 prompt leak] | Whole content on create | Exact-string replace, or full rewrite | Reads, copies, runs the preview | Exact unique anchors beat regex; a failed `old_str` returned "OK" silently and the model "became increasingly deranged" [claude-code #9434, 2025-10-12]. **Every op must return a real error.** |
| **ChatGPT canvas** (`canmore`) | Tool calls → stateful doc beside the chat | `create_textdoc{name,type,content}` (types `document`, `code/*`, preview for `code/react`/`code/html`) | `update_textdoc{updates:[{pattern,multiple,replacement}]}` (Python regex; "ALWAYS REWRITE CODE TEXTDOCS"); `comment_textdoc{comments:[{pattern,comment}]}` | Edits in place; reads the model's comments | Separate *edit* and *comment* calls; "lean towards NOT using" the canvas for short content [canmore leak] |
| **v0** | Originally an MDX dialect: a project wrapper with a stable `id` and per-file fences, so the preview diffs and hot-reloads [Narr 2024-11-22]; now a full editor and previews in Vercel Sandbox [v0 FAQ] | Files | Per-file blocks / agent edits | "Add to chat": selected lines + file path + comment become prompt context [v0 code-editing docs] | Owner comments should carry their anchor (file, lines, element) into the agent's next turn |
| **tldraw agent starter kit** | Tool-like typed actions applied to a live canvas | Model gets a screenshot **and** a simplified "focused shape" format; emits actions (create/update/delete, pen strokes, rotate/resize/align/distribute/stack/reorder, todo list, move viewport, schedule review) streamed onto the canvas [tldraw.dev/starter-kits/agent; docs/ai] | Same actions on existing shape ids | Chats in a side panel, picks shapes/areas as context | A *simplified* shape format plus code-side conversion is the proven pattern |
| **tldraw make real** | Sketch → screenshot → vision model → single-file HTML in an iframe shape | HTML | Annotate the iframe, select, run again; the prior HTML is passed back [make-real-starter; blog 2023-11-18] | Draws, annotates, interacts with the prototype on the canvas | Mockups as sandboxed single-file HTML, next to the sketches |
| **Excalidraw MCP App** (official, MIT, v0.3.2) | One tool `create_view{elements: JSON string}` plus `read_me` for the format | Standard Excalidraw element JSON; streamed, partial JSON parsed by dropping the last incomplete item; rendered with `exportToSvg` + morphdom | `restoreCheckpoint` + `delete` pseudo-elements against a saved checkpoint id | Opens fullscreen and edits in the real editor [excalidraw-mcp CLAUDE.md, server.ts @a617657e] | Checkpoints with ids = our revs; streaming draw-on is cheap to copy |
| **Excalidraw mermaid-to-excalidraw** (MIT) | Text → editable elements | Mermaid → skeleton elements → `convertToExcalidrawElements`; "currently only flowcharts", other types become an image [docs.excalidraw.com] | — | Edits the result | Cheap models write Mermaid well; offer it as a fence with "Open on canvas" |
| **dots / Muse work pane** | Chat in one window, the agent's work in another | — | — | dots: Activity (In progress / Scheduled / Completed), open the dot's computer, *Take over* then *Return control*; Muse: activity feed with task lineage, deterministic approval cards, Goals tab, "Spaces" (agent-built web apps) [A §1.6, §2.6, §2.7] | The pane shows *work products and their state*, approvals are UI, not chat; the owner can take over |

### 1.2 Side by side

| | **Fence** (stateless, inline) | **Artifact** (stateful, tool calls, work pane) |
|---|---|---|
| Where it lives | Inside one reply (the ledger/thread) | A file under `.data/vault/projects/<pid>/work/…`, one vault commit per change (§8b) |
| Identity and versions | None; a new block each time | Stable id + `rev`; History tab, diffs, Restore (G) |
| Model output per revision | The whole object again | Only the delta (ops) |
| Validation | Tolerant parse at render; bad block → "📊 Chart" fallback | Closed zod schema per op, validated before write; per-op errors returned to the model |
| Streaming | Into the bubble as it's written | Tool-call args can stream over the SSE bridge (R5) and draw op by op (excalidraw-mcp's trick); *planned* |
| Owner | Reads, toggles | Edits, comments, approves; owner edits win over a racing agent write (expected rev, as in G's writer queue) |
| Background work | Only while replying | Works with no reply at all (overnight, between DMs) |
| Model support | Any model, no tool calling needed | Needs tool calling, which the runtime already requires (deepagents file tools, `task`, `report`) |
| Size | One small object (the chart templates cap at 60 points/10 rows) | Unbounded; read back through a compact digest, never the raw file |

### 1.3 The rule (recommended)

1. **Fence** when all four hold: the output is a view of data the agent already has; it fits one small JSON object
   (≤ ~2 KB / ≤ 60 items); it is read once in the conversation; nobody will edit, approve or revise it later.
   → `chart`, `mermaid`, citation chips, Mira's `project` card.
2. **Artifact** when any one holds: it persists beyond the reply; it will be revised across turns; the owner will
   edit, comment on or approve it; it's bigger than a fence; or it's made in the background.
   → canvas, mockup, doc, sources, table, diff.
3. **Derived view** when the state is already written by other tools or code: plan (`dag.json`), board, timeline,
   company dashboard, file tree, test results. The app draws it; the agent never "presents" it.
4. **Never both.** An artifact is not pasted into chat. When a tool result changes an artifact, code (not the
   model) adds a chip under the reply: "Updated *Signup A* on **Onboarding canvas** · rev 7 · Open". The reply
   itself says what changed in 1–2 sentences.
5. **Fences stay fences.** Charts keep the fenced block for the three reasons in DECISIONS.md. A chart that
   becomes a recurring report is promoted to an artifact by writing it into a doc (a `chart` fence inside the doc's
   Markdown renders with the same `Charts.tsx`).

---

## 2. The designer's infinite canvas

### 2.1 Candidates

| | **Excalidraw** | **tldraw SDK** | **React Flow** (`@xyflow/react`) |
|---|---|---|---|
| Version (npm, published) | `0.18.1` (2026-04-20) | `5.5.2` (2026-10-02) | `12.12.0` (modified 2026-10-11) |
| License | **MIT** (LICENSE, "Copyright (c) 2020 Excalidraw") | **tldraw license** ("SEE LICENSE IN LICENSE.md"): use "only in development" by default | **MIT** (webkid GmbH) |
| Production terms | None (MIT); no key, no watermark. Package telemetry: none seen in the docs read, **UNVERIFIED** | Needs a license key. Trial: no watermark, 100 days, one per business unit, pings tldraw with a key hash. Commercial: annual, through sales, "value-based pricing" (no public price). Hobby: non-commercial, discretionary, **"made with tldraw" watermark must be shown**. Without a key in production (HTTPS, non-loopback host, `NODE_ENV=production`) the SDK logs errors and **stops rendering after 5 s**; 30-day grace after expiry; open-source projects pass the requirement on to their users [tldraw.dev/community/license, /sdk-features/license-key, /pricing; LICENSE.md] | None |
| React 19 / Next 16 | Peer `react ^17.0.2 \|\| ^18.2.0 \|\| ^19.0.0`; Next: `dynamic(() => import(...), { ssr: false })` per the package README. Peer resolution with Next 16.4.2 + React 19.3.0 clean; Turbopack build **UNVERIFIED** | Peer `react ^18.2.0 \|\| ^19.2.1`; resolution clean; build **UNVERIFIED** | Peer `react >=17`; resolution clean |
| Bundle (bundlephobia) | main 1,124,502 B min / 352,695 B gz, plus lazy chunks (largest 1,819,429 / 734,647 gz); 46.8 MB unpacked (fonts, locales) | 1,778,107 B min / 530,042 B gz; 15.2 MB unpacked | ~1.2 MB unpacked; gz not fetched (rate-limited): **UNVERIFIED** |
| How an LLM drives it | Element JSON (`type,id,x,y,width,height,strokeColor,backgroundColor,…`) that every local Excalidraw skill already teaches; the *skeleton* API `convertToExcalidrawElements` accepts `label` on containers, arrows with `start/end:{id}`, and `{type:"frame", children:[ids], name}` [skeleton docs]; official MCP app proves streaming + checkpoints | Agent starter kit (template `package.json` says MIT, but it runs on the licensed SDK, Vercel AI SDK v5 and a Cloudflare Worker): typed `AgentActionUtil` actions, screenshot + "focused shape" format [templates/agent] | Nodes/edges JSON; no free drawing, images or frames-as-artboards; a graph editor, not a canvas |
| Frames / artboards | Yes, `frame` element; children carry `frameId` | Yes, frame shape, multiple pages | Groups/sub-flows only |
| Persistence | `serializeAsJSON` → standard `.excalidraw` file (opens in excalidraw.com and other Excalidraw editors) | `getSnapshot(editor.store)` → `{document, session}`, `loadSnapshot` [tldraw docs persistence.mdx] | Your JSON |
| Export | `exportToSvg`, `exportToBlob({mimeType:"image/png"})`, client side | `editor.toImage(shapes,{format:"png"})`, `editor.getSvgString` (client side) [tldraw docs image-export.mdx] | Via html-to-image (yours) |
| Comments | No comment API in the docs read (**UNVERIFIED** beyond them); ours to build | Same (**UNVERIFIED**); ours to build | — |
| Mermaid import | `@excalidraw/mermaid-to-excalidraw@2.2.2` (MIT), flowcharts only | `@tldraw/mermaid`: flowchart, sequence, state, mindmap [tldraw.dev/docs/mermaid] | — |
| Fit | **Designer canvas** | Better ceiling, blocked by license | **PM plan DAG view** (§3, lead) |

### 2.2 Pick: Excalidraw, with an op schema of our own

- **Why Excalidraw.** MIT and fully local, so it meets "local-first, no hosted dependency" with no key to manage
  and nothing that stops rendering on a date. Frames give the designer artboards (one per screen, option or
  moodboard) that are the unit the owner reviews, approves and exports. The file format is standard JSON that the
  vault diffs and that the owner can open elsewhere. The agent skills on this machine (excalimate-core, excalidraw, excalidraw-diagram-generator) already teach its element format.
- **What we give up vs tldraw.** tldraw's agent kit (actions for align/distribute/stack, pen strokes, viewport
  moves, screenshot context), rich text, multiple pages and broader Mermaid support. **Revisit** only if the owner
  buys a tldraw commercial license; the op schema below is library-neutral, so only `applyCanvasOps` and the pane
  would change.
- **Don't use Excalidraw's skeleton converter on the server.** `convertToExcalidrawElements` measures text in the
  browser (the MCP app calls it in the widget, then `restore(…, { refreshDimensions: true })` once fonts load).
  Agents work with the pane closed, so ops are applied by **our pure function on the server**, which writes full
  standard elements with estimated text sizes; the pane runs `restore(…, { refreshDimensions: true })` on load to
  fix metrics. Whether `restore` runs under jsdom for tests: **UNVERIFIED** (fallback: Playwright).

### 2.3 Op schema (8 ops)

One model-callable tool, `canvas_edit({ canvas, expectedRev, ops })`, with **flat, closed** op objects (one `op`
enum plus optional fields, no nested unions, since DeepSeek Flash does better with small closed schemas). ≤ 40 ops
per call; per-op results.

```ts
// src/lib/tools/canvas-ops.ts (BUILD) — zod in code; this is the shape the model sees.
type Color = "gray" | "blue" | "green" | "yellow" | "red" | "violet";   // mapped to Excalidraw's open-color pairs
type Size = "s" | "m" | "l" | "xl";                                     // 16 / 20 / 28 / 36 px

type CanvasOp =
  | { op: "frame";   id: string; name: string; x?: number; y?: number; w: number; h: number }            // artboard
  | { op: "shape";   id: string; frame?: string; kind: "rect" | "ellipse" | "diamond";
      x?: number; y?: number; w: number; h: number; label?: string; color?: Color; fill?: boolean; link?: string }
  | { op: "text";    id: string; frame?: string; x?: number; y?: number; text: string; size?: Size; color?: Color }
  | { op: "note";    id: string; text: string; near?: string; frame?: string; x?: number; y?: number } // sticky: rationale for the owner
  | { op: "image";   id: string; frame?: string; src: string; x?: number; y?: number; w: number; h: number } // src = project file path
  | { op: "connect"; id: string; from: string; to: string; label?: string; style?: "arrow" | "line" | "dashed" }
  | { op: "update";  id: string; x?: number; y?: number; w?: number; h?: number; frame?: string;
      label?: string; text?: string; color?: Color; name?: string }                                     // move, resize, reparent, relabel, restyle
  | { op: "delete";  ids: string[] };
```

Rules the code enforces (each failure is a per-op error, the rest of the batch still applies):
- **Ids** are the model's short names (`f1`, `b1`), unique per canvas, `[a-z0-9_-]{1,24}`; reusing a live id on a
  create op is an error that names the existing element.
- **Coordinates** are integers, relative to the frame when `frame` is set. **Omit `x`/`y` inside a frame and code
  places the item in the next free cell** (row flow, 24 px gutter), which makes moodboards and option grids trivial
  for a cheap model.
- **Mapping to Excalidraw** (pinned to 0.18.1): `frame` → `type:"frame"` + `frameId` on children; `shape` →
  rectangle/ellipse/diamond + a bound text element (`containerId`) for `label`; `note` → yellow filled rectangle +
  bound text, `customData.kind:"note"`, placed beside `near`; `image` → `image` element with a `fileId` whose bytes
  stay in project files (the `files` map is rehydrated by the pane, so the `.excalidraw` file stays small);
  `connect` → arrow with start/end bindings to the two elements' ids and points between their edges (exact
  0.18.1 binding fields **UNVERIFIED**, pinned and covered by the round-trip test); `update` bumps `version`,
  `versionNonce`, `updated`; `delete` sets `isDeleted` on the element, its bound text and arrows bound to it.
- Every element gets `customData: { by: <agentId>, rev }`, so the pane can show who drew what and the lineage
  index can link elements to runs.
- `link` on a shape may point to a mockup (`/work/mockups/<id>`); opening it in the pane via Excalidraw's link
  handler: **UNVERIFIED**.

Companion tools (designer set, §3): `canvas_read({canvas, frame?})` returns a digest, never raw JSON:

```
canvas onboarding · rev 7 · 3 frames · 41 elements
f1 frame "Signup A" 0,0 390x844 · review · 1 open comment: "CTA too low" (owner)
  t1 text "Welcome" 24,96 xl
  b1 rect "Create account" 24,700 342x52 blue
  n1 note "Primary CTA, thumb reach" near b1
  ~ 6 owner strokes (freehand, not listed)
f2 frame "Signup B" 430,0 390x844 · draft
c1 connect f1→f2 "tap Create"
```

`canvas_export({canvas, frame, format: "png" | "svg"})` writes `exports/<slug>-<frame>.<ext>` (export runs in the
client with `exportToBlob`/`exportToSvg`; with no pane open the request is queued and the chip says "export
pending"; headless export would need a browser, i.e. T7). `request_review({canvas, frame, question})` puts a
review card in the owner's inbox.

### 2.4 Storage, versions, rendering

- **Files** (vault, per §8b): `projects/<pid>/work/canvas/<slug>.excalidraw` (standard format) and
  `<slug>.review.json` (frame status `draft | review | approved | changes`, `approvedBy` + ledger ref, comments with
  their anchor `{frame?, element?}` and resolution). Images under `projects/<pid>/files/canvas/<slug>/`.
- **Versions**: one vault commit per `canvas_edit` call (trailers `Tool: canvas_edit`, `Rev`, `Agent`, `Run`), one per
  owner save (debounced to 3 s idle), one per approval (`Approved-By`). `rev` = commit count on the file;
  `expectedRev` mismatch → error with a fresh digest, so the model re-reads instead of overwriting.
- **Renderer** `CanvasPane` (`src/components/panes/CanvasPane.tsx`, BUILD): loaded with
  `next/dynamic(..., { ssr: false })` only when a canvas tab opens (keeps ~350 KB gz off every other page); imports
  `@excalidraw/excalidraw/index.css`; `restore(…, { refreshDimensions: true })` on load; frame chips (status +
  Approve / Request changes / Export) over each frame; a comment layer pinned to element/frame ids.
- **Workspace**: `Tab` gains `{ type: "artifact"; artifactId: string; artifactType: ArtifactType }`; `tabMeta`
  takes the title and icon from the registry entry for that type.

### 2.5 What the owner can do

- **Edit** anything (move, restyle, draw freehand, add images): saved as an owner commit; the agent sees it as a
  `<state_delta>` line ("owner moved b1 to 24,640; added 6 strokes in f1") on its next turn.
- **Comment** on an element or frame; the comment carries its anchor into the agent's inbox (v0's "Add to chat").
- **Approve a frame** or **request changes**: writes `review.json`, a vault commit with `Approved-By`, and a report
  to the PM; approved frames lock against agent `update`/`delete` (error: "f1 is approved; ask to reopen").
- **Take over / return control** (dots semantics): while the owner has the canvas in edit mode, agent writes are
  queued and the agent is told "owner editing"; returning control releases the queue against the new rev.
- **Export** PNG/SVG per frame; **History** (vault diffs, Restore as a new commit); **Open on canvas** from any
  ` ```mermaid ` fence (client-side `parseMermaidToExcalidraw`, saved as an owner edit).

---

## 3. Per-archetype toolsets

**Base set** (every archetype inherits it; not counted in the curated 4–8):

| Tool | Kind · mechanism | Status | Tier | Why |
|---|---|---|---|---|
| deepagents file tools (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`) | action · call | EXISTS (deepagents) | T0/T1 | Project files are where work products live |
| `web_search`, `fetch_page` (You.com) | action · call | planned (W1) | T3 | Default search per §3b |
| `report` | action · call | planned (M2) | T1 | The only way "done" reaches the PM, with evidence |
| `chart` | present · fence | **EXISTS** (`charts.ts`, `Charts.tsx`, `CHARTS_NOTE`) | T0 | Six templates; every agent and Mira use it today |
| Markdown tables, code blocks | present · fence | **EXISTS** (Streamdown + `@streamdown/code`) | T0 | Small comparisons, snippets |
| `mermaid` | present · fence | ADOPT `@streamdown/mermaid@1.0.3` (Apache-2.0; already listed in streamdown 2.7.0's package.json; not in our `PLUGINS` yet) | T0 | Flowcharts, sequences; "Open on canvas" for the designer |
| artifact chip | present · (code) | BUILD | — | Code-written "Updated X · rev n · Open" under any reply whose tools changed an artifact |

**Curated sets** (A = action, P = present):

| Archetype | Tool | A/P · mechanism | Status | Tier | Why it's high-value |
|---|---|---|---|---|---|
| **designer** | `canvas_edit` | A · artifact | BUILD | T1 | 8 small ops; the model emits deltas, code validates and lays out |
| | `canvas_read` | A · call | BUILD | T0 | Digest of frames/elements/comments; owner edits become visible |
| | `canvas_export` | A · call | BUILD | T1 | PNG/SVG per frame for handoff and the writer's docs |
| | `request_review` | A · call | BUILD | T1 | Turns "is this OK?" into a frame-scoped card, not a chat question |
| | `write_mockup` | A · artifact | BUILD | T1 | Single-file HTML prototype (make-real pattern), linked from a frame |
| | `fetch_image` | A · call | BUILD | T3 | Moodboard references saved to project files, labelled `untrusted` |
| | **canvas** pane | P · artifact | ADOPT Excalidraw + BUILD `CanvasPane` | T0 | Infinite canvas: frames as artboards, edit/comment/approve/export |
| | **mockup** pane | P · artifact | BUILD `MockupPane` | T0 | `<iframe sandbox="allow-scripts" srcdoc>` + injected CSP `default-src 'none'` (no network egress); mobile/desktop widths |
| **engineer** | `propose_patch` | A · artifact | BUILD | T1 | Snapshots its edits as a reviewable diff instead of "I changed 4 files" |
| | `repo_read` (status, diff, log, blame) | A · call | BUILD (typed git wrapper, no shell) | T0 | Grounded answers about the code without T7 |
| | `run_tests` | A · call | planned; **denied until sandboxed** | T7 | Evidence for `report`; arrives with the sandbox backend |
| | **diff** pane | P · artifact | ADOPT `@git-diff-view/react@0.1.8` (MIT, React ^19 peer); fallback `react-diff-view@3.3.3` (MIT) | T0 | Split/unified review, approve/apply; line comments **UNVERIFIED** in the lib (overlay ours) |
| | **files** pane | P · derived | BUILD | T0 | Project file tree from the backend `ls`, changed-file badges |
| | **tests** pane | P · derived | planned (with `run_tests`) | T0 | Pass/fail per test from the runner's JSON, linked to the patch |
| **researcher** | `research` (You.com) | A · call | planned (W2) | T3 (+ approval card at `exhaustive`/`frontier`) | Cited multi-source answers; `output_schema`, `source_control` |
| | `add_source` | A · artifact | BUILD | T1 | One record per source: url, title, date, quote, claim ids; untrusted label kept |
| | `doc_write` (shared with writer) | A · artifact | BUILD | T1 | The report as a document, citations `[S3]` bound to sources |
| | **sources** pane | P · artifact | BUILD `SourcesPane` | T0 | Domain, date, quote, which claims cite it, freshness; spot weak evidence |
| | **report** (doc pane) | P · artifact | BUILD (shared `DocPane`) | T0 | Hover a `[S3]` to see the quote |
| | citation chips | P · fence | BUILD (a `splitCharts`-style parser for `[S<n>]`) | T0 | Same chips in chat replies; an unknown `[S9]` renders as a red "missing source" |
| **analyst** | `describe` | A · call | BUILD (pure TS over CSV/JSON in project files) | T0 | count/sum/mean/median/p90/min/max by group: numbers come from code, not model arithmetic (no shell needed) |
| | `answer` (You.com) | A · call | planned (W2) | T3 | One-pass cited sanity check |
| | `write_table` | A · artifact | BUILD | T1 | Results too big for a Markdown table |
| | **chart** (incl. `stats`) | P · fence | **EXISTS** | T0 | Its main present tool (in the base set; the analyst's note adds "chart every number you computed with `describe`") |
| | **table** pane | P · artifact | ADOPT `@tanstack/react-table@9.3.1` (MIT, React >=18) + BUILD `TablePane` | T0 | Sort, filter, column totals; "Chart this" makes a chart fence from a selection |
| **writer** | `doc_write` | A · artifact | BUILD | T1 | Create or rewrite a Markdown doc |
| | `doc_suggest` | A · artifact | BUILD | T1 | Tracked changes: `edits:[{find, replace, why}]`, `find` must be unique (Claude's `old_str` rule; no regex) |
| | `doc_comment` | A · artifact | BUILD | T1 | Margin comments `[{find, comment}]` (ChatGPT `comment_textdoc`) |
| | `doc_read` | A · call | BUILD | T0 | Text with open suggestions/comments and owner edits marked |
| | **doc** pane | P · artifact | BUILD `DocPane` (Streamdown + `diff@9.0.0`, BSD-3, for word-level marks) | T0 | Accept / reject per suggestion or all, edit in place, comment; Tiptap's Tracked Changes is a **paid add-on** (rejected) |
| **lead (PM)** | `add_task` · `update_task` · `assign_task` | A · call | planned (M1) | T1 | The plan as validated state (§4) |
| | `record_decision` | A · call | planned (M1) | T1 | ADR log the owner can audit |
| | `raise_item` / `resolve_item` | A · call | planned (M1) | T1 | Risks and owner questions become cards |
| | `find_skill` | A · call | planned (W3) | T0, T3 on a miss | Staffing from the skill library |
| | **plan** pane | P · derived (`dag.json`) | ADOPT `@xyflow/react@12.12.0` (MIT) + `@dagrejs/dagre@3.1.1` (MIT); not elkjs (EPL-2.0/GPL) | T0 | DAG with owner, status, blocker, evidence links; click → the task's artifacts |
| | **board** pane | P · derived (`dag.json`) | BUILD | T0 | Kanban by status; same data, owner can reassign through the structured tools |
| | **timeline** | P · fence + derived | EXISTS (`timeline` chart) + BUILD lane view | T0 | Inline milestones in chat; a dated lane view in the pane |
| | **decisions** list | P · derived (`decisions.md`) | BUILD | T0 | What was decided, why, approved by |
| **chief (Mira)** | `project` proposal | A · fence | **EXISTS** (`project.ts`, ` ```project `) | T1 | The launch card; already a fence that becomes UI |
| | `find_agent` | A · call | planned (S2) | T0 | Rehire before create |
| | `dispatch` | A · call | planned (R7) | T1 | Hand off and end the turn (never poll) |
| | `answer` / daily `research` | A · call | planned (W2, Q13) | T3 | The news check per project |
| | **dashboard** pane | P · derived (`company/index.json`) | BUILD `DashboardPane` | T0 | Per project: progress, budget burn, blockers, waiting on owner |
| | **inbox** pane | P · derived (approvals, `open.json`) | BUILD | T0 | Everything that needs the owner, in one list |
| **coordinator** (in `Archetype`, not in §2's list) | assign/report + plan/board panes read-only | — | planned | T1/T0 | Same views as the lead without hiring tools |

Tool budget for Flash: base (~9 calls) + the designer's 6 calls = ~15 model-callable tools, the largest set.

---

## 4. Tool registry contract

```ts
// src/lib/tools/types.ts (BUILD). Shared by the server (tools, prompt notes) and the client (fences, panes).
import type { Archetype, Tier } from "../policy/types";

export type ArtifactType =
  | "canvas" | "mockup" | "doc" | "sources" | "table" | "diff"      // written by the agent's own tools
  | "plan" | "dashboard" | "inbox" | "files" | "tests";             // derived from state files or code
export type RendererId = "chart" | "mermaid" | "citations" | `pane:${ArtifactType}`;

export interface ToolDef {
  /** Registry id, e.g. "canvas_edit", "chart", "plan". */
  id: string;
  name: string;
  /** One line: the "what I can do" sheet and the launch card. */
  description: string;
  kind: "action" | "present";
  /** call: a tool() whose result goes back to the model · fence: a block in the reply the app draws ·
   *  artifact: writes or shows a versioned file rendered as a work-pane tab. */
  mechanism: "call" | "fence" | "artifact";
  tier: Tier;
  /** Curated sets it belongs to; "*" = the base set every archetype inherits. */
  archetypes: (Archetype | "*")[];
  status: "ready" | "planned";
  origin: "exists" | "adopt" | "build";
  /** LangChain tool() names this entry contributes ([] for fences and derived views). */
  calls: string[];
  /** fence: the info string after ``` (parser and renderer looked up by it). */
  fence?: string;
  /** present: the client component that draws it. */
  renderer?: RendererId;
  /** artifact: the product and where it lives, relative to .data/vault/. writtenBy "self" = this entry's calls;
   *  otherwise the tool ids (or "code") that write it. */
  artifact?: { type: ArtifactType; path: string; writtenBy: "self" | string[] };
  /** Prompt usage note: a module-level constant, never templated with runtime data. */
  note?: string;
  /** Pinned packages, e.g. ["@excalidraw/excalidraw@0.18.1"]. */
  deps?: string[];
}
```

Example entries:

```ts
{ id: "chart", name: "Chart", description: "Draws one of six chart templates inline.", kind: "present",
  mechanism: "fence", tier: "T0", archetypes: ["*"], status: "ready", origin: "exists", calls: [],
  fence: "chart", renderer: "chart", note: CHARTS_NOTE },
{ id: "canvas_edit", name: "Edit canvas", description: "Adds and changes frames, shapes, text, notes, images and links.",
  kind: "action", mechanism: "artifact", tier: "T1", archetypes: ["designer"], status: "planned", origin: "build",
  calls: ["canvas_edit"], renderer: "pane:canvas", note: CANVAS_NOTE,
  artifact: { type: "canvas", path: "projects/{pid}/work/canvas/{slug}.excalidraw", writtenBy: "self" },
  deps: ["@excalidraw/excalidraw@0.18.1"] },
{ id: "plan", name: "Plan", description: "The project's task graph with owners, status and blockers.",
  kind: "present", mechanism: "artifact", tier: "T0", archetypes: ["lead", "coordinator", "chief"],
  status: "planned", origin: "adopt", calls: [], renderer: "pane:plan",
  artifact: { type: "plan", path: "projects/{pid}/state/dag.json", writtenBy: ["add_task", "update_task", "report"] },
  deps: ["@xyflow/react@12.12.0", "@dagrejs/dagre@3.1.1"] },
```

How the existing types reference it (proposed edits, not made here):
- `ArchetypeDef.tools: string[]` keeps its type but means **registry ids, in prompt order**; the base set is not
  listed per archetype.
- `Composition` gains `extraTools?: { id: string; why: string }[]` (≤ 3).
- Code checks at load (a unit test, §7 step 1): every id resolves; every archetype's resolved set has ≥ 1 action
  and ≥ 1 present entry; every `artifact.type` has exactly one `pane:` renderer; every `fence` string is unique;
  `calls` names are unique across the registry.

---

## 5. Inheritance

```ts
// src/lib/tools/resolve.ts (BUILD), pure.
function resolveToolset(arch: ArchetypeDef, comp?: Composition, env = { sandbox: false }) {
  const ids = [...BASE_IDS, ...arch.tools, ...(comp?.extraTools ?? []).filter(approved).map((x) => x.id)];
  const defs = unique(ids).map(byId).filter((d) => d.status === "ready")
    .filter((d) => d.tier !== "T7" || env.sandbox);                  // shell stays denied without a sandbox
  return {
    calls: defs.flatMap((d) => d.calls),                              // → LangChain tool() instances (server map)
    notes: defs.filter((d) => d.note).map((d) => d.note!),            // → prompt, in this exact order
    fences: defs.filter((d) => d.fence).map((d) => d.fence!),         // → which fences this agent is taught
    artifacts: defs.flatMap((d) => (d.artifact ? [d.artifact.type] : [])),
  };
}
```

- **Agents get tools by archetype, automatically.** At hire, the runtime calls `resolveToolset` and builds the
  deepagents agent from `calls` (+ base file tools) and the prompt from `notes`. Nothing per agent is stored except
  the composition's approved extras. Changing the designer's curated set changes every designer on its next run
  (archetypes "track latest" like archetype skills in §8b; a pin can come later).
- **Renderers come with the artifact, not the agent.** The client registers every fence parser and every `pane:`
  renderer once (lazy-loaded). Any artifact opens with its type's pane for whoever views it; a designer's canvas
  looks the same in the PM's plan link, Mira's dashboard or the owner's tab. Inheritance decides what an agent can
  *produce* (calls + notes); the UI needs no per-agent setup.
- **Policy still decides each call.** Registry `tier` is the default the policy engine starts from (§6); rules can
  tighten it (`locked` rules can't be relaxed); T4–T6 still ask; T7 is filtered out until a sandbox exists.
- **Adding a tool beyond the archetype** (e.g. a writer who needs `canvas_read` to describe a design): the PM puts
  it in `Composition.extraTools` with a one-line `why`; it shows on the **launch card** under the role as "extra
  tool: Read canvas (T0) — to describe approved frames", so it rides the one existing gate. Mid-project it's its own
  approval card (like a new hire). Limits: ≤ 3 extras, `status: "ready"` only, never a T7 tool without a sandbox,
  and an extra whose tier is T4+ is listed in red on the card. Removing a tool needs no approval.
- **History.** The composition (with extras) is a vault file, so compositions adapted "from history" (§2) inherit
  the extras that worked, with provenance.

---

## 6. Prompting

- **One note per present tool, as a constant**, like `CHARTS_NOTE`: `CANVAS_NOTE`, `MOCKUP_NOTE`, `DOC_NOTE`,
  `SOURCES_NOTE`, `TABLE_NOTE`, `DIFF_NOTE`, `MERMAID_NOTE`. Format for Flash: one "when to use" sentence, if-then
  rules, one example per op with closed enums, and the chat rule. Target ≤ 180 words each (`CHARTS_NOTE` is ~330;
  keep it as is).
- **Placement for prefix caching**: shared prefix → archetype block (role, Inherent, then a **"Showing your work"**
  section with the base notes followed by the archetype's notes in registry order) → composition extras' notes →
  SOUL/MEMORY → charter/state digest → history → `<state_delta>` tail. Every designer therefore shares the same
  bytes up to SOUL.md. Notes never contain ids, revs, dates or project names; the list of open artifacts and their
  revs goes in the window opener and `<state_delta>` lines.
- **Tool schemas are part of the prefix too**: zod `.describe()` strings are constants, and `calls` are bound in
  registry order, so the `tools` array is byte-stable per archetype.
- **Draft `CANVAS_NOTE`** (~170 words):

```
Canvas: your designs live on a canvas the owner sees in the work pane. Change it only with canvas_edit (a list of
ops); call canvas_read first if anyone else may have changed it. Put each screen, option or moodboard in its own
frame and give every item its frame. Ops (ids are yours: short and unique):
- {"op":"frame","id":"f1","name":"Signup A","w":390,"h":844}
- {"op":"shape","id":"b1","frame":"f1","kind":"rect","x":24,"y":700,"w":342,"h":52,"label":"Create account","color":"blue"}
- {"op":"text","id":"t1","frame":"f1","x":24,"y":96,"text":"Welcome","size":"xl"}
- {"op":"note","id":"n1","near":"b1","text":"Primary CTA within thumb reach"}
- {"op":"image","id":"i1","frame":"f3","src":"files/moodboard/ref-3.png","w":200,"h":140}
- {"op":"connect","id":"c1","from":"f1","to":"f2","label":"tap Create"}
- {"op":"update","id":"b1","y":640,"label":"Get started"}
- {"op":"delete","ids":["n1"]}
x and y are pixels inside the frame; leave them out and the item goes in the next free spot. Colors: gray, blue,
green, yellow, red, violet. Sizes: s, m, l, xl. If an op fails, fix that op and send only it again. When a frame is
ready, call request_review with its id. In chat, say what changed in one or two sentences and name the frame;
never paste ops or canvas JSON into a reply.
```

- **Draft `DOC_NOTE`** (writer, researcher; ~90 words): "Long or reusable text goes in a doc, not a reply: create
  with doc_write. To change the owner's text, propose with doc_suggest: each edit has `find` (an exact passage that
  appears once, as short as possible), `replace` and a short `why`; never rewrite a doc the owner has edited.
  Comments go through doc_comment. Cite sources as [S1], [S2] using the ids add_source returned; a claim without a
  source gets no marker. In chat, say what you changed in one sentence."

---

## 7. Build order

| # | Step | Test that fails when it's wrong |
|---|---|---|
| 1 | **Registry + resolver**: `src/lib/tools/{types,registry,resolve}.ts`; move `CHARTS_NOTE` into the `chart` entry; `ArchetypeDef.tools` hold registry ids | (a) every archetype's resolved set has ≥ 1 action and ≥ 1 present entry, every id resolves, every artifact type has one pane renderer (breaks on a typo or a missing renderer); (b) `resolveToolset(designer)` contains `canvas_edit` and not `run_tests`; with `extraTools: [run_tests]` and `sandbox: false` it still lacks it; an unapproved extra is absent; (c) two designers with different SOUL files produce system prompts **byte-equal up to the SOUL marker**, and the `tools` arrays are deep-equal (breaks the moment a note is templated) |
| 2 | **Canvas ops core**: zod op schema + pure `applyCanvasOps(scene, ops, {agentId, rev})` + `canvasDigest(scene)` | Fixture tests per op (ids, types, `frameId`, `containerId`, relative→absolute coordinates, auto-placement into the next free cell); `connect` to a missing id → that op errors, others apply; reused id → error naming the existing element; `delete b1` also deletes its label and unbinds/deletes its arrows; property test: 500 random op sequences never leave a dangling `containerId`, `frameId` or binding; approved-frame elements reject `update`/`delete` |
| 3 | **Canvas tools + storage**: `canvas_edit`/`canvas_read`/`canvas_export`/`request_review` as `tool()`s, files + `review.json` in the vault, one commit per call with trailers | Two `canvas_edit` calls with the same `expectedRev` → exactly one commit, the other returns a conflict with a fresh digest; an owner save between read and edit wins and the agent's next turn carries the owner's change as a `<state_delta>`; `git log` on the file shows `Tool: canvas_edit` + `Rev` trailers per call |
| 4 | **CanvasPane + artifact tabs**: `Tab {type:"artifact"}`, `next/dynamic` Excalidraw, frame chips, comments, approve, export | `next build` passes (breaks if Excalidraw is imported server-side); a component/Playwright test opens a fixture canvas and finds every element id from the file; clicking Approve on f1 writes `approved` + `approvedBy` to `review.json` and a commit with `Approved-By`; `restore()` round-trip keeps the element count and ids of every op's output |
| 5 | **Doc + sources artifacts** (writer, researcher): `doc_write/suggest/comment/read`, `add_source`, `DocPane`, `SourcesPane`, citation chips | `doc_suggest` with a `find` that appears twice → error stating the count, doc unchanged; accepting a suggestion yields exactly the replaced text (jsdiff of before/after = that edit only); a reply or doc citing `[S9]` with no source 9 is flagged in the tool result and rendered red |
| 6 | **Derived views and data tools**: `PlanPane` (React Flow + dagre over `dag.json`), board, `DashboardPane`, `DiffPane`, `TablePane`, `describe` | A `dag.json` fixture renders one node per task and one edge per dep, blocked tasks styled blocked (breaks on a dropped dep); `describe` median/p90 match hand-computed values on an even-length and an odd-length fixture (breaks on off-by-one percentiles); `propose_patch` diff of a fixture edit equals `git diff` output for the same change |

Dependencies: step 1 has none. Steps 2–3 can start now (pure + vault writer V1). Step 4 needs R5's SSE events for
live refresh but works on reload without them. Steps 5–6 follow M1 (state files) for the plan and W2 for research.

---

## 8. Sources (all accessed 2026-10-17)

Libraries and licenses
- npm registry: `tldraw@5.5.2` (published 2026-10-02; license "SEE LICENSE IN LICENSE.md"; peer react `^18.2.0 || ^19.2.1`); `@excalidraw/excalidraw@0.18.1` (2026-04-20; MIT; peer `^17.0.2 || ^18.2.0 || ^19.0.0`); `@xyflow/react@12.12.0` (MIT; peer `>=17`); `@git-diff-view/react@0.1.8` (MIT; peer `^16.8 … ^19`); `react-diff-view@3.3.3` (MIT); `@tanstack/react-table@9.3.1` (MIT; peer `>=18`); `diff@9.0.0` (BSD-3-Clause); `@dagrejs/dagre@3.1.1` (MIT); `elkjs@0.12.0` (EPL-2.0 OR GPL-3.0-or-later); `@excalidraw/mermaid-to-excalidraw@2.2.2` (MIT); `streamdown@2.7.0` and `@streamdown/mermaid@1.0.3` (Apache-2.0; `node_modules/streamdown/package.json` lists the mermaid plugin); `@tiptap/react@3.32.0` (MIT); `@blocknote/react@0.56.0` (MPL-2.0).
- `npm install --dry-run` with next 16.4.2, react 19.3.0 and the canvas packages (`/tmp/canvas-peer`): 718 packages, exit 0.
- bundlephobia API: `https://bundlephobia.com/api/size?package=tldraw@5.5.2`, `…@excalidraw/excalidraw@0.18.1`.
- https://raw.githubusercontent.com/excalidraw/excalidraw/master/LICENSE (MIT); https://raw.githubusercontent.com/xyflow/xyflow/main/LICENSE (MIT).
- https://tldraw.dev/community/license · https://tldraw.dev/sdk-features/license-key · https://tldraw.dev/pricing · https://github.com/tldraw/tldraw/blob/main/LICENSE.md · https://tldraw.dev/blog/tldraw-sdk-4-0 (2025-09-18, the dev-only license change).
- https://tldraw.dev/starter-kits/agent · https://tldraw.dev/docs/ai · https://github.com/tldraw/tldraw/blob/main/templates/agent/README.md · `templates/agent/package.json` (MIT; Cloudflare deploy target; `ai@^5`, `tldraw: workspace:*`) · https://github.com/tldraw/make-real-starter · https://tldraw.dev/blog/make-real-the-story-so-far (2023-11-18) · https://tldraw.dev/docs/mermaid.
- tldraw docs via Context7 `/tldraw/tldraw` (`persistence.mdx`: `getSnapshot`/`loadSnapshot`; `image-export.mdx`: `toImage`, `getSvgString`).
- Excalidraw docs via Context7 `/excalidraw/excalidraw` (`dev-docs/.../excalidraw-element-skeleton.mdx`: labels, arrow `start/end`, frames with `children`; `packages/excalidraw/README.md`: Next `dynamic(..., {ssr:false})`; `utils`: `exportToSvg`, `exportToBlob`, `serializeAsJSON`; `updateScene` + `CaptureUpdateAction`; `viewModeEnabled`).
- https://github.com/excalidraw/excalidraw-mcp (README, CLAUDE.md; `src/server.ts` and `src/mcp-app.tsx` at a617657e; `package.json`: MIT, 0.3.2, `@excalidraw/excalidraw ^0.18.0`, React ^19).
- https://docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/api ("Currently only flowcharts are supported").
- https://plus.excalidraw.com/docs/mcp/tools (hosted Excalidraw+ MCP, `create_diagram` with auto layout: prior art only, not a dependency).
- https://tiptap.dev/docs/tracked-changes/getting-started/install ("a paid add-on that isn't included in any plan") · https://tiptap.dev/pricing.

Prior art
- ChatGPT canvas: https://github.com/asgeirtj/system_prompts_leaks/blob/main/OpenAI/tool-canvas-canmore.md · https://huggingface.co/datasets/Nymbo/Official_LLM_System_Prompts (ChatGPT-4o with Canvas, 2024-10-03).
- Claude artifacts: https://www.reidbarber.com/blog/reverse-engineering-claude-artifacts (2024-06-23) · https://github.com/asgeirtj/system_prompts_leaks/blob/HEAD/Anthropic/old/claude-3.7-full-system-message-with-all-tools.md · https://github.com/anthropics/claude-code/issues/9434 (2025-10-12).
- v0: https://www.codeline.co/thoughts/repo-review/2024/v0-system-prompt-leaked (2024-11-22) · https://v0.app/docs/faqs · https://v0.app/docs/code-editing.
- dots and Muse: `docs/research/A-dots-muse.md` §1.6, §2.6, §2.7 and its sources.

**UNVERIFIED** (named where used): a Turbopack `next build` with either canvas; Excalidraw package telemetry and comment APIs (none found); Excalidraw `restore()` under jsdom;
0.18.1's exact arrow-binding fields; Excalidraw's link handler for in-app mockup links; `@git-diff-view/react` line
comment widgets; `@xyflow/react` gzip size; tldraw commercial prices (not published).

---

## 9. Self-check

| Requirement | Verdict | Evidence |
|---|---|---|
| Cov 1: compare fence vs artifact with prior art (Claude artifacts, ChatGPT canvas, dots/Muse, v0, tldraw agent kit / make real, Excalidraw AI) and recommend per tool | PASS | §1.1 table (8 rows, each cited), §1.2, §1.3 rule; every tool in §3 carries its mechanism |
| Cov 2: tldraw vs Excalidraw vs alternative on license/production terms, React 19 + Next 16, bundle, LLM driving, agent kit, persistence, export, owner interaction; one pick with ≤ 8-op schema | PASS | §2.1 table; §2.2 pick with license; §2.3 8 ops (TypeScript) + rules + mapping; §2.4 storage/renderer; §2.5 owner actions |
| Cov 3: 4–8 tools per archetype, action + present, EXISTS/ADOPT/BUILD, tier, why; designer, engineer (shell T7-denied), researcher, analyst, writer, lead, chief | PASS | §3: designer 8, engineer 6, researcher 6, analyst 5, writer 5, lead 8, chief 6; each has ≥ 1 A and ≥ 1 P; `run_tests` T7 denied until sandbox |
| Cov 4: concrete TS registry with id, name, description, kind, mechanism, tier, archetypes, status, renderer, artifact type + path; how `ArchetypeDef.tools` references it | PASS | §4 `ToolDef` + three example entries + the `ArchetypeDef`/`Composition` changes |
| Cov 5: inheritance of tools and renderers; adding a tool beyond the archetype, gated | PASS | §5 `resolveToolset`, renderer-by-artifact-type, `extraTools` on the launch card, limits |
| Cov 6: usage notes in the prompt, short and stable for caching | PASS | §6 placement, ordering, no runtime data, drafts of `CANVAS_NOTE` and `DOC_NOTE` |
| Output: §7 build order ≤ 6 steps starting with registry and canvas, each with a failing test | PASS | §7, 6 steps; 1 = registry, 2–4 = canvas |
| Bar: every library claim has a URL/package source and date; unverified marked | PASS | Method block, §8 sources dated 2026-10-17, UNVERIFIED list in §8 and inline |
| Bar: canvas recommendation includes production license terms | PASS | §0, §2.1 (Excalidraw MIT, no key; tldraw trial/commercial/hobby + watermark + 5 s stop) |
| Bar: says which library, which license, which op schema, stored where, rendered by which component, what the owner can do | PASS | Excalidraw 0.18.1 · MIT · §2.3 ops · `projects/<pid>/work/canvas/<slug>.excalidraw` + `review.json` · `CanvasPane` via `next/dynamic` · edit, comment, approve/request changes, take over, export, history, open Mermaid on canvas |
| Must not: edit any repo file other than this report | PASS | Only this file written; type changes are proposals in §4 |
| Must not: hosted SaaS dependencies | PASS | All picks are npm packages run locally; Excalidraw+ MCP, Tiptap Tracked Changes, tldraw licensing and Context7 are named and rejected; You.com is the owner's existing decision (§3b) |
