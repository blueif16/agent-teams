/*
 * Local search over the skill library: BM25 over name, tags, archetypes and description (field-weighted), with a
 * boost for entries made for the asking archetype. No network, no dependencies; the index is built once per
 * library load and a query is a single pass over the docs (< 0.1 ms at 200 entries, see search.test.ts).
 *
 * `score` is the BM25 sum divided by the most the query could score (each of its terms saturated), so it reads as
 * weighted coverage of the need in [0, 1), times the archetype boost. find.ts thresholds on it.
 * Entries whose scan found anything are never indexed, so they can't be returned.
 */
import type { Archetype } from "../policy/types";
import type { SearchSkills, SkillEntry, SkillHit } from "./types";

const K1 = 1.2;
const B = 0.75;
/** A match in the name counts 3×, in the curator's tags 2×. */
const FIELDS = [
  ["name", 3],
  ["tags", 2],
  ["archetypes", 1],
  ["description", 1],
] as const;
type Field = (typeof FIELDS)[number][0];
/** For entries made for the asking archetype: breaks near ties, can't beat a far better match. */
export const ARCHETYPE_BOOST = 1.25;

const STOPWORDS = new Set(
  ("a an and any are as at be before by can do does for from has have how i in into is it its it's me my need needs of on or " +
    "our so that the their them then there these this those to up us use used uses using want we what when which while who " +
    "why will with without you your skill skills user users like make makes made making get not out").split(" "),
);

/** Light stemming so "fixing", "fixes" and "fixed" meet "fix". Applied to queries and docs alike. */
function stem(word: string): string {
  let w = word;
  if (w.length > 8 && w.endsWith("ally")) w = w.slice(0, -2);
  if (w.length > 7 && w.endsWith("ations")) w = w.slice(0, -6);
  else if (w.length > 7 && w.endsWith("ation")) w = w.slice(0, -5);
  else if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 5 && w.endsWith("ing")) w = undouble(w.slice(0, -3));
  else if (w.length > 4 && w.endsWith("ed")) w = undouble(w.slice(0, -2));
  else if (w.length > 4 && /(x|ch|sh|ss)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}
const undouble = (w: string) => (/([b-df-hj-km-np-rtv-y])\1$/.test(w) ? w.slice(0, -1) : w);

/** Words of `text` as [stem, original] pairs, stopwords dropped. */
function words(text: string): [string, string][] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOPWORDS.has(w)).map((w) => [stem(w), w]);
}

interface Doc {
  entry: SkillEntry;
  /** Field-weighted term frequency. */
  tf: Map<string, number>;
  len: number;
  /** Which stems each field contains, for `why`. */
  fields: Record<Field, Set<string>>;
}

function fieldText(entry: SkillEntry, field: Field): string {
  if (field === "tags") return entry.tags.join(" ");
  if (field === "archetypes") return entry.archetypes.join(" ");
  return entry[field];
}

function toDoc(entry: SkillEntry): Doc {
  const tf = new Map<string, number>();
  const fields = {} as Record<Field, Set<string>>;
  let len = 0;
  for (const [field, weight] of FIELDS) {
    const stems = words(fieldText(entry, field)).map(([s]) => s);
    fields[field] = new Set(stems);
    for (const s of stems) tf.set(s, (tf.get(s) ?? 0) + weight);
    len += stems.length * weight;
  }
  return { entry, tf, len, fields };
}

export function createSearchSkills(entries: SkillEntry[]): SearchSkills {
  const docs = entries.filter((e) => e.scan.findings === 0).map(toDoc);
  const avgLen = docs.reduce((sum, d) => sum + d.len, 0) / (docs.length || 1);
  const df = new Map<string, number>();
  for (const d of docs) for (const s of d.tf.keys()) df.set(s, (df.get(s) ?? 0) + 1);
  const idf = (s: string) => Math.log(1 + (docs.length - (df.get(s) ?? 0) + 0.5) / ((df.get(s) ?? 0) + 0.5));

  return (query: string, opts: { archetype?: Archetype; limit?: number } = {}): SkillHit[] => {
    const { archetype, limit = 5 } = opts;
    // One entry per stem, remembering the word the asker used.
    const terms = new Map<string, string>();
    for (const [s, w] of words(query)) if (!terms.has(s)) terms.set(s, w);
    if (terms.size === 0 || docs.length === 0) return [];
    let best = 0;
    for (const s of terms.keys()) best += idf(s) * (K1 + 1);

    const hits: SkillHit[] = [];
    for (const d of docs) {
      let sum = 0;
      for (const s of terms.keys()) {
        const f = d.tf.get(s);
        if (f) sum += (idf(s) * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avgLen));
      }
      if (sum === 0) continue;
      const boosted = !!archetype && d.entry.archetypes.includes(archetype);
      hits.push({ entry: d.entry, score: (sum / best) * (boosted ? ARCHETYPE_BOOST : 1), why: why(d, terms, boosted ? archetype : undefined) });
    }
    hits.sort((a, b) => b.score - a.score || b.entry.source.stars - a.entry.source.stars || a.entry.id.localeCompare(b.entry.id));
    return hits.slice(0, limit);
  };
}

/** "name: systematic; tags: root, cause, bug; description: bug, fixing; for engineer" */
function why(d: Doc, terms: Map<string, string>, boostedFor?: Archetype): string {
  const parts: string[] = [];
  for (const [field] of FIELDS) {
    const matched = [...terms].filter(([s]) => d.fields[field].has(s)).map(([, w]) => w);
    if (matched.length) parts.push(`${field}: ${matched.join(", ")}`);
  }
  if (boostedFor) parts.push(`for ${boostedFor}`);
  return parts.join("; ");
}
