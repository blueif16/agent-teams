import { describe, expect, it } from "vitest";
import type { Deliverable } from "../scenario";
import { DELIVERABLES, PATHS, edit, fakeContext, read } from "./fixtures";
import { runCheck } from "./fixtures/run";

const COPY = read("copy.md");
const LANDING = read("landing.html");

/** A small doc of lines the page must carry verbatim (proof strip, trial terms, the CTA). */
const SNIPPETS = "## Proof strip\n\nPilot users saved **3.5 hours** a week on note-taking. [F8]\n\n- The free trial lasts 14 days and needs no card. [F7]\n\n[Start your free trial](#start)\n";
const SNIPPETS_DELIVERABLE: Deliverable = { id: "snippets", title: "Proof snippets", type: "doc", by: "writer" };

const page = (text = LANDING, from: Record<string, { path: string; text: string }> = { copy: { path: PATHS.copy, text: COPY } }) =>
  fakeContext({ check: DELIVERABLES.landing, files: { landing: { path: PATHS.landing, text }, ...from } });
const withSnippets = (text = LANDING) => page(text, { [SNIPPETS_DELIVERABLE.id]: { path: "projects/tern/work/docs/snippets.md", text: SNIPPETS } });
const lines = (r: { evidence: string[] }) => r.evidence.join("\n");

/** Remove every occurrence; throws if there were none. */
const removeAll = (text: string, s: string) => {
  if (!text.includes(s)) throw new Error(`fixture edit: "${s}" not found`);
  return text.split(s).join("");
};

describe("verbatim_in", () => {
  it("passes when every ### headline of the copy appears verbatim on the page", () => {
    const r = runCheck("verbatim_in", page(), { from: "copy", unit: "headline" });
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toBe("6 ### headlines of copy, all verbatim in landing");
  });

  it("fails a headline the designer reworded, naming it", () => {
    const r = runCheck("verbatim_in", page(edit(LANDING, "<h1>Meeting notes that write themselves</h1>", "<h1>Notes that write themselves</h1>")), { from: "copy", unit: "headline" });
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(['missing: "Meeting notes that write themselves"']);
  });

  it("passes when every body line of the source appears verbatim, without its fact tags or Markdown", () => {
    const r = runCheck("verbatim_in", withSnippets(), { from: "snippets", unit: "line" });
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toBe("3 lines of snippets, all verbatim in landing");
  });

  it("fails a body line the page changed", () => {
    const r = runCheck("verbatim_in", withSnippets(edit(LANDING, "needs no card", "needs no credit card")), { from: "snippets", unit: "line" });
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(['missing: "The free trial lasts 14 days and needs no card."']);
  });

  it("fails when the source was never written", () => {
    const r = runCheck("verbatim_in", page(LANDING, {}), { from: "copy", unit: "headline" });
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/"copy" was never written/);
  });
});

describe("no_foreign_text", () => {
  it("passes when every long visible text run comes from the copy", () => {
    const r = runCheck("no_foreign_text", page(), { source: "copy" });
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toBe("6 text runs over 40 characters, all in copy");
  });

  it("fails a long run the designer rewrote", () => {
    const r = runCheck("no_foreign_text", page(edit(LANDING, "Clients talk faster", "Clients speak faster")), { source: "copy" });
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(['not in copy: "Clients speak faster than anyone can write, and the detail you miss is the one they remember."']);
  });

  it("fails a long run the designer added", () => {
    const added = "<p>Trusted by more than 10,000 consultants across North America.</p>";
    const r = runCheck("no_foreign_text", page(edit(LANDING, "</section>", `${added}</section>`)), { source: "copy" });
    expect(r.pass).toBe(false);
    expect(lines(r)).toMatch(/Trusted by more than 10,000 consultants/);
  });

  it("lets through runs no longer than minRun", () => {
    const added = "<p>Trusted by more than 10,000 consultants across North America.</p>";
    expect(runCheck("no_foreign_text", page(edit(LANDING, "</section>", `${added}</section>`)), { source: "copy", minRun: 61 }).pass).toBe(true);
    expect(runCheck("no_foreign_text", page(edit(LANDING, "</section>", `${added}</section>`)), { source: "copy", minRun: 60 }).pass).toBe(false);
  });
});

describe("single_cta", () => {
  it("passes when every primary CTA has the same label", () => {
    const r = runCheck("single_cta", page(), {});
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toBe('3 primary CTAs, all "Start your free trial"');
  });

  it("fails a page with no primary CTA", () => {
    const r = runCheck("single_cta", page(removeAll(LANDING, ' data-cta="primary"')), {});
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(['no element marked data-cta="primary"']);
  });

  it("fails primary CTAs with different labels, counting each", () => {
    const r = runCheck("single_cta", page(edit(LANDING, 'data-cta="primary">Start your free trial', 'data-cta="primary">Start free trial')), {});
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(["2 different primary CTA labels", '"Start free trial" ×1', '"Start your free trial" ×2']);
  });
});

describe("offline", () => {
  it("passes a page whose references are all in-page anchors or data: URLs", () => {
    const r = runCheck("offline", page(), {});
    expect(r.pass).toBe(true);
    expect(r.evidence[0]).toBe("6 src/href/url() references, none external");
  });

  it("fails an https href", () => {
    const r = runCheck("offline", page(edit(LANDING, "</head>", '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></head>')), {});
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(["<link href> https://fonts.googleapis.com/css2?family=Inter"]);
  });

  it("fails a protocol-relative src", () => {
    const r = runCheck("offline", page(edit(LANDING, "</body>", '<script src="//cdn.example.com/a.js"></script></body>')), {});
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(["<script src> //cdn.example.com/a.js"]);
  });

  it("fails an http url() in a style block", () => {
    const r = runCheck("offline", page(edit(LANDING, "section { max-width", ".proof { background: url(http://images.example.com/hero.jpg); }\n    section { max-width")), {});
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(["<style> url(http://images.example.com/hero.jpg)"]);
  });

  it("fails an https url() in a style attribute", () => {
    const r = runCheck("offline", page(edit(LANDING, '<section id="proof">', `<section id="proof" style="background-image: url('https://x.example/p.png')">`)), {});
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual(["<section style> url(https://x.example/p.png)"]);
  });
});
