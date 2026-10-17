/*
 * How the History view reads a file's commits: its origin, each row's source
 * chip and the chips for what a change was derived from. Pure, so client and
 * server can share it.
 */
import type { VaultAuthor, VaultCommit, VaultSource } from "./types";

export interface Parent {
  agent: string;
  version: string | null;
  change: string | null;
}

export type FileOrigin =
  /** Seeded from named parent agents (`Seeded-From`); `carried` counts the `Derived-From` items. */
  | { kind: "inherited"; at: string; parents: Parent[]; carried: number }
  /** Seeded from the archetype's template (a seed with no parents). */
  | { kind: "template"; at: string; archetype: string | null }
  /** First written by someone directly. */
  | { kind: "created"; at: string; author: VaultAuthor };

export interface Derivation {
  kind: "derived" | "evidence" | "dream" | "restores";
  label: string;
  /** The raw trailer value, for a tooltip. */
  title: string;
}

/** "soul(mira): pin a standing instruction" → "Pin a standing instruction". */
export function summaryOf(subject: string): string {
  const s = subject.replace(/^[a-z]+\([^)]*\):\s*/, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CHIP: Record<VaultSource, string> = {
  seed: "seed",
  owner: "you",
  pin: "📌 pin",
  dream: "dream",
  tool: "tool",
  report: "report",
  inherit: "inherited",
  restore: "restore",
};

export function sourceChip(source: VaultSource): { label: string } {
  return { label: CHIP[source] ?? source };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "pip@v3 c_01J9ZK5R2C7A" → { agent: "pip", version: "v3", change: "c_01J9ZK5R2C7A" }. */
function parent(value: string): Parent {
  const [ref, change = null] = value.trim().split(/\s+/);
  const at = ref.indexOf("@");
  return at === -1 ? { agent: ref, version: null, change } : { agent: ref.slice(0, at), version: ref.slice(at + 1) || null, change };
}

/** Where the file came from, read off its first commit (the last one, newest first). */
export function originOf(commits: VaultCommit[]): FileOrigin | null {
  const first = commits[commits.length - 1];
  if (!first) return null;
  const parents = first.trailers["Seeded-From"] ?? [];
  if (parents.length) return { kind: "inherited", at: first.at, parents: parents.map(parent), carried: first.trailers["Derived-From"]?.length ?? 0 };
  if (first.source === "seed") return { kind: "template", at: first.at, archetype: first.trailers.Archetype?.[0] ?? null };
  return { kind: "created", at: first.at, author: first.author };
}

/** "pip:m_91c2" → "Pip m_91c2"; "skills/researcher/research@v5" → "researcher/research v5". */
function source(ref: string): string {
  const item = /^([A-Za-z0-9_-]+):(.+)$/.exec(ref);
  if (item) return item[1] === "skill" ? `skill ${item[2]}` : `${cap(item[1])} ${item[2]}`;
  const versioned = /^(?:skills\/)?(.+)@(v\d+)$/.exec(ref);
  return versioned ? `${versioned[1]} ${versioned[2]}` : ref;
}

function derived(value: string): Derivation {
  const [target, from = ""] = value.split(/\s*<-\s*/);
  const parents = from.split(/\s*\+\s*/).filter(Boolean).map(source);
  return { kind: "derived", label: parents.length ? `${source(target)} ← ${parents.join(" + ")}` : source(target), title: value };
}

/** Evidence ids from G §3: msg:<thread>:<idx>, led:<at>/<t>, asg:<id>, note:<n>, file:<path>. */
function evidence(id: string): Derivation {
  const [kind, ...rest] = id.split(":");
  const tail = rest.join(":");
  const label =
    kind === "msg"
      ? `message ${rest[rest.length - 1]}`
      : kind === "led"
        ? `ledger ${tail.slice(tail.lastIndexOf("/") + 1)}`
        : kind === "asg"
          ? `assignment ${tail}`
          : kind === "note"
            ? `note ${tail}`
            : kind === "file"
              ? tail.slice(tail.lastIndexOf("/") + 1)
              : id;
  return { kind: "evidence", label, title: id };
}

/** Chips for what a change was derived from: Derived-From, Evidence, Dream and Restores trailers. */
export function derivationsOf(commit: VaultCommit): Derivation[] {
  const t = commit.trailers;
  return [
    ...(t["Derived-From"] ?? []).map(derived),
    ...(t.Evidence ?? []).flatMap((v) => v.split(",").map((s) => s.trim()).filter(Boolean)).map(evidence),
    ...(t.Dream ?? []).map((d): Derivation => ({ kind: "dream", label: `dream ${d}`, title: d })),
    ...(t.Restores ?? []).map((c): Derivation => ({ kind: "restores", label: "restores an earlier version", title: c })),
  ];
}

/** "just now", "5 min ago", "3 h ago", "yesterday", then "Oct 3" (with the year when it isn't this one). */
export function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  const s = Math.max(0, (now - then) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172_800) return "yesterday";
  const d = new Date(then);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
