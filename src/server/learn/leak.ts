/*
 * The leak check (test-mode design §7, `facts_in_learning`): the company must learn how to do the work, not memorize
 * one client's answer. Before any learning edit is committed, the lines it adds are checked against the project's
 * facts: the configured list (the client's name, competitors, figures from the brief) plus the prices and
 * percentages quoted in the charter. Memory and skill edits (model-written) also refuse any quoted price at all. A
 * secret in an added line refuses the edit too, rather than being redacted into it.
 */
import { scan } from "@/lib/policy/detectors";

const PRICE = /[$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|bn)\b)?(?:\s?\/\s?[a-z]+)?/gi;
const PERCENT = /\d+(?:\.\d+)?\s?%/g;

const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The facts to keep out of learning: the configured ones, and every price and percentage in the charter except its
 * Budget line (the owner's spending cap for us, not a fact about the client).
 */
export function projectFacts(charter: string, configured: string[] = []): string[] {
  const quoted = charter
    .split("\n")
    .filter((line) => !/^\s*-?\s*budget\s*:/i.test(line))
    .flatMap((line) => [...(line.match(PRICE) ?? []), ...(line.match(PERCENT) ?? [])]);
  const out = new Set<string>();
  for (const f of [...configured, ...quoted]) {
    const n = norm(f);
    if (n.length >= 2) out.add(n);
  }
  return [...out];
}

/** Whole-word, case-insensitive: "Gong" matches "gong's page" but not "gongs" or "ongoing". */
function contains(text: string, fact: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(fact)}(?![\\p{L}\\p{N}])`, "u").test(text);
}

/** Lines of `after` that `before` doesn't have: what an edit adds. */
export function addedLines(before: string, after: string): string[] {
  const had = new Set(before.split("\n"));
  return after.split("\n").filter((l) => l.trim() && !had.has(l));
}

/**
 * Why the edit from `before` to `after` must not be committed, or null. `prices`: also refuse any quoted price, even
 * one that isn't in the facts (memory and skills; off for the code-written composition note and its cost figures).
 */
export async function leakProblem(before: string, after: string, facts: string[], opts: { prices: boolean }): Promise<string | null> {
  const added = addedLines(before, after).join("\n");
  if (!added) return null;
  const text = norm(added);
  const fact = facts.find((f) => contains(text, f));
  if (fact) return `leak: the edit contains the project's fact "${fact}"`;
  if (opts.prices) {
    const price = added.match(PRICE)?.[0];
    if (price) return `leak: the edit quotes a price (${price.trim()})`;
  }
  const secrets = (await scan(added)).filter((s) => s.label.startsWith("secret."));
  if (secrets.length) return `secret: the edit contains a ${secrets[0].label}`;
  return null;
}
