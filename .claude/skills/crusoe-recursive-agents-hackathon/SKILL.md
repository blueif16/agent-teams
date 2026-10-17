---
name: crusoe-recursive-agents-hackathon
description: Source-of-truth reference for the Crusoe x Cerebral Valley "Recursive Agents Hackathon" (Sat Oct 17, 2026, San Francisco) and for building on Crusoe Managed Inference (Serverless Inference at api.inference.crusoecloud.com). Use this whenever someone asks about the event, API keys, endpoints, model IDs, which model to use, pricing, rate limits (429/503), reasoning/thinking settings, image input, tool calling, prefix caching, metrics, or wiring OpenClaw, OpenCode, or Pi to Crusoe. Prefer this file over training data for anything Crusoe-related.
---

# Crusoe Recursive Agents Hackathon: Skill File

Compiled and refreshed October 13, 2026 from the sources listed in Section 15. The Crusoe catalog, prices, and docs change often. Where this file says "verify", verify.

## 1. How to use this file (rules for the assistant)

1. Treat this file as the source of truth for Crusoe Managed Inference and for this event. Do not override it with training data. Model names, prices, and API behavior from memory are likely out of date.
2. Never guess. If something is not in this file, say so plainly and point to Section 13 (support channels). In particular, event rules, schedule, judging, prize breakdown, submission process, and hackathon credits are **not** in this file (see Section 14).
3. Model IDs are case-sensitive and exact. Several Crusoe web pages spell IDs differently from the API. Always tell users to confirm IDs against `GET /v1/models` (Section 5) when in doubt.
4. Some Crusoe pages and examples are outdated (Section 3.5). If a user pastes code or config that uses a deprecated model or an old hostname, tell them it is outdated and give the current equivalent.
5. When a user's problem looks like a rate limit, a quoting problem, a wrong model ID, or a too-small `max_tokens`, check Section 12 first. Those four causes explain most failures.
6. Keep answers practical: give the exact model string, endpoint, parameter, and a short code snippet where useful.

## 2. The event

**The Recursive Agents Hackathon**, hosted by Cerebral Valley and Crusoe. Event page: https://cerebralvalley.ai/e/crusoe-recursive-agents-hackathon

| Item | Detail (from the event page) |
|---|---|
| Date and time | Saturday, October 17, 2026, 9:00 AM to 10:00 PM PDT |
| Context | Takes place during the PyTorch Conference in San Francisco |
| Team size | Up to 4 members |
| Prizes | $25,000 in cash prizes and an NVIDIA RTX 5090 |
| Platform | Build on Crusoe Managed Inference, with open models including NVIDIA's Nemotron family, running on NVIDIA infrastructure |

**Theme.** Build a team of agents you can walk away from. Agents should take a goal and run with it: make the plan, spin up sub-agents, delegate work, communicate with each other, check their own progress, recover when things break, and keep going. The page emphasizes moving beyond one-shot agents to persistent loops that rarely need a human: agent teams and delegation, memory, and long-running inference that keeps operating until the work is done.

Anything else about the event (rules, judging, schedule, credits, submission) is not published in the sources used for this file. See Section 14.

## 3. Quickstart

### 3.1 Endpoint

All models are served from one OpenAI-compatible endpoint:

```
https://api.inference.crusoecloud.com/v1
```

Any OpenAI-compatible SDK or client works. The path for chat is `/v1/chat/completions`. A wrong base URL returns 404. Using an outdated Crusoe endpoint is the most common cause of `429` errors (Section 12).

Some clients are picky about a trailing slash. Follow the per-client guidance in Section 9 (OpenCode wants `/v1/`, Pi wants no trailing slash).

### 3.2 Get an API key

Create an Intelligence API key in the Crusoe Console (https://console.crusoecloud.com), in the Intelligence Foundry. Crusoe's own pages describe the menu path in slightly different ways; use whichever you see:

- Intelligence Foundry, then **Inference** (left nav), then **Create API Key**
- Console top right **Apps**, then **Intelligence Foundry**, then **API Keys**, then **Create API Key**
- **Security** tab, then **Intelligence API Keys** (or "Inference API key")

You can optionally set an alias and an **expiration date**. The key is **shown only once**: copy it immediately or create a new one. Keys are tied to a project. An expired or wrong-project key fails with 401 or 403.

### 3.3 Set the key without mangling it (important)

Crusoe API keys can contain `$` characters. In a shell, **wrap the key in single quotes**:

```bash
export CRUSOE_API_KEY='paste-your-key-here'
```

Double quotes let the shell expand `$...` segments, which silently corrupts the key and produces `401 Unauthorized` or `403 Forbidden`. A safer option that keeps the key out of your shell history:

```bash
read -rs CRUSOE_API_KEY && export CRUSOE_API_KEY   # paste key, press Enter
```

When checking that the variable is set, avoid printing the key; use `[ -n "$CRUSOE_API_KEY" ] && echo set || echo not set`.

### 3.4 First call

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://api.inference.crusoecloud.com/v1",
    api_key=os.environ["CRUSOE_API_KEY"],
)

resp = client.chat.completions.create(
    model="deepseek-ai/Deepseek-V4-Flash",   # exact spelling the API accepts, see Section 4
    messages=[
        {"role": "system", "content": "You are a concise assistant."},
        {"role": "user", "content": "Say hello in five words."},
    ],
    max_tokens=1024,
)
print(resp.choices[0].message.content)
print(resp.usage)   # prompt_tokens, completion_tokens, prompt_tokens_details.cached_tokens
```

```bash
curl https://api.inference.crusoecloud.com/v1/chat/completions \
  -H "Authorization: Bearer $CRUSOE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-ai/Deepseek-V4-Flash","messages":[{"role":"user","content":"hello"}],"max_tokens":1024}'
