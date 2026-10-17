/*
 * Checks on the designer's hand-off (C2): the page carries the copy verbatim (every headline or line is there, and
 * no long text run is the designer's own), has one primary call to action, and renders with no network request.
 */
import { collapse, excalidrawTexts, htmlTextRuns, htmlTokens, mdHeadings, mdLines } from "./parse";
import { clip, dropFactTags, fail, formatOf, isResult, pass, plural, squash, versionOf, visibleText, type Params } from "./shared";
import type { CheckFn, DeliverableVersion } from "./types";

export const verbatim_in: CheckFn<Params<"verbatim_in">> = (ctx, p) => {
  const v = versionOf(ctx);
  if (isResult(v)) return v;
  const src = versionOf(ctx, p.from);
  if (isResult(src)) return src;
  // In copy, "## S1 Hero" names a section and the ### under it is the headline (the scenario doc conventions).
  const raw = p.unit === "headline" ? mdHeadings(src.text).flatMap((h) => (h.level === 3 ? [h.text] : [])) : mdLines(src.text).map((l) => l.text);
  const units = raw.map((u) => collapse(dropFactTags(u))).filter(Boolean);
  const what = p.unit === "headline" ? "### headline" : "line";
  if (!units.length) return fail([`no ${what}s in ${p.from}`]);
  const hay = squash(visibleText(v));
  const missing = units.filter((u) => !hay.includes(squash(u)));
  if (missing.length) return fail(missing.map((u) => `missing: "${clip(u)}"`));
  return pass(`${plural(units.length, what)} of ${p.from}, all verbatim in ${ctx.deliverable.id}`);
};

/** The separate pieces of text a reader sees: a page's text nodes, a canvas's text elements, a doc's lines. */
function textRuns(v: DeliverableVersion): string[] {
  switch (formatOf(v.path)) {
    case "html":
      return htmlTextRuns(v.text);
    case "canvas":
      return excalidrawTexts(v.text) ?? [];
    case "markdown":
      return mdLines(v.text).map((l) => l.text);
    default:
      return v.text.split("\n").map(collapse).filter(Boolean);
  }
}

export const no_foreign_text: CheckFn<Params<"no_foreign_text">> = (ctx, p) => {
  const v = versionOf(ctx);
  if (isResult(v)) return v;
  const src = versionOf(ctx, p.source);
  if (isResult(src)) return src;
  const hay = squash(dropFactTags(visibleText(src)));
  const long = textRuns(v).filter((r) => r.length > p.minRun);
  const foreign = long.filter((r) => !hay.includes(squash(r)));
  if (foreign.length) return fail(foreign.map((r) => `not in ${p.source}: "${clip(r, 120)}"`));
  return pass(`${plural(long.length, "text run")} over ${p.minRun} characters, all in ${p.source}`);
};

/** The visible label of each element marked data-cta="primary" (an input's value, else its text). */
function primaryLabels(html: string): string[] {
  const tokens = htmlTokens(html);
  const labels: string[] = [];
  tokens.forEach((t, i) => {
    if (t.kind !== "open" || t.attrs["data-cta"] !== "primary") return;
    if (t.void) return labels.push(collapse(t.attrs.value ?? ""));
    let depth = 0;
    let text = "";
    for (const u of tokens.slice(i + 1)) {
      if (u.kind === "open" && u.name === t.name && !u.void) depth++;
      else if (u.kind === "close" && u.name === t.name && depth-- === 0) break;
      else if (u.kind === "text") text += u.text;
    }
    labels.push(collapse(text));
  });
  return labels;
}

export const single_cta: CheckFn<Params<"single_cta">> = (ctx) => {
  const v = versionOf(ctx);
  if (isResult(v)) return v;
  const labels = primaryLabels(v.text);
  if (!labels.length) return fail(['no element marked data-cta="primary"']);
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  if (counts.size === 1 && labels[0]) return pass(`${plural(labels.length, "primary CTA")}, all "${labels[0]}"`);
  if (counts.size === 1) return fail(["the primary CTA has no visible label"]);
  const each = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([l, n]) => `"${l || "(no label)"}" ×${n}`);
  return fail([`${counts.size} different primary CTA labels`, ...each]);
};

const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const EXTERNAL = /^(?:https?:|\/\/)/i;

export const offline: CheckFn<Params<"offline">> = (ctx) => {
  const v = versionOf(ctx);
  if (isResult(v)) return v;
  const refs: { url: string; shown: string }[] = [];
  const cssRefs = (css: string, where: string) => {
    for (const m of css.matchAll(CSS_URL)) refs.push({ url: m[2].trim(), shown: `${where} url(${m[2].trim()})` });
  };
  for (const t of htmlTokens(v.text)) {
    if (t.kind === "raw" && t.name === "style") cssRefs(t.text, "<style>");
    if (t.kind !== "open") continue;
    for (const a of ["src", "href", "xlink:href"]) if (Object.hasOwn(t.attrs, a)) refs.push({ url: t.attrs[a].trim(), shown: `<${t.name} ${a}> ${t.attrs[a].trim()}` });
    if (t.attrs.style) cssRefs(t.attrs.style, `<${t.name} style>`);
  }
  const external = refs.filter((r) => EXTERNAL.test(r.url));
  if (external.length) return fail(external.map((r) => r.shown));
  return pass(`${refs.length} src/href/url() references, none external`);
};
