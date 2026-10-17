/* stub */
import { exists, monotonic_tiers, recompute, sources_cited, table_rows, verbatim_quote } from "./tables";
import type { CheckRegistry, CheckResult } from "./types";

const todo = (): CheckResult => ({ pass: false, evidence: [] });

export const CHECK_FNS: CheckRegistry = {
  exists,
  table_rows,
  sources_cited,
  verbatim_quote,
  cites_facts: todo,
  verbatim_in: todo,
  no_foreign_text: todo,
  single_cta: todo,
  offline: todo,
  frames: todo,
  recompute,
  chart_matches: todo,
  prices_supported: todo,
  monotonic_tiers,
  mentions: todo,
  excludes: todo,
  sections: todo,
  max_words: todo,
};