```

You can also try any model in the browser chat before writing code: https://console.crusoecloud.com/foundry/chat/new

Crusoe docs also advertise **$5 in free credits** to explore Serverless Inference. Whether the hackathon provides additional credits is not published here (Section 14).

### 3.5 Outdated pages and examples to ignore

- The official quickstart and the developer-hub README still show **`meta-llama/Llama-3.3-70B-Instruct`** in their examples. That model is **deprecated** (Section 4.3), so those examples will fail. Substitute a current model.
- Older docs and blog pages show **old hostnames** such as `api.crusoe.ai` and `managed-inference-api-proxy.crusoecloud.com`. Do not use them. Use `api.inference.crusoecloud.com`.
- The developer-hub README model table still lists deprecated models. Use the docs "Available models" page (https://docs.crusoecloud.com/serverless-inference/available-models) and `GET /v1/models`.

## 4. Models

### 4.1 Current Serverless catalog

This is the list on Crusoe's "Available models" docs page as of this compilation, with prices from Crusoe's pricing page (USD per 1M tokens). "ID status" says how sure we are of the exact string.

| Model ID to use | ID status | Modality | Context | Input / Output / Cached | Notes |
|---|---|---|---|---|---|
| `deepseek-ai/Deepseek-V4-Flash` | Confirmed (API spelling, lowercase "s") | text | 1M | $0.14 / $0.28 / $0.03 | The docs table shows `DeepSeek-V4-Flash`; the API only accepts the spelling in this row |
| `deepseek-ai/DeepSeek-V4.1-Flash` | From docs table, confirm (casing: the docs spell it `DeepSeek`; the API spelled V4 Flash with a lowercase "s") | text; model card says natively image + text, confirm in `/v1/models` | 1M | $0.29 / $0.20 / **$0.007** | Newest DeepSeek Flash on the catalog. Numeric reasoning effort 1 to 100. See 4.5 |
| `deepseek-ai/DeepSeek-V4-Pro` | Confirmed in Crusoe support articles | text | 1M | $1.74 / $3.48 / $0.15 | Heavy reasoner |
| `google/gemma-4-31b-it` | Confirmed | image + text | 262k | $0.14 / $0.40 / $0.14 | Answers directly (no reasoning phase) |
| `nvidia/Nemotron-3-Nano-30B-A3B` | From docs table, confirm | text | 262k | $0.05 / $0.20 / $0.03 | Cheap, high volume |
| `nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B` | Confirmed | text, image, video, audio in; text out | 262k | $0.30 / $1.83 / $0.30 (audio cached: $0.50) | Reasoning model |
| `nvidia/Nemotron-3-Super-120B-A12B` | From docs table, confirm | text | 262k | $0.30 / $2.40 / $0.15 | Agentic workloads |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | From docs table, confirm | text | 1M | $0.05 / $0.20 / $0.03 | Built for long-running agents / sub-agents |
| `nvidia/Nemotron-3-VoiceChat` | From docs table, confirm | speech-to-speech | 131k | Contact sales | See 4.5 |
| `openai/gpt-oss-120b` | Confirmed | text | 128k | $0.05 / $0.20 / $0.05 | Most reliable tool calling in OpenCode (per Crusoe) |
| `Qwen/Qwen3.8-27B` | Confirmed (API prefix `Qwen/`) | image + text (video per model card) | 256k | Not listed in the serverless price table | Docs table shows `qwen/`; API accepts `Qwen/` |
| `zai-org/GLM-5.3-Flash` | Confirmed (API prefix `zai-org/`) | image + text | 1M | $0.15 / $0.50 / $0.03 | Docs table shows `zai/` |
| GLM-5.3 (docs table: `zai/GLM-5.3`) | **Confirm prefix with `/v1/models`** (Flash uses `zai-org/`) | text | 1M | $1.40 / $4.40 / $0.26 | Its card positions it as the most capable open-weights model for coding and long-horizon tasks |

Context sizes: "262k" is 262,144 tokens, "256k" is 262,144, "1M" is 1,048,576, "128k" is 131,072.

Rules of thumb on IDs:
- The docs page, GitHub README, and API sometimes disagree on casing or prefix (`DeepSeek` vs `Deepseek`, `zai/` vs `zai-org/`, `qwen/` vs `Qwen/`). A wrong ID returns `404 model_not_found`.
- Copy the `id` field from `/v1/models`, not from a web page.

### 4.2 Listed elsewhere but absent from the docs catalog table (verify before relying)

| Model | Where it appears | What to tell users |
|---|---|---|
| **Nemotron 3 Ultra 550B** | Crusoe pricing page ($1.00 / $3.20 / $0.25 per 1M) and Crusoe's Pi guide, which uses the ID `nvidia/NVIDIA-Nemotron-3-Ultra-550B` with a 262,144-token context | It is not in the docs catalog table. Run `/v1/models` to confirm it is available to your project and to get the exact ID |

### 4.3 Deprecated: do not use

| Deprecated | Date | Crusoe's suggested replacement |
|---|---|---|
| Moonshot Kimi K2.6 | Oct 2, 2026 | DeepSeek V4 Flash or GLM-5.3 |
| Z.ai GLM-5.1, GLM-5.2 | Sept 12, 2026 | GLM-5.3 |
| DeepSeek V3 | Sept 12, 2026 | DeepSeek V4 Pro or V4 Flash |
| Qwen3 235B A22B | Sept 12, 2026 | DeepSeek V4 Flash or Qwen3.8 27B |
| Llama 3.3 70B Instruct | Sept 12, 2026 | DeepSeek V4 Flash |

### 4.4 Choosing a model (from Crusoe articles and the model cards)

| Need | Pick | Why (source) |
|---|---|---|
| Cheap, high-volume text (classifiers, routers, sub-agent chatter) | `deepseek-ai/Deepseek-V4-Flash`, `nvidia/Nemotron-3-Nano-30B-A3B`, `nvidia/nemotron-3.5-lightning-30b-a3b` | Crusoe calls V4 Flash and Nano the cheap high-volume options; NVIDIA's card calls Lightning a sub-agent workhorse for long-running autonomous agents |
| Long-running autonomous agents / sub-agents | `nvidia/nemotron-3.5-lightning-30b-a3b` (1M context) | NVIDIA card "best for" |
| Collaborative agents, tool use, RAG, long-context reasoning | `nvidia/Nemotron-3-Super-120B-A12B` | NVIDIA card "best for" |
| Input-heavy, long-context agent loops where most of each request is a repeated prefix | `deepseek-ai/DeepSeek-V4.1-Flash` | Its card says it was designed to cut KV-cache cost for input-heavy agentic workloads, and its cached-input price ($0.007 per 1M) is the lowest of any model with a listed price (next lowest is $0.03) |
| Hardest reasoning and coding/agentic tasks | `deepseek-ai/DeepSeek-V4-Pro`, GLM-5.3 | Crusoe calls V4 Pro a heavy reasoner; the DeepSeek and Z.ai cards emphasize agentic and coding capability |
| Most reliable tool calling in a coding agent | `openai/gpt-oss-120b` | Crusoe's OpenCode guidance |
| Image understanding, quick captioning/extraction | `google/gemma-4-31b-it` | No reasoning phase, cheapest per Crusoe |
| Image + text with an open general model | `Qwen/Qwen3.8-27B`, `zai-org/GLM-5.3-Flash` | Both are vision-language models |
| Audio, video, and image together | `nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B` | Inputs: video (mp4, up to 2 minutes), audio, image (jpeg/png), text |

### 4.5 Per-model notes (from the Hugging Face cards that Crusoe links)

- **DeepSeek V4 Flash / V4 Pro**: Crusoe's docs link to the `-0731` (Flash) and `-0813` (Pro) cards, which are the official releases superseding the preview versions, with improved agentic capability. Model-card sampling for local runs: temperature 1.0, top_p 0.95 for agentic use and 1.0 otherwise. `reasoning_effort` on the card has three levels: low, high, max. Cards: https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731 and https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-0813
- **DeepSeek V4.1 Flash** (docs link: https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash): a multimodal mixture-of-experts model (552B backbone parameters per its card) that natively processes images and text and generates text, with 1M-token context. Per the card it activates 8B parameters per token during prefill and 16B during decode, and its global KV cache is about one quarter the size of V4 Flash's, which is why it suits input-heavy agent loops. Reasoning effort is a **numeric budget from 1 to 100** ("continuously controllable"). Card sampling: temperature 1.0, top_p 0.95 or 1.0; the card suggests very large output budgets (256K or more) for its published max-effort results. Card agentic results at max effort include Terminal-Bench 2.1 at 90.6 and DeepSWE v1.1 at 74.2. The card also says its encoder reference supports tool calling, thinking mode, numeric effort, and interleaved image content. Crusoe has not published a V4.1-specific thinking toggle in the sources used for this file; see 4.6.
- **GLM-5.3 and GLM-5.3-Flash**: `reasoning_effort` accepts low, high, max and defaults to max if not passed. The chat template's `clear_thinking` defaults to false; for chat scenarios the card says to pass it as true. GLM-5.3-Flash is the first natively multimodal model in the GLM-5 series (320B total, 18B active). Cards: https://huggingface.co/zai-org/GLM-5.3 and https://huggingface.co/zai-org/GLM-5.3-Flash
- **Qwen3.8-27B**: dense 27B vision-language model (images and video). Thinking is on by default and can be disabled per request. `reasoning_effort` levels: xhigh (default), medium, low. `preserve_thinking` is on by default and keeps earlier reasoning in context, which the card says improves KV-cache utilization and helps agent consistency. Card note worth remembering: in multi-turn agentic tasks, lower reasoning effort does not always shorten total completion time because it can cause more failures and retries. Card sampling: thinking mode temperature 1.0, top_p 0.95, top_k 20, presence_penalty 0.0; non-thinking mode temperature 0.7, top_p 0.8, top_k 20, presence_penalty 1.5. Card: https://huggingface.co/Qwen/Qwen3.8-27B
- **gpt-oss-120b**: 117B parameters, 5.1B active. Reasoning effort (low, medium, high) is set in the system prompt, for example "Reasoning: high". Supports function calling and structured outputs. Card: https://huggingface.co/openai/gpt-oss-120b
- **Nemotron 3 Super 120B-A12B** (released March 2026): 120B total, 12B active; designed for collaborative agents and high-volume workloads. Card sampling: temperature 1.0, top_p 0.95 for all tasks. Reasoning toggled with `enable_thinking`; a `low_effort` option uses far fewer reasoning tokens. For coding agents, the card suggests `force_nonempty_content: true` in `chat_template_kwargs`. Card: https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8
- **Nemotron 3.5 Lightning 30B-A3B** (released August 11, 2026): 30B total, 3B active, hybrid Mamba-2 / MoE / attention. NVIDIA's card lists "best for" as long-running autonomous agents and sub-agent workhorse deployments. Sampling: temperature 1.0, top_p 0.95. Thinking on by default; `enable_thinking: false` for direct answers; `force_nonempty_content: true` suggested for coding agents. Card: https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4
- **Nemotron 3 Nano 30B-A3B** (December 2025): 30B total, 3.5B active; a unified reasoning and non-reasoning model whose reasoning can be configured through a chat-template flag. Card: https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8
- **Nemotron 3 Nano Omni**: accepts video, audio, image, text; outputs text; supports reasoning output. The request format Crusoe expects for audio and video input is **not documented in the sources used for this file**; for those, ask Crusoe support (Section 13). Image input works as in Section 7.1. Card: https://huggingface.co/nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-FP8
- **Gemma 4 31B it**: image + text. Crusoe notes it answers directly with no reasoning phase. Card: https://huggingface.co/google/gemma-4-31B-it
- **Nemotron 3 VoiceChat**: speech-to-speech, 131k context, pricing "contact sales". No request format for it is documented in the sources used for this file; ask Crusoe.

### 4.6 Turning reasoning on and off

Many catalog models reason before answering. Reasoning tokens count against `max_tokens`. Reasoning text comes back in a separate field on the message (`reasoning_content` or `reasoning`; read both defensively, for example with `message.model_dump()`).

**Verified by Crusoe (DeepSeek V4 Pro):**
- Enable thinking with `chat_template_kwargs`: `{"thinking": true}`. Turn off with `false` or by omitting it; `reasoning_content` is then `null`.
- Sending DeepSeek's own hosted-API parameter, `"thinking": {"type": "enabled"}`, returns **403** (`Request blocked: parameter 'thinking' is not allowed`). The proxy only accepts OpenAI-compatible parameters plus the supported ones listed in `/v1/models`.
- `reasoning_effort` on its own does **not** turn thinking on for V4 Pro; it only tunes effort once thinking is on.
- In the OpenAI Python SDK, pass non-standard fields through `extra_body`, which is merged into the request body:

```python
resp = client.chat.completions.create(
    model="deepseek-ai/DeepSeek-V4-Pro",
    messages=[{"role": "user", "content": "What is 17 x 23? Think it through."}],
    max_tokens=2048,
    extra_body={"chat_template_kwargs": {"thinking": True}},
)
m = resp.choices[0].message.model_dump()
print(m.get("reasoning_content"), m["content"])
```

**From the model cards (not individually verified by Crusoe; test and check which reasoning field comes back):**

| Model | Toggle named on the card |
|---|---|
| Qwen3.8-27B | `chat_template_kwargs: {"enable_thinking": false}` to disable; `reasoning_effort` xhigh/medium/low; `preserve_thinking` |
| GLM-5.3, GLM-5.3-Flash | `reasoning_effort` low/high/max; `clear_thinking` template option |
| Nemotron 3 Super, 3.5 Lightning | `chat_template_kwargs: {"enable_thinking": true/false}` |
| gpt-oss-120b | "Reasoning: low/medium/high" in the system prompt |
| DeepSeek V4 Flash | `reasoning_effort` low/high/max on the card; no Flash-specific Crusoe toggle is documented, so test the V4 Pro pattern above |
| DeepSeek V4.1 Flash | Card: numeric `reasoning_effort` from 1 to 100, plus a thinking on/off mode. No Crusoe-specific toggle is documented. Test `extra_body={"chat_template_kwargs": {"thinking": True, "reasoning_effort": 40}}` and check `supported_parameters` first. Use **integer** effort values: DeepSeek's reference encoder and third-party serving recipes map the words "low", "high", and "max" to different numbers and defaults, so words are ambiguous. **Pin thinking explicitly** (true or false) and give `max_tokens` room; if thinking is on by default for a request, a small `max_tokens` gets spent on the trace and returns empty content |

Always check `supported_parameters` for the model in `/v1/models` (Section 5) before relying on a parameter.

## 5. Discovering what a model supports: `GET /v1/models`

`/v1/models` is the programmatic source of truth. It returns, per model: `id`, `type`, `context_length`, `quantization`, `architecture.modality` (`text` or `multimodal`), `tags`, `features` (for example `tool_calling`, `structured_outputs`, `reasoning`), `supported_parameters` (the exact request fields accepted), `top_provider.max_completion_tokens`, and `pricing` with `prompt`, `completion`, `image`, `request`, `video`, and `input_cache_reads`.

Caveats from Crusoe:
- The `description` field is upstream model-card prose passed through unchanged. It can contradict the structured fields in the same response (for example on parameter counts). Trust the structured fields.
- `created` is unreliable (some models return 0).
- There is no checkpoint or version-date field. If a model has checkpoint versions, they usually appear in the name (such as a date suffix).
- `pricing.image` is `0` for vision models at the time of writing, meaning image input is billed as ordinary prompt tokens.

```bash
# list every model ID
curl -s https://api.inference.crusoecloud.com/v1/models -H "Authorization: Bearer $CRUSOE_API_KEY" | jq -r '.data[].id'

