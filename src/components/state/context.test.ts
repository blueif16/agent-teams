import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CompactionEvent, ContextStatus } from "@/lib/compaction";
import { CompactionHistory, ContextBar } from "./ContextBar";
import { compactionSteps } from "./context";

/*
 * The context bar (owner, 2026-10-17): a thin bar that fills to how much of its context the agent uses, with a tick
 * where it compacts on its own, and never a number; its history shows each compaction's steps in the order they ran,
 * with the files saved first, each opening that file's History at the change it was saved in.
 */
const status = (used: number | null, compactsAt = 2 / 3, compactions: CompactionEvent[] = []): ContextStatus => ({ agentId: "juno", used, compactsAt, compactions });

function event(steps: CompactionEvent["steps"], extra: Partial<CompactionEvent> = {}): CompactionEvent {
  return { t: "compaction", at: "2026-10-17T18:00:00.000Z", agent: "juno", project: "p_42", thread: "pm-p_42", window: 3, trigger: "soft", before: 0.7, after: 0.2, steps, degraded: false, ms: 900, usd: 0.01, ...extra };
}

const filed: CompactionEvent["steps"][number] = {
  kind: "filed",
  files: [
    { path: "projects/p_42/state/decisions.md", change: "c_01DECISIONS" },
    { path: "projects/p_42/state/prefs.md", change: "c_01PREFS" },
  ],
  items: 3,
};

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (html: string) => html.replace(/<[^>]*>/g, " ");
const fillWidth = (html: string) => /data-part="fill"[^>]*style="[^"]*width:\s*([\d.]+)%/.exec(html)?.[1];

describe("ContextBar", () => {
  it("fills to the share of context in use", () => {
    expect(Number(fillWidth(render(createElement(ContextBar, { status: status(0.3) }))))).toBeCloseTo(30, 5);
    expect(Number(fillWidth(render(createElement(ContextBar, { status: status(0.85) }))))).toBeCloseTo(85, 5);
  });

  it("marks where the agent compacts on its own", () => {
    const html = render(createElement(ContextBar, { status: status(0.3, 0.75) }));
    expect(/data-part="tick"[^>]*style="[^"]*left:\s*([\d.]+)%/.exec(html)?.[1]).toBe("75");
  });

  it("draws no fill before the agent's first model call", () => {
    expect(Number(fillWidth(render(createElement(ContextBar, { status: status(null) }))) ?? 0)).toBe(0);
  });

  it("shows no number anywhere: not in its text, its label or its value text", () => {
    for (const s of [status(0.53), status(0.97, 0.5), status(null)]) {
      const html = render(createElement(ContextBar, { status: s }));
      expect(text(html)).not.toMatch(/\d/);
      for (const attr of html.matchAll(/(?:aria-label|aria-valuetext|title)="([^"]*)"/g)) expect(attr[1]).not.toMatch(/\d/);
      expect(html).not.toMatch(/aria-valuenow/);
    }
  });
});

describe("compaction steps", () => {
  it("lists the steps in the order the compaction ran them", () => {
    const e = event([{ kind: "summarized" }, filed, { kind: "rebuilt" }, { kind: "checked", passed: 4, total: 4 }]);
    expect(compactionSteps(e).map((s) => s.label)).toEqual(["Summarized", "Saved", "Rebuilt", "Checked 4/4"]);
  });

  it("names each saved file and keeps the change it was saved in", () => {
    const [saved] = compactionSteps(event([filed]));
    expect(saved.files).toEqual([
      { name: "decisions.md", path: "projects/p_42/state/decisions.md", change: "c_01DECISIONS" },
      { name: "prefs.md", path: "projects/p_42/state/prefs.md", change: "c_01PREFS" },
    ]);
  });

  it("shows a degraded compaction's check in the caution colour", () => {
    const ok = compactionSteps(event([{ kind: "checked", passed: 4, total: 4 }]))[0];
    const bad = compactionSteps(event([{ kind: "checked", passed: 3, total: 4 }], { degraded: true }))[0];
    expect(ok.tone).toBe("ok");
    expect(bad.tone).toBe("caution");
  });
});

describe("CompactionHistory", () => {
  const steps = [filed, { kind: "summarized" } as const, { kind: "rebuilt" } as const, { kind: "checked", passed: 4, total: 4 } as const];

  it("renders each compaction's steps in event order, with a file chip per saved file that opens its change", () => {
    const html = render(createElement(CompactionHistory, { compactions: [event(steps)], onOpenFile: () => {} }));
    const order = ["Saved", "decisions.md", "prefs.md", "Summarized", "Rebuilt", "Checked 4/4"].map((w) => text(html).indexOf(w));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toMatch(/data-change="c_01DECISIONS"[^>]*>[^<]*(?:<[^>]+>[^<]*)*?decisions\.md/);
    expect(html).toMatch(/data-change="c_01PREFS"[^>]*>[^<]*(?:<[^>]+>[^<]*)*?prefs\.md/);
  });

  it("says so when there are no compactions yet", () => {
    expect(text(render(createElement(CompactionHistory, { compactions: [], onOpenFile: () => {} })))).toMatch(/No compactions yet/);
  });
});
