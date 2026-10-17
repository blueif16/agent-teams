import { readFileSync } from "node:fs";
import path from "node:path";
import { tool } from "langchain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { HQ } from "@/lib/data";
import { readLedger, type ApprovalEvent } from "@/lib/ledger";
import { DEFAULT_RULES } from "@/lib/policy/defaults";
import type { Rule } from "@/lib/policy/types";
import { openCheckpointer } from "./checkpointer";
import { openRuntimeDb, type RuntimeDb } from "./db";
import type { ThreadEvent } from "./events";
import { Runtime, type RuntimeOptions } from "./index";
import { tempEnv, type TempEnv } from "./testing/env";
import { fakeCrusoe, textOf, type ChatRequest, type FakeCrusoe } from "./testing/fake-crusoe";
import { RESEARCH_URL } from "./tools/research";

/*
 * R6 approvals: a gated tool call pauses the run on a durable approval; the owner's decision resumes it, even
 * after a restart. Mira (chief) has `research`, which always asks. You.com is a fake that answers with a real
 * recorded lite response; Crusoe is the scripted fake.
 */
const T = "a:mira:p:dm";
const Q = "What does the interrupt() function do in LangGraph JS, and how is a paused graph resumed?";
const LITE = readFileSync(new URL("./tools/__fixtures__/youcom/research-lite.json", import.meta.url), "utf8");
const ANSWER = "the `interrupt()` function pauses graph execution within a node";

let env: TempEnv;
let db: RuntimeDb;
let checkpointer: ReturnType<typeof openCheckpointer>;
let rt: Runtime | undefined;

const files = () => ({ db: path.join(env.data, "runtime.db"), checkpoints: path.join(env.data, "checkpoints.db") });

beforeEach(async () => {
  env = await tempEnv();
  db = openRuntimeDb(files().db);
  checkpointer = openCheckpointer(files().checkpoints);
});
afterEach(async () => {
  await rt?.close();
  rt = undefined;
  checkpointer.db.close();
  db.close();
  await env.cleanup();
});

/** A fake You.com Research endpoint: every request recorded, each answered with the recorded lite response. */
function fakeYou() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return new Response(LITE, { headers: { "content-type": "application/json" } });
  };
  return { calls, fetch };
}

function runtime(fake: FakeCrusoe, you: ReturnType<typeof fakeYou>, over: Partial<RuntimeOptions> = {}) {
  return new Runtime({ db, checkpointer, fetch: fake.fetch, research: { apiKey: "ydc-test-key", fetch: you.fetch }, ...over });
}

const research = (tier?: string) => ({ toolCalls: [{ name: "research", args: { question: Q, ...(tier ? { tier } : {}) } }] });
/** The tool results a model request carried. */
const toolResults = (req: ChatRequest) => req.messages.filter((m) => m.role === "tool").map((m) => textOf(m.content));

describe("a research call", () => {
  it("pauses the run before any You.com request, with one pending approval naming the tier and its cost", async () => {
    const fake = fakeCrusoe([research("deep"), { text: "Done." }]);
    const you = fakeYou();
    rt = runtime(fake, you);

    const { runId } = rt.send(T, { text: "Dig into LangGraph interrupts for me." });
    await rt.idle(T);

    expect(db.runs.get(runId!)?.status).toBe("interrupted");
    expect(db.threads.get(T)?.status).toBe("waiting_approval");
    expect(you.calls).toHaveLength(0);
    expect(fake.requests).toHaveLength(1);
    const pending = db.approvals.pending({ thread: T });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      threadId: T,
      runId,
      agentId: "mira",
      projectId: "dm",
      tool: "research",
      args: { question: Q, tier: "deep" },
      title: "Research (deep, ~$0.10)",
      detail: Q,
      estUsd: 0.1,
      state: "pending",
      decidedAt: null,
    });
  }, 30_000);

  it("announces the approval on the thread's events when it is created", async () => {
    const fake = fakeCrusoe([research(), { text: "Done." }]);
    rt = runtime(fake, fakeYou());
    const seen: ThreadEvent[] = [];
    rt.events.subscribe(T, (e) => seen.push(e));

    rt.send(T, { text: "Research this." });
    await rt.idle(T);

    const approvals = seen.filter((e) => e.type === "approval");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ approval: { title: "Research (standard, ~$0.05)", state: "pending" } });
  }, 30_000);
});

