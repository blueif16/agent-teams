import { describe, expect, it } from "vitest";
import { ARCHETYPES } from "../skills/archetypes";
import { getTool, REGISTRY } from "./registry";
import { resolveToolset } from "./resolve";

/*
 * The two halves of an archetype's toolset, built separately: ArchetypeDef.tools (skills/archetypes.ts) lists
 * registry ids, and each ToolDef (tools/registry.ts) names the archetypes it belongs to. They must agree, or the
 * runtime and the Permissions view disagree about what an agent has.
 */
describe("archetypes ↔ tool registry", () => {
  it("every id an archetype lists is a registry tool", () => {
    for (const a of ARCHETYPES) for (const id of a.tools) expect(getTool(id), `${a.id} lists unknown tool "${id}"`).toBeDefined();
  });

  it("every tool an archetype lists names that archetype (or every archetype) in the registry", () => {
    for (const a of ARCHETYPES)
      for (const id of a.tools) expect(getTool(id)?.archetypes, `${id} doesn't name ${a.id}`).toEqual(expect.arrayContaining([expect.toBeOneOf([a.id, "*"])]));
  });

  it("every registry tool that names an archetype is in that archetype's list", () => {
    for (const d of REGISTRY)
      for (const owner of d.archetypes) {
        const a = ARCHETYPES.find((x) => x.id === owner);
        if (owner === "*" || !a) continue;
        expect(a.tools, `${d.id} names ${owner}, but ${owner} doesn't list it`).toContain(d.id);
      }
  });

  it("every archetype resolves at least one action tool and one presentation tool", () => {
    for (const a of ARCHETYPES) {
      const { tools, dropped } = resolveToolset(a, undefined, { sandbox: false, includePlanned: true });
      expect(dropped.filter((d) => d.reason === "unknown"), a.id).toEqual([]);
      expect(tools.some((t) => t.kind === "action"), `${a.id} has no action tool`).toBe(true);
      expect(tools.some((t) => t.kind === "present"), `${a.id} has no presentation tool`).toBe(true);
    }
  });
});