# one model's full record
curl -s https://api.inference.crusoecloud.com/v1/models -H "Authorization: Bearer $CRUSOE_API_KEY" \
  | jq '.data[] | select(.id == "openai/gpt-oss-120b")'

# multimodal models that accept tools
curl -s https://api.inference.crusoecloud.com/v1/models -H "Authorization: Bearer $CRUSOE_API_KEY" \
  | jq -r '.data[] | select(.architecture.modality == "multimodal") | select(.supported_parameters | index("tools")) | .id'

# models that take tools and response_format with at least 128k context, with prompt price
curl -s https://api.inference.crusoecloud.com/v1/models -H "Authorization: Bearer $CRUSOE_API_KEY" \
  | jq -r '.data[] | select((.supported_parameters | index("tools")) and (.supported_parameters | index("response_format"))) | select(.context_length >= 131072) | "\(.id)\t\(.context_length)\t\(.pricing.prompt)"'
```

Do not paste the key inline in a command (it lands in shell history and the process list); use the exported variable.

## 6. Rate limits and retries (read this before building a multi-agent system)

Limits apply **per project and per model**, and they reset every minute. Two limits are tracked independently: tokens per minute (TPM, input plus output) and requests per minute (RPM). Exceeding either returns `429`.

| Account status | TPM per model | RPM per model |
|---|---|---|
| No payment method on file | 500,000 | 30 |
| Payment method added | 2,000,000 | 600 |

- Adding a payment method raises both limits automatically (https://console.crusoecloud.com/billing/payments). For more, contact sales: https://www.crusoe.ai/contact-sales
- **Why this matters for agents:** 30 RPM per model is easy to exceed with parallel sub-agents or tight loops, because each loop turn is a request. Agent loops multiply request volume. Because limits are per model, spreading roles across different models also spreads the load.
- `429 Too Many Requests` means your project exceeded its TPM or RPM. `503 Service Unavailable` means you are within your limits but the shared endpoint is under unusually high load (shared deployments can scale up). Both are transient; retry with exponential backoff.
- A `429` can also come from using an outdated endpoint; check your `base_url` first (Section 12).
- Every response carries `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-limit-requests`, and `x-ratelimit-remaining-requests`, so you can throttle on the client before hitting a 429.

Backoff recipe from Crusoe's docs: start around 1 second, double each retry, add random jitter, cap at 30 to 60 seconds, and cap the number of retries.

```python
import random, time
from openai import RateLimitError, InternalServerError   # 503 surfaces as InternalServerError

