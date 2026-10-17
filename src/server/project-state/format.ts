/*
 * The bytes of every state file (F §3): JSON with sorted keys, so the same state is always the same bytes, and the
 * Markdown files in one fixed, code-written layout that parses back exactly. A file that doesn't parse (a hand
 * edit gone wrong) is an error, never a silent default: the tools refuse to write over state they can't read.
 */
import type { z } from "zod";
import { Charter, Decision, JournalLine, Pref } from "./schema";

/** A state file that isn't in the format the tools write. */
export class StateFileError extends Error {
  constructor(
    readonly file: string,
    detail: string,
  ) {
    super(`${file} isn't in the state tools' format: ${detail}`);
    this.name = "StateFileError";
  }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return v;
}

/** JSON with every object's keys sorted, two-space indent, one trailing newline. */
export const renderJson = (v: unknown): string => `${JSON.stringify(sortKeys(v), null, 2)}\n`;

export function parseJson<S extends z.ZodType>(file: string, text: string, schema: S): z.infer<S> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new StateFileError(file, (e as Error).message);
  }
  const out = schema.safeParse(raw);
  if (!out.success) throw new StateFileError(file, issues(out.error));
  return out.data;
}

const issues = (e: z.ZodError) =>
  e.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");

function check<S extends z.ZodType>(file: string, schema: S, value: unknown): z.infer<S> {
  const out = schema.safeParse(value);
  if (!out.success) throw new StateFileError(file, issues(out.error));
  return out.data;
}

const num = (id: string) => Number(id.replace(/^\D+/, ""));

// ------------------------------------------------------------------------------------------ decisions.md

const DECISION_HEAD = /^## (D-[0-9]{3,5}) · ([0-9]{4}-[0-9]{2}-[0-9]{2}) · (.+)$/;
const FIELD = /^- ([A-Za-z][A-Za-z ]*): (.*)$/;
const APPROVED = /^(pm|owner)(?: \(([^\s()]+)\))? · proposed by (\S+)$/;

/** decisions.md, oldest first (append-only, ADR-style; F §3.2). */
export function renderDecisions(pid: string, decisions: readonly Decision[]): string {
  const out = [`# Decisions (${pid})`, "", "Append-only. Written by the record_decision tool; active ones show in the state digest."];
  for (const d of [...decisions].sort((a, b) => num(a.id) - num(b.id))) {
    out.push("", `## ${d.id} · ${d.date} · ${d.title}`, `- Status: ${d.status}`, `- Decision: ${d.decision}`, `- Why: ${d.why}`);
    out.push(`- Approved by: ${d.approvedBy}${d.approvalRef ? ` (${d.approvalRef})` : ""} · proposed by ${d.proposedBy}`);
    if (d.supersedes) out.push(`- Supersedes: ${d.supersedes}`);
    if (d.links.length) out.push(`- Links: ${d.links.join(", ")}`);
    out.push(`- Source: ${d.source}`);
  }
  return `${out.join("\n")}\n`;
}

export function parseDecisions(md: string, file = "decisions.md"): Decision[] {
  const out: Decision[] = [];
  let cur: Record<string, unknown> | null = null;
  const flush = () => {
    if (cur) out.push(check(file, Decision, cur));
    cur = null;
  };
  md.split("\n").forEach((line, i) => {
    const head = DECISION_HEAD.exec(line);
    if (head) {
      flush();
      cur = { id: head[1], date: head[2], title: head[3], links: [] };
      return;
    }
    if (!cur) return; // the title and intro
    if (!line.trim()) return;
    const f = FIELD.exec(line);
    if (!f) throw new StateFileError(file, `line ${i + 1} isn't "- Key: value"`);
    const [, key, value] = f;
    if (key === "Status") cur.status = value;
    else if (key === "Decision") cur.decision = value;
    else if (key === "Why") cur.why = value;
    else if (key === "Supersedes") cur.supersedes = value;
    else if (key === "Links") cur.links = value.split(", ");
    else if (key === "Source") cur.source = value;
    else if (key === "Approved by") {
      const a = APPROVED.exec(value);
      if (!a) throw new StateFileError(file, `line ${i + 1}: "Approved by" must read "<pm|owner> (<ref>) · proposed by <agent>"`);
      cur.approvedBy = a[1];
      if (a[2]) cur.approvalRef = a[2];
      cur.proposedBy = a[3];
    } else throw new StateFileError(file, `line ${i + 1}: unknown field "${key}"`);
  });
  flush();
  return out;
}

