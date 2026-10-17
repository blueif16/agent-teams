import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  Brain,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Ban,
  Database,
  Eye,
  EyeOff,
  FilePenLine,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderX,
  Fingerprint,
  Globe,
  History,
  IdCard,
  KeyRound,
  KeySquare,
  ListChecks,
  Loader,
  Lock,
  Mail,
  MessageSquare,
  NotebookPen,
  PencilLine,
  Plug,
  Puzzle,
  Search,
  ShieldCheck,
  SquareTerminal,
  StickyNote,
  Tag,
  Trash2,
  TriangleAlert,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cache, useCached, type Resource } from "@/lib/client-cache";
import { AGENTS } from "@/lib/data";
import type { Access, CompileResult, DataGuard, DetectorSummary, Permission, Rule, RuleConflict, RulesResponse, SaveRulesResponse } from "@/lib/policy/types";
import type { FileAccess, FileZoneView } from "@/lib/policy/zones";
import { POP, SPRING } from "./ui";

/*
 * Permissions tab (design §6): what an agent can do, in plain words, from GET /api/rules. One line per capability
 * (relevant ones first: those in the agent's toolset), one per file zone, one per kind of data, and the rules you
 * added. A row opens to at most three short lines: its limits (or a zone's reason) and who set it.
 */

type State = Access | "hidden";
type Look = { label: string; Icon: LucideIcon; cls: string };

/** The only words a state is ever shown as. Gray lets through, blue asks, red stops, amber hides. */
const STATE: Record<State, Look> = {
  allow: { label: "Allowed", Icon: Check, cls: "bg-bubble text-ink-2" },
  ask: { label: "Asks you", Icon: CircleHelp, cls: "bg-accent-wash text-accent" },
  deny: { label: "Blocked", Icon: X, cls: "bg-danger-wash text-danger" },
  hidden: { label: "Hidden", Icon: EyeOff, cls: "bg-caution-wash text-caution" },
};

const GUARD_STATE: Record<DataGuard["outcome"], State> = { block: "deny", ask: "ask", hidden: "hidden", allow: "allow" };

const CAPABILITY_ICON: Record<string, LucideIcon> = {
  "files.read": FileText,
  "files.write": FilePenLine,
  plan: ListChecks,
  team: Users,
  memory: Brain,
  "web.search": Search,
  "web.open": Globe,
  email: Mail,
  post: MessageSquare,
  calendar: CalendarDays,
  delete: Trash2,
  apis: Plug,
  money: CreditCard,
  accounts: KeyRound,
  code: SquareTerminal,
};

const DATA_ICON: Record<string, LucideIcon> = { secret: KeySquare, pii: IdCard, project: FolderClosed, owner_private: NotebookPen };

/** What an agent can do in a file zone, in the same colors; dimmer gray for "only reads". */
const FILE_LOOK: Record<FileAccess, Look> = {
  edit: { label: "Can edit", Icon: PencilLine, cls: "bg-bubble text-ink-2" },
  ask: { label: "Asks you", Icon: CircleHelp, cls: "bg-accent-wash text-accent" },
  read: { label: "Read only", Icon: Eye, cls: "bg-bubble text-muted" },
  protected: { label: "Protected", Icon: ShieldCheck, cls: "bg-bubble text-muted" },
  never: { label: "Never", Icon: Ban, cls: "bg-danger-wash text-danger" },
};

const ZONE_ICON: Record<string, LucideIcon> = {
  project: FolderOpen,
  scratch: StickyNote,
  home: Fingerprint,
  state: ListChecks,
  skills: Puzzle,
  history: History,
  secrets: KeySquare,
  stores: Database,
  outside: FolderX,
};

/** What a rule does when it fires, as a pill; a classifier only labels data, so it has none. */
function stateOfRule(rule: Rule): State | null {
  switch (rule.kind) {
    case "tool":
      return rule.effect;
    case "flow":
      return rule.action === "block" ? "deny" : rule.action === "ask" ? "ask" : rule.action === "allow" ? "allow" : "hidden";
    case "grant":
      // A grant only ever turns an ask into an allow.
      return "allow";
    case "budget":
      return rule.onExceed === "ask" ? "ask" : "deny";
    case "classifier":
      return null;
  }
}