def with_backoff(fn, max_tries=6, base=1.0, cap=60.0):
    for attempt in range(max_tries):
        try:
            return fn()
        except (RateLimitError, InternalServerError):
            if attempt == max_tries - 1:
                raise
            time.sleep(min(cap, base * 2 ** attempt) + random.uniform(0, 0.5))

resp = with_backoff(lambda: client.chat.completions.create(model="openai/gpt-oss-120b", messages=[{"role": "user", "content": "hi"}], max_tokens=512))
```

Reading the headers with the OpenAI SDK:

```python
raw = client.chat.completions.with_raw_response.create(model="openai/gpt-oss-120b", messages=[{"role": "user", "content": "hi"}], max_tokens=512)
print(raw.headers.get("x-ratelimit-remaining-requests"), raw.headers.get("x-ratelimit-remaining-tokens"))
completion = raw.parse()
```

## 7. Request details that commonly bite

### 7.1 Image input

- Image input is a per-model property, not an endpoint property. Models tagged `image text to text` accept it: Nemotron 3 Nano Omni, Gemma 4 31B, GLM-5.3 Flash, and Qwen3.8 27B (Crusoe's list as of September 30). DeepSeek V4.1 Flash is described on its model card as natively processing images and text; confirm that Crusoe's deployment accepts images by checking `architecture.modality` in `/v1/models`. There is no separate vision endpoint; use `/v1/chat/completions`.
- Make `content` a list of parts. The `image_url` can be a public HTTPS URL or a base64 data URI. The data-URI route means the model never needs outbound network access.

```python
import base64
def data_uri(path, mime="image/png"):
    return f"data:{mime};base64," + base64.b64encode(open(path, "rb").read()).decode()