describe("deciding an approval", () => {
  it("approve: exactly one You.com request, and the run finishes with the answer in the model's tool message", async () => {
    const fake = fakeCrusoe([research("lite"), { text: "interrupt() pauses a node; Command resumes it." }]);
    const you = fakeYou();
    rt = runtime(fake, you);
    rt.send(T, { text: "Research this." });
    await rt.idle(T);
    const [approval] = db.approvals.pending({ thread: T });

    const { runId } = await rt.decide(approval.id, "approve");
    await rt.idle(T);

    expect(you.calls).toHaveLength(1);
    expect(you.calls[0]).toMatchObject({ url: RESEARCH_URL, body: { input: Q, research_effort: "lite" } });
    expect(fake.requests).toHaveLength(2);
    const [result] = toolResults(fake.requests[1]);
    expect(result).toContain(ANSWER);
    expect(result).toContain("https://docs.langchain.com/oss/javascript/langgraph/interrupts");
    expect(db.runs.get(runId)?.status).toBe("done");
    expect(db.threads.get(T)?.status).toBe("idle");
    expect(db.approvals.get(approval.id)).toMatchObject({ state: "approved" });
    expect(db.approvals.pending({ thread: T })).toEqual([]);
  }, 30_000);

  it("decline: no You.com request, and the model sees the owner's note", async () => {
    const fake = fakeCrusoe([research("exhaustive"), { text: "Understood, I'll use what I have." }]);
    const you = fakeYou();
    rt = runtime(fake, you);
    rt.send(T, { text: "Research this." });
    await rt.idle(T);
    const [approval] = db.approvals.pending({ thread: T });

    const { runId } = await rt.decide(approval.id, "decline", "Too pricey for this question");
    await rt.idle(T);

    expect(you.calls).toHaveLength(0);
    expect(fake.requests).toHaveLength(2);
    expect(toolResults(fake.requests[1])).toEqual(["declined by the owner: Too pricey for this question"]);
    expect(db.runs.get(runId)?.status).toBe("done");
    expect(db.approvals.get(approval.id)).toMatchObject({ state: "declined", note: "Too pricey for this question" });
  }, 30_000);

  it("survives a restart: a fresh Runtime on the same db and checkpoints resumes the run", async () => {
    const you = fakeYou();
    rt = runtime(fakeCrusoe([research()]), you);
    rt.send(T, { text: "Research this." });
    await rt.idle(T);
    const [{ id }] = db.approvals.pending({ thread: T });

    // "Restart": drop the runtime and reopen both files, as a new process would.
    await rt.close();
    checkpointer.db.close();
    db.close();
    db = openRuntimeDb(files().db);
    checkpointer = openCheckpointer(files().checkpoints);
    const after = fakeCrusoe([{ text: "Here is what I found." }]);
    rt = runtime(after, you);

    expect(db.approvals.get(id)).toMatchObject({ state: "pending", title: "Research (standard, ~$0.05)" });
    const { runId } = await rt.decide(id, "approve");
    await rt.idle(T);

    expect(you.calls).toHaveLength(1);
    expect(after.requests).toHaveLength(1);
    expect(toolResults(after.requests[0]).at(-1)).toContain(ANSWER);
    expect(db.runs.get(runId)?.status).toBe("done");
    expect(db.threads.get(T)?.status).toBe("idle");
  }, 30_000);

  it("writes one ledger approval row per decision, and refuses a second decision", async () => {
    rt = runtime(fakeCrusoe([research(), { text: "Done." }]), fakeYou());
    rt.send(T, { text: "Research this." });
    await rt.idle(T);
    const [{ id }] = db.approvals.pending({ thread: T });

    await rt.decide(id, "approve");
    await rt.idle(T);
    await expect(rt.decide(id, "decline")).rejects.toThrow(/already/i);

    const rows = (await readLedger()).filter((e): e is ApprovalEvent => e.t === "approval");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ t: "approval", agent: "mira", team: HQ.id, decision: "approved" });
  }, 30_000);

  it("two research calls in one turn wait on their own approvals", async () => {
    const fake = fakeCrusoe([
      { toolCalls: [{ name: "research", args: { question: Q, tier: "lite" } }, { name: "research", args: { question: "Who maintains LangGraph?", tier: "frontier" } }] },
      { text: "Done." },
    ]);
    const you = fakeYou();
    rt = runtime(fake, you);
    rt.send(T, { text: "Research both." });
    await rt.idle(T);
    const pending = db.approvals.pending({ thread: T });
    expect(pending.map((a) => a.title).sort()).toEqual(["Research (frontier, ~$1.20)", "Research (lite, ~$0.012)"]);
    const lite = pending.find((a) => a.title.includes("lite"))!;
    const frontier = pending.find((a) => a.title.includes("frontier"))!;

    // The first answer runs its call; the run waits again on the second.
    const first = await rt.decide(lite.id, "approve");
    await rt.idle(T);
    expect(you.calls).toHaveLength(1);
    expect(db.runs.get(first.runId)?.status).toBe("interrupted");
    expect(fake.requests).toHaveLength(1);

    const second = await rt.decide(frontier.id, "decline", "Not worth $1.20");
    await rt.idle(T);
    expect(you.calls).toHaveLength(1);
    expect(db.runs.get(second.runId)?.status).toBe("done");
    expect(fake.requests).toHaveLength(2);
    const results = toolResults(fake.requests[1]);
    expect(results).toHaveLength(2);
    expect(results.some((r) => r.includes(ANSWER))).toBe(true);
    expect(results).toContain("declined by the owner: Not worth $1.20");
  }, 30_000);
});