// ---------------------------------------------------------------------------------------------- prefs.md

const PREF = /^- (P-[1-9][0-9]*) (.+) \(([^\s()]+)\)$/;

/** prefs.md: one bullet per owner preference with its source (F §3.5). */
export function renderPrefs(pid: string, prefs: readonly Pref[]): string {
  const lines = [...prefs].sort((a, b) => num(a.id) - num(b.id)).map((p) => `- ${p.id} ${p.text} (${p.source})`);
  return `# Owner preferences (${pid})\n\n${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

export function parsePrefs(md: string, file = "prefs.md"): Pref[] {
  const out: Pref[] = [];
  md.split("\n").forEach((line, i) => {
    if (!line.startsWith("- ")) return;
    const m = PREF.exec(line);
    if (!m) throw new StateFileError(file, `line ${i + 1} isn't "- P-<n> <text> (<source>)"`);
    out.push(check(file, Pref, { id: m[1], text: m[2], source: m[3] }));
  });
  return out;
}

// -------------------------------------------------------------------------------------------- charter.md

const CHARTER_FIELDS: [keyof Charter, string][] = [
  ["goal", "Goal"],
  ["metric", "Success metric"],
  ["deadline", "Deadline"],
  ["scope", "In scope"],
  ["outOfScope", "Out of scope"],
  ["qualifications", "Qualifications"],
  ["budget", "Budget"],
];

/** charter.md (F §3.6): pinned in the PM's system prefix, so it changes only on an owner approval. */
export function renderCharter(pid: string, c: Charter): string {
  const lines = [`# ${c.title} (${pid})`, "", ...CHARTER_FIELDS.map(([k, label]) => `- ${label}: ${c[k]}`), `- Approved: owner (${c.approvalRef})`];
  return `${lines.join("\n")}\n`;
}

export function parseCharter(md: string, pid: string, file = "charter.md"): Charter {
  const lines = md.split("\n");
  const head = new RegExp(`^# (.+) \\(${pid}\\)$`).exec(lines[0] ?? "");
  if (!head) throw new StateFileError(file, `the first line must be "# <title> (${pid})"`);
  const raw: Record<string, string> = { title: head[1] };
  for (const line of lines.slice(1)) {
    const f = FIELD.exec(line);
    if (!f) continue;
    const field = CHARTER_FIELDS.find(([, label]) => label === f[1]);
    if (field) raw[field[0]] = f[2];
    else if (f[1] === "Approved") raw.approvalRef = /^owner \(([^\s()]+)\)$/.exec(f[2])?.[1] ?? "";
  }
  return check(file, Charter, raw);
}

// ------------------------------------------------------------------------------------------ journal/<n>.md

const JOURNAL = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z) r([1-9][0-9]*) (.+)$/;

/** One journal window (F §3.7): a line per event, `<minute>Z r<rev> <text>`. */
export function renderJournal(pid: string, window: number, lines: readonly JournalLine[]): string {
  return `# Journal (${pid}), window ${window}\n\n${lines.map((l) => `${l.at} r${l.rev} ${l.text}\n`).join("")}`;
}

export function parseJournal(md: string, file: string): JournalLine[] {
  const out: JournalLine[] = [];
  md.split("\n").forEach((line, i) => {
    if (!line.trim() || line.startsWith("# ")) return;
    const m = JOURNAL.exec(line);
    if (!m) throw new StateFileError(file, `line ${i + 1} isn't "<minute>Z r<rev> <text>"`);
    out.push(check(file, JournalLine, { at: m[1], rev: Number(m[2]), text: m[3] }));
  });
  return out;
}

/** `2026-10-17T17:41:09.123Z` → `2026-10-17T17:41Z`. */
export const minute = (iso: string) => `${iso.slice(0, 16)}Z`;
