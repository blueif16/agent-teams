import { describe, expect, it, vi } from "vitest";

/*
 * Mira's prompt is evaluated live (it needs Crusoe); these are the deterministic checks that can fail in CI: the
 * example fence she copies is a valid v2 fence with options, the staffable archetypes come from code, and the old
 * roster staffing she used to follow (pick agent ids, one leadId) is gone.
 */
vi.mock("@/server/directory", () => ({ getAgent: () => undefined }));

const org = { teams: [] };
const files = { soul: "# Mira's soul", memory: "# Mira's memory" };

describe("chiefPrompt", () => {
  it("shows an example fence that parses as v2 with 2 to 3 options", async () => {
    const { chiefPrompt } = await import("./chief-prompt");
    const { parseProject, PROJECT_FENCE } = await import("./project");
    const prompt = chiefPrompt(org, [], files, "Sat, Oct 17, 2026");
    const at = prompt.indexOf(PROJECT_FENCE);
    expect(at).toBeGreaterThan(-1);
    const parsed = parseProject(prompt.slice(at));
    expect(parsed).not.toBeNull();
    expect(parsed!.options.length).toBeGreaterThanOrEqual(2);
    expect(parsed!.options.length).toBeLessThanOrEqual(3);
    expect(new Set(parsed!.options.map((o) => o.kind))).toEqual(new Set(["solo", "project"]));
  });

  it("lists every staffable archetype and no others", async () => {
    const { chiefPrompt } = await import("./chief-prompt");
    const { STAFFABLE } = await import("./project");
    const prompt = chiefPrompt(org, [], files, "Sat, Oct 17, 2026");
    for (const a of STAFFABLE) expect(prompt).toMatch(new RegExp(`^- ${a}: `, "m"));
    expect(prompt).not.toMatch(/^- (chief|coordinator): /m);
  });

  it("no longer staffs from a roster of agent ids", async () => {
    const { chiefPrompt } = await import("./chief-prompt");
    const prompt = chiefPrompt(org, [], files, "Sat, Oct 17, 2026");
    expect(prompt).not.toMatch(/roster id|leadId|"members"|Roster for staffing/);
  });
});
