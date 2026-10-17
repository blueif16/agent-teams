import { describe, expect, it } from "vitest";
import { derivationsOf, originOf, relativeTime, sourceChip, summaryOf } from "./present";
import type { VaultCommit, VaultSource } from "./types";

/*
 * What the History view says about a file's commits: where it came from,
 * which chip each row wears, and what each change was derived from.
 */

let n = 0;
function commit(source: VaultSource, trailers: Record<string, string[]> = {}, at = "2026-10-15T09:12:00.000Z"): VaultCommit {
  n += 1;
  return {
    change: `c_${String(n).padStart(26, "0")}`,
    sha: String(n).padStart(40, "0"),
    at,
    author: source === "owner" || source === "pin" ? { kind: "owner", id: "owner", name: "Owner" } : { kind: "agent", id: "ada", name: "Ada" },
    subject: "memory(nova): something",
    source,
    trailers,
    stats: { added: 1, removed: 0 },
  };
}

describe("originOf", () => {
  it("names the parent agents of a file whose first commit was seeded from them", () => {
    const first = commit("seed", {
      "Seeded-From": ["pip@v3 c_01J9ZK5R2C7A", "rex@v2 c_01J8QQ0H6D2E"],
      "Derived-From": ["m_a101 <- pip:m_7f3a", "m_a102 <- pip:m_91c2 + rex:m_5e10"],
    });
    // Newest first: the origin is the last commit, whatever came after it.
    const origin = originOf([commit("owner"), commit("seed", { "Seeded-From": ["zed@v9 c_X"] }), first]);
    expect(origin).toEqual({
      kind: "inherited",
      at: first.at,
      parents: [
        { agent: "pip", version: "v3", change: "c_01J9ZK5R2C7A" },
        { agent: "rex", version: "v2", change: "c_01J8QQ0H6D2E" },
      ],
      carried: 2,
    });
  });

  it("calls a first seed commit without parents the archetype template", () => {
    expect(originOf([commit("pin"), commit("seed", { Archetype: ["researcher"] })])).toMatchObject({ kind: "template", archetype: "researcher" });
    expect(originOf([commit("seed")])).toMatchObject({ kind: "template", archetype: null });
  });

  it("credits whoever made the first commit when it wasn't a seed", () => {
    const first = commit("owner");
    expect(originOf([commit("dream"), first])).toEqual({ kind: "created", at: first.at, author: first.author });
  });

  it("has no origin for a file with no commits", () => {
    expect(originOf([])).toBeNull();
  });
});

describe("sourceChip", () => {
  it("labels each source the way the owner reads it", () => {
    const labels = (["seed", "owner", "pin", "dream", "tool", "report", "inherit", "restore"] as const).map((s) => sourceChip(s).label);
    expect(labels).toEqual(["seed", "you", "📌 pin", "dream", "tool", "report", "inherited", "restore"]);
  });
});

describe("derivationsOf", () => {
  it("turns Derived-From lines into 'new ← parent' chips, naming every parent of a merge", () => {
    const d = derivationsOf(
      commit("seed", { "Derived-From": ["m_a102 <- pip:m_91c2 + rex:m_5e10", "skill:research <- skills/researcher/research@v5"] }),
    );
    expect(d).toEqual([
      { kind: "derived", label: "m_a102 ← Pip m_91c2 + Rex m_5e10", title: "m_a102 <- pip:m_91c2 + rex:m_5e10" },
      { kind: "derived", label: "skill research ← researcher/research v5", title: "skill:research <- skills/researcher/research@v5" },
    ]);
  });

  it("gives each piece of evidence its own chip", () => {
    const d = derivationsOf(
      commit("dream", { Evidence: ["asg:41, led:2026-10-17T14:02:11Z/order, msg:a:pip:p:p_42:131, note:3, file:projects/p_42/files/reports/t7-2.md"] }),
    );
    expect(d.map((x) => [x.kind, x.label])).toEqual([
      ["evidence", "assignment 41"],
      ["evidence", "ledger order"],
      ["evidence", "message 131"],
      ["evidence", "note 3"],
      ["evidence", "t7-2.md"],
    ]);
    expect(d[2].title).toBe("msg:a:pip:p:p_42:131");
  });

  it("shows the dream and the version a restore brought back", () => {
    expect(derivationsOf(commit("dream", { Dream: ["d_01JA7Q2"] }))).toEqual([{ kind: "dream", label: "dream d_01JA7Q2", title: "d_01JA7Q2" }]);
    expect(derivationsOf(commit("restore", { Restores: ["c_01J9ZK5R2C7A"] }))).toMatchObject([{ kind: "restores", title: "c_01J9ZK5R2C7A" }]);
  });

  it("has nothing to show for a plain edit", () => {
    expect(derivationsOf(commit("owner", { Change: ["c_1"], Source: ["owner"], Agent: ["nova"] }))).toEqual([]);
  });
});

describe("summaryOf", () => {
  it("drops the conventional prefix and capitalizes the summary", () => {
    expect(summaryOf("soul(mira): pin a standing instruction")).toBe("Pin a standing instruction");
    expect(summaryOf("agent(*): import 4 existing files as the seed")).toBe("Import 4 existing files as the seed");
    expect(summaryOf("Fixed a typo by hand")).toBe("Fixed a typo by hand");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it("reads recent changes relative to now and older ones as a date", () => {
    expect(relativeTime(ago(30_000), now)).toBe("just now");
    expect(relativeTime(ago(5 * 60_000), now)).toBe("5 min ago");
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe("3 h ago");
    expect(relativeTime(ago(30 * 3_600_000), now)).toBe("yesterday");
    expect(relativeTime("2026-10-03T12:00:00Z", now)).toBe("Oct 3");
    expect(relativeTime("2025-10-03T12:00:00Z", now)).toBe("Oct 3, 2025");
  });
});
