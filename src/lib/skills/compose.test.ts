import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { createDeepAgent } from "deepagents";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compose, materializeSkills } from "./compose";
import { findSkill } from "./find";
import { loadLibrary } from "./library";
import { createSearchSkills } from "./search";
import type { Composition } from "./types";
import { createResearch } from "./youcom";

const DIR = fileURLToPath(new URL("./__fixtures__/skills", import.meta.url));
const onDisk = (rel: string) => readFileSync(`${DIR}/library/${rel}`, "utf8");

const composition = (skills: string[]): Composition => ({
  id: "c1",
  archetype: "engineer",
  skills,
  role: "Frontend engineer",
  qualifications: [],
  source: "orchestrator",
  createdAt: "2026-10-17T00:00:00.000Z",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("materializeSkills", () => {
  it("maps each skill's files under /skills/<frontmatter name>/, the folder Deep Agents reads", async () => {
    const lib = await loadLibrary(DIR);
    const files = await materializeSkills(composition(["obra/systematic-debugging", "vercel-labs/react-best-practices"]), lib);
    expect(Object.keys(files).sort()).toEqual([
      "/skills/systematic-debugging/SKILL.md",
      "/skills/vercel-react-best-practices/SKILL.md",
      "/skills/vercel-react-best-practices/rules/async-parallel.md",
    ]);
    expect(files["/skills/systematic-debugging/SKILL.md"]).toBe(onDisk("obra/systematic-debugging/SKILL.md"));
    expect(files["/skills/vercel-react-best-practices/rules/async-parallel.md"]).toBe(onDisk("vercel-labs/react-best-practices/rules/async-parallel.md"));
  });

  it("is an empty map for a composition with no skills", async () => {
    expect(await materializeSkills(composition([]), await loadLibrary(DIR))).toEqual({});
  });

  it("refuses skills that must not reach an agent: unknown, link-only, scan-failed, or shipping code", async () => {
    const lib = await loadLibrary(DIR);
    await expect(materializeSkills(composition(["nobody/nothing"]), lib)).rejects.toThrow(/unknown/i);
    await expect(materializeSkills(composition(["anthropics/pptx"]), lib)).rejects.toThrow(/not vendored/);
    await expect(materializeSkills(composition(["quickfix-labs/debug-anything"]), lib)).rejects.toThrow(/scan/);
    await expect(materializeSkills(composition(["anthropics/webapp-testing"]), lib)).rejects.toThrow(/executable|sandbox/);
  });

  it("loads into a Deep Agent's skills list from skills: ['/skills/'], spec-clean", async () => {
    const lib = await loadLibrary(DIR);
    const files = await materializeSkills(composition(["obra/systematic-debugging", "vercel-labs/react-best-practices"]), lib);
    const warn = vi.spyOn(console, "warn");

    /** Records the system prompt it is given and answers once. */
    class RecordingModel extends BaseChatModel {
      system = "";
      constructor() {
        super({});
      }
      _llmType() {
        return "recording";
      }
      bindTools() {
        return this;
      }
      async _generate(messages: BaseMessage[]): Promise<ChatResult> {
        this.system = messages.find((m) => m.getType() === "system")?.text ?? "";
        return { generations: [{ text: "ok", message: new AIMessage("ok") }] };
      }
    }
    const model = new RecordingModel();
    const now = new Date().toISOString();
    const state = Object.fromEntries(Object.entries(files).map(([p, content]) => [p, { content, mimeType: "text/markdown", created_at: now, modified_at: now }]));
    const agent = createDeepAgent({ model, systemPrompt: "You are a test engineer.", skills: ["/skills/"] });
    const result = await agent.invoke({ messages: [{ role: "user", content: "hi" }], files: state });

    const loaded = (result as unknown as { skillsMetadata: { name: string; path: string }[] }).skillsMetadata;
    expect(loaded.map((s) => [s.name, s.path]).sort()).toEqual([
      ["systematic-debugging", "/skills/systematic-debugging/SKILL.md"],
      ["vercel-react-best-practices", "/skills/vercel-react-best-practices/SKILL.md"],
    ]);
    expect(model.system).toContain("/skills/vercel-react-best-practices/SKILL.md");
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/Agent Skills spec/);
  }, 30_000);
});

describe("compose", () => {
  const RESPONSE = readFileSync(new URL("./__fixtures__/youcom/research-skill-candidates.json", import.meta.url), "utf8");

  async function setup() {
    const library = await loadLibrary(DIR);
    const research: { body: unknown }[] = [];
    const youFetch: typeof fetch = async (_u, init) => {
      research.push({ body: JSON.parse(String(init?.body)) });
      return new Response(RESPONSE, { status: 200 });
    };
    const githubFetch: typeof fetch = async () => new Response(JSON.stringify({ message: "Not Found", status: "404" }), { status: 404 });
    const deps = {
      library,
      find: (need: string, ctx: Parameters<typeof findSkill>[1]) =>
        findSkill(need, ctx, { search: createSearchSkills(library.index.skills), research: createResearch({ apiKey: "k", fetch: youFetch }), githubFetch, githubToken: "" }),
    };
    return { deps, research };
  }

  it("composes an archetype with the library skills that cover the role's qualifications", async () => {
    const { deps } = await setup();
    const { composition: c } = await compose(
      { archetype: "engineer", role: "Frontend engineer", qualifications: ["find the root cause of bugs", "speed up slow Next.js pages"] },
      deps,
    );
    expect(c.skills).toEqual(["obra/systematic-debugging", "vercel-labs/react-best-practices"]);
    expect(c).toMatchObject({ archetype: "engineer", role: "Frontend engineer", source: "orchestrator", qualifications: ["find the root cause of bugs", "speed up slow Next.js pages"] });
    expect(c.basedOn).toBeUndefined();
    expect(c.id).toMatch(/\S/);
    expect(new Date(c.createdAt).toISOString()).toBe(c.createdAt);
  });

  it("returns a need the library misses as pending web candidates for approval, not as a skill", async () => {
    const { deps, research } = await setup();
    const { composition: c, pending } = await compose(
      { archetype: "engineer", role: "Data engineer", qualifications: ["find the root cause of bugs", "design ClickHouse table schemas"] },
      deps,
    );
    expect(c.skills).toEqual(["obra/systematic-debugging"]);
    expect(research).toHaveLength(1);
    expect(pending.map((p) => p.need)).toEqual(["design ClickHouse table schemas"]);
    expect(pending[0].result.source).toBe("web");
  });

  it("leaves out link-only skills and skills that ship code, and never picks one twice", async () => {
    const { deps } = await setup();
    const { composition: c } = await compose(
      {
        archetype: "engineer",
        role: "QA engineer",
        qualifications: ["build a slide deck for the board meeting", "test web apps in a browser with playwright screenshots", "root cause of a bug", "fix a bug at its root cause"],
      },
      deps,
    );
    expect(c.skills).not.toContain("anthropics/pptx");
    expect(c.skills).not.toContain("anthropics/webapp-testing");
    expect(c.skills.filter((s) => s === "obra/systematic-debugging")).toHaveLength(1);
  });

  it("searches the role itself when there are no qualifications", async () => {
    const { deps } = await setup();
    const { composition: c } = await compose({ archetype: "designer", role: "Poster designer", qualifications: [] }, deps);
    expect(c.skills).toEqual(["anthropics/canvas-design"]);
  });

  it("keeps the skill list small: at most maxSkills", async () => {
    const { deps } = await setup();
    const { composition: c } = await compose(
      { archetype: "engineer", role: "Engineer", qualifications: ["root cause of a bug", "write the failing test first", "speed up slow Next.js pages", "turn a spec into an implementation plan"] },
      { ...deps, maxSkills: 2 },
    );
    expect(c.skills).toHaveLength(2);
  });
});
