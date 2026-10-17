import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAgentFiles, writeAgentFile } from "@/lib/agent-files";
import { workerBackend } from "./backends";
import { openCheckpointer } from "./checkpointer";
import { openRuntimeDb, type RuntimeDb } from "./db";
import { tempEnv, type TempEnv } from "./testing/env";
import { fakeCrusoe, systemOf, textOf, type Step } from "./testing/fake-crusoe";
import { getVault } from "./vault";
import { buildWorker } from "./worker";

/*
 * R2 (D §11 step 2, adjusted to main): Mira's home files come from the vault and are fresh on every model
 * call; /home/ and /skills/ are read-only to the agent; /project/ is the project's folder on disk; the agent
 * has exactly its archetype's ready tools, so no execute and no shell.
 */
let env: TempEnv;
let db: RuntimeDb;
let checkpointer: ReturnType<typeof openCheckpointer>;

beforeEach(async () => {
  env = await tempEnv();
  db = openRuntimeDb(path.join(env.data, "runtime.db"));
  checkpointer = openCheckpointer(path.join(env.data, "checkpoints.db"));
});
afterEach(async () => {
  checkpointer.db.close();
  db.close();
  await env.cleanup();
});

const mira = (steps: Step[] = []) => {
  const fake = fakeCrusoe(steps);
  const agent = buildWorker(db.agents.get("mira")!, db.projects.get("dm")!, { checkpointer, fetch: fake.fetch });
  return { fake, agent };
};
const say = (text: string) => ({ messages: [{ role: "user", content: text }] });
const memoryFile = () => path.join(getVault().dir, "agents", "mira", "MEMORY.md");

describe("HomeFiles", () => {
  it("puts a MEMORY.md line saved through the vault between runs into the next model call, after the identity", async () => {
    const { fake, agent } = mira([{ text: "Hi." }, { text: "Noted." }]);
    await agent.invoke(say("Hello"));

    const line = `- Lead with the cost line in every recommendation. [m_${randomUUID().slice(0, 8)}]`;
    const { memory } = await readAgentFiles("mira");
    await writeAgentFile("mira", "memory", `${memory.content.trimEnd()}\n${line}\n`);
    await agent.invoke(say("What should I know?"));

    expect(fake.requests).toHaveLength(2);
    expect(systemOf(fake.requests[0])).not.toContain(line);
    const system = systemOf(fake.requests[1]);
    expect(system).toContain(line);
    expect(system.indexOf("You are Mira")).toBeGreaterThanOrEqual(0);
    expect(system.indexOf("You are Mira")).toBeLessThan(system.indexOf(line));
  }, 30_000);
});

describe("workerBackend through the agent", () => {
  it("refuses write_file to /home/MEMORY.md: an error for the model, and no change or commit in the vault", async () => {
    const { fake, agent } = mira([
      { toolCalls: [{ name: "write_file", args: { file_path: "/home/MEMORY.md", content: "# Overwritten\n" } }] },
      { text: "I couldn't." },
    ]);
    await readAgentFiles("mira");
    const before = await readFile(memoryFile(), "utf8");
    const commits = (await getVault().history("agents/mira/MEMORY.md")).commits.length;

    await agent.invoke(say("Rewrite your memory."));

    const result = fake.requests[1].messages.find((m) => m.role === "tool");
    expect(textOf(result?.content)).toMatch(/read-only/i);
    expect(await readFile(memoryFile(), "utf8")).toBe(before);
    expect((await getVault().history("agents/mira/MEMORY.md")).commits).toHaveLength(commits);
  }, 30_000);

  it("lands write_file to /project/x.md in <DATA_DIR>/projects/<project>/files/x.md", async () => {
    const { agent } = mira([
      { toolCalls: [{ name: "write_file", args: { file_path: "/project/x.md", content: "# Brief\n" } }] },
      { text: "Written." },
    ]);
    await agent.invoke(say("Write the brief."));

    expect(await readFile(path.join(env.data, "projects", "dm", "files", "x.md"), "utf8")).toBe("# Brief\n");
  }, 30_000);
});

describe("the compiled agent's tools", () => {
  const FILE_TOOLS = ["edit_file", "glob", "grep", "ls", "read_file", "write_file"];

  it("are the archetype's ready file tools plus write_todos: no execute, shell, delete or task", async () => {
    const { fake, agent } = mira([{ text: "Hi." }]);
    await agent.invoke(say("Hello"));

    // What the graph can execute (its tools node) and what the model is offered.
    const node = (agent.graph.nodes as unknown as Record<string, { bound?: { tools?: { name: string }[] } }>).tools;
    const executable = (node?.bound?.tools ?? []).map((t) => t.name).sort();
    const offered = (fake.requests[0].tools ?? []).map((t) => t.function.name).sort();
    expect(executable).toEqual([...FILE_TOOLS, "write_todos"].sort());
    expect(offered).toEqual(executable);
    for (const name of ["execute", "shell", "delete", "task"]) expect(executable).not.toContain(name);
  }, 30_000);
});

describe("workerBackend", () => {
  it("serves /home/ from the vault and refuses every write there and under /skills/", async () => {
    process.env.SKILLS_DIR = path.join(env.cwd, "skills");
    try {
      await mkdir(process.env.SKILLS_DIR, { recursive: true });
      await writeFile(path.join(process.env.SKILLS_DIR, "README.md"), "skills\n");
      const { soul } = await readAgentFiles("mira");
      const backend = workerBackend("mira", "dm");

      const read = await backend.read("/home/SOUL.md");
      expect(read.error).toBeUndefined();
      expect(JSON.stringify(read.content)).toContain(soul.content.split("\n")[0]);

      expect((await backend.write("/home/notes.md", "a note\n")).error).toMatch(/read-only/i);
      expect((await backend.edit("/home/SOUL.md", soul.content.split("\n")[0], "# Hijacked")).error).toMatch(/read-only/i);
      expect((await backend.write("/skills/evil/SKILL.md", "x\n")).error).toMatch(/read-only/i);

      expect(existsSync(path.join(getVault().dir, "agents", "mira", "notes.md"))).toBe(false);
      expect((await readAgentFiles("mira")).soul.content).toBe(soul.content);
      expect(existsSync(path.join(process.env.SKILLS_DIR, "evil"))).toBe(false);
    } finally {
      delete process.env.SKILLS_DIR;
    }
  }, 30_000);
});

describe("summarization (D finding 7)", () => {
  it("triggers at 60K tokens, not the 170K default, and offloads the old messages under <DATA_DIR>/history", async () => {
    const summarize: Step = (req) =>
      /summar/i.test(textOf(req.messages.at(-1)?.content) + systemOf(req)) && !req.tools?.length ? { text: "Summary of the earlier talk." } : { text: "Answer." };
    const { agent } = mira([summarize, summarize, summarize]);
    // ~75K tokens in 30 messages: over 60K, under 170K, and more than the 20 messages it keeps.
    const filler = "lorem ipsum ".repeat(830);
    const messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `${i}: ${filler}` }));
    await agent.invoke({ messages: [...messages, { role: "user", content: "Where were we?" }] });

    const history = path.join(env.data, "history", "mira", "dm");
    expect(existsSync(history) ? readdirSync(history).filter((f) => f.endsWith(".md")) : []).not.toEqual([]);
  }, 60_000);
});
