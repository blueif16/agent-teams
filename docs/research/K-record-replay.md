# K. Record and replay a full Agent Teams run

Question: how do we record one full run (owner actions, agent messages, tool calls, state changes, every model HTTP exchange) and replay it (a) as a deterministic, zero-token re-run of the real code for regression tests, and (b) as fast, faithful playback in the live UI for a demo, with speed control?

Short answer: use two recordings, not one. **L1** is a hand-rolled HTTP cassette at our injectable `fetch`. It stores every model exchange with per-chunk timing, and it serves the regression tests. **L2** is an app-event tape that uses the R5 SSE wire format with `t`/`seq`/`dur` timing fields. It serves the demo by streaming the recorded frames back into the unchanged live UI at 1x, 4x or instant speed, with seeking. LangGraph checkpoints and LangChain fakes are useful, but they are not a replay mechanism. Video is only for artifacts you share.

Research date: 2026-10-17. Installed versions were read from `/Users/tk/Desktop/agent-teams/node_modules`. Latest versions and release dates come from the npm registry (`npm view <pkg> time`).

## Sources

1. undici `SnapshotAgent` API docs. https://github.com/nodejs/undici/blob/main/docs/docs/api/SnapshotAgent.md. undici 8.12.2 (2026-10-15). Marked "Stability: 1 - Experimental".
2. undici `lib/mock/snapshot-recorder.js` source. https://github.com/nodejs/undici/blob/main/lib/mock/snapshot-recorder.js (main, read 2026-10-17).
3. undici `MockAgent` / `MockPool` docs (`intercept`, `reply`, `delay`, `times`, `persist`, `disableNetConnect`, `enableNetConnect`). https://github.com/nodejs/undici/blob/main/docs/docs/api/MockPool.md and `MockAgent.md`. undici 8.12.2.
4. undici `setGlobalDispatcher` docs, the v7→v8 migration guide and "undici vs built-in fetch". https://github.com/nodejs/undici/tree/main/docs/docs (`index.md`, `best-practices/migrating-from-v7-to-v8.md`, `best-practices/undici-vs-builtin-fetch.md`). Local check: Node v24.22.0 reports `process.versions.undici = 7.29.1`.
5. undici v7.13.0 release notes ("feat: add SnapshotAgent for HTTP request recording and playback", PR #4270). https://github.com/nodejs/undici/releases/tag/v7.13.0 (2025-07-31).
6. nock README (Nock Back modes, stream replies, `NetConnectNotAllowedError`, recorder body formats). https://github.com/nock/nock/blob/main/README.md. nock 15.0.2 (2026-10-16). Depends on `@mswjs/interceptors ^0.44.0`; engines node >=20.12.1.
7. nock autodocs: `recorder.rec` / `RecorderOptions`, `nock.back` `BackOptions`, `delayConnection` / `delayBody`, `filteringRequestBody`, and `lib/interceptors/builtin.ts` (BatchInterceptor of HttpRequestInterceptor + FetchInterceptor). https://github.com/nock/nock/tree/main/_autodocs (via Context7 `/nock/nock`).
8. MSW docs on `delay()` and response timing ("Add stream latency with delay()"). https://mswjs.io/docs/api/delay and https://mswjs.io/docs/http/mocking-responses/response-timing. msw 3.0.3 (2026-10-10). engines node >=22.12.0.
9. MSW 2.x → 3.x migration (`onUnhandledRequest` renamed `onUnhandledFrame`, Node ≥22, entrypoints such as `msw/http`, `msw/sse`, `msw/utils/*`). https://github.com/mswjs/mswjs.io/blob/main/src/content/docs/migrations/2.x-to-3.x.md. msw 3.0.0 (2026-09-28).
10. MSW autodocs for `sse()` (matches GET with `Accept: text/event-stream` only), `passthrough()`, and the `onUnhandledRequest` strategies table (warn default / error / bypass). https://github.com/mswjs/msw/tree/main/_autodocs and mswjs.io `setup-worker/start`.
11. `@mswjs/interceptors` README and autodocs (`FetchInterceptor`, `request` event + `RequestController.respondWith/errorWith/passthrough`, `response` event with `response`, `responseType`, `request`, `requestId`). https://github.com/mswjs/interceptors. 0.45.9 (2026-10-17).
12. Polly.JS configuration docs (`mode`, `recordIfMissing`, `timing: Timing.fixed/relative`, `matchRequestsBy` incl. `body(body, req)` and `order`). https://github.com/Netflix/pollyjs/blob/master/docs/configuration.md. @pollyjs/core 6.0.6 (2023-07-20).
13. Polly fetch adapter source (`response.arrayBuffer()` on passthrough; replay builds `new Response(responseBody, …)`). https://github.com/Netflix/pollyjs/blob/master/packages/@pollyjs/adapter-fetch/src/index.js. @pollyjs/adapter-fetch 6.0.7 (2025-05-31).
14. Polly adapter base source (the error text "Recording for the following request is not found and `recordIfMissing` is `false`."; `timing(time)` is called with the recorded response time). https://github.com/Netflix/pollyjs/blob/master/packages/@pollyjs/adapter/src/index.js.
15. GitHub API for Netflix/pollyjs: `pushed_at` 2025-05-31T22:29:19Z, not archived, 61 open issues. The last commits are "Publish v6.0.7" and "Undeprecating fetch for node" (#506). The commit before those is from 2023-09-19. https://api.github.com/repos/Netflix/pollyjs.
16. npm registry release times (`npm view <pkg> time`, queried 2026-10-17) for all packages named in this file.
17. CopilotKit aimock README (`llmock --record --provider-openai`, `--replay-speed`, "per-frame arrival timestamps … approximate timing reproduction based on recorded TTFT and inter-frame cadence", fixture `match` fields). https://github.com/CopilotKit/aimock. @copilotkit/aimock 1.45.1 (2026-10-12).
18. Installed `openai` 7.34.0, `node_modules/openai/client.js`. Line 1086 calls `this.fetch.call(undefined, url, fetchOptions)`. Lines 1268–1290 build headers: `X-Stainless-Retry-Count`, `X-Stainless-Timeout`, `User-Agent`, and platform headers (`X-Stainless-OS`, `X-Stainless-Runtime-Version`, …).
19. Installed `@langchain/openai` 1.6.2, `dist/chat_models/base.js:324`. The OpenAI client is built with `maxRetries: 0`, so LangChain's own caller does the retries.
20. Installed `@langchain/core` 1.2.18:
    - `dist/language_models/chat_models.js`: `_streamIterator` at lines 132–160 does not consult the cache. `generate()` → `_generateCached` at lines 357–453. The streaming-handler switch to `_streamResponseChunks` is at lines 232 and 273.
    - `dist/caches/index.js`: the default key encoder is `sha256(strings.join("_"))`, and `makeDefaultKeyEncoder` replaces it.
    - `dist/utils/async_caller.js`: `maxRetries` defaults to 6. `STATUS_NO_RETRY = [400,401,402,403,404,405,406,407,409,413]`.
    - `dist/testing/fake_model_builder.d.ts`: `fakeModel()` / `FakeBuiltModel`, which has no `_streamResponseChunks`.
    - `dist/utils/testing/chat_models.d.ts`: `FakeListChatModel`, `FakeStreamingChatModel`.
    - `dist/utils/testing/openai_stream_fixtures.d.ts`: `sseResponseFromOpenAIChunks`, `openAITextOnlyChunks`, `openAIToolCallChunks`.
21. LangChain JS docs, "Unit testing" (`fakeModel` from `langchain`, `respondWithTools`, `calls`, `callCount`). https://docs.langchain.com/oss/javascript/langchain/test/unit-testing.
22. LangChain JS docs, "Fake LLM" (`FakeListChatModel` with `responses`, `sleep`, streaming). https://docs.langchain.com/oss/javascript/integrations/chat/fake.
23. LangGraph JS docs, "Use time travel" (`getStateHistory`, replay with `invoke(null, snapshot.config)`, fork with `updateState`). https://docs.langchain.com/oss/javascript/langgraph/use-time-travel.
24. LangGraph JS docs, "Checkpointers" (replay semantics, super-steps, per-task writes and pending writes, durability `exit`/`async`/`sync`). https://docs.langchain.com/oss/javascript/langgraph/checkpointers.
25. LangGraph JS docs, Functional API "Determinism" (side effects and non-deterministic values go in `task()`; completed task results are restored on resume). https://docs.langchain.com/oss/javascript/langgraph/functional-api.
26. LangGraph JS docs, Graph API "Node caching" (`addNode(…, { cachePolicy: { keyFunc, ttl } })`, `compile({ cache: new InMemoryCache() })`, `__metadata__.cached`). https://docs.langchain.com/oss/javascript/langgraph/graph-api.
27. LangGraph JS docs, "Streaming" (stream modes) and "Event streaming" (`streamEvents(input, { version: "v3" })`, projections `messages/values/output/subgraphs/interrupts/extensions`, "introduced in LangGraph v1.2"). https://docs.langchain.com/oss/javascript/langgraph/streaming and `/event-streaming`.
28. Installed `@langchain/langgraph` 1.5.0 and `@langchain/langgraph-checkpoint` 1.2.0:
    - `dist/stream/types.d.ts:26-49`: `ProtocolEvent { type:"event"; seq; method; params:{ namespace; timestamp; node?; data } }`.
    - `dist/pregel/types.d.ts`: `StreamMode = "values"|"updates"|"debug"|"messages"|"checkpoints"|"tasks"|"custom"|"tools"`, `encoding?: "text/event-stream"`, and `StateSnapshot`.
    - `dist/pregel/index.d.ts:493`: `streamEvents(…, { encoding: "text/event-stream" })` returns `IterableReadableStream<Uint8Array>`.
    - `dist/pregel/messages.js:31`: `lc_prefer_streaming = true`.
    - Checkpoint `types.d.ts:11-31`: `CheckpointMetadata { source; step; parents }`.
    - Checkpoint `id.d.ts`: `uuid6`.
    - Latest on npm: `@langchain/langgraph` 1.5.1 (2026-10-16).
29. Installed `langchain` 1.5.18:
    - `dist/agents/nodes/ToolNode.js:333`: runs the tool calls of one AIMessage with `Promise.all`.
    - `dist/index.d.ts`: exports `fakeModel`, `FakeToolCallingModel`, `modelRetryMiddleware`, `modelFallbackMiddleware`.
30. LangSmith docs, "Threads" (metadata `session_id` / `thread_id` on all runs, Threads tab and Turns view) and "Query threads" (`client.listThreads`). https://docs.langchain.com/langsmith/threads and `/query-threads`. langsmith 0.9.0 installed (pinned); latest 0.11.0 (2026-10-15).
31. LangSmith docs, pytest "Caching" (`LANGSMITH_TEST_CACHE`, cassettes; Python `langsmith[pytest]`) and "Vitest and Jest". https://docs.langchain.com/langsmith/pytest and `/vitest-jest`. Local check: grep for `TEST_CACHE|cassette` in installed `langsmith` 0.9.0 `dist` returned nothing.
32. Langfuse docs, "Sessions" ("session replay of the entire interaction", publish, annotate) and "Observability best practices". https://langfuse.com/docs/observability/features/sessions. `@langfuse/tracing` 6.0.0 (2026-10-14).
33. OpenAI Agents SDK JS, "Tracing" (traces: `workflow_name`, `trace_id`, `group_id`; spans: `started_at`, `ended_at`, `parent_id`, `span_data`; `addTraceProcessor`, `setTraceProcessors`). https://openai.github.io/openai-agents-js/guides/tracing. `@openai/agents` 0.20.0 (2026-10-08).
34. AgentOps docs (Session Drilldown / "Session Waterfall"; timeline, tree and message views; "Session Replay: Step-by-step playback"). https://github.com/agentops-ai/agentops (`llms.txt`, `docs/v2/concepts/*.mdx`). npm `agentops` (JS) 0.1.0, released 2025-06-05.
35. AutoGen 0.2 docs, AgentOps page ("Time Travel Debugging: Save snapshots of session states to rewind and replay agent runs from chosen checkpoints"). https://microsoft.github.io/autogen/0.2/docs/ecosystem/agentops/.
36. Vercel AI SDK 7 docs, UI message stream protocol (SSE `data: {"type":"text-delta",…}`, header `x-vercel-ai-ui-message-stream: v1`, `start-step`, `data-*` parts) and Testing (`simulateReadableStream({ initialDelayInMs, chunkDelayInMs, chunks })`). https://github.com/vercel/ai/blob/ai@7.0.0/content/docs/04-ai-sdk-ui/50-stream-protocol.mdx and `03-ai-sdk-core/55-testing.mdx`. `ai` 7.0.143 (2026-10-16).
37. Martin Fowler, "Event Sourcing" (Complete Rebuild, Temporal Query, Event Replay; gateways disabled during replay; remembered query responses). https://martinfowler.com/eaaDev/EventSourcing.html (2005).
38. asciinema, asciicast v3 format (`[interval, code, data]`, relative intervals, `idle_time_limit`, marker events `m`). https://docs.asciinema.org/manual/asciicast/v3/.
39. rrweb canvas recipe (`recordCanvas`, `sampling.canvas` fps, `dataURLOptions`, `UNSAFE_replayCanvas`, which adds `allow-scripts` to the replay iframe). https://github.com/rrweb-io/rrweb/blob/main/docs/recipes/canvas.md. rrweb / @rrweb/record / rrweb-player 2.1.7 (2026-10-02).
40. rrweb guide (record options table, `checkoutEveryNth` / `checkoutEveryNms`). https://github.com/rrweb-io/rrweb/blob/main/guide.md.
41. rrweb `packages/rrweb/src/record/observers/canvas/canvas-manager.ts`. In FPS mode it uses `createImageBitmap`, a worker, and `if (context?.getContextAttributes()?.preserveDrawingBuffer === false) context.clear(context.COLOR_BUFFER_BIT)` for WebGL. In "all" mode it records 2D/WebGL API calls. (main, read 2026-10-17.)
42. rrweb `docs/replay.md` ("Play from any point in time": the chain before the start time runs synchronously, the rest asynchronously) and `rrweb-player` README (`speed`, `speedOption [1,2,4,8]`, `setSpeed`, `goto(timeOffset, play?)`, `toggleSkipInactive`). https://github.com/rrweb-io/rrweb.
43. Playwright docs, Videos (`video: 'on' | 'retain-on-failure' | …`, size defaults to the viewport scaled to fit 800×800, `show.actions`) and `recordVideo`. https://playwright.dev/docs/videos and `/docs/api/class-testoptions`. playwright 1.64.1 (2026-10-14).
44. Playwright release notes, trace `snapshots: { dom, aria, screen }`. https://playwright.dev/docs/release-notes.
45. Playwright docs, HAR mocking ("HAR replay matches URL and HTTP method strictly. For POST requests, it also matches POST payloads strictly"), `routeFromHAR` (`notFound: "abort"|"fallback"`, default abort; `update`), and `route.fulfill` (`body: string | Buffer`). https://playwright.dev/docs/mock, `/docs/api/class-page`, `/docs/api/class-route`.
46. Playwright docs, Clock (`page.clock.install`, `pauseAt`, `fastForward`). https://playwright.dev/docs/clock.
47. Vitest 5 `vi` API (`vi.setSystemTime`: "If fake timers are not enabled, this method will only mock `Date.*` and `Temporal.Now.*` calls"; `vi.useFakeTimers({ toFake })`). https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/api/vi.md. vitest 5.0.5 installed.
48. Installed `@rive-app/react-canvas` 4.36.0 → `@rive-app/canvas` 2.44.0 README: "High-level Rive API using CanvasRenderingContext2D".
49. Agent Teams source, read-only at 2026-10-17:
    - `src/app/api/chat/route.ts`: `callCrusoe` with global `fetch` and jittered retries at :19-38; `today` at :117; `uuid7()` trace id at :146; model fallback chain at :157-161.
    - `src/server/runtime/models.ts` (`crusoe(model, { fetch })`).
    - `src/server/cache/bus.ts`, `src/server/cache/index.ts:24` (`dataDir()` = `.data`), `src/app/api/events/route.ts`.
    - `src/lib/ledger.ts:54` (`record()`).
    - `src/lib/chief-prompt.ts:57-72`: SOUL.md, MEMORY.md, "Today is", and ledger performance go into the prompt.
    - `src/components/AgentTeams.tsx`: `send()` → `fetch("/api/chat")` at :262-315; heartbeat at :358-364.
    - `src/lib/skills/compose.ts:59-65` (`randomUUID`, `now`).

## Cassettes at the HTTP seam

### What the seam has to carry

Model calls leave the app through two paths:

- **Agent runtime.** `crusoe(model, { fetch })` passes `fetch` into the OpenAI SDK, which calls `this.fetch.call(undefined, url, init)` with a JSON string body [18, 49]. Every ChatOpenAI call goes through this function, including fallbacks and summarization. LangGraph's `messages` stream handler sets `lc_prefer_streaming = true`, which turns these into `stream: true` SSE requests [20, 28].
- **Chat route.** `callCrusoe()` POSTs `stream: true, stream_options: { include_usage: true }` with the **global** `fetch` [49]. Today it is not injectable. Making it use the same injected `modelFetch` is a one-parameter change and is a precondition for everything below.

Responses are OpenAI-style SSE. Text, reasoning and tool-call deltas arrive as `data:` lines, and usage arrives in the last chunk. A useful cassette therefore has to replay a **stream**, and for the demo it has to keep **when** each chunk arrived.

### Comparison

"SSE" means: does a recorded streaming response replay as a stream that our parser (and the browser) receives incrementally? "Timing" means: can it reproduce the recorded gap between chunks?

| Tool (version, last release) | Maintained? | Hook point | SSE streaming | Chunk timing | Request matching | On a miss |
|---|---|---|---|---|---|---|
| **Polly.JS** `@pollyjs/core` 6.0.6 (2023-07-20); `adapter-fetch` 6.0.7 (2025-05-31) [16] | **No, effectively.** The last repo push was 2025-05-31. The only release since 2023 un-deprecated the fetch adapter for Node. 61 open issues [15]. | Patches `fetch` on a context object (fetch adapter) | **No.** On passthrough the adapter calls `response.arrayBuffer()` and replays `new Response(responseBody, …)` [13]. The body is fully buffered. Worse, it is buffered **while recording** too, so the live UI loses streaming during a recording session. | **No.** `timing: Timing.relative(n)` scales one whole-response delay, and `timing(time)` gets the recorded response time [12, 14]. | A GUID from `method`, `headers`, `body`, `order` and url parts, all `true` by default. `body(body, req)` can normalize the body. `order: true` is the default, which breaks parallel calls, so it must be set `false` [12]. | Default `recordIfMissing: true` passes through to the paid API and records the result. With `false` it throws "Recording for the following request is not found and `recordIfMissing` is `false`." [12, 14] |
| **nock** 15.0.2 (2026-10-16) [6, 16] | Yes | Global. A BatchInterceptor (ClientRequest + `globalThis.fetch`) from `@mswjs/interceptors` [7] | **Partial.** `reply()` accepts a stream ("A Stream works too", via a callback returning `fs.createReadStream`) [6]. But the recorder reads the finished response and stores the body as a string or hex [6, 7], so a recorded fixture replays as one body. | **No.** Only `delayConnection(ms)` and `delayBody(ms)`, which are whole-body delays [7]. | Method, host and path, plus the recorded request `body`. `filteringRequestBody(regex\|fn)` and `nock.back` `before(def)` (e.g. `delete def.body`) normalize it [7]. Each interceptor is consumed once unless `.persist()`, so identical requests consume entries in recorded order. | Depends on the mode [6]. `dryrun` (default) lets the HTTP call out. `record` records new calls. `lockdown` raises `NetConnectNotAllowedError` "Nock: Disallowed net connect for host:port". |
| **MSW** `msw/node` `setupServer` 3.0.3 (2026-10-10) [8, 16] | Yes. v3 needs Node ≥22 (engines `>=22.12.0`) and renamed `onUnhandledRequest` to `onUnhandledFrame` [9]. | Global interceptors | **Yes, for replay.** A handler can return `new HttpResponse(new ReadableStream(…))` [10]. The `sse()` handler only matches **GET** with `Accept: text/event-stream` [10], so it can't serve OpenAI's POST `/chat/completions`. Use `http.post` with a stream. There is **no built-in recorder**. | **Yes, if you store it.** Put `await delay(ms)` between `controller.enqueue` calls [8]. Recording the gaps is up to you. | You write it: a path pattern plus your own body hash in the resolver. | `onUnhandledFrame` defaults to `'warn'`, which **performs the request as-is**. `'error'` aborts and `'bypass'` is silent [9, 10]. |
| **@mswjs/interceptors** `FetchInterceptor` 0.45.9 (2026-10-17) [11, 16] | Yes | Global, low-level | **Yes.** `controller.respondWith(response)` takes any Fetch `Response`, including a stream body. The `response` event carries a clone of the real response (`responseType: "original"`) that you can read for recording [11]. | **Yes, if you store it.** Timestamp each chunk of the clone as it arrives (see Unverified on clone backpressure). | You write it | A request no listener handles stays PENDING and **passes through to the network**. Failing closed requires an explicit `controller.errorWith()` [11]. |
| **undici MockAgent** (undici 8.12.2, 2026-10-15) [3, 16] | Yes | Global dispatcher. `setGlobalDispatcher` mirrors to `Symbol.for('undici.globalDispatcher.1')` so Node's built-in fetch (bundled undici 7.29.1) uses it [4] | **Partial.** `reply(status, data)` takes a string, Buffer, Object, or a function returning one of those, not a stream [3]. The SSE text arrives in one piece, which the parser handles, but nothing arrives incrementally. | **No.** `delay(ms)` delays the whole reply [3]. | `intercept({ path, method, body: string\|RegExp\|fn, headers, query })` [3]. `times(n)` and `persist()`. | Per the docs example, an exhausted interceptor makes "a real request" attempt. `disableNetConnect()` makes unmatched requests throw [3]. |
| **undici SnapshotAgent** (added v7.13.0, 2025-07-31 [5]; Experimental [1]) | Yes, but experimental. It "emits an ExperimentalWarning" [1]. | Global dispatcher, modes `record` / `playback` / `update` [1] | **Partial.** The snapshot stores the response body as **one base64 string** [2], so playback delivers the whole body at once. | **No.** Only an ISO `timestamp` of when the entry was written [2]. | A hash of `method\|url\|sorted headers\|body` [2]. Options: `matchHeaders`, `ignoreHeaders`, `excludeHeaders` (never written to disk), `matchBody`, `normalizeBody(body)`, `matchQuery`, `normalizeQuery`, `excludeUrls` [1]. Repeated identical requests get `responses[]` indexed by `callCount`, and the last one repeats [2]. | `playback` rejects with an UndiciError starting "No snapshot found". `update` records the miss [1]. |
| **aimock** `@copilotkit/aimock` 1.45.1 (2026-10-12) [16, 17] | Yes | A **separate mock server**: set `CRUSOE_BASE_URL` to `${mock.url}/v1`. Proxy-records with `llmock --record --provider-openai <url>` [17]. | Yes [17] | **Approximate.** "Recorded fixtures capture per-frame arrival timestamps; replay uses recorded timings for approximate timing reproduction based on recorded TTFT and inter-frame cadence". `--replay-speed` multiplier [17]. | Fixture `match`: `turnIndex`, `hasToolResult`, `toolCallId`, `sequenceIndex`, `systemMessage`, custom predicates [17]. | In record mode a miss proxies to the real provider [17]. Pure-replay miss behaviour: unverified. |
| **Hand-rolled wrapper at our injected `fetch`** | It's ours (no dependency) | Exactly our two call paths: `crusoe(model, { fetch })` and `callCrusoe` once it takes the same `modelFetch` [49] | **Yes.** Record by `res.body.tee()`: one branch goes to the caller unchanged, so live streaming is kept while recording. Replay a `ReadableStream`. | **Yes, exact.** Store TTFB plus a `dt` per chunk, and divide by `speed` on replay. | Our canonical key (rules below) | Our choice: **fail closed** (rules below) |

Notes on fit:

- A global interceptor (nock, MSW, undici) also catches LangSmith tracing traffic and any other HTTP, so you have to allow-list hosts. A wrapper at the model `fetch` only sees model traffic, which is the scope we want.
- Only MSW, `@mswjs/interceptors`, aimock and a hand-rolled wrapper can replay **incrementally**. Only aimock (approximately) and a hand-rolled wrapper (exactly) **record** timing.
- **Decision: hand-roll.** It's about 150 lines plus tests, at the seam we already have. If we ever need a global net, `@mswjs/interceptors` is the maintained primitive to build it on. **Don't use Polly**: it is unmaintained and buffers streams. **Don't use SnapshotAgent** for SSE: it is experimental and stores a single body.

### Matching rules (the canonical key)

Build the key from the request alone, after removing everything that varies between runs and doesn't change the model's answer:

1. **URL.** Use the path only (`/chat/completions`), not the host. `CRUSOE_BASE_URL` differs between machines.
2. **Headers.** Ignore all of them. The OpenAI SDK sends `X-Stainless-Retry-Count` (which changes per attempt), `User-Agent`, `X-Stainless-OS` and `X-Stainless-Runtime-Version` (which change per machine), and `Authorization` [18]. Strip `Authorization` from what is stored. This is the same idea as SnapshotAgent's `excludeHeaders` [1].
3. **Body.** `JSON.parse`, keep the semantic fields (`model`, `messages`, `tools`, `tool_choice`, `temperature`, `max_tokens`, `stream`, `stream_options`, `response_format`, reasoning fields), then serialize with sorted keys.
   - **Keep `stream`.** The response format depends on it (SSE vs JSON), and LangGraph's `messages` mode flips it on [20, 28].
4. **Redactions.** Apply a short, named list of regex rewrites to message text before hashing. Each one is justified under Determinism hazards:
   - `Today is <DATE>.` [49]
   - UUID-shaped strings → `<UUID>`
   - ISO timestamps → `<TS>`
   - the chief prompt's ledger-performance block → masked digits [49]

   This is the same mechanism as Polly's `matchRequestsBy.body(body, req)` [12], nock's `filteringRequestBody` [7] and SnapshotAgent's `normalizeBody` [1].
5. `key = sha256(canonical)`. **Store** the canonical request next to the response, so a miss can show a diff.
6. **Order.** Index entries by `(key, occurrence)`. Parallel calls with different bodies match whatever order they arrive in. LangChain's ToolNode runs tool calls with `Promise.all` [29], so deepagents subagents can arrive in any order. Identical bodies (retries) are consumed in recorded order, the way SnapshotAgent's `callCount` [2] and nock's consume-once interceptors [7] work. Polly's `order: true` default [12] is exactly what not to do.

### Miss rules

- **Tests: fail closed, fast and loud.**
  - Return `new Response(JSON.stringify({ error: { message: "cassette miss <key>" } }), { status: 404, headers: { "x-cassette": "miss" } })`.
  - Append the miss to a list that the test asserts is empty.
  - Why 404: LangChain's `AsyncCaller` retries up to 6 times by default but never retries `STATUS_NO_RETRY` codes (400–409, 413) [20]. A thrown network-style error would be retried 6 times with backoff.
  - Print the diff between the missed canonical request and the nearest recorded one (same model, longest common message prefix).
- **Re-record: `CASSETTE=update`.** Replay hits, pass misses through to Crusoe, and append them, like SnapshotAgent `update` [1] and nock `record` [6]. Never let a missed request silently reach the network.
- **Demo: never miss.** A playback demo doesn't run the model path at all (see the next sections). A "live re-run" demo uses `CASSETTE=replay` and stops with a visible banner on the first miss.

### Sketch of the wrapper (shape only)

```ts
// src/server/runtime/cassette.ts (proposed)
type Entry = {
  key: string; n: number;                       // n-th occurrence of this key in the recording
  at: number;                                   // ms since tape t0 when the request started
  req: unknown;                                 // canonical, redacted request (for diffs)
  res: { status: number; headers: Record<string, string>; ttfbMs: number; chunks: [dtMs: number, b64: string][] };
};

export function recordingFetch(inner: typeof fetch, sink: (e: Entry) => void, t0: number): typeof fetch {
  return async (input, init) => {
    const started = performance.now();
    const res = await inner(input, init);
    const ttfbMs = performance.now() - started;
    if (!res.body) return res;
    const [mine, theirs] = res.body.tee();                 // caller keeps streaming live
    void drain(mine, ttfbMs, started).then((chunks) => sink({ /* key, n, at: started - t0, req, res */ } as Entry));
    return new Response(theirs, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

export function replayFetch(cassette: Cassette, { speed = 1 }: { speed?: number } = {}): typeof fetch {
  return async (input, init) => {
    const e = cassette.take(keyOf(input, init));            // (key, occurrence) lookup
    if (!e) return cassette.miss(input, init);              // 404 + log + diff
    const wait = (ms: number) => (speed === Infinity ? Promise.resolve() : sleep(ms / speed, init?.signal));
    await wait(e.res.ttfbMs);
    const body = new ReadableStream<Uint8Array>({
      async start(c) { for (const [dt, b64] of e.res.chunks) { await wait(dt); c.enqueue(base64ToBytes(b64)); } c.close(); },
    });
    return new Response(body, { status: e.res.status, headers: e.res.headers });
  };
}
```

Store raw bytes per network chunk, not parsed SSE events. Our SSE parsers then see the same chunk boundaries, including events split across chunks and multibyte UTF-8 split across chunks. `@langchain/core/utils/testing` has `sseResponseFromOpenAIChunks(chunks): Response` and `openAIToolCallChunks()` [20]. They are handy for unit-testing the parser and the replay path without a recorded file.

## LangChain/LangGraph-native options

| Option (API, version) | Runs the real code? | Calls the LLM? | Re-runs tool side effects? | Streams tokens? | Keeps timing? | Good for |
|---|---|---|---|---|---|---|
| `fakeModel()` from `langchain` / `@langchain/core/testing` (core 1.2.18): `.respond(msg\|Error\|fn)`, `.respondWithTools([...])`, `.alwaysThrow`, `.structuredResponse`, `.calls`, `.callCount` [20, 21] | Graph and tools yes. **Not** ChatOpenAI, HTTP or SSE parsing (the model object is replaced). | No | **Yes**, tools run for real | No. It has no `_streamResponseChunks`, so `.stream()` yields one chunk [20] | No | Unit tests of agent control flow: did it call the tool, handle the error, stop? FIFO, not keyed by input [20]. |
| `FakeListChatModel({ responses, sleep, emitCustomEvent })` [20, 22] | Same as above | No | Yes | Yes, with a uniform `sleep` | Uniform only | UI or stream plumbing smoke tests |
| `FakeStreamingChatModel({ chunks, responses, sleep, toolStyle })` [20] | Same as above | No | Yes | Yes, exact `AIMessageChunk[]` including tool-call deltas | Uniform `sleep` | Testing tool-call delta handling |
| LLM cache: `new ChatOpenAI({ cache })` with `InMemoryCache` / `BaseCache` (`lookup(prompt, llmKey)`, `update`, `makeDefaultKeyEncoder(fn)`; default key `sha256(prompt + "_" + llmKey)`) [20] | Yes | Only on a miss | Yes | **No on a hit.** The cache is consulted only in `generate()`. `_streamIterator` (`.stream()`) skips it. A hit inside a LangGraph stream returns the whole message at once (`handleLLMEnd … { cached: true }`) [20]. | No | A cheap dev loop. **Not a cassette**: exact-match on the serialized prompt, no SSE, no timing, and `.stream()` bypasses it. |
| LangGraph node cache: `addNode(name, fn, { cachePolicy: { keyFunc, ttl } })` + `compile({ cache: new InMemoryCache() })` (`InMemoryCache` from `@langchain/langgraph-checkpoint`) [26, 28] | Skips the cached node | Not for cached nodes | Not for cached nodes | No for cached nodes | No | Expensive deterministic nodes. deepagents builds its own graph, so we don't control its model node's `cachePolicy` (Unverified). |
| Checkpoint history: `graph.getStateHistory(config)` → `StateSnapshot { values, next, config, metadata{source,step,parents}, createdAt, parentConfig, tasks }` [23, 28] | No (read only) | No | No | No | `createdAt` per super-step | **Seek keyframes and inspection** at super-step granularity, for free |
| Replay: `graph.invoke(null, snapshot.config)` [23, 24] | Yes, from the checkpoint on | **Yes.** "Nodes after the checkpoint re-execute, including any LLM calls, API requests, and interrupts (which may produce different results)" [23] | **Yes**, after the checkpoint. Not before. Successful same-super-step tasks are restored from pending writes [24]. | Live | Live | Retrying from a step. With L1 underneath it becomes zero-token. |
| Fork: `graph.updateState(snapshot.config, values)` → `invoke(null, forkConfig)` [23] | Yes | Yes | Yes, after the fork | Live | Live | A "what if" demo feature ("fork here"). It costs tokens unless the cassette serves it. |
| `streamEvents(input, { version: "v3" })`, optionally `encoding: "text/event-stream"` [27, 28] | n/a (a stream) | n/a | n/a | Yes | **Yes.** Each `ProtocolEvent` has `seq` and `params.timestamp` (ms), plus `namespace` and `node` [28]. | **The R5 wire and the tape payload** (next section) |

What the native options can't do:

- **None of them records and replays the real HTTP exchange.** The fakes replace the model object, so ChatOpenAI request building, SSE parsing, usage extraction, the Crusoe quirks in `reasoningFields`, and the chat route's own parser are never exercised.
- **Checkpoint replay is not zero-token, and it re-runs tool side effects** after the chosen checkpoint: vault writes, ledger rows, MEMORY.md edits [23, 24]. LangGraph's own determinism guidance is to put side effects and non-deterministic values in `task()`, so that resuming restores them instead of recomputing [25]. That is Fowler's "remember the responses to queries" rule [37], applied inside the graph.
- LangSmith's HTTP cassette feature (`LANGSMITH_TEST_CACHE`) exists only for the Python pytest plugin [31]. The installed JS `langsmith` 0.9.0 has no equivalent (local grep [31]).

**Use:** `fakeModel` for unit tests of graph logic. The checkpoint history as free keyframes for seeking, plus a "fork from here" feature. `streamEvents` v3 as the stream we record. Nothing native as the regression cassette.

## App-event tape and playback

### Established patterns to borrow

- **Event sourcing** [37]: state = fold(events). This gives "Complete Rebuild", "Temporal Query" (state at any time t) and "Event Replay". The key rule for us: during replay, wrap external systems in **gateways that are disabled**, and "remember the responses to its queries". In practice:
  - A playback must not POST `/api/chat`, write the vault or call Crusoe.
  - A re-run must get model answers from the cassette.
- **asciicast v3** [38]: NDJSON with a header line, then `[interval, code, data]` events. It also has `idle_time_limit` (compress long gaps) and marker events `m` (chapters). This is the closest precedent for "1x / 4x / instant with idle compression".
- **rrweb seeking** [42]: to start at time T, run everything before T synchronously, then schedule the rest normally. Periodic full snapshots (`checkoutEveryNms`) [40] keep that cheap. rrweb-player exposes `setSpeed`, `goto(ms, play?)`, `toggleSkipInactive`, `speedOption [1,2,4,8]` [42].
- **LangGraph v3 `ProtocolEvent`** [28]: `{ type:"event", seq, method, params:{ namespace, timestamp, node?, data } }`, where `method` is a stream mode, `lifecycle`, `input` or a custom channel. It is already ordered and timestamped, so we wrap it rather than reinvent it.
- **Vercel AI SDK UI message stream** [36]: SSE `data: {"type":"text-start"|"text-delta"|"text-end"|"tool-input-start"|"start-step"|"finish"|"data-*",…}` with `x-vercel-ai-ui-message-stream: v1`. Its test helper `simulateReadableStream({ initialDelayInMs, chunkDelayInMs, chunks })` [36] shows the weak form of timing: one fixed delay between chunks. We want recorded per-event `t`. The part taxonomy (start/delta/end per message, tool input/output, `data-*` for app parts) is a good model for our message events.

### How agent observability products present "session replay"

| Product | Unit of replay | Presentation | Re-drives your UI? |
|---|---|---|---|
| AgentOps [34, 35] | Session = trace of spans | **Session Waterfall**: a time view of LLM calls, actions, tool calls and errors on the left, the selected event's prompt and completion on the right. Timeline, tree and message views. "Session Replay: step-by-step playback". "Time Travel Debugging: save snapshots of session states to rewind and replay … from chosen checkpoints" (AutoGen page). | No. It's a viewer. The JS package `agentops` 0.1.0 dates from 2025-06-05, so it's Python-first. |
| Langfuse [32] | Session = traces sharing `sessionId` | "Session replay" of the whole interaction in sequence. Publish as a public link, bookmark, annotate with scores. Agent graphs per trace. | No |
| LangSmith [30] | Thread = root runs sharing `session_id`/`thread_id` metadata, which must be on **all** runs | Threads tab and Turns view. `client.listThreads` returns runs per thread with `min_start_time`/`max_start_time`. | No |
| OpenAI Agents SDK [33] | Trace (`group_id` links a conversation's traces) | Spans with `started_at`/`ended_at`, `parent_id` and typed `span_data` (agent, generation, …), shown in the OpenAI Traces dashboard. Custom processors via `addTraceProcessor` / `setTraceProcessors`. | No |

All four have the same shape: a **read-only timeline or waterfall plus a detail pane**, with span-level timing (start and end), not token-chunk timing. None of them plays a run back into *your* product UI. So for the demo we build our own playback. These products are still worth borrowing from for a debug view: a waterfall of `dur` spans with a detail pane over the same tape.

### Proposed tape record shape

One NDJSON file per run (`.data/tapes/<tapeId>.jsonl`). Line 1 is the header and every other line is one event. App types (`View`, `OrderKey`, `AgentStatus`, `LedgerEvent`) are the existing ones from `src/lib`. `ProtocolEvent` is the shape from `@langchain/langgraph` 1.5.0 `dist/stream/types.d.ts` [28].

```ts
export interface TapeHeader {
  kind: "header";
  v: 1;
  tapeId: string;               // uuid7, minted once at record time
  title: string;
  recordedAt: string;           // ISO wall clock at t = 0
  durationMs: number;           // t of the last event, written when the tape closes
  clock: "monotonic";           // every t comes from performance.now() - t0, never from Date
  idleCapMs?: number;           // playback shortens any gap longer than this (asciicast idle_time_limit)
  app: { commit: string; promptHash: string };      // a mismatch warns before a re-run
  fixtures: { vault: string; ledger: string };      // copies of .data at t = 0, so a re-run starts from the same files
  cassette?: string;            // the L1 file recorded alongside, for zero-token re-runs
  markers: { t: number; label: string }[];          // chapters for the scrubber
  keyframeEveryMs: number;      // how often a "keyframe" event was written (for seeking)
}

interface Timing {
  seq: number;                  // total order across the run; equal t keeps seq order
  t: number;                    // ms since t = 0 on the recorder's monotonic clock: the only field playback schedules on
  wall?: number;                // epoch ms for display ("10:42"); never used for scheduling
  dur?: number;                 // span events: how long it took when recorded (model call, tool), so "instant" can still say "took 3.2 s"
}

interface Scope {
  run?: string;                 // server run id / LangGraph thread_id
  agent?: string;
  team?: string;
  ns?: string[];                // LangGraph namespace (subagent path), from ProtocolEvent.params.namespace
  cause?: number;               // seq of the event that caused this one (owner message -> reply)
}

export type TapeEvent = Timing & Scope & (
  // owner actions: shown in playback, never re-sent (Fowler's disabled gateway)
  | { kind: "owner.send"; view: View; text: string; images?: number }
  | { kind: "owner.order"; agent: string; order: OrderKey; trace?: string }
  | { kind: "owner.approval"; agent: string; decision: "approved" | "declined" }
  | { kind: "owner.navigate"; view: View }               // optional: the demo follows the owner's clicks
  // agent activity
  | { kind: "agent.status"; status: AgentStatus; line?: string }
  | { kind: "agent.plan"; todos: { text: string; done: boolean }[] }
  | { kind: "msg.start"; msgId: string; view: View }
  | { kind: "msg.delta"; msgId: string; text: string }    // one per received chunk, each with its own t
  | { kind: "msg.end"; msgId: string; usage?: { input: number; cached: number; output: number }; trace?: string }
  | { kind: "tool.call"; callId: string; name: string; args: unknown }
  | { kind: "tool.result"; callId: string; ok: boolean; summary: string }
  // state changes
  | { kind: "ledger"; row: LedgerEvent }                  // the row exactly as record() wrote it
  | { kind: "bus"; topic: string; version: number }       // cache change notices, as /api/events sends them
  | { kind: "lg"; event: ProtocolEvent }                  // raw LangGraph v3 event, once R5 streams them
  | { kind: "model.http"; key: string; n: number; status: number; ttfbMs: number }  // pointer into the L1 cassette
  // playback aids
  | { kind: "marker"; label: string }
  | { kind: "keyframe"; state: UiSnapshot }               // full UI state (convos, statuses, teams) every keyframeEveryMs
);
```

How the timing fields give every speed:

- **1x:** wait `t[i] - t[i-1]` before emitting event i.
- **4x:** wait `(t[i] - t[i-1]) / 4`.
- **Idle cap:** wait `min(gap, idleCapMs) / speed`. A 40-second model think plays as at most `idleCapMs`. The typing indicator still shows, because `agent.status` events carry it.
- **Instant:** `speed = Infinity`. Emit back to back, but yield to the event loop every N events so React paints. Optionally merge consecutive `msg.delta` events of one `msgId` into one. `dur` still lets the UI print the recorded durations.
- **Seek to T:** take the last `keyframe` with `t ≤ T`, apply it, fold every event after it up to T with no delay (rrweb's method [42]), then schedule the rest at the current speed. Markers give chapter jumps.
- **Pause / resume:** the player keeps a virtual time `v`. Pausing freezes `v`, and resuming schedules from `v`.

```ts
async function* play(tape: TapeEvent[], o: { speed: number; from: number; idleCapMs: number; signal: AbortSignal }) {
  let i = lastKeyframeAtOrBefore(tape, o.from);
  let prev = o.from;
  for (; i < tape.length; i++) {
    const e = tape[i];
    if (e.t > o.from && o.speed !== Infinity) await sleep(Math.min(e.t - prev, o.idleCapMs) / o.speed, o.signal);
    if (e.t > prev) prev = e.t;
    yield e;                                  // events before `from` flush with no delay
  }
}
```

### Where it records and where it plays

- **Record (server, R5).** Tee the R5 SSE writer: every frame the run streams to the browser is also appended to the tape with `t = performance.now() - t0`. Also tap:
  - `record()` in `src/lib/ledger.ts:54` → `ledger` events.
  - `Bus.emit` in `src/server/cache/bus.ts` → `bus` events.
  - the model `fetch` wrapper → `model.http` pointers into L1.
- **Record (client, today, before R5).** Owner actions come from `send()` in `src/components/AgentTeams.tsx:262`, plus the order and approval POSTs. Message deltas come from the stream reader at `:315`, where each `reader.read()` value becomes `msg.delta` with `t`. The client batches these to a small `POST /api/tapes/:id` endpoint.
- **Play.** Add `GET /api/replay/:tapeId?speed=4&from=12000`. It streams the tape's frames in the **same SSE format as the live R5 stream** (or as `/api/events` for `bus` notices). Write each frame with `id: <seq>`, so a dropped connection reconnects with `Last-Event-ID` and resumes. The live UI consumes it with unchanged code, so the Rive mascots, Streamdown and the panels all run for real.
  - `owner.*` events render as if the owner had typed them but are **not** re-sent.
  - Before R5, the same idea runs on the client: a "replay transport" stands in for `fetch("/api/chat")` inside `send()` and returns a `Response` whose body streams the recorded deltas.

## UI-level recording

| Method | What it captures | Canvas (Rive) | Cost | Seek / speed | When it's the right tool |
|---|---|---|---|---|---|
| **rrweb 2.1.7** (`@rrweb/record`, `@rrweb/replay`, `rrweb-player`) [39–42] | A DOM snapshot plus mutations, as `{ type, data, timestamp }` events. Streamdown output is plain DOM, so it's captured fine. | Only with `recordCanvas: true` [40]. Two modes [41]: (a) default `"all"` records 2D/WebGL API calls; (b) `sampling: { canvas: N }` takes `createImageBitmap` snapshots at N fps in a worker, encoded per `dataURLOptions` (e.g. `image/webp`, `quality: 0.6`) [39]. Our Rive runtime is `@rive-app/canvas` 2.44.0, which uses `CanvasRenderingContext2D` [48]. For WebGL canvases with `preserveDrawingBuffer === false`, rrweb calls `context.clear(COLOR_BUFFER_BIT)` [41]. Replaying canvas needs `UNSAFE_replayCanvas: true`, which adds `allow-scripts` to the replay iframe [39]. | The DOM part is small. Canvas snapshots dominate: one image per canvas per frame (size: Unverified). API-call mode on Rive's per-frame drawing is likely heavy (Unverified). | Built in: `speed`, `goto(ms)`, skip inactive, `speedOption [1,2,4,8]` [42] | Bug reports from a real user session, or "what did the screen look like". It replays inside a sandboxed iframe, **not the live app**: no interaction, and no CSS changes or new components after recording. |
| **Playwright 1.64.1 video** [43] | Pixels of the page (webm), modes `on`, `retain-on-failure`, … | Yes (pixels) | One video per test. Size defaults to the viewport scaled to fit 800×800 [43]. | Seeking only in the video player. Speed is fixed at recording time. | A shareable clip of a **tape playback**: run `/api/replay/:id?speed=4` under Playwright and keep the video for a deck or README. `show.actions` annotations help [43]. |
| **Playwright trace viewer** [44] | Per action: DOM, aria and screen snapshots, plus network, console and timeline | Screenshots only | Per test | Step by step | Debugging e2e failures. Not a demo. |
| **Playwright HAR / `routeFromHAR`** [45] | Browser network | n/a | Small | n/a | Matches URL and method strictly, and POST payloads strictly. `notFound` defaults to `abort`. `route.fulfill` takes `body: string \| Buffer` [45], so **a browser-level cassette for `/api/chat` delivers the reply in one piece and the streaming look is lost.** Use only for non-streaming fixtures. |
| **OS screen capture** (QuickTime, OBS) | Pixels | Yes | Manual | Video player | One-off marketing video. Zero integration and full fidelity, but no event seeking and nothing to re-run. |

**DOM or video recording beats replaying events into the live app when:**

- the UI the viewer must see is not ours to re-render (a user's session, an old build), or
- the artifact must play without our server (a slide, a tweet, an email), or
- it's a bug report and pixel truth matters more than interactivity.

**Replaying events into the live app beats recording when:**

- the demo should be **interactive**: clicking into a panel mid-playback, changing speed, jumping to a chapter, forking;
- it should survive UI changes, since the same tape plays in tomorrow's UI;
- Rive should animate natively, with no canvas capture cost;
- the file should be KB of events instead of MB of video.

Agent Teams' demo is the second case.

## Determinism hazards

| Hazard (where in our code) | What breaks | Fix |
|---|---|---|
| Wall-clock date in prompts: `today` at `chat/route.ts:117` → "Today is …" in `chief-prompt.ts:63` [49] | Cassette key changes daily | Inject `now()` into prompt builders (compose already takes `deps.now` [49]). In tests, `vi.setSystemTime(header.recordedAt)`, which only mocks `Date.*` when fake timers are off, so streaming timers stay real [47]. Also redact `Today is <DATE>.` in the key as a backstop. |
| Ledger-derived numbers in the chief prompt ("Performance from the ledger", roster calls, `chief-prompt.ts:68-72`) built from `readLedger()`, whose rows carry `ms` latencies and costs [49] | The prompt depends on earlier calls' latencies. In replay, latencies differ, so the key changes. | Restore the ledger fixture from the tape header before a re-run. Mask digits inside that block in the key. Better: in replay, the cassette returns recorded `ttfbMs`/chunk times and the route's `ms` derives from an injected clock advanced by the recording, so the ledger rows match exactly. |
| Agent files in prompts (SOUL.md, MEMORY.md) that agents rewrite during a run (`chief-prompt.ts:57-61`) [49] | Run N+1 sees run N's memory edits | Copy the vault at t = 0 into `fixtures.vault`. A re-run sets `VAULT_DIR` to a temp copy. `.data` itself is hard-coded in `src/server/cache/index.ts:24` and would need an env override (proposal). |
| Random ids: `uuid7()` trace ids (`route.ts:146`), client `uid()` (`AgentTeams.tsx`), `randomUUID` in `compose.ts:59`, LangChain run ids (`run-<runId>` on chunks [20]), LangGraph checkpoint ids (`uuid6` [28]) | They change every run. Today they don't reach the Crusoe body as far as we know (deepagents is unverified). | The key replaces UUID-shaped strings with `<UUID>`. Playback uses the **recorded** ids from the tape (never regenerate). Tests assert on content, not ids. |
| Parallel calls: LangChain ToolNode runs tool calls with `Promise.all` [29], and deepagents `task` subagents run concurrently | Arrival order varies, so order-based matching (Polly's default `order: true` [12]) fails | Match by `(key, occurrence)`, not by order. The tape keeps the recorded interleaving through `t`/`seq` for the demo. Tests must not assert on interleaving across agents. |
| Retries with identical bodies: `callCrusoe` retries 429/503 with `1000 * 2**attempt + Math.random()*400` ms (`route.ts:33`) [49]; LangChain `AsyncCaller` `maxRetries` defaults to 6 [20] | The same key appears several times. Jitter makes timing random. | Record every attempt, including 429/503 responses, indexed by occurrence (like SnapshotAgent's `responses[]` [2]). Make the retry `sleep` injectable and scale it by playback speed. Tests run at `speed = Infinity`. |
| Fallbacks: main ↔ advisor chain (`route.ts:157-161`) [49]; `modelFallbackMiddleware` in langchain [29] | A different model is called after a failure | The `model` field is in the key, so the fallback request is its own entry. The recorded 503 reproduces the same fallback path. |
| Stream vs invoke: LangGraph's `messages` handler has `lc_prefer_streaming = true`, so ChatOpenAI sends `stream: true` [20, 28]; plain `invoke` without it doesn't | The same logical call has different bodies and different response formats (SSE vs JSON) | Keep `stream`/`stream_options` in the key. Record and replay with the same `streamMode`. |
| Varying headers: `X-Stainless-Retry-Count`, `User-Agent`, `X-Stainless-OS` / `-Runtime-Version`, `Authorization` [18] | Header-matching tools miss across machines and attempts (SnapshotAgent and Polly match headers by default [1, 12]) | Never key on headers. Strip `Authorization` from stored files. |
| Heartbeat timer: the chief's check-in "shortly after load, then every 20 minutes" (`AgentTeams.tsx:358-364`) [49] | Extra, timing-dependent requests in a re-run | Disable it in replay mode, or record it as an event (`owner.send` with `heartbeat`) and only replay it from the tape. |
| `temperature: 0.8` (`route.ts`) | Re-recording one call gives a different answer, and later calls in the tape then miss | Treat a tape as one sample. Re-record the **whole** run, never patch single entries. The header's `commit`/`promptHash` warn when code drifted. |
| Prompt or code changes | Misses, by design | Diff-on-miss output, plus `CASSETTE=update` to append new exchanges deliberately |
| Fake timers | `vi.useFakeTimers()` also fakes `setTimeout`, so streaming replay and SSE heartbeats hang | Fake only the clock: call `vi.setSystemTime` without `vi.useFakeTimers()`, which mocks only `Date.*` [47] |
| Browser clock in e2e: client `now()` stamps on messages, the heartbeat schedule (`AgentTeams.tsx`) | Screens and recorded `wall` values differ run to run | In Playwright, `page.clock.install({ time })` before `goto`, then `pauseAt` / `fastForward` as needed [46] |
| Chunk boundaries and UTF-8 splits | Re-chunking on replay hides parser bugs | Store raw bytes per network chunk (base64), not parsed SSE events |
| Abort mid-stream (owner navigates away, `req.signal`) | Replay keeps writing to a dead stream | `replayFetch` honours `init.signal`, and the replay endpoint stops on `req.signal` abort, like `/api/events` does [49] |
| Wall clock jumps (sleep/NTP) during recording | Negative or huge gaps | `t` comes from `performance.now()` (monotonic). `wall` is display-only. |

## Recommendation for Agent Teams

**In three lines:**
1. Record every model exchange with the hand-rolled cassette (L1) at the injectable `fetch`. It serves the regression tests: zero tokens, real code.
2. Record the run's own stream as the app-event tape (L2), using R5's SSE wire format with `t`/`seq`/`dur`. It serves the demo: 1x, 4x, instant and seek, played into the unchanged live UI.
3. Use checkpoints for keyframes and "fork here", `fakeModel` for graph unit tests, and Playwright video only for shareable clips.

### Which layer records what, and where it plugs in

| Layer | Records | Plugs into (exact seam) | Serves |
|---|---|---|---|
| **L1 HTTP cassette** (new `src/server/runtime/cassette.ts`, no dependency) | Every model HTTP exchange: canonical redacted request, status, headers without auth, TTFB, raw chunks with `dt` | (1) `crusoe(model, { fetch })` in `src/server/runtime/models.ts`: pass `recordingFetch`/`replayFetch`. (2) `callCrusoe()` in `src/app/api/chat/route.ts`: change its global `fetch` to the same shared `modelFetch`. Mode is chosen by env: `CASSETTE=off\|record:<file>\|replay:<file>\|update:<file>`. | **Regression tests.** Vitest restores fixtures, sets the clock, installs `replayFetch(…, { speed: Infinity })`, drives the recorded owner actions through the real route handlers or the R5 run function, and asserts zero misses plus equal ledger rows (minus `at`/`ms`) and final messages. It is also an optional "live re-run" demo mode at real speed. |
| **L2 app-event tape** (`.data/tapes/*.jsonl`, type above) | Owner actions, agent status, plans, message deltas, tool calls, ledger rows, bus notices, markers, keyframes, with `seq`/`t`/`wall`/`dur` | Server: the R5 SSE writer (tee each frame), `record()` in `src/lib/ledger.ts:54`, `Bus.emit` in `src/server/cache/bus.ts`. Client (before R5): `send()` and its stream reader in `src/components/AgentTeams.tsx:262-315`. | **The demo.** `GET /api/replay/:tapeId?speed=&from=` re-emits frames over the same SSE protocol as R5 / `/api/events`, with `id: <seq>` for resume. The UI gets a speed control (1x / 4x / instant), a scrubber with markers, and pause. |
| **L3 LangGraph checkpoints** (existing `@langchain/langgraph-checkpoint-sqlite` 1.1) | State per super-step (already durable) | The thread's checkpointer. `getStateHistory` for keyframes. `updateState` + `invoke(null, cfg)` for forks. | Seek keyframes in an inspector view. A "fork from here" demo button, served by L1 in `update` mode so only the new branch costs tokens. |
| **L4 video** (Playwright 1.64.1 `video: 'on'`) | Pixels of an L2 playback | An e2e spec that opens `/api/replay/...?speed=4` | Clips for decks and READMEs only |

### Build order (each step is testable on its own)

1. **`modelFetch` + `cassette.ts`.**
   - Tests use `sseResponseFromOpenAIChunks` fixtures [20]: a recorded SSE stream replays byte-identical.
   - A miss returns 404 with a diff.
   - `speed` scales the gaps.
2. **Record one golden run** against Crusoe. This is the only paid step. Then write a vitest re-run test that fails if any request or parsed output changes.
3. **Tape recorder on the R5 writer, plus the ledger and bus taps.** Write keyframes every ~10 s.
4. **`/api/replay/:tapeId` and the player controls.** Owner actions render but are never re-sent.
5. **Playwright video of a 4x playback**, only if a clip is wanted.

**What not to do:**
- Don't adopt Polly.JS (unmaintained since 2023, buffers streams even while recording [13, 15]).
- Don't use SnapshotAgent or MockAgent for SSE timing (one body, no timing [1–3]).
- Don't treat the LangChain LLM cache as a cassette (`.stream()` bypasses it, and hits don't stream [20]).
- Don't treat LangGraph replay as free (it re-calls the LLM and re-runs tools after the checkpoint [23]).
- Don't make rrweb the demo: it needs canvas capture plus `UNSAFE_replayCanvas`, and it isn't the live app [39].

## Unverified

- **SnapshotAgent in `record` mode:** whether it streams chunks to the caller or buffers first. Only the stored format (one base64 body) was confirmed [2].
- **nock recorder with native fetch streaming:** whether the app still receives incremental chunks while nock records.
- **Polly's node-http adapter internals:** not checked. Only the fetch adapter was read [13].
- **`@mswjs/interceptors` `response` clone:** whether reading the clone slowly applies backpressure to the original response, which is a property of `Response.clone()` tee semantics.
- **aimock:** its miss behaviour in pure replay (without `--record`), and how faithful the chunk count and per-chunk timing are. The README says "approximate" [17].
- **deepagents 1.15.0 request bodies:** whether they ever contain random ids or timestamps (todo ids, subagent ids, file timestamps). The diff-on-miss output will reveal any. Also not checked: whether deepagents exposes a way to set `cachePolicy` on its model node.
- **`FakeToolCallingModel`:** the `langchain` 1.5.18 export was seen, but its options were not read.
- **rrweb canvas payload size** for our Rive mascots at 10–15 fps (webp 0.6), and the CPU cost of API-call mode on Rive's per-frame 2D drawing. Not measured.
  - The installed `@rive-app/canvas` bundle contains `getContext("webgl")` strings, so some feature may use WebGL despite the 2D README [48]. If it does, rrweb's WebGL `clear()` workaround [41] could cause flicker.
- **Playwright video** frame rate and codec details beyond the documented size defaults [43].
- **Langfuse "session replay" and AgentOps "Session Replay":** whether they are timed playback or a sequential list. Docs wording only [32, 34]; the products weren't tried.
- **LangSmith JS 0.11.0:** whether it added an HTTP cache like Python's `LANGSMITH_TEST_CACHE`. Only 0.9.0 was grepped [31].
- **Other LLM VCR tools** seen only in search results and not evaluated: `9osiris/cassette`, `faisalkhan91/Cassette`, `@node-llm/testing` 0.6.0 (2026-10-03), `vcr-test` 1.4.2 (2026-08-28).
- **MSW 3 inside the Next.js server runtime** (e.g. `instrumentation.ts`): not checked. MSW is only considered here for vitest.
- **Cassette size:** about 0.2–0.3 MB per 1,500-token streamed call (roughly 150–200 B of SSE JSON per chunk). This is arithmetic, not measured.
- **`vi.useFakeTimers({ toFake: ['Date'] })`:** not confirmed as a valid value. The docs list timer APIs plus `Date` among what fake timers wrap [47], but don't show `'Date'` as a `toFake` entry. The recommendation relies on `vi.setSystemTime` alone.
- **SSE `id:` / `Last-Event-ID` resume** for `/api/replay`: this comes from the SSE web standard, not a library. The browser's `EventSource` does it automatically. A `fetch`-based reader would have to send the header itself.
