"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, GitBranch, HistoryIcon, MessageSquareQuote, MoonStar, RotateCcw, Sprout, X } from "lucide-react";
import { cache, useCached, type Resource } from "@/lib/client-cache";
import { AGENTS, CAST } from "@/lib/data";
import type { AgentType, MascotLook } from "@/lib/types";
import { derivationsOf, originOf, relativeTime, sourceChip, summaryOf, type Derivation, type FileOrigin } from "@/lib/vault/present";
import {
  AGENT_FILES,
  type AgentFileName,
  type DiffSegment,
  type FileDiff,
  type FileHistory as FileHistoryData,
  type VaultAuthor,
  type VaultCommit,
  type VaultSource,
} from "@/lib/vault/types";
import { Mascot } from "./Mascot";
import { POP, SPRING, YouAvatar } from "./ui";

/*
 * The timeline of one agent file (SOUL.md, MEMORY.md, notes.md) from the vault:
 * where it came from, every change newest first with who made it, why and what
 * it was derived from, a word diff per change, and Restore as a new version.
 * HistoryButton is the clock quick action that opens it in a sheet.
 */

export interface FileHistoryProps {
  agentId: string;
  file: AgentFileName;
  /** Shows the app's toast (AgentTeams' notify). */
  onNotify: (text: string) => void;
  /** After a restore, the file as it is now, so the caller can refresh its copy. */
  onRestored?: (file: { content: string; updated: string }) => void;
}

const filesRoute = (agentId: string, file: AgentFileName) => `/api/agents/${encodeURIComponent(agentId)}/files/${file}`;
// Every commit to an agent's files announces files:agent:<id> (the vault's announceCommit), as Identity's reads use.
const filesTopic = (agentId: string) => `files:agent:${agentId}`;

/** The client-cache resource for a file's history: prefetch it to make the first open instant. */
export const historyOf = (agentId: string, file: AgentFileName): Resource => ({
  key: `${filesRoute(agentId, file)}/history`,
  topic: filesTopic(agentId),
});

/** One version's word diff against the version before it. A version never changes, so neither does its diff. */
const diffOf = (agentId: string, file: AgentFileName, change: string): Resource => ({
  key: `${filesRoute(agentId, file)}/diff?to=${encodeURIComponent(change)}`,
  topic: filesTopic(agentId),
});

// Relative times re-read the clock once a minute; render code never calls Date.now() itself.
const MINUTE = 60_000;
const subscribeClock = (tick: () => void) => {
  const t = setInterval(tick, MINUTE);
  return () => clearInterval(t);
};
const clockNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;
const useNow = () => useSyncExternalStore(subscribeClock, clockNow, () => 0);

const TYPES: AgentType[] = ["lead", "writer", "researcher", "coordinator", "analyst", "engineer"];
const castIndex = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % TYPES.length;
};
/** An agent's mascot; agents from earlier companies (parents in Seeded-From) get a stable stand-in. */
function lookFor(id: string): MascotLook {
  return AGENTS[id]?.look ?? CAST[TYPES[castIndex(id)]];
}
/** Mascots for agents shown side by side: stand-ins never repeat, so two parents never look alike. */
function distinctLooks(ids: string[]): MascotLook[] {
  const used = new Set<number>();
  return ids.map((id) => {
    const known = AGENTS[id]?.look;
    if (known) return known;
    let i = castIndex(id);
    while (used.has(i) && used.size < TYPES.length) i = (i + 1) % TYPES.length;
    used.add(i);
    return CAST[TYPES[i]];
  });
}

const nameOf = (id: string) => AGENTS[id]?.name ?? id.charAt(0).toUpperCase() + id.slice(1);
const actorName = (a: VaultAuthor) => (a.kind === "owner" ? "You" : a.kind === "system" ? "Agent Teams" : (AGENTS[a.id]?.name ?? a.name));
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Actor({ author, size = 24 }: { author: VaultAuthor; size?: number }) {
  if (author.kind === "owner") return <YouAvatar size={size} />;
  if (author.kind === "system")
    return (
      <span className="grid shrink-0 place-items-center rounded-full bg-[#e9f6ec] text-[#2f8a4a]" style={{ width: size, height: size }}>
        <Sprout className="size-[60%]" strokeWidth={2.2} />
      </span>
    );
  return <Mascot look={lookFor(author.id)} size={size} />;
}