resp = client.chat.completions.create(
    model="google/gemma-4-31b-it",
    messages=[{"role": "user", "content": [
        {"type": "text", "text": "What does this chart show?"},
        {"type": "image_url", "image_url": {"url": data_uri("chart.png")}},
    ]}],
    max_tokens=1024,
)
```

- **Sending an image to a text-only model does not fail gracefully.** Depending on the model you get a 400 about unsupported content, or the model silently ignores the image and answers from text alone. Check `architecture.modality == "multimodal"` in `/v1/models` first.
- Images count as prompt tokens: roughly 100 tokens for a small 400x200 image and roughly 1,000 for a 1280x800 screenshot. Downscale to the smallest size that is still legible; about 1024px on the long edge is a reasonable start for UI screenshots. The exact count is in `usage.prompt_tokens_details`.

### 7.2 Reasoning models and `max_tokens`

Reasoning models spend output tokens thinking before they answer. If `max_tokens` is too small (under a few hundred), the budget runs out mid-thought and `message.content` comes back `None` or empty, which looks like "the model ignored my input". Use at least `max_tokens=1024` for image questions with reasoning models, and check `finish_reason`: `length` means the model was starved. Reasoning-capable models named by Crusoe include Nemotron 3 Nano Omni, Qwen3.8 27B, and GLM-5.3 Flash.

### 7.3 Tool calling

- Use standard OpenAI `tools` and `tool_calls`. Whether a model accepts `tools` is shown in its `supported_parameters`.
- When the model returns `tool_calls`, append that **assistant message first**, then append one `role: "tool"` message per call with the matching `tool_call_id`. Dropping the assistant turn before appending tool results causes a 400 about message ordering.
- If a model describes a tool call in prose instead of emitting `tool_calls`, either it does not support `tools`, it is a reasoning model with too small a `max_tokens`. Raise the token budget before resorting to forcing `tool_choice`, and validate forced arguments before acting on them.

## 8. Prefix caching (cost and latency for agent loops)

Crusoe's Serverless Inference runs on **MemoryAlloy**, a cluster-wide memory fabric with cache-aware routing. It steers requests that share a prefix toward the KV state already built for it. Cached input tokens are billed at the lower "cached" rate and reduce time to first token.

- Per-request proof is in the response: `usage.prompt_tokens_details.cached_tokens`. Divide by `usage.prompt_tokens` for that request's hit rate. A session's aggregate rate is `sum(cached_tokens) / sum(prompt_tokens)`.
- In a multi-turn agent loop the system prompt, tool definitions, and earlier turns are byte-identical from one request to the next, so only the newest tokens need new compute. Keep the prefix **identical**: whitespace, tool ordering, and JSON key order all matter. Put changing content at the end.
- The first request of a session is cold (`cached_tokens` is 0). A healthy session shows `cached_tokens` growing after turn 1 and not dropping to zero mid-session.
- Cache credit can be granted in fixed-size segments on some models, so very short prompts can report 0 even when the prefix is identical. Test with your real system prompt and tool schema.
- Rewriting or trimming an earlier message invalidates the cache from that point on.
- Prefix caching is also what makes long agent histories affordable: cached rates in Section 4.1 are a fraction of the uncached input price (for example V4 Flash $0.03 vs $0.14 per 1M).
- A simple way to measure your own hit rate is to replay a realistic conversation of N sequential turns with `temperature: 0` and a small `max_tokens`, adding a unique user message each turn, and printing `prompt_tokens`, `cached_tokens`, and the ratio. Running several sessions in parallel counts against your RPM limit.

## 9. Building persistent agents: verified patterns

What Crusoe's own materials establish that is relevant to long-running, multi-agent systems:

1. **Budget for rate limits** (Section 6): per-model TPM/RPM, 429 vs 503, jittered backoff, header-based throttling.
2. **Design for cache hits** (Section 8): stable system prompt and tool schema; append-only history.
3. **Give reasoning models room** (Section 7.2) and choose reasoning depth deliberately. Lower effort is not always faster for multi-turn agent work (Qwen card).
4. **Pick the cheap model for the high-frequency role** and the strong model for planning or hard steps (Section 4.4).
5. **Use per-model features, not assumptions**: check `features` and `supported_parameters` (Section 5).
6. **Add a hosted or alternate fallback** if uptime matters (the OpenClaw guide below shows how to test a fallback chain).

### 9.1 Connecting agent harnesses to Crusoe

All of these just point an OpenAI-compatible client at `https://api.inference.crusoecloud.com/v1`.