const ownedByYou = (r: Rule) => r.createdBy !== "default";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Pill({ state, small = false }: { state: State; small?: boolean }) {
  return <LookPill look={STATE[state]} id={state} small={small} />;
}

/** A state pill in any vocabulary: `id` keys the pop when it changes. */
function LookPill({ look, id, small = false }: { look: Look; id: string; small?: boolean }) {
  const { label, Icon, cls } = look;
  return (
    // A fixed box for row pills (as wide as "Asks you"), so the marks before it line up down the list. In a narrow
    // pane the glyph goes and the words stay, so the labels keep their room.
    <span className={`flex shrink-0 justify-end ${small ? "" : "min-w-[84px] @max-sm:min-w-[68px]"}`}>
      {/* Keyed on the state so a change pops instead of swapping silently; no pop on first paint. */}
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={id}
          initial={{ scale: 0.75, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.06 } }}
          transition={POP}
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium ${
            small ? "px-1.5 text-[11.5px] leading-[18px]" : "px-2 py-0.5 text-[12px] leading-[16px]"
          } ${cls}`}
        >
          <Icon className="size-3 @max-sm:hidden" strokeWidth={2.5} />
          {label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** GET /api/rules for an agent's panel or a team's. Saves and deletes announce the `rules` topic, which refetches it. */
export const rulesOf = ({ agentId, projectId }: { agentId?: string; projectId?: string }): Resource => ({
  key: `/api/rules?${agentId ? `agent=${encodeURIComponent(agentId)}` : `project=${encodeURIComponent(projectId ?? "")}`}`,
  topic: "rules",
});

/** The rule ids that arrived since the snapshot this view showed before, so new rows pop in (none on first paint). */
function useArrivals(data: RulesResponse | undefined): ReadonlySet<string> {
  const [seen, setSeen] = useState<{ data: RulesResponse | undefined; fresh: ReadonlySet<string> }>({ data, fresh: new Set() });
  if (seen.data !== data) {
    const before = seen.data ? new Set(seen.data.rules.map((r) => r.id)) : null;
    setSeen({ data, fresh: new Set(before && data ? data.rules.filter((r) => !before.has(r.id)).map((r) => r.id) : []) });
  }
  return seen.fresh;
}

function Section({ title, children, className = "mt-6" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      {title && <h3 className="mb-2 px-1 text-[13px] font-medium text-muted">{title}</h3>}
      {/* No overflow clip: the remove popover hangs out of the card. Rows round their own corners instead. */}
      <ul className="rounded-2xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">{children}</ul>
    </section>
  );
}

// ---------- removing a rule ----------

/** The confirm step before a DELETE: anchored to its button, closes on Escape or a click outside. */
function RemoveConfirm({
  sentence,
  align,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  sentence: string;
  align: "left" | "right";
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onCancel} />
      <motion.div
        role="dialog"
        aria-label="Remove this rule?"
        initial={{ opacity: 0, scale: 0.94, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.1 } }}
        transition={SPRING}
        style={{ transformOrigin: align === "right" ? "top right" : "top left" }}
        className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full z-40 mt-1.5 w-64 rounded-2xl bg-white p-3 text-left text-ink shadow-[0_8px_30px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.05)]`}
      >
        <p className="text-[13.5px] font-medium">Remove this rule?</p>
        <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[17px] text-ink-2">{sentence}</p>
        {error && <p className="mt-1.5 text-[12px] leading-[16px] text-danger">{error}</p>}
        <div className="mt-2.5 flex justify-end gap-1.5">
          <button type="button" onClick={onCancel} className="tap rounded-full px-3 py-1 text-[13px] font-medium text-ink-2 hover:bg-bubble">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="tap rounded-full bg-danger px-3 py-1 text-[13px] font-medium text-white hover:shadow-lg hover:shadow-danger/30 disabled:opacity-60"
          >
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      </motion.div>
    </>
  );
}

