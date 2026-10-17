import { describe, expect, it } from "vitest";
import { INHERENT } from "@/lib/agent-files";
import type { ArchetypeDef } from "@/lib/skills/types";
import { GET } from "./route";

describe("GET /api/archetypes", () => {
  it("returns every archetype definition, with no skills attached", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchetypeDef[];
    expect(body.map((a) => a.id).sort()).toEqual(["analyst", "chief", "designer", "engineer", "lead", "researcher", "writer"]);
    expect(body.find((a) => a.id === "designer")!.inherent).toEqual(INHERENT.designer);
    for (const a of body) expect(a).not.toHaveProperty("defaultSkills");
  });
});