describe("the tool gate", () => {
  it("returns the reason for a tool a rule denies, and never runs it", async () => {
    let ran = false;
    const sendEmail = tool(
      async () => {
        ran = true;
        return "sent";
      },
      { name: "send_email", description: "Sends an email.", schema: z.object({ to: z.string(), body: z.string() }) },
    );
    const noMail: Rule = { id: "r_nomail", kind: "tool", scope: { agents: ["mira"] }, match: { tools: ["send_email"] }, effect: "deny", createdBy: "owner", reason: "Mira never sends email" };
    const fake = fakeCrusoe([{ toolCalls: [{ name: "send_email", args: { to: "ana@acme.com", body: "Hi" } }] }, { text: "I can't send email." }]);
    rt = runtime(fake, fakeYou(), { tools: () => [sendEmail], rules: async () => [...DEFAULT_RULES, noMail] });

    const { runId } = rt.send(T, { text: "Email Ana." });
    await rt.idle(T);

    expect(ran).toBe(false);
    expect(fake.requests).toHaveLength(2);
    const [result] = toolResults(fake.requests[1]);
    expect(result).toMatch(/Mira never sends email/);
    expect(db.approvals.pending({ thread: T })).toEqual([]);
    expect(db.runs.get(runId!)?.status).toBe("done");
  }, 30_000);

  it.each(["start_team", "set_charter"])("runs %s without asking: the owner's go on the launch is the approval", async (name) => {
    let ran = false;
    const stub = tool(
      async () => {
        ran = true;
        return "ok";
      },
      { name, description: "Stand-in.", schema: z.object({}).passthrough() },
    );
    const fake = fakeCrusoe([{ toolCalls: [{ name, args: {} }] }, { text: "Done." }]);
    rt = runtime(fake, fakeYou(), { tools: () => [stub] });

    const { runId } = rt.send(T, { text: "Go." });
    await rt.idle(T);

    expect(ran).toBe(true);
    expect(db.approvals.pending({ thread: T })).toEqual([]);
    expect(db.runs.get(runId!)?.status).toBe("done");
  }, 30_000);

  it("parks an owner message sent while the thread waits, and delivers it in the resumed run", async () => {
    const fake = fakeCrusoe([research(), { text: "Done." }]);
    rt = runtime(fake, fakeYou());
    rt.send(T, { text: "Research this." });
    await rt.idle(T);
    const [{ id }] = db.approvals.pending({ thread: T });

    const parked = rt.send(T, { text: "Also keep it short." });
    expect(parked.delivered).toBe("inbox");
    await rt.idle(T);
    expect(fake.requests).toHaveLength(1);

    await rt.decide(id, "approve");
    await rt.idle(T);
    expect(fake.requests).toHaveLength(2);
    const last = fake.requests[1].messages.filter((m) => m.role !== "system").at(-1);
    expect(last).toMatchObject({ role: "user" });
    expect(textOf(last?.content)).toBe("Also keep it short.");
  }, 30_000);
});