interface Removal {
  confirming: boolean;
  busy: boolean;
  error: string | null;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** One confirm open at a time across the tab; `where` keeps a row's remove and its Your-rules trash apart. */
function useRemoval(onRemoved: (id: string) => void) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useCallback(() => {
    setConfirm(null);
    setError(null);
  }, []);
  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rules/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw await failure(res, "Couldn't remove it");
      setConfirm(null);
      onRemoved(id);
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(false);
    }
  };
  const removal = (id: string, where: string): Removal => {
    const key = `${where}:${id}`;
    return {
      confirming: confirm === key,
      busy: busy && confirm === key,
      error: confirm === key ? error : null,
      onAsk: () => {
        setError(null);
        setConfirm((c) => (c === key ? null : key));
      },
      onCancel: cancel,
      onConfirm: () => void remove(id),
    };
  };
  return removal;
}

// ---------- rows ----------

/** A one-line row that opens to a few short lines. */
function Row({
  icon: Icon,
  label,
  marks,
  state,
  pill,
  open,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  label: string;
  marks?: ReactNode;
  state?: State;
  /** In place of a state pill (the Files section's own words). */
  pill?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <li className="border-t border-line first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        // A narrow pane trims gaps and type a little so the longest label ("Use passwords and accounts") still fits.
        className="tap-soft flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-black/[0.03] @max-sm:gap-1.5 @max-sm:pl-3 @max-sm:pr-2.5 [li:first-child>&]:rounded-t-2xl [li:last-child>&]:rounded-b-2xl"
      >
        <Icon className="size-4 shrink-0 text-ink-2 @max-sm:mr-0.5" strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate text-[14px] leading-[20px] @max-sm:text-[13.5px]">{label}</span>
        {marks}
        {pill ?? (state && <Pill state={state} />)}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="detail"
            // Clip while the height moves, then let the remove popover hang out.
            initial={{ height: 0, opacity: 0, overflow: "hidden" }}
            animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
            exit={{ height: 0, opacity: 0, overflow: "hidden" }}
            transition={SPRING}
          >
            <div className="pb-2.5 pl-11 pr-4 @max-sm:pl-9 @max-sm:pr-2.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function Line({ text, state }: { text: string; state?: State }) {
  return (
    // One line in a wide pane; up to two in a narrow one, where one line would cut most of it.
    <div className="flex items-start gap-2 py-[3px]">
      <span className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink-2 @sm:truncate @max-sm:line-clamp-2" title={text}>
        {text}
      </span>
      {state && <Pill small state={state} />}
    </div>
  );
}

const LIMIT_ORDER: Access[] = ["deny", "ask", "allow"];

/** Rules in force by id, each with the sentence it reads as. */
type RuleIndex = Map<string, { rule: Rule; sentence: string }>;

function PermissionRow({
  p,
  rules,
  open,
  onToggle,
  removal,
}: {
  p: Permission;
  rules: RuleIndex;
  open: boolean;
  onToggle: () => void;
  removal: (id: string, where: string) => Removal;
}) {
  // Limits read as one line per outcome, so the detail stays at three lines: two of limits, one of who set it.
  const groups = LIMIT_ORDER.map((a) => ({ a, texts: p.limits.filter((l) => l.access === a).map((l) => l.text) })).filter((g) => g.texts.length);
  const shown = groups.slice(0, 2);
  const rest = groups.slice(2).flatMap((g) => g.texts);
  const yours = p.ruleIds.map((id) => rules.get(id)).find((r) => r !== undefined && ownedByYou(r.rule) && !r.rule.locked);
  return (
    <Row
      icon={CAPABILITY_ICON[p.id] ?? Tag}
      label={p.label}
      state={p.access}
      open={open}
      onToggle={onToggle}
      marks={
        <>
          {p.planned && <span className="shrink-0 text-[12px] leading-[16px] text-muted">soon</span>}
          {p.limits.length > 0 && <span title="Has limits" className="size-1.5 shrink-0 rounded-full bg-ink-2/35" />}
          {p.locked && <Lock aria-label="Locked" className="size-3.5 shrink-0 text-muted" />}
        </>
      }
    >
      {shown.map((g, i) => (
        <Line key={g.a} state={g.a} text={[...g.texts, ...(i === shown.length - 1 ? rest : [])].join(" · ")} />
      ))}
      <WhoSetIt locked={p.locked} yours={yours?.rule} sentence={yours?.sentence ?? ""} removal={yours ? removal(yours.rule.id, "row") : null} />
    </Row>
  );
}

function WhoSetIt({ locked, yours, sentence, removal }: { locked: boolean; yours: Rule | undefined; sentence: string; removal: Removal | null }) {
  // A div, not a p: the remove popover inside holds paragraphs of its own.
  const cls = "pt-[3px] text-[12.5px] leading-[18px] text-muted";
  if (locked) return <div className={cls}>Locked: can&apos;t be loosened</div>;
  if (!yours || !removal) return <div className={cls}>Default</div>;
  return (
    <div className={cls}>
      You ·{" "}
      <span className="relative inline-block">
        <button
          type="button"
          aria-expanded={removal.confirming}
          onClick={removal.onAsk}
          className={`tap -mx-1 rounded-full px-1 hover:bg-danger-wash hover:text-danger ${removal.confirming ? "bg-danger-wash text-danger" : ""}`}
        >
          remove
        </button>
        <AnimatePresence>
          {removal.confirming && (
            <RemoveConfirm align="left" sentence={sentence} busy={removal.busy} error={removal.error} onCancel={removal.onCancel} onConfirm={removal.onConfirm} />
          )}
        </AnimatePresence>
      </span>
    </div>
  );
}

function DataRow({ g, open, onToggle }: { g: DataGuard; open: boolean; onToggle: () => void }) {
  const shown = g.rules.length > 3 ? g.rules.slice(0, 2) : g.rules;
  return (
    <Row
      icon={DATA_ICON[g.id] ?? Tag}
      label={g.label}
      state={GUARD_STATE[g.outcome]}
      open={open}
      onToggle={onToggle}
      marks={g.locked && <Lock aria-label="Locked" className="size-3.5 shrink-0 text-muted" />}
    >
      {shown.map((r) => (
        <Line key={r.ruleId} text={r.text} state={GUARD_STATE[r.outcome]} />
      ))}
      {g.rules.length > shown.length && <p className="pt-[3px] text-[12.5px] leading-[18px] text-muted">+{g.rules.length - shown.length} more</p>}
    </Row>
  );
}

/** One file zone: what the agent can do there; opens to the reason, the paths and who set it. */
function FileRow({ z, rules, open, onToggle }: { z: FileZoneView; rules: RuleIndex; open: boolean; onToggle: () => void }) {
  const yours = z.ruleIds.map((id) => rules.get(id)).find((r) => r !== undefined && ownedByYou(r.rule));
  return (
    <Row
      icon={z.severity === "deliverable" ? FilePenLine : (ZONE_ICON[z.id] ?? FileText)}
      label={z.label}
      pill={<LookPill look={FILE_LOOK[z.access]} id={z.access} />}
      open={open}
      onToggle={onToggle}
      marks={z.access === "protected" && <Lock aria-label="Locked" className="size-3.5 shrink-0 text-muted" />}
    >
      <p className="py-[3px] text-[13px] leading-[18px] text-ink-2">{z.reason}</p>
      {z.id !== "outside" && <p className="break-all py-[3px] font-mono text-[11.5px] leading-[16px] text-muted">{z.paths.join("  ")}</p>}
      <div className="pt-[3px] text-[12.5px] leading-[18px] text-muted">{z.locked ? "Locked: can't be loosened" : yours ? `Your rule: ${yours.sentence}` : "Default"}</div>
    </Row>
  );
}

/** "Mira can": capabilities in the agent's toolset, then the rest behind one collapsed row. */
function Permissions({
  name,
  permissions,
  rules,
  open,
  onToggle,
  removal,
}: {
  name: string;
  permissions: Permission[];
  rules: RuleIndex;
  open: string | null;
  onToggle: (key: string) => void;
  removal: (id: string, where: string) => Removal;
}) {
  const [more, setMore] = useState(false);
  const has = permissions.filter((p) => p.inToolset);
  const lacks = permissions.filter((p) => !p.inToolset);
  const rows = (ps: Permission[]) =>
    ps.map((p) => <PermissionRow key={p.id} p={p} rules={rules} open={open === p.id} onToggle={() => onToggle(p.id)} removal={removal} />);
  return (
    <>
      {has.length > 0 && <Section title={`${name} can`}>{rows(has)}</Section>}
      {lacks.length > 0 && (
        <div className={has.length ? "mt-1.5" : "mt-6"}>
          <button
            type="button"
            aria-expanded={more}
            onClick={() => setMore((m) => !m)}
            className="tap-soft flex items-center gap-1 rounded-full py-1 pl-1.5 pr-2.5 text-[13px] leading-[18px] text-muted hover:bg-black/[0.04] hover:text-ink-2"
          >
            <motion.span animate={{ rotate: more ? 90 : 0 }} transition={SPRING} className="grid place-items-center">
              <ChevronRight className="size-3.5" />
            </motion.span>
            {lacks.length} more {name} doesn&apos;t have
          </button>
          <AnimatePresence initial={false}>
            {more && (
              <motion.div
                key="more"
                initial={{ height: 0, opacity: 0, overflow: "hidden" }}
                animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
                exit={{ height: 0, opacity: 0, overflow: "hidden" }}
                transition={SPRING}
              >
                <Section className="pt-1.5">{rows(lacks)}</Section>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}

function YourRuleRow({ rule, sentence, fresh, reveal, removal }: { rule: Rule; sentence: string; fresh: boolean; reveal: boolean; removal: Removal }) {
  const ref = useRef<HTMLLIElement>(null);
  // A rule you just saved scrolls into view, so you see it pop in.
  useEffect(() => {
    if (!reveal) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" });
  }, [reveal]);
  const state = stateOfRule(rule);
  return (
    <motion.li
      ref={ref}
      initial={fresh ? { opacity: 0, y: 12, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      // Fade first, then close the gap, so the leaving text never overlaps the row below.
      exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, transition: { opacity: { duration: 0.08 }, default: SPRING } }}
      transition={POP}
      className="flex items-center gap-2 border-t border-line py-2 pl-4 pr-2.5 first:border-t-0"
    >
      <span className="min-w-0 flex-1 line-clamp-2 text-[14px] leading-[20px]" title={rule.source?.nl ?? sentence}>
        {sentence}
      </span>
      {rule.mode === "shadow" && (
        <span
          title="Logged, never enforced"
          className="shrink-0 whitespace-nowrap rounded-full border border-dashed border-ink-2/40 px-1.5 text-[11px] leading-[16px] text-ink-2"
        >
          Log only
        </span>
      )}
      {state && <Pill state={state} />}
      <span className="relative grid size-7 shrink-0 place-items-center text-muted">
        {rule.locked ? (
          <span role="img" aria-label="Locked" title="Locked: can't be loosened or removed here">
            <Lock className="size-3.5" />
          </span>
        ) : (
          <button
            type="button"
            aria-label={`Remove rule: ${sentence}`}
            aria-expanded={removal.confirming}
            title="Remove"
            onClick={removal.onAsk}
            className={`tap grid size-7 place-items-center rounded-full hover:bg-danger-wash hover:text-danger ${removal.confirming ? "bg-danger-wash text-danger" : ""}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
        <AnimatePresence>
          {removal.confirming && (
            <RemoveConfirm align="right" sentence={sentence} busy={removal.busy} error={removal.error} onCancel={removal.onCancel} onConfirm={removal.onConfirm} />
          )}
        </AnimatePresence>
      </span>
    </motion.li>
  );
}

/** One muted line: how many local detectors check the data, and whether each hosted check is on. */
function DetectorLine({ detectors }: { detectors: DetectorSummary[] }) {
  const local = detectors.filter((d) => d.configured === undefined).reduce((n, d) => n + d.rules, 0);
  const hosted = detectors.filter((d) => d.configured !== undefined).map((d) => `${d.name.split(" ")[0]} ${d.configured ? "on" : "off"}`);
  return <p className="mt-6 px-1 text-[12px] leading-[16px] text-muted">{[`Checked by ${local} local detectors`, ...hosted].join(" · ")}</p>;
}

// ---------- composer ----------

const CONFLICT_LABEL: Record<RuleConflict["kind"], string> = {
  shadowed: "Already covered",
  tightens: "Tightens",
  revokes_grant: "Revokes a grant",
  duplicate: "Duplicate",
};

const TONE = {
  danger: "bg-danger-wash text-danger",
  ask: "bg-accent-wash text-accent",
  caution: "bg-caution-wash text-caution",
  neutral: "bg-bubble text-ink-2",
} as const;

function CountChip({ label, tone }: { label: string; tone: keyof typeof TONE }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[12px] font-medium leading-[16px] ${TONE[tone]}`}>{label}</span>;
}

/** POST /api/rules { rules, mode }: the same two modes a rule carries. */
type SaveMode = NonNullable<Rule["mode"]>;

/** The server's own `{ error }` message when it sent one, else a plain fallback. */
async function failure(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return new Error(typeof body?.error === "string" ? body.error : `${fallback} (${res.status})`);
}
const reason = (e: unknown) => (e instanceof TypeError ? "The app server didn't answer" : (e as Error).message);
const asSentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

const btn = "tap rounded-full px-3.5 py-1.5 text-[13.5px] font-medium";

function Proposal({
  result,
  round,
  busy,
  picked,
  error,
  existing,
  onAnswer,
  onSave,
  onCancel,
}: {
  result: CompileResult;
  round: number;
  busy: "compile" | SaveMode | null;
  picked: string | null;
  error: string | null;
  /** Read-backs of the rules already in force, for the conflict lines. */
  existing: Record<string, string>;
  onAnswer: (q: string, option: string) => void;
  onSave: (mode: SaveMode) => void;
  onCancel: () => void;
}) {
  const n = result.rules.length;
  // readBack is a list, not keyed by id; when it lines up with the rules, each line gets its rule's pill.
  const aligned = n === result.readBack.length;
  const d = result.dryRun;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.14 } }}
      transition={POP}
      style={{ transformOrigin: "top center" }}
      className="mt-2 rounded-[20px] bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_8px_24px_rgba(0,0,0,0.06)]"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-medium text-muted">{n === 0 ? "Nothing new to add" : n === 1 ? "Proposed rule" : "Proposed rules"}</h3>
        {busy === "compile" && (
          <span className="inline-flex items-center gap-1 text-[12px] text-muted">
            <Loader className="size-3 animate-spin motion-reduce:animate-none" />
            Updating…
          </span>
        )}
      </div>
      {/* Keyed per compile so a recompiled proposal pops in. */}
      <motion.div
        key={round}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: busy === "compile" ? 0.55 : 1, y: 0 }}
        transition={POP}
      >
        <ul className="mt-2 space-y-1.5">
          {result.readBack.map((line, i) => {
            const state = aligned ? stateOfRule(result.rules[i]) : null;
            return (
              <li key={i} className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-[14.5px] leading-[21px]">{line}</span>
                {state && (
                  <span className="mt-0.5 flex">
                    <Pill state={state} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {result.questions.map((q) => (
          <div key={q.q} className="mt-3">
            <p className="text-[13.5px] font-medium leading-[19px]">{q.q}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {q.options.map((o) => {
                const on = picked === `${q.q}\n${o}`;
                return (
                  <button
                    key={o}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => onAnswer(q.q, o)}
                    className={`tap rounded-full px-3 py-1 text-[13px] ${on ? "bg-accent text-white" : "bg-bubble hover:bg-black/[0.08] disabled:opacity-60"}`}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {result.assumptions.length > 0 && (
          <p className="mt-3 truncate text-[12.5px] leading-[18px] text-muted" title={result.assumptions.join("\n")}>
            Assumed: {result.assumptions.join("; ")}
          </p>
        )}

        {result.conflicts.map((c) => (
          <div key={`${c.kind}-${c.ruleId}-${c.otherRuleId}`} className="mt-3 flex gap-2 rounded-xl bg-caution-wash px-3 py-2 text-[13px] leading-[18px]">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-caution" />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-caution">{CONFLICT_LABEL[c.kind]}</span> · {c.note}
              {existing[c.otherRuleId] && (
                <span className="mt-0.5 block truncate text-[12px] text-ink-2" title={existing[c.otherRuleId]}>
                  Existing rule: {existing[c.otherRuleId]}
                </span>
              )}
            </span>
          </div>
        ))}

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3 text-[12.5px] leading-[18px] text-muted">
          {d ? (
            <>
              <span className="mr-1">Last {plural(d.total, "call")}</span>
              <CountChip label={`${d.block} blocked`} tone="danger" />
              <CountChip label={`${d.ask} asked`} tone="ask" />
              <CountChip label={`${d.redact} redacted`} tone="caution" />
              <CountChip label={`${d.allow} allowed`} tone="neutral" />
            </>
          ) : (
            <span>No recorded calls to test it on yet</span>
          )}
        </div>
      </motion.div>

      {error && <p className="mt-3 text-[12.5px] text-danger">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={n === 0 || busy !== null}
          onClick={() => onSave("enforce")}
          className={`${btn} bg-accent text-white hover:shadow-lg hover:shadow-accent/30 disabled:bg-accent-soft disabled:shadow-none`}
        >
          {busy === "enforce" ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={n === 0 || busy !== null}
          onClick={() => onSave("shadow")}
          title="Log what it would do, without enforcing it"
          className={`${btn} bg-white ring-1 ring-black/10 hover:bg-bubble disabled:opacity-50`}
        >
          {busy === "shadow" ? "Saving…" : "Log only"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy === "enforce" || busy === "shadow"} className={`${btn} text-ink-2 hover:bg-bubble`}>
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

/** "Change a permission in plain words…": compiles the sentence, shows the proposal, saves it. */
function RuleComposer({
  agentId,
  projectId,
  existing,
  onSaved,
}: {
  agentId?: string;
  projectId?: string;
  existing: Record<string, string>;
  /** The rules as saved (final ids), each with its read-back when the compile gave one per rule. */
  onSaved: (rules: Rule[], readBack: Record<string, string>, mode: SaveMode) => void;
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<CompileResult | null>(null);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState<"compile" | SaveMode | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Cancel, so a compile that lands afterwards doesn't reopen the card.
  const attempt = useRef(0);

  const compile = async (sentence: string) => {
    if (!sentence.trim() || busy) return;
    const mine = ++attempt.current;
    setBusy("compile");
    setError(null);
    try {
      const res = await fetch("/api/rules/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sentence.trim(), agent: agentId, project: projectId }),
      });
      if (!res.ok) throw await failure(res, "Couldn't turn that into a rule");
      const r = (await res.json()) as CompileResult;
      if (mine !== attempt.current) return;
      setResult(r);
      setRound((x) => x + 1);
    } catch (e) {
      if (mine === attempt.current) setError(reason(e));
    } finally {
      if (mine === attempt.current) {
        setBusy(null);
        setPicked(null);
      }
    }
  };

  // An answer joins the sentence, so the box shows exactly what was compiled.
  const answer = (q: string, option: string) => {
    const next = `${asSentence(text)} ${q.trim()} ${asSentence(option)}`;
    setText(next);
    setPicked(`${q}\n${option}`);
    void compile(next);
  };

  const save = async (mode: SaveMode) => {
    if (!result?.rules.length || busy) return;
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: result.rules, mode }),
      });
      if (!res.ok) throw await failure(res, "Couldn't save the rule");
      // The store keeps the order, so each saved rule lines up with its proposed read-back.
      const { rules } = (await res.json()) as SaveRulesResponse;
      const aligned = rules.length === result.readBack.length;
      onSaved(rules, aligned ? Object.fromEntries(rules.map((r, i) => [r.id, result.readBack[i]])) : {}, mode);
      setResult(null);
      setText("");
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    attempt.current++;
    setResult(null);
    setBusy(null);
    setPicked(null);
    setError(null);
  };

  const canSend = text.trim().length > 0 && busy === null;
  return (
    <div className="mt-5">
      <div className="flex items-end gap-1 rounded-[22px] border border-line bg-white py-1.5 pl-4 pr-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] focus-within:border-accent-soft focus-within:ring-3 focus-within:ring-accent/12">
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void compile(text);
            }
          }}
          placeholder="Change a permission in plain words…"
          aria-label="Change a permission"
          className="own-focus scroll-quiet field-sizing-content max-h-40 min-h-[34px] min-w-0 flex-1 resize-none bg-transparent py-[7px] text-[14.5px] leading-[20px] outline-none placeholder:text-muted"
        />
        <button
          type="button"
          aria-label="Turn into a rule"
          title="Turn into a rule"
          onClick={() => void compile(text)}
          disabled={!canSend}
          className={`tap grid size-[34px] shrink-0 place-items-center rounded-full text-white ${canSend ? "bg-accent hover:shadow-lg hover:shadow-accent/30" : "bg-accent-soft"}`}
        >
          {busy === "compile" ? (
            <Loader className="size-[17px] animate-spin motion-reduce:animate-none" />
          ) : (
            <ArrowUp className="size-[18px]" strokeWidth={2.2} />
          )}
        </button>
      </div>
      {!result && error && <p className="mt-1.5 px-4 text-[12.5px] leading-[18px] text-danger">{error}</p>}
      <AnimatePresence initial={false}>
        {result && (
          <Proposal
            key="proposal"
            result={result}
            round={round}
            busy={busy}
            picked={picked}
            error={error}
            existing={existing}
            onAnswer={answer}
            onSave={(m) => void save(m)}
            onCancel={cancel}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function LoadState({ error, onRetry }: { error: string | undefined; onRetry: () => void }) {
  if (!error) return <p className="mt-6 text-center text-[13px] text-muted">Loading permissions…</p>;
  return (
    <p className="mt-6 text-center text-[13px] text-ink-2">
      Couldn&apos;t load permissions: {error}.{" "}
      <button type="button" onClick={onRetry} className="tap rounded-full px-1.5 py-0.5 font-medium text-accent hover:bg-accent-wash">
        Try again
      </button>
    </p>
  );
}

/** The Permissions tab: `agentId` for an agent's panel, `projectId` for a team's (no capability list there yet). */
export function RulesTab({ agentId, projectId, onNotify }: { agentId?: string; projectId?: string; onNotify: (text: string) => void }) {
  const resource = rulesOf({ agentId, projectId });
  // Cached: switching tabs or panels paints the last snapshot at once; the `rules` topic refetches it after a write.
  const { data, error } = useCached<RulesResponse & { files?: FileZoneView[] }>(resource);
  const fresh = useArrivals(data);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  // One row open at a time keeps the tab short.
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen((o) => (o === key ? null : key));
  // Writes show at once in the cached copy; the topic refetch then brings the recomputed permissions.
  const edit = (update: (d: RulesResponse) => RulesResponse) => cache.mutate<RulesResponse>(resource.key, (d) => d && update(d));
  const removal = useRemoval((id) => {
    edit((d) => ({ ...d, rules: d.rules.filter((r) => r.id !== id) }));
    onNotify("Rule removed");
  });
  if (!data) return <LoadState error={error} onRetry={() => void cache.revalidate(resource.key)} />;

  const byId: RuleIndex = new Map(data.rules.map((r) => [r.id, { rule: r, sentence: data.readBack[r.id] ?? r.reason ?? "A rule you added" }]));
  const yours = data.rules.filter(ownedByYou);
  return (
    <div className="@container">
      <RuleComposer
        agentId={agentId}
        projectId={projectId}
        existing={data.readBack}
        onSaved={(rules, readBack, mode) => {
          setSaved(new Set(rules.map((r) => r.id)));
          edit((d) => ({ ...d, rules: [...d.rules, ...rules], readBack: { ...d.readBack, ...readBack } }));
          onNotify(`Saved ${plural(rules.length, "rule")}${mode === "shadow" ? ", log only" : ""}`);
        }}
      />
      {agentId && data.permissions && (
        <Permissions
          name={AGENTS[agentId]?.name ?? agentId}
          permissions={data.permissions}
          rules={byId}
          open={open}
          onToggle={toggle}
          removal={removal}
        />
      )}
      {data.files && (
        <Section title="Files">
          {data.files.map((z) => (
            <FileRow key={z.id} z={z} rules={byId} open={open === `file:${z.id}`} onToggle={() => toggle(`file:${z.id}`)} />
          ))}
        </Section>
      )}
      <Section title="Data">
        {data.data.length === 0 ? (
          <li className="px-4 py-2.5 text-[13px] text-muted">No data rules</li>
        ) : (
          data.data.map((g) => <DataRow key={g.id} g={g} open={open === `data:${g.id}`} onToggle={() => toggle(`data:${g.id}`)} />)
        )}
      </Section>
      {yours.length > 0 && (
        <Section title="Your rules">
          <AnimatePresence initial={false}>
            {yours.map((r) => (
              <YourRuleRow
                key={r.id}
                rule={r}
                sentence={byId.get(r.id)!.sentence}
                fresh={fresh.has(r.id)}
                reveal={fresh.has(r.id) && saved.has(r.id)}
                removal={removal(r.id, "list")}
              />
            ))}
          </AnimatePresence>
        </Section>
      )}
      <DetectorLine detectors={data.detectors} />
    </div>
  );
}