**OpenCode** (open-source terminal coding agent; needs Node.js 18+). Install with `curl -fsSL https://opencode.ai/install | bash` or `npm install -g opencode-ai`. Config at `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "crusoe/openai/gpt-oss-120b",
  "provider": {
    "crusoe": {
      "name": "Crusoe Cloud",
      "options": {
        "baseURL": "https://api.inference.crusoecloud.com/v1/",
        "apiKey": "{env:CRUSOE_API_KEY}"
      },
      "models": {
        "openai/gpt-oss-120b": { "name": "gpt-oss-120b" },
        "google/gemma-4-31b-it": { "name": "gemma-4-31b-it" }
      }
    }
  }
}
```

Use `/models` inside OpenCode to switch. For OpenCode, use the trailing-slash `baseURL` (`.../v1/`); a missing slash is Crusoe's listed fix for connection refused or timeouts. `{env:CRUSOE_API_KEY}` reads the key from your environment so it is not hardcoded. A 404 means the model name in your config does not exactly match the ID (names are case-sensitive).

**Pi** (`@earendil-works/pi-coding-agent`, community software, not endorsed by Crusoe). Install with `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` (keep `--ignore-scripts`). Config at `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "crusoe": {
      "baseUrl": "https://api.inference.crusoecloud.com/v1",
      "api": "openai-completions",
      "apiKey": "your-crusoe-api-key-here",
      "defaultHeaders": { "Accept": "text/event-stream" },
      "compat": {
        "supportsDeveloperRole": false, "supportsResponseFormat": false, "supportsTools": true,
        "supportsStreamOptions": false, "supportsMaxCompletionTokens": false, "supportsStore": false,
        "supportsReasoningEffort": true
      },
      "models": [
        { "id": "openai/gpt-oss-120b", "name": "GPT-OSS 120B", "contextWindow": 131072, "maxTokens": 8192,
          "reasoning": true, "modality": "text", "input": ["text"],
          "features": ["tool_calling", "structured_outputs", "json_mode", "reasoning", "prompt_cache", "seed"] },
        { "id": "deepseek-ai/DeepSeek-V4-Pro", "name": "DeepSeek V4 Pro", "contextWindow": 1048576, "maxTokens": 8192,
          "reasoning": true, "modality": "text", "input": ["text"],
          "features": ["tool_calling", "structured_outputs", "json_mode", "reasoning", "prompt_cache", "seed"] }
      ]
    }
  }
}
```

For Pi, `baseUrl` must end in `/v1` with **no** trailing slash. `models[].id` is sent verbatim as the `model` parameter. Launch with `pi`; `/model` switches models mid-session. Credential priority is: `--api-key` flag, then `~/.pi/agent/auth.json` (written by `/login`), then environment variables, then `apiKey` in `models.json`. A stale `auth.json` silently overrides a newer `models.json` key; delete it if you switch methods. Both files hold keys in plaintext; keep them out of source control.

**OpenClaw** (agent runtime; config `~/.openclaw/openclaw.json`, JSON5; the file stores your key in plaintext, so protect it). Add Crusoe as a custom provider with `models.mode: "merge"` so other providers remain available as fallbacks:

```json5
{
  models: {
    mode: "merge",
    providers: {
      crusoe: {
        baseUrl: "https://api.inference.crusoecloud.com/v1",   // must include /v1
        apiKey: "YOUR_CRUSOE_API_KEY",
        api: "openai-completions",                              // Crusoe uses /v1/chat/completions, not the Responses API
        models: [{
          id: "deepseek-ai/Deepseek-V4-Flash",                  // exact catalog ID, no provider prefix
          name: "DeepSeek V4 Flash (Crusoe)",
          reasoning: true,                                      // match the model's features in /v1/models
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1048576,
          maxTokens: 8192,
        }],
      },
    },
  },
  agents: { defaults: { model: { primary: "crusoe/deepseek-ai/Deepseek-V4-Flash" } } },
}
```

