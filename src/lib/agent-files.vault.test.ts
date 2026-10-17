import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * SOUL.md and MEMORY.md live in the vault (design §8b): every change is a commit with its source, the repo's
 * agents/ folder only seeds it, and secrets are scrubbed before anything reaches git.
 */
type Global = { __agentTeamsCache?: { close(): void }; __agentTeamsVault?: unknown };
const SOUL = "agents/mira/SOUL.md";
// gitleaks' aws-access-token shape; not a real key.
const FAKE_AWS_KEY = "AKIAQX3RTV7PLM2KD6WZ";

describe("agent files in the vault", () => {
  let root: string;
  let cwd: { mockRestore(): void };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agent-vault-"));
    cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.resetModules();
    delete (globalThis as Global).__agentTeamsCache;
    delete (globalThis as Global).__agentTeamsVault;
  });

  afterEach(async () => {
    (globalThis as Global).__agentTeamsCache?.close();
    delete (globalThis as Global).__agentTeamsCache;
    delete (globalThis as Global).__agentTeamsVault;
    cwd.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  const load = async () => ({ ...(await import("@/lib/agent-files")), ...(await import("@/server/runtime/vault")) });

  it("seeds the vault from the repo's agents/ folder on first read", async () => {
    await mkdir(path.join(root, "agents", "mira"), { recursive: true });
    await writeFile(path.join(root, "agents", "mira", "SOUL.md"), "# Mira's soul\n\nFrom the repo.\n");
    const { readAgentFiles, getVault } = await load();

    expect((await readAgentFiles("mira")).soul.content).toBe("# Mira's soul\n\nFrom the repo.\n");
    const { commits } = await getVault().history(SOUL);
    expect(commits.map((c) => c.source)).toEqual(["seed"]);
  }, 60_000);

  it("creates a missing file from its template as a seed commit", async () => {
    const { readAgentFiles, getVault } = await load();

    const { memory } = await readAgentFiles("mira");
    const { commits } = await getVault().history("agents/mira/MEMORY.md");
    expect(commits).toHaveLength(1);
    expect(commits[0].source).toBe("seed");
    expect(await getVault().show("agents/mira/MEMORY.md")).toBe(memory.content);
  }, 60_000);

  it("commits an owner save, and the next read returns it", async () => {
    const { readAgentFiles, writeAgentFile, getVault } = await load();
    await readAgentFiles("mira");

    await writeAgentFile("mira", "soul", "# Mira's soul\n\nShip on Fridays.");
    const { commits } = await getVault().history(SOUL);
    expect(commits[0].source).toBe("owner");
    expect(await getVault().show(SOUL)).toBe("# Mira's soul\n\nShip on Fridays.\n");
    expect((await readAgentFiles("mira")).soul.content).toBe("# Mira's soul\n\nShip on Fridays.\n");
  }, 60_000);

  it("commits a 📌 standing instruction as a pin", async () => {
    const { readAgentFiles, addStandingInstruction, getVault } = await load();
    await readAgentFiles("mira");

    await addStandingInstruction("mira", "Lead with the number.");
    const { commits } = await getVault().history(SOUL);
    expect(commits[0].source).toBe("pin");
    expect(await getVault().show(SOUL)).toContain("Lead with the number.");
  }, 60_000);

  it("never lets a secret pasted into a save reach the vault or the next read", async () => {
    const { readAgentFiles, writeAgentFile, getVault } = await load();
    await readAgentFiles("mira");

    await writeAgentFile("mira", "soul", `# Mira's soul\n\nDeploy key: ${FAKE_AWS_KEY}\n`);
    expect(await getVault().show(SOUL)).not.toContain(FAKE_AWS_KEY);
    expect((await readAgentFiles("mira")).soul.content).not.toContain(FAKE_AWS_KEY);
  }, 60_000);
});
