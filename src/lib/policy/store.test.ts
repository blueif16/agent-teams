import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "@/lib/policy/defaults";
import { policyStore, RuleValidationError } from "@/lib/policy/store";
import type { Rule } from "@/lib/policy/types";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "policy-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const owner = (over: Partial<Rule> = {}): Rule =>
  ({ id: "r_own001", kind: "tool", scope: {}, match: { tools: ["send_email"] }, effect: "deny", createdBy: "owner", ...over }) as Rule;

describe("policyStore", () => {
  it("lists exactly the defaults when nothing is saved", async () => {
    expect(await policyStore(dir).list()).toEqual(DEFAULT_RULES);
  });

  it("persists saved rules to rules.json and merges them with the defaults", async () => {
    await policyStore(dir).save([owner()], { mode: "enforce" });
    const onDisk = JSON.parse(await readFile(path.join(dir, "rules.json"), "utf8"));
    expect(onDisk.rules.map((r: Rule) => r.id)).toEqual(["r_own001"]);
    const listed = await policyStore(dir).list();
    expect(listed.map((r) => r.id)).toEqual([...DEFAULT_RULES.map((r) => r.id), "r_own001"]);
  });

  it("saves each rule in the requested mode", async () => {
    const [saved] = await policyStore(dir).save([owner()], { mode: "shadow" });
    expect(saved.mode).toBe("shadow");
    expect((await policyStore(dir).list()).find((r) => r.id === "r_own001")?.mode).toBe("shadow");
  });

  it("gives a rule a fresh id when its id is already taken", async () => {
    const store = policyStore(dir);
    const [a] = await store.save([owner({ id: "r_secr01" })], { mode: "enforce" });
    const [b] = await store.save([owner()], { mode: "enforce" });
    const [c] = await store.save([owner()], { mode: "enforce" });
    expect(a.id).not.toBe("r_secr01");
    expect(a.id).toMatch(/^r_[a-z0-9]{6,}$/);
    expect(b.id).toBe("r_own001");
    expect(c.id).not.toBe("r_own001");
    expect(new Set((await store.list()).map((r) => r.id)).size).toBe(DEFAULT_RULES.length + 3);
  });

  it("rejects an invalid rule and writes nothing", async () => {
    const bad = { ...owner(), scope: { agent: ["pip"] } } as unknown as Rule;
    await expect(policyStore(dir).save([owner({ id: "r_own002" }), bad], { mode: "enforce" })).rejects.toBeInstanceOf(RuleValidationError);
    expect(await policyStore(dir).list()).toEqual(DEFAULT_RULES);
  });

  it("refuses to save a rule that claims to be a default", async () => {
    await expect(policyStore(dir).save([owner({ createdBy: "default" })], { mode: "enforce" })).rejects.toBeInstanceOf(RuleValidationError);
  });

  it("deletes an owner rule", async () => {
    const store = policyStore(dir);
    await store.save([owner()], { mode: "enforce" });
    expect((await store.list()).some((r) => r.id === "r_own001")).toBe(true);
    expect(await store.remove("r_own001")).toEqual({ ok: true });
    expect((await store.list()).some((r) => r.id === "r_own001")).toBe(false);
  });

  it("refuses to delete a default, a locked rule, or a rule it doesn't have", async () => {
    const store = policyStore(dir);
    await store.save([owner({ locked: true })], { mode: "enforce" });
    expect(await store.remove("r_proj01")).toEqual({ ok: false, reason: "default" });
    expect(await store.remove("r_own001")).toEqual({ ok: false, reason: "locked" });
    expect(await store.remove("r_nope00")).toEqual({ ok: false, reason: "not_found" });
    expect((await store.list()).some((r) => r.id === "r_own001")).toBe(true);
  });

  it("keeps both of two concurrent saves", async () => {
    const store = policyStore(dir);
    await Promise.all([store.save([owner({ id: "r_aaa001" })], { mode: "enforce" }), store.save([owner({ id: "r_bbb001" })], { mode: "enforce" })]);
    const ids = (await policyStore(dir).list()).map((r) => r.id);
    expect(ids).toContain("r_aaa001");
    expect(ids).toContain("r_bbb001");
  });

  it("fails closed on a corrupt rules file instead of dropping rules", async () => {
    await writeFile(path.join(dir, "rules.json"), "{ not json");
    await expect(policyStore(dir).list()).rejects.toThrow();
  });
});
