/*
 * The `<project_state>` digest for the PM's window opener and the one-line `recite` returned by every state tool
 * (F §3.1, §4.1). Both are rendered by code from the state files alone: fixed section order, sorted, times in UTC
 * relative to the state's own as-of date, no clock. The same state is always the same bytes, so the opener caches.
 *
 * The digest must stay within DIGEST_MAX_TOKENS whatever the caps allow. It renders at the richest detail level
 * that fits, and every level keeps F §7.1's must-survive set: each open task's id, status, owner and blocker, and
 * each open item's id.
 */
import { isOpen, OWNER_ID, PM, type Decision, type Item, type Member, type ProjectState, type Status, type Task } from "./schema";

export const DIGEST_MAX_TOKENS = 4000;

/**
 * A conservative token count for budgets: a third of the ASCII characters (BPE tokenizers average 3.5-4 for
 * English, less for ids and punctuation) plus, for every other character, its UTF-8 bytes minus one (· 1, — 2, 📌 3).
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) ascii++;
    else other += code < 0x800 ? 1 : code < 0x10000 ? 2 : 3;
  }
  return Math.ceil(ascii / 3) + other;
}

const num = (id: string) => Number(id.replace(/^\D+/, ""));
const byId = <T extends { id: string }>(a: T, b: T) => num(a.id) - num(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Most urgent first: what the PM must act on, then what is moving, then what waits. */
const PRIORITY: Record<Status, number> = { blocked: 0, review: 1, in_progress: 2, ready: 3, todo: 4, done: 5, failed: 6, dropped: 7 };
const byUrgency = (a: Task, b: Task) => PRIORITY[a.status] - PRIORITY[b.status] || byId(a, b);

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** UTC time, with the month and day when it isn't the as-of date. */
function when(iso: string, asOfDay: string): string {
  return iso.slice(0, 10) === asOfDay ? iso.slice(11, 16) : `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

const ownerOf = (t: Task) => t.owner ?? "(unassigned)";

interface Level {
  /** Max characters per field; 0 leaves the field out. */
  title: number;
  report: number;
  item: number;
  decision: number;
  note: number;
  journal: number;
  journalLines: number;
  /** Closed tasks from the last 24 h: full one-liners, ids only, or none. */
  closed: "full" | "ids" | "none";
}

const LEVELS: Level[] = [
  { title: 60, report: 50, item: 80, decision: 60, note: 40, journal: 120, journalLines: 8, closed: "full" },
  { title: 36, report: 0, item: 40, decision: 32, note: 0, journal: 80, journalLines: 4, closed: "ids" },
  { title: 0, report: 0, item: 0, decision: 0, note: 0, journal: 0, journalLines: 0, closed: "none" },
];

function asOf(s: ProjectState): string {
  const stamps = [s.dag.updatedAt, s.roster.updatedAt, s.open.updatedAt].filter((x): x is string => !!x).map((x) => `${x.slice(0, 16)}Z`);
  const last = s.journal.lines.at(-1)?.at;
  if (last) stamps.push(last);
  return stamps.sort().at(-1) ?? "1970-01-01T00:00Z";
}

function taskLine(t: Task, lv: Level, day: string): string {
  const status = t.status === "todo" && t.deps.length ? `todo, deps ${[...t.deps].sort((a, b) => num(a) - num(b)).join(",")}` : t.status;
  const parts = [`${t.id} [${status}]${lv.title ? ` ${clip(t.title, lv.title)}` : ""}${t.due && lv.title ? ` (due ${t.due.slice(5)})` : ""}`];
  const tail: string[] = [];
  if (t.kind !== "todo" || (t.owner && t.owner !== PM)) tail.push(ownerOf(t));
  if (t.blocker) {
    if (t.blocker.on) tail.push(`on ${t.blocker.on}${lv.title ? ` since ${when(t.blocker.since, day)}` : ""}`);
    else tail.push(lv.item ? `blocked: "${clip(t.blocker.text, lv.item / 2)}"` : "blocked");
  }
  if (lv.report && t.lastReport) tail.push(`last ${when(t.lastReport.at, day)} "${clip(t.lastReport.summary, lv.report)}"`);
  if (!tail.length) return parts[0];
  // Full detail uses F's em-dash layout; the compact levels drop it for spaces.
  return lv.title ? `${parts[0]} — ${tail.join(" — ")}` : `${parts[0]} ${tail.join(" ")}`;
}

function planSections(s: ProjectState, lv: Level, day: string): string[] {
  const tasks = [...s.dag.tasks];
  const milestones = tasks.filter((t) => t.kind === "milestone").sort(byId);
  const known = new Set(milestones.map((m) => m.id));
  const work = tasks.filter((t) => t.kind === "work");
  const groups: { head: string; tasks: Task[] }[] = milestones.map((m) => ({
    head: `PLAN ${m.id}${lv.title ? ` "${clip(m.title, lv.title)}"` : ""}`,
    tasks: work.filter((t) => t.milestone === m.id),
  }));
  const loose = work.filter((t) => !t.milestone || !known.has(t.milestone));
  if (loose.length) groups.push({ head: "PLAN (no milestone)", tasks: loose });

  const out: string[] = [];
  for (const g of groups) {
    const open = g.tasks.filter((t) => isOpen(t.status)).sort(byUrgency);
    if (!open.length && !g.tasks.length) continue;
    const done = g.tasks.filter((t) => t.status === "done").length;
    const blocked = open.filter((t) => t.status === "blocked").length;
    const ready = open.filter((t) => t.status === "ready").length;
    const counts = [`${done}/${g.tasks.length} done`, ...(blocked ? [`${blocked} blocked`] : []), ...(ready ? [`${ready} ready`] : [])];
    if (!open.length && lv.closed === "none") continue;
    out.push(`${g.head} ${counts.join(" · ")}`);
    for (const t of open) out.push(`- ${taskLine(t, lv, day)}`);
  }
  return out;
}

function closedRecently(s: ProjectState, lv: Level, at: string): string | null {
  if (lv.closed === "none") return null;
  const cutoff = Date.parse(at) - 24 * 3600_000;
  const closed = s.dag.tasks.filter((t) => t.kind !== "milestone" && !isOpen(t.status) && Date.parse(t.updated) >= cutoff).sort(byId);
  if (!closed.length) return null;
  const one = (t: Task) => {
    const mark = t.status === "done" ? "" : ` [${t.status}]`;
    return lv.closed === "ids" ? `${t.id}${mark}` : `${t.id}${mark} ${clip(t.title, lv.title)} (${ownerOf(t)})`;
  };
  return `DONE (24h): ${closed.map(one).join(lv.closed === "ids" ? " " : " | ")}`;
}

function todos(s: ProjectState, lv: Level, day: string): string | null {
  const open = s.dag.tasks.filter((t) => t.kind === "todo" && isOpen(t.status)).sort(byUrgency);
  return open.length ? `TODOS (pm): ${open.map((t) => taskLine(t, lv, day)).join(" | ")}` : null;
}

function team(s: ProjectState, lv: Level, day: string): string | null {
  const members = [...s.roster.members].sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));
  if (!members.length) return null;
  const now = (m: Member) =>
    s.dag.tasks
      .filter((t) => t.owner === m.agentId && t.status === "in_progress")
      .sort(byId)
      .map((t) => t.id);
  const one = (m: Member) => {
    const b = m.blockers[0];
    const state = m.state === "blocked" && b ? `blocked(${b.on ?? (lv.item ? clip(b.text, 20) : "?")})` : m.state;
    const parts = [lv.title ? `${m.agentId} ${clip(m.role, 24)}` : m.agentId, state];
    if (lv.title && m.lastCheckIn) parts.push(when(m.lastCheckIn, day));
    const doing = now(m);
    if (doing.length) parts.push(`now ${doing.join(",")}`);
    if (lv.note && m.pmNote) parts.push(`note "${clip(m.pmNote, lv.note)}"`);
    return parts.join(" · ");
  };
  return `TEAM: ${members.map(one).join(" | ")}`;
}

function itemOne(i: Item, lv: Level, day: string): string {
  if (!lv.item) return i.kind === "question" ? `${i.id}→${i.askOf}` : `${i.id} ${i.severity ?? "risk"}`;
  const links = i.links.length ? ` (${i.links.join(",")})` : "";
  if (i.kind === "risk") return `${i.id} ${i.severity ?? "risk"}: ${clip(i.text, lv.item)}${links}`;
  const meta = [when(i.raised, day), ...(i.due ? [`due ${i.due.slice(5)}`] : [])].join(", ");
  return `${i.id} → ${i.askOf} "${clip(i.text, lv.item)}" (${meta})`;
}

function openItems(s: ProjectState, lv: Level, day: string): string | null {
  const items = s.open.items.filter((i) => i.status === "open").sort((a, b) => (a.kind === b.kind ? byId(a, b) : a.kind === "question" ? -1 : 1));
  return items.length ? `OPEN: ${items.map((i) => itemOne(i, lv, day)).join(" | ")}` : null;
}

function decisions(s: ProjectState, lv: Level): string | null {
  const active = s.decisions.filter((d) => d.status === "active").sort((a, b) => byId(b, a));
  const one = (d: Decision) => (lv.decision ? `${d.id} ${clip(d.title, lv.decision)} (${d.approvedBy})` : `${d.id}(${d.approvedBy})`);
  return active.length ? `DECISIONS (active): ${active.map(one).join(" | ")}` : null;
}

function journal(s: ProjectState, lv: Level, day: string): string[] {
  if (!lv.journalLines) return [];
  const lines = s.journal.lines.slice(-lv.journalLines);
  if (!lines.length) return [];
  return [`JOURNAL (last ${lines.length}):`, ...lines.map((l) => `${when(`${l.at.slice(0, 16)}:00.000Z`, day)} r${l.rev} ${clip(l.text, lv.journal)}`)];
}

function render(s: ProjectState, lv: Level): string {
  const at = asOf(s);
  const day = at.slice(0, 10);
  const body = [...planSections(s, lv, day), closedRecently(s, lv, at), todos(s, lv, day), team(s, lv, day), openItems(s, lv, day), decisions(s, lv), ...journal(s, lv, day)].filter(
    (x): x is string => x !== null,
  );
  return [`<project_state rev="${s.rev}" as_of="${at}">`, ...body, "</project_state>"].join("\n");
}

/** The `<project_state>` block for the window opener: within DIGEST_MAX_TOKENS, at the richest level that fits. */
export function renderDigest(s: ProjectState): string {
  for (const lv of LEVELS) {
    const out = render(s, lv);
    if (estimateTokens(out) <= DIGEST_MAX_TOKENS) return out;
  }
  // Unreachable within the caps; a hand-edited file past them still gets a bounded block.
  const lines = render(s, LEVELS[LEVELS.length - 1]).split("\n");
  const kept: string[] = [];
  const tail = (n: number) => `… ${n} more lines: read_file /state/dag.json\n</project_state>`;
  for (const l of lines.slice(0, -1)) {
    if (estimateTokens([...kept, l].join("\n")) + estimateTokens(tail(lines.length)) > DIGEST_MAX_TOKENS) break;
    kept.push(l);
  }
  return `${kept.join("\n")}\n${tail(lines.length - 1 - kept.length)}`;
}

const RECITE_LIST = 6;

function list(label: string, tasks: Task[], fmt: (t: Task) => string): string | null {
  if (!tasks.length) return null;
  const shown = tasks.slice(0, RECITE_LIST).map(fmt).join(", ");
  return `${label}: ${shown}${tasks.length > RECITE_LIST ? ` +${tasks.length - RECITE_LIST} more` : ""}`;
}

/**
 * The plan in one line, appended to every state tool's result (F §3.1, Manus-style recitation at the tail):
 * `DAG r58 · 4/9 done · blocked: t7(ana→Q-2) · ready: t8(bo), t9(unassigned) · todos: t11`.
 */
export function recite(s: ProjectState): string {
  const tasks = [...s.dag.tasks].sort(byId);
  const work = tasks.filter((t) => t.kind === "work");
  const who = (t: Task) => (t.owner === null ? "unassigned" : t.owner === OWNER_ID ? "owner" : t.owner);
  const parts = [
    `DAG r${s.rev}`,
    `${work.filter((t) => t.status === "done").length}/${work.length} done`,
    list("blocked", work.filter((t) => t.status === "blocked"), (t) => `${t.id}(${who(t)}${t.blocker?.on ? `→${t.blocker.on}` : ""})`),
    list("review", work.filter((t) => t.status === "review"), (t) => `${t.id}(${who(t)})`),
    list("ready", work.filter((t) => t.status === "ready"), (t) => `${t.id}(${who(t)})`),
    list("todos", tasks.filter((t) => t.kind === "todo" && isOpen(t.status)), (t) => t.id),
  ];
  return parts.filter((p): p is string => p !== null).join(" · ");
}
