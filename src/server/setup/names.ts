/*
 * Names for new hires: a short list of object words per archetype, never a person's name, so an agent reads as a
 * character and not an impersonation. An id is the name's slug plus a 4-character random suffix ("swatch-k3p9").
 */
import type { StaffableArchetype } from "@/lib/project";

export const NAMES: Record<StaffableArchetype, string[]> = {
  lead: ["Compass", "Beacon", "Keel", "Lantern", "Harbor", "Anchor"],
  engineer: ["Sprocket", "Gizmo", "Widget", "Rivet", "Cog", "Bolt"],
  designer: ["Swatch", "Doodle", "Palette", "Kerning", "Sketch", "Gradient"],
  researcher: ["Scout", "Sleuth", "Lookout", "Sonar", "Periscope", "Truffle"],
  analyst: ["Tally", "Abacus", "Ledger", "Sigma", "Gauge", "Quartile"],
  writer: ["Quill", "Inkwell", "Margin", "Serif", "Comma", "Draft"],
};

/** The archetype's first name nobody holds yet (case-insensitive); past the list, the first name with a number. */
export function pickName(archetype: StaffableArchetype, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const list = NAMES[archetype];
  const free = list.find((n) => !used.has(n.toLowerCase()));
  if (free) return free;
  for (let n = 2; ; n++) if (!used.has(`${list[0]} ${n}`.toLowerCase())) return `${list[0]} ${n}`;
}

/** Whether a name came from the archetype's list (with or without a number). */
export const isListedName = (archetype: StaffableArchetype, name: unknown) =>
  typeof name === "string" && NAMES[archetype].some((n) => name === n || new RegExp(`^${n} \\d{1,3}$`).test(name));

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function agentIdFor(name: string): string {
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}-${suffix}`;
}
