/*
 * The deliverable checks, one per name in CHECKS (../scenario.ts), as the registry claims call. Each is a pure
 * function of the CheckContext and its params: no model, no I/O, the same verdict on every re-grade of a tape.
 */
import { chart_matches, frames } from "./canvas";
import { cites_facts, excludes, max_words, mentions, prices_supported, sections } from "./docs";
import { no_foreign_text, offline, single_cta, verbatim_in } from "./mockup";
import { exists, monotonic_tiers, recompute, sources_cited, table_rows, verbatim_quote } from "./tables";
import type { CheckRegistry } from "./types";

export const CHECK_FNS: CheckRegistry = {
  exists,
  table_rows,
  sources_cited,
  verbatim_quote,
  cites_facts,
  verbatim_in,
  no_foreign_text,
  single_cta,
  offline,
  frames,
  recompute,
  chart_matches,
  prices_supported,
  monotonic_tiers,
  mentions,
  excludes,
  sections,
  max_words,
};