const CHIP_TONE: Record<VaultSource, string> = {
  seed: "bg-[#e9f6ec] text-[#2f7a45]",
  owner: "bg-accent-wash text-accent",
  pin: "bg-[#fff4de] text-[#9a5b00]",
  dream: "bg-[#f1ebfe] text-[#6d3fd6]",
  tool: "bg-[#e7f3f7] text-[#1d6f8a]",
  report: "bg-[#e7f3f7] text-[#1d6f8a]",
  inherit: "bg-[#e6f6ee] text-[#16794c]",
  restore: "bg-[#eef0f3] text-[#44546a]",
};

function SourceChip({ source }: { source: VaultSource }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-[1px] text-[11.5px] font-medium ${CHIP_TONE[source]}`}>{sourceChip(source).label}</span>
  );
}

const DERIVATION_ICON = { derived: GitBranch, evidence: MessageSquareQuote, dream: MoonStar, restores: RotateCcw } as const;

function DerivationChip({ d }: { d: Derivation }) {
  const Icon = DERIVATION_ICON[d.kind];
  return (
    <span
      title={d.title}
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2 py-[1px] text-[11.5px] text-ink-2 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]"
    >
      <Icon className="size-3 shrink-0 text-muted" />
      <span className="truncate">{d.label}</span>
    </span>
  );
}

function Stats({ stats }: { stats: VaultCommit["stats"] }) {
  if (!stats.added && !stats.removed) return null;
  return (
    <span className="font-mono text-[11.5px] tabular-nums">
      {stats.added > 0 && <span className="text-[#1f8a4c]">+{stats.added}</span>}
      {stats.added > 0 && stats.removed > 0 && " "}
      {stats.removed > 0 && <span className="text-[#c4321b]">−{stats.removed}</span>}
    </span>
  );
}

function Origin({ origin, file }: { origin: FileOrigin; file: string }) {
  let icon: React.ReactNode;
  let title: string;
  let detail: string;
  if (origin.kind === "inherited") {
    const names = origin.parents.map((p) => `${nameOf(p.agent)}${p.version ? ` ${p.version}` : ""}`);
    const looks = distinctLooks(origin.parents.map((p) => p.agent));
    icon = (
      <span className="flex -space-x-2">
        {origin.parents.map((p, i) => (
          <span key={p.agent} className="block rounded-full bg-white ring-2 ring-white">
            <Mascot look={looks[i]} size={30} />
          </span>
        ))}
      </span>
    );
    title = `Inherited from ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]}`;
    detail = `${when(origin.at)}${origin.carried ? ` · ${origin.carried} item${origin.carried === 1 ? "" : "s"} carried over` : ""}`;
  } else if (origin.kind === "template") {
    icon = <Actor author={{ kind: "system", id: "runtime", name: "Agent Teams" }} size={30} />;
    title = `Seeded from the ${origin.archetype ? `${origin.archetype} ` : "archetype "}template`;
    detail = `${when(origin.at)} · the first ${file}`;
  } else {
    icon = <Actor author={origin.author} size={30} />;
    title = `Started by ${actorName(origin.author)}`;
    detail = when(origin.at);
  }
  return (
    <section className="rounded-[20px] bg-white px-4 py-3.5 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Origin</div>
      <div className="mt-2 flex items-center gap-3">
        {icon}
        <div className="min-w-0">
          <p className="text-[14px] font-semibold leading-[19px]">{title}</p>
          <p className="mt-0.5 text-[12.5px] text-muted">{detail}</p>
        </div>
      </div>
    </section>
  );
}

const SEG: Record<DiffSegment["op"], string> = {
  same: "",
  add: "rounded-[3px] bg-[#d9f4e3] text-[#0f5f33]",
  del: "rounded-[3px] bg-[#fde3e1] text-[#a1261d] line-through decoration-[#a1261d]/50",
};

function WordDiff({ agentId, file, change }: { agentId: string; file: AgentFileName; change: string }) {
  const { data, error } = useCached<FileDiff>(diffOf(agentId, file, change));
  if (!data && error) return <p className="py-2 text-[12.5px] text-[#c4321b]">Couldn&apos;t load this change ({error}).</p>;
  if (!data) return <p className="py-2 text-[12.5px] text-muted">Loading the change…</p>;
  const { hunks } = data;
  if (!hunks.length) return <p className="py-2 text-[12.5px] text-muted">No text changed in this version.</p>;
  return (
    <div className="rounded-2xl bg-white py-2 text-[13px] leading-[20px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
      {hunks.map((h, i) => (
        <div key={i}>
          {i > 0 && <div className="my-1 border-t border-dashed border-line" />}
          <div className="px-3 pb-0.5 font-mono text-[10.5px] text-muted">line {h.newStart}</div>
          {h.lines.map((line, j) => {
            const kind = line.length && line.every((s) => s.op === "add") ? "add" : line.length && line.every((s) => s.op === "del") ? "del" : "same";
            return (
              <div
                key={j}
                className={`flex gap-2 px-3 ${kind === "add" ? "bg-[#f0fbf4]" : kind === "del" ? "bg-[#fff4f3]" : ""}`}
              >
                <span className={`w-2.5 shrink-0 select-none font-mono text-[11px] ${kind === "add" ? "text-[#1f8a4c]" : kind === "del" ? "text-[#c4321b]" : "text-transparent"}`}>
                  {kind === "add" ? "+" : kind === "del" ? "−" : "·"}
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-words">
                  {line.length
                    ? line.map((s, k) =>
                        s.op === "same" ? (
                          <span key={k}>{s.text}</span>
                        ) : (
                          // A replacement is a del right before its add; keep the two apart so they don't read as one word.
                          <span key={k} className={`${SEG[s.op]} ${s.op === "del" && line[k + 1]?.op === "add" ? "mr-1" : ""}`}>
                            {s.text}
                          </span>
                        ),
                      )
                    : " "}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ConfirmRestore({
  file,
  agentName,
  at,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  file: string;
  agentName: string;
  at: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The question sits under the diff; bring it fully into view once it has popped in.
  useEffect(() => {
    const t = setTimeout(() => ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 120);
    return () => clearTimeout(t);
  }, []);
  return (
    <motion.div
      ref={ref}
      role="alertdialog"
      aria-label={`Restore ${file}`}
      initial={{ opacity: 0, scale: 0.94, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
      transition={POP}
      style={{ transformOrigin: "top left" }}
      className="mt-2 rounded-2xl bg-white p-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.06)]"
    >
      <p className="text-[13.5px] font-semibold">
        Restore {file} to {when(at)}?
      </p>
      <p className="mt-1 text-[12.5px] leading-[18px] text-ink-2">
        {agentName} works from it on its next turn. Nothing is lost: the restore is a new version on top, so you can restore back.
      </p>
      {error && <p className="mt-2 text-[12.5px] text-[#c4321b]">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="tap rounded-full px-3 py-1 text-[13px] font-medium text-ink-2 hover:bg-bubble">
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="tap rounded-full bg-accent px-3.5 py-1 text-[13px] font-medium text-white hover:bg-[#3557d6] disabled:bg-accent-soft"
        >
          {busy ? "Restoring…" : "Restore"}
        </button>
      </div>
    </motion.div>
  );
}

/** The timeline of one agent file, newest first. */
export function FileHistory({ agentId, file, onNotify, onRestored }: FileHistoryProps) {
  const name = AGENT_FILES[file];
  const agentName = nameOf(agentId);
  const resource = historyOf(agentId, file);
  const { data: history, error } = useCached<FileHistoryData>(resource);
  const now = useNow();
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const toggle = (c: VaultCommit) => {
    setOpen(open === c.change ? null : c.change);
    setConfirm(null);
    setRestoreError(null);
  };

  // A write: a plain POST. The commit announces files:agent:<id>; revalidating here as well makes the new row
  // appear even when the event stream is down.
  const restore = async (c: VaultCommit) => {
    setBusy(true);
    setRestoreError(null);
    try {
      const res = await fetch(`${filesRoute(agentId, file)}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change: c.change }),
      });
      const body = (await res.json().catch(() => ({}))) as { commit?: VaultCommit | null; content?: string; updated?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Restore failed (${res.status})`);
      onNotify(body.commit ? `Restored ${agentName}'s ${name} to ${when(c.at)}` : `${name} already matches that version`);
      onRestored?.({ content: body.content ?? "", updated: body.updated ?? new Date().toISOString() });
      setConfirm(null);
      setOpen(null);
      void cache.revalidate(resource.key);
    } catch (e) {
      setRestoreError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!history && error)
    return (
      <div className="rounded-[20px] bg-white px-4 py-5 text-center shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
        <p className="text-[14px] font-medium">Couldn&apos;t load the history of {name}</p>
        <p className="mt-1 text-[12.5px] text-muted">The server answered {error}.</p>
        <button
          type="button"
          onClick={() => void cache.revalidate(resource.key)}
          className="tap mt-3 rounded-full bg-white px-3 py-1 text-[13px] font-medium shadow-[0_0_0_1px_#e2e2e2] hover:bg-[#f6f6f6]"
        >
          Try again
        </button>
      </div>
    );

  if (!history)
    return (
      <div aria-busy className="space-y-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-black/[0.04]" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
    );

  const origin = originOf(history.commits);
  if (!origin)
    return (
      <div className="rounded-[20px] bg-white px-4 py-6 text-center shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
        <HistoryIcon className="mx-auto size-6 text-muted" />
        <p className="mt-2 text-[14px] font-medium">No versions of {name} yet</p>
        <p className="mt-1 text-[12.5px] leading-[18px] text-muted">
          The first time {agentName} or you change it, its history starts here.
        </p>
      </div>
    );

  return (
    <div>
      <Origin origin={origin} file={name} />
      <ol className="mt-3">
        <AnimatePresence initial={false}>
          {history.commits.map((c, i) => {
            const expanded = open === c.change;
            const derivations = derivationsOf(c).map((d) => {
              const target = d.kind === "restores" && history.commits.find((x) => x.change === d.title);
              return target ? { ...d, label: `restores the ${relativeTime(target.at, now)} version` } : d;
            });
            const last = i === history.commits.length - 1;
            return (
              <motion.li
                key={c.change}
                layout="position"
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={SPRING}
                className="relative pl-8"
              >
                {!last && <span aria-hidden className="absolute bottom-0 left-[13px] top-[34px] w-px bg-[#e3e3e3]" />}
                <span className="absolute left-[2px] top-[13px]">
                  <Actor author={c.author} size={23} />
                </span>
                <button
                  type="button"
                  onClick={() => toggle(c)}
                  aria-expanded={expanded}
                  className={`tap-soft block w-full rounded-2xl px-3 py-2.5 text-left hover:bg-black/[0.035] ${expanded ? "bg-black/[0.035]" : ""}`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-[13.5px] font-semibold">{actorName(c.author)}</span>
                    <span className="text-[12px] text-muted" title={when(c.at)}>
                      {relativeTime(c.at, now)}
                    </span>
                    {i === 0 && <span className="text-[11.5px] text-muted">· current</span>}
                    <span className="flex-1" />
                    <Stats stats={c.stats} />
                    <ChevronDown className={`size-4 shrink-0 self-center text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
                  </span>
                  <span className="mt-0.5 block text-[13.5px] leading-[19px] text-ink-2" title={c.subject}>
                    {summaryOf(c.subject)}
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    <SourceChip source={c.source} />
                    {derivations.map((d, k) => (
                      <DerivationChip key={k} d={d} />
                    ))}
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      key="detail"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={SPRING}
                      className="overflow-hidden"
                    >
                      <div className="px-1 pb-3 pt-1.5">
                        <WordDiff agentId={agentId} file={file} change={c.change} />
                        <div className="mt-2 flex items-center gap-2 px-1">
                          {i === 0 ? (
                            <span className="text-[12px] text-muted">This is the current version.</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirm(c.change);
                                setRestoreError(null);
                              }}
                              className="tap inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[13px] font-medium shadow-[0_0_0_1px_#e2e2e2] hover:bg-[#f6f6f6]"
                            >
                              <RotateCcw className="size-3.5" />
                              Restore this version
                            </button>
                          )}
                          <span className="ml-auto truncate font-mono text-[10.5px] text-muted" title={`${c.change} · ${c.sha}`}>
                            {c.change.slice(0, 12)}
                          </span>
                        </div>
                        <AnimatePresence>
                          {confirm === c.change && (
                            <ConfirmRestore
                              file={name}
                              agentName={agentName}
                              at={c.at}
                              busy={busy}
                              error={restoreError}
                              onCancel={() => setConfirm(null)}
                              onConfirm={() => restore(c)}
                            />
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </div>
  );
}

const noop = () => () => {};

export interface HistoryButtonProps extends FileHistoryProps {
  /** "card": white glass for the SOUL/MEMORY gradient cards; "plain": a gray icon button for headers. */
  tone?: "card" | "plain";
  className?: string;
}

/**
 * The clock quick action for an agent file. Opens its History in a sheet (a drawer from the right on
 * wide screens, a bottom sheet on phones). Place it beside a card's button, never inside it.
 */
export function HistoryButton({ agentId, file, onNotify, onRestored, tone = "card", className = "" }: HistoryButtonProps) {
  const [open, setOpen] = useState(false);
  const isClient = useSyncExternalStore(noop, () => true, () => false);
  const titleId = useId();
  const name = AGENT_FILES[file];
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        aria-label={`History of ${name}`}
        title={`History of ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`tap grid size-8 place-items-center rounded-full ${
          tone === "card"
            ? "bg-white/20 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)] hover:bg-white/30"
            : "text-[#6b6b6b] hover:bg-black/[0.06] hover:text-ink"
        } ${className}`}
      >
        <HistoryIcon className="size-[17px]" strokeWidth={2.1} />
      </button>
      {isClient &&
        createPortal(
          <AnimatePresence>
            {open && (
              // Clicks inside the portal still bubble through React to the button's parents; stop them here.
              <div key="history" className="fixed inset-0 z-[45]" onClick={(e) => e.stopPropagation()}>
                <motion.div
                  className="absolute inset-0 bg-black/25"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={close}
                />
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={titleId}
                  initial={{ opacity: 0, y: 24, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 16, scale: 0.98, transition: { duration: 0.16 } }}
                  transition={SPRING}
                  className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-[26px] bg-pane shadow-[0_-12px_40px_rgba(0,0,0,0.18)] md:inset-x-auto md:bottom-3 md:right-3 md:top-3 md:max-h-none md:w-[460px] md:rounded-[26px] md:shadow-[0_18px_60px_rgba(0,0,0,0.2)]"
                >
                  <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-3">
                    <span className="grid size-9 place-items-center rounded-full bg-bubble text-ink-2">
                      <HistoryIcon className="size-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 id={titleId} className="text-[15px] font-semibold leading-[20px]">
                        History
                      </h2>
                      <p className="truncate text-[12.5px] text-muted">
                        {nameOf(agentId)} · <span className="font-mono text-[12px]">{name}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      autoFocus
                      aria-label="Close history"
                      onClick={close}
                      className="tap grid size-8 place-items-center rounded-full text-[#6b6b6b] hover:bg-black/[0.06] hover:text-ink"
                    >
                      <X className="size-[18px]" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:px-4">
                    <FileHistory agentId={agentId} file={file} onNotify={onNotify} onRestored={onRestored} />
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
