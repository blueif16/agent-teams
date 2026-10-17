import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "@/lib/policy/defaults";
import { readBack, readBackAll } from "@/lib/policy/readback";
import type { Rule } from "@/lib/policy/types";

const byId = (id: string) => DEFAULT_RULES.find((r) => r.id === id)!;

describe("readBack: tool rules", () => {
  it("deny, for everyone", () => {
    const r: Rule = { id: "r_exec01", kind: "tool", scope: {}, match: { tools: ["execute"] }, effect: "deny", createdBy: "owner" };
    expect(readBack(r)).toBe("No agent can run shell commands.");
  });

  it("locked ask", () => {
    expect(readBack(byId("r_buy001"))).toBe("Always ask you before any agent can buy things, make payments, connect accounts or read credentials.");
  });

  it("allow with an arg constraint, for an archetype", () => {
    const r: Rule = {
      id: "r_rsch01",
      kind: "tool",
      scope: { archetypes: ["researcher"] },
      match: { tools: ["web_search", "fetch_page"] },
      effect: "allow",
      args: [{ path: "url", op: "domain_not_in", value: ["pastebin.com", "webhook.site"] }],
      createdBy: "owner",
    };
    expect(readBack(r)).toBe("Researchers can search the web or open web pages without asking when the URL is outside pastebin.com or webhook.site.");
  });

  it("ask with a taint condition", () => {
    expect(readBack(byId("r_taint1"))).toBe(
      "Always ask you before any agent can open web pages, send email, post messages, create calendar events, call web APIs or call APIs when the agent has seen untrusted content and the destination came from untrusted content.",
    );
  });

  it("names the raw-IP pattern instead of printing the regex", () => {
    expect(readBack(byId("r_rawip1"))).toBe("No agent can use any tool when the URL points at a raw IP address.");
  });

  it("uses the agent's name", () => {
    const r: Rule = { id: "r_mira01", kind: "tool", scope: { agents: ["mira"] }, match: { tools: ["send_email"] }, effect: "ask", createdBy: "owner" };
    expect(readBack(r)).toBe("Ask you before Mira can send email.");
  });
});

describe("readBack: flow rules", () => {
  it("block with a recipient constraint, in a project (E's R5)", () => {
    const r: Rule = {
      id: "r_acme01",
      kind: "flow",
      scope: { projects: ["acme-launch"] },
      labels: ["project:acme-launch", "pii.*"],
      sinks: ["email"],
      where: [{ path: "to[*]", op: "domain_not_in", value: ["acme.com"] }],
      action: "block",
      createdBy: "nl-compiler",
    };
    expect(readBack(r)).toBe("Block acme-launch project data or personal info from going to email in project acme-launch when any recipient is outside acme.com.");
  });

  it("names cc and bcc recipients apart, so ANDed constraints read as AND", () => {
    const r: Rule = {
      id: "r_ccbcc1",
      kind: "flow",
      scope: {},
      labels: ["pii.*"],
      sinks: ["email"],
      where: [
        { path: "to[*]", op: "domain_not_in", value: ["acme.com"] },
        { path: "cc[*]", op: "domain_not_in", value: ["acme.com"] },
        { path: "bcc[*]", op: "domain_not_in", value: ["acme.com"] },
      ],
      action: "block",
      createdBy: "nl-compiler",
    };
    expect(readBack(r)).toBe(
      "Block personal info from going to email when any recipient is outside acme.com and any cc recipient is outside acme.com and any bcc recipient is outside acme.com.",
    );
  });

  it("tokenize", () => {
    expect(readBack(byId("r_secr01"))).toBe("Replace secrets with placeholders before they reach any model.");
  });

  it("ask", () => {
    expect(readBack(byId("r_proj02"))).toBe("Ask you before project data can go to cross-project memory.");
  });

  it("block to several sinks", () => {
    expect(readBack(byId("r_secr03"))).toBe("Block secrets from going to the web, email, the calendar, any API or other projects.");
  });

  it("says when a rule expires and when it only logs", () => {
    const r: Rule = {
      id: "r_shad01",
      kind: "flow",
      scope: {},
      labels: ["pii.email"],
      sinks: ["web"],
      action: "redact",
      mode: "shadow",
      expiresAt: "2026-11-01T00:00:00Z",
      createdBy: "owner",
    };
    expect(readBack(r)).toBe("Remove email addresses before they reach the web, until Nov 1, 2026 (shadow mode: logged, not enforced).");
  });
});

describe("readBack: grants", () => {
  it("a recipient grant on a project, until a date (E's R7)", () => {
    const r: Rule = {
      id: "r_g7f3a1",
      kind: "grant",
      scope: { agents: ["pip"], projects: ["acme-launch"] },
      tool: "send_email",
      args: [{ path: "to[*]", op: "in", value: ["sam@acme.com"] }],
      grantScope: "project",
      expiresAt: "2026-11-16T00:00:00Z",
      createdBy: "approval",
    };
    expect(readBack(r)).toBe("Pip can send email without asking in project acme-launch when every recipient is sam@acme.com, until Nov 16, 2026.");
  });

  it("a one-time grant", () => {
    const r: Rule = {
      id: "r_once01",
      kind: "grant",
      scope: { agents: ["pip"] },
      tool: "post_message",
      args: [{ path: "channel", op: "in", value: ["launch"] }],
      grantScope: "once",
      createdBy: "approval",
    };
    expect(readBack(r)).toBe("Pip can post messages without asking when the channel is launch, once.");
  });
});

describe("readBack: budgets", () => {
  it("a call cap per run", () => {
    const r: Rule = { id: "r_bud001", kind: "budget", scope: {}, match: { tools: ["web_search"] }, metric: "calls", limit: { amount: 20, per: "run" }, onExceed: "end", createdBy: "owner" };
    expect(readBack(r)).toBe("Each agent can search the web at most 20 times per run, then end the run.");
  });

  it("a spending cap per day", () => {
    const r: Rule = { id: "r_bud002", kind: "budget", scope: { agents: ["*"] }, metric: "cost_usd", limit: { amount: 2, per: "day" }, onExceed: "pause_agent", createdBy: "owner" };
    expect(readBack(r)).toBe("Each agent can spend at most $2 per day, then pause the agent.");
  });
});

describe("readBack: classifiers", () => {
  it("terms and a pattern, ignoring case (E's Bluebird classifier)", () => {
    const r: Rule = {
      id: "r_cls001",
      kind: "classifier",
      scope: { projects: ["bluebird"] },
      label: "project:bluebird",
      detect: { terms: ["Bluebird", "Kestrel Foods"], regex: ["\\bKF-\\d{6}\\b"], caseInsensitive: true },
      createdBy: "owner",
    };
    expect(readBack(r)).toBe("Treat text mentioning Bluebird or Kestrel Foods, or matching \\bKF-\\d{6}\\b, as bluebird project data in project bluebird, ignoring case.");
  });
});

describe("readBackAll", () => {
  it("maps every rule id to its sentence", () => {
    const map = readBackAll(DEFAULT_RULES);
    expect(Object.keys(map).sort()).toEqual(DEFAULT_RULES.map((r) => r.id).sort());
    expect(map.r_proj01).toBe("Block project data from going to other projects.");
  });
});
