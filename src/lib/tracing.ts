/*
 * LangSmith for calls that don't go through LangChain (the chat route).
 * Deep Agents runs are traced automatically from the LANGSMITH_* env vars;
 * this gives raw Crusoe calls the same shape: an LLM run with usage and the
 * agent/team in metadata, plus reactions recorded as feedback on that run.
 * Every function is a no-op when tracing is off, and tracing never fails a reply.
 */
import { Client, RunTree } from "langsmith";

const enabled = () => process.env.LANGSMITH_TRACING === "true" && Boolean(process.env.LANGSMITH_API_KEY);
const project = () => process.env.LANGSMITH_PROJECT ?? "default";

let client: Client | undefined;
let projectId: Promise<string> | undefined;
const ls = () => (client ??= new Client());

export async function startLLMRun(opts: {
  /** Our own id, so the reply can carry it before the run is posted. */
  id?: string;
  name: string;
  model: string;
  inputs: Record<string, unknown>;
  metadata: Record<string, unknown>;
  tags: string[];
}): Promise<RunTree | null> {
  if (!enabled()) return null;
  try {
    const run = new RunTree({
      id: opts.id,
      name: opts.name,
      run_type: "llm",
      project_name: project(),
      inputs: opts.inputs,
      tags: opts.tags,
      client: ls(),
      // ls_provider/ls_model_name let LangSmith price the run from its model table.
      metadata: { ls_provider: "crusoe", ls_model_name: opts.model, ...opts.metadata },
    });
    await run.postRun();
    return run;
  } catch (e) {
    console.warn("LangSmith: couldn't start run", (e as Error).message);
    return null;
  }
}

export async function endLLMRun(
  run: RunTree | null,
  result: { output?: string; error?: string; model: string; input: number; cached: number; output_tokens: number },
): Promise<void> {
  if (!run) return;
  try {
    run.metadata = {
      ...run.metadata,
      ls_model_name: result.model,
      usage_metadata: {
        input_tokens: result.input,
        output_tokens: result.output_tokens,
        total_tokens: result.input + result.output_tokens,
        input_token_details: { cache_read: result.cached },
      },
    };
    await run.end(result.output !== undefined ? { output: result.output } : undefined, result.error);
    await run.patchRun();
    // Uploads are batched in the background; on Vercel the function freezes before they'd send.
    await ls().awaitPendingTraceBatches();
  } catch (e) {
    console.warn("LangSmith: couldn't end run", (e as Error).message);
  }
}

/** A reaction as feedback on the reply's run: key "order", value the order, score 1 for 👍 and 0 for 🔁. */
export async function orderFeedback(runId: string, order: string): Promise<void> {
  if (!enabled()) return;
  try {
    projectId ??= ls()
      .readProject({ projectName: project() })
      .then((p) => p.id);
    const score = order === "go" ? 1 : order === "redo" ? 0 : undefined;
    await ls().createFeedback({ runId, sessionId: await projectId, key: "order", value: order, score, feedbackSourceType: "app" });
  } catch (e) {
    projectId = undefined;
    console.warn("LangSmith: couldn't record feedback", (e as Error).message);
  }
}
