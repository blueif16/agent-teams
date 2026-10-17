/* stub */
import { cites_facts, excludes, max_words, mentions, prices_supported, sections } from "./docs";
import { exists, monotonic_tiers, recompute, sources_cited, table_rows, verbatim_quote } from "./tables";
import type { CheckRegistry, CheckResult } from "./types";

const todo = (): CheckResult => ({ pass: false, evidence: [] });

export const CHECK_FNS: CheckRegistry = {
  exists,
  table_rows,
  sources_cited,
  verbatim_quote,
  cites_facts,
  verbatim_in: todo,
  no_foreign_text: todo,
  single_cta: todo,
  offline: todo,
  frames: todo,
  recompute,
  chart_matches: todo,
  prices_supported,
  monotonic_tiers,
  mentions,
  excludes,
  sections,
  max_words,
};