The model reference format is `provider/model-id`. Prefer `openclaw config set ...` for schema-validated writes. To keep another provider as a fallback, add `fallbacks: ["<provider>/<model>"]` next to `primary`. Verifying correctly matters because two execution paths exist:
- `openclaw infer model run --local --model crusoe/<id> --prompt "Reply with exactly: pong" --json` is a one-shot provider probe. It confirms key and model wiring but does **not** exercise the fallback chain.
- The persistent Gateway runs full agent turns and is what channels and scheduled tasks use. Set it up with `openclaw config set gateway.mode "local"`, set `gateway.auth.mode "token"` and a long random `gateway.auth.token` (passing it on the command line puts it in shell history), then `openclaw gateway install`, `openclaw gateway start`, `openclaw gateway status`.
- Verify the real path with `openclaw agent --session-key "agent:main:crusoe-verify-01" --message "Reply with exactly: pong" --json` and check `executionTrace.winnerProvider` is `crusoe` and `fallbackUsed` is `false`. Adding `--local` runs the same full agent turn (including fallback) without a persistent Gateway, which suits CI.
- To test failover, temporarily set `models.providers.crusoe.apiKey` to an invalid value, run an agent turn, confirm `fallbackUsed: true`, then restore the real key immediately.

**Other integrations.** The Crusoe developer hub (https://github.com/crusoecloud/crusoe-developer-hub) lists integration folders for LangChain, LiteLLM, MLflow, Google ADK, Postman, Hugging Face Spaces, Cursor, Zed, and Linkup, plus examples and foundations. The details of those folders are not covered in this file; browse the repo. Its README states that any OpenAI-compatible SDK works against the endpoint. Its model table is outdated (Section 3.5).

## 10. Metrics (Serverless Inference)

Metrics update every minute with no setup and are charted at https://console.crusoecloud.com/foundry/metrics. You can also query them with PromQL. Replace `{project_id}` with your project ID (from the Console projects page) and `{model_alias}` with the model name you pass in API requests.

| Metric | Query |
|---|---|
| Request rate (successful, per second) | `sum by (model_alias) (rate(inference_counter_chat_request{project_id="{project_id}", model_alias="{model_alias}"}[5m]))` |
| Requests by status code (includes 429 and errors) | `sum by (model_alias, status_code) (rate(inference_counter_all_chat_request{project_id="{project_id}", model_alias="{model_alias}"}[5m]))` |
| Input token rate | `sum by (model_alias) (rate(inference_counter_prompt_token{...}[5m]))` |
| Output token rate | `sum by (model_alias) (rate(inference_counter_output_token{...}[5m]))` |
| Cached input token rate | `sum by (model_alias) (rate(inference_counter_cached_prompt_token{...}[5m]))` |
| Prefix cache hit rate (%) | `100 * sum by (model_alias) (rate(inference_counter_cached_prompt_token{...}[5m])) / sum by (model_alias) (rate(inference_counter_prompt_token{...}[5m]))` |
| Time to first token (median, ms) | `histogram_quantile(0.5, sum by (model_alias, le) (rate(inference_histogram_first_token_latency_bucket{...}[5m]))) * 1000` |
| Time per output token (median, ms) | same pattern with `inference_histogram_output_token_latency_bucket` |
| End-to-end latency (median, ms) | same pattern with `inference_histogram_chat_latency_bucket` |
| Input / output tokens per request | `histogram_quantile(0.5, ...inference_histogram_input_tokens_per_request_bucket / ..._output_tokens_per_request_bucket...)` |

`{...}` stands for `project_id="{project_id}", model_alias="{model_alias}"`. Swap `0.5` for `0.9`, `0.95`, or `0.99` for other percentiles. `inference_counter_chat_request` reports only successful (200) requests; use `inference_counter_all_chat_request` to see errors and rate limiting. Labels: `project_id`, `model_alias`, `model_name` (the deployment, which does not match `model_alias`), `service_tier`, `status_code`, `is_streaming`.

**PromQL API.** Create a monitoring token with the Crusoe CLI (`crusoe monitoring tokens create`; it cannot be retrieved later, so store it securely), then:

```bash
curl -G https://api.cloud.crusoe.ai/v1/projects/<project-id>/metrics/timeseries \
  --data-urlencode 'query=histogram_quantile(0.5, sum by (model_alias, le) (rate(inference_histogram_first_token_latency_bucket[5m]))) * 1000' \
  -H 'Authorization: Bearer <API-Key>'
```

For Grafana, add a Prometheus data source with server URL `https://api.cloud.crusoe.ai/v1/projects/<project-id>/metrics/timeseries` and an HTTP header `Authorization: Bearer <API-Key>`.

## 11. Billing and pricing

- Serverless Inference is pay-as-you-go, billed per 1M input, output, and cached tokens. Prices are in Section 4.1. Full pricing page: https://www.crusoe.ai/cloud/pricing . Usage and billing docs: https://docs.crusoecloud.com/serverless-inference/usage-billing-models
- Cached tokens are billed at a much lower rate and also lower latency (Section 8).
- A reference batch-inference workflow using `openai/gpt-oss-120b` with strict JSON output schemas exists in Crusoe's support center ("Run Production Batch Inference with openai/gpt-oss-120b model on Crusoe Intelligence Foundry"); it calls for retry-with-backoff on 429.

## 12. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `401 Unauthorized` / "Invalid API Key" | Key not set, mangled, or expired. Re-export with **single quotes**; check the expiration date and that the key was created in the right project. In OpenCode/Pi, confirm the environment variable or config key is actually present |
| `403 Forbidden` | Wrong or expired key; double-quoted key containing `$`; or a blocked parameter (for example `{"thinking": {"type": "enabled"}}`, error text `parameter 'thinking' is not allowed`). Remove non-standard parameters and use `chat_template_kwargs` (Section 4.6) |
| `404` with `model_not_found` | Wrong ID, case, or prefix. Copy `id` from `/v1/models` (for example `Deepseek` vs `DeepSeek`, `zai-org/` vs `zai/`, `Qwen/` vs `qwen/`), or the model was deprecated (Section 4.3) |
| `404 page not found` | Wrong `base_url`. Use `https://api.inference.crusoecloud.com/v1` |
| `429 Too Many Requests` | First check you are using `api.inference.crusoecloud.com` (an outdated endpoint is the most common cause). Then check RPM/TPM (Section 6): no payment method means only 30 RPM and 500K TPM per model. Back off and retry; add a payment method for higher limits. If still stuck on the correct endpoint, submit a support request |
| `503 Service Unavailable` | Shared endpoint scaling or under high load, even within your limits. Retry with backoff; if repeated, contact Crusoe |
| `message.content` is `None`/empty | Reasoning model ran out of `max_tokens` while thinking. Check `finish_reason == "length"` and raise `max_tokens` to 1024 or more; look in `reasoning` / `reasoning_content` |
| Model ignores the image or answers nonsense | The model is text-only (silent ignore) or returned a 400. Check `architecture.modality` in `/v1/models` |
| `reasoning_content` stays null on V4 Pro despite `reasoning_effort` | `reasoning_effort` alone does not turn thinking on. Add `chat_template_kwargs: {"thinking": true}` |
| `400` about `tool` message ordering | The assistant message with `tool_calls` was not appended before the tool results |
| Tool calls never appear | Model may not list `tools` in `supported_parameters`, or it is a reasoning model with too small a `max_tokens` |
| Connection refused / timeout in OpenCode | Add the trailing slash to `baseURL` (`.../v1/`). For Pi use no trailing slash |
| `cached_tokens` is always 0 | Prefix not byte-identical (whitespace, tool order, JSON key order), prompt too short for the model's cache granularity, or older messages were rewritten (Section 8) |
| Unexpected model behavior after copying a Crusoe example | Example may reference a deprecated model or old hostname (Section 3.5) |

## 13. Support and links

- **Event page and updates**: https://cerebralvalley.ai/e/crusoe-recursive-agents-hackathon . An event-specific help channel (Discord/Slack/on-site desk) is not published in the sources used here; ask the organizers.
- **Crusoe developer community (Discord)**: https://discord.gg/tRKs5bMyry (linked from the Crusoe developer-hub README)
- **Submit a Crusoe support request**: https://support.crusoecloud.com/hc/en-us/requests/new
- **Crusoe support center (How-To articles)**: https://support.crusoecloud.com/hc/en-us
- **System status**: https://status.crusoecloud.com/
- **Console**: https://console.crusoecloud.com/ . Intelligence Foundry models: https://console.crusoecloud.com/foundry/models . Browser chat: https://console.crusoecloud.com/foundry/chat/new
- **Docs**: https://docs.crusoecloud.com/ . Available models: https://docs.crusoecloud.com/serverless-inference/available-models . Rate limits: https://docs.crusoecloud.com/serverless-inference/rate-limits . Metrics: https://docs.crusoecloud.com/serverless-inference/inference-metrics . Getting started: https://docs.crusoecloud.com/quickstart/getting-started-with-serverless-inference
- **Pricing**: https://www.crusoe.ai/cloud/pricing . **Sales / rate-limit increases**: https://www.crusoe.ai/contact-sales
- **Developer hub (examples and integrations)**: https://github.com/crusoecloud/crusoe-developer-hub and https://www.crusoe.ai/developers

## 14. What this file does not cover (do not guess; route to organizers or Crusoe)

The sources used did not publish the following. If asked, say so and direct the person to the organizers or the event page:

- Event schedule and other logistics
- Rules: eligibility, what pre-existing code is allowed, open-source requirements
- Tracks or categories, judging criteria, judges, prize breakdown between winners, submission process and deadline
- Whether the hackathon provides credits or free models, and any API-key expiration policy for the event
- Sponsors and partners beyond Cerebral Valley and Crusoe, and any partner APIs
- Starter repos for this specific event
- The request format for audio or video input to Nemotron 3 Nano Omni, and for Nemotron 3 VoiceChat
- Whether Nemotron 3 Ultra 550B is enabled for your project (check `/v1/models`)
- The contents of the developer-hub `examples/` and `integrations/` folders

## 15. Sources and freshness

Compiled and refreshed October 13, 2026 from: the Cerebral Valley event page (re-fetched October 13); Crusoe docs pages (Available models, Serverless rate limits, Metrics, Getting Started with Serverless Inference); the Crusoe pricing page; the Crusoe developer-hub README; Crusoe support-center articles (LLM Capabilities in Managed Inference, Test the Prefix Cache Hit Rate, List Model Features via the Inference API, Hook Up OpenClaw, Use Managed Inference with OpenCode, Use Managed Inference with Pi, Enable Thinking Mode for DeepSeek V4 Pro, Fix 429 RateLimitError, Resolve 403 Forbidden, Get Started with Text Generation, batch inference with gpt-oss-120b); and Hugging Face model cards for DeepSeek V4 Flash-0731, DeepSeek V4.1 Flash, DeepSeek V4 Pro-0813, GLM-5.3, GLM-5.3-Flash, Qwen3.8-27B, gpt-oss-120b, Nemotron 3 Super, Nemotron 3.5 Lightning, Nemotron 3 Nano, and Nemotron 3 Nano Omni. Model-card details for Nano, Nano Omni, and Gemma 4 were limited to the facts stated in Section 4.5.

When a Crusoe page and this file disagree, the newer Crusoe page and `/v1/models` win. Tell the user which source you relied on.
