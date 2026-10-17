"use client";

/*
 * The plan (dag.json) as a graph or a board, and the task drawer both open. Answers "what's moving, what's
 * blocked and on whom?". The graph lays out left to right with dagre (layout.ts); React Flow only paints it, with
 * pan, pinch-zoom and fit-to-view, no minimap. Below 480 px the graph can't be read, so the board shows instead.
 * Read-only in this version: nothing drags.
 */
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { Check, Columns3, FileText, HistoryIcon, Maximize2, Minus, Network, Plus, ScanSearch, X } from "lucide-react";
import { POP, SPRING } from "../ui";
import { CARD, layoutPlan } from "./layout";
import { ago, card, IdChip, nameOf, pressable, shortDate, useNow, useStateEnv, WhoMascot } from "./shared";
import { BOARD_COLUMNS, isClosed, statusMeta, TONE } from "./status";
import type { PlanVM, TaskVM } from "./types";

// ------------------------------------------------------------------------------------------------ pieces

export function StatusDot({ task, className = "" }: { task: Pick<TaskVM, "status">; className?: string }) {
  const m = statusMeta(task.status);
  if (m.check)
    return (
      <span className={`grid size-[15px] shrink-0 place-items-center rounded-full bg-muted/25 text-ink-2 ${className}`}>
        <Check className="size-[10px]" strokeWidth={3.2} />
      </span>
    );
  return <span className={`size-2.5 shrink-0 rounded-full ${TONE[m.tone].dot} ${task.status === "in_progress" ? "pulse-dot" : ""} ${className}`} />;
}

export function StatusChip({ status }: { status: TaskVM["status"] }) {
  const m = statusMeta(status);
  return (
    <motion.span
      key={status}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={POP}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium ${TONE[m.tone].chip}`}
    >
      {m.check ? <Check className="size-3" strokeWidth={3} /> : <span className={`size-1.5 rounded-full ${TONE[m.tone].dot}`} />}
      {m.label}
    </motion.span>
  );
}

/** What stands out on a card: a blocker (and on what), your approval, or the due date. */
function Flag({ task }: { task: TaskVM }) {
  if (task.blocker)
    return (
      <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-danger-wash px-1.5 py-px text-[11px] font-medium text-danger" title={task.blocker.text}>
        <span className="truncate">{task.blocker.on ? `on ${task.blocker.on}` : "blocked"}</span>
      </span>
    );
  if (task.needsYou) return <span className="shrink-0 rounded-full bg-caution-wash px-1.5 py-px text-[11px] font-medium text-caution">needs you</span>;
  if (task.due && !isClosed(task.status)) return <span className="shrink-0 text-[11px] text-muted">due {shortDate(task.due)}</span>;
  return null;
}

// ------------------------------------------------------------------------------------------------ graph

type TaskNodeData = { task: TaskVM; open: (id: string) => void; order: number };
type GroupNodeData = { title: string; id: string; done: number; total: number };

const TaskNode = memo(function TaskNode({ data }: NodeProps<Node<TaskNodeData, "task">>) {
  const { task, open, order } = data;
  const env = useStateEnv();
  const m = statusMeta(task.status);
  const closed = isClosed(task.status);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ ...POP, delay: Math.min(0.4, order * 0.025) }}
      style={{ width: CARD.width, height: CARD.height }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
      <div
        {...pressable(() => open(task.id))}
        aria-label={`${task.id} ${task.title}`}
        className={`lift flex h-full w-full cursor-pointer flex-col justify-between rounded-[16px] bg-white px-3 py-2 text-left ${TONE[m.tone].ring} hover:shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_8px_20px_rgba(0,0,0,0.08)] ${closed ? "opacity-70" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <StatusDot task={task} />
          <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold leading-[18px] ${task.status === "dropped" ? "line-through" : ""} ${closed ? "text-ink-2" : ""}`}>
            {task.title}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <IdChip id={task.id} />
          <WhoMascot who={task.owner} size={22} />
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{nameOf(task.owner, env)}</span>
          <Flag task={task} />
        </span>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
    </motion.div>
  );
});

const GroupNode = memo(function GroupNode({ data, width, height }: NodeProps<Node<GroupNodeData, "milestone">>) {
  return (
    <div className="rounded-[24px] bg-accent-wash/60 shadow-[inset_0_0_0_1px_rgba(65,102,235,0.08)]" style={{ width, height }}>
      <div className="flex items-center gap-1.5 px-3.5 pt-1.5 text-[11.5px] font-medium text-ink-2">
        <span className="font-mono text-[10.5px] text-muted">{data.id}</span>
        <span className="truncate">{data.title}</span>
        <span className="text-muted">
          · {data.done}/{data.total}
        </span>
      </div>
    </div>
  );
});

const NODE_TYPES = { task: TaskNode, milestone: GroupNode };

function ZoomPill() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const btn = "tap grid size-7 place-items-center rounded-full text-ink-2 hover:bg-black/[0.06] hover:text-ink";
  return (
    <div className="absolute bottom-3 right-3 z-10 flex items-center gap-0.5 rounded-full bg-white p-0.5 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_4px_14px_rgba(0,0,0,0.08)]">
      <button type="button" aria-label="Zoom out" title="Zoom out" className={btn} onClick={() => zoomOut({ duration: 200 })}>
        <Minus className="size-3.5" />
      </button>
      <button type="button" aria-label="Fit to view" title="Fit to view" className={btn} onClick={() => fitView({ duration: 300, padding: 0.08 })}>
        <ScanSearch className="size-3.5" />
      </button>
      <button type="button" aria-label="Zoom in" title="Zoom in" className={btn} onClick={() => zoomIn({ duration: 200 })}>
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

/** Below this zoom a card's text can't be read; a graph that won't fit above it opens on its active front instead. */
const READABLE = 0.78;
const ACTIVE = new Set<TaskVM["status"]>(["in_progress", "blocked", "review"]);

function PlanGraph({ plan, onOpen, height, width, tall = false }: { plan: PlanVM; onOpen: (id: string) => void; height: number; width: number; tall?: boolean }) {
  const { nodes, edges, fit } = useMemo(() => {
    const l = layoutPlan(plan);
    // Fit everything when it stays readable; otherwise open on what's moving (in progress, blocked, in review) and
    // the tasks right before and after it, centred at a readable zoom; pan or "fit" for the rest.
    const fitsAll = Math.min(width / l.width, height / l.height) >= READABLE;
    const active = plan.tasks.filter((t) => ACTIVE.has(t.status));
    const near = new Set(active.flatMap((t) => [t.id, ...t.deps, ...plan.tasks.filter((x) => x.deps.includes(t.id)).map((x) => x.id)]));
    const front = plan.tasks.filter((t) => near.has(t.id)).map((t) => ({ id: t.id }));
    const fit = fitsAll || !front.length ? { padding: 0.08, maxZoom: 1 } : { nodes: front, padding: 0.06, minZoom: READABLE, maxZoom: 0.9 };
    const byId = new Map(plan.tasks.map((t) => [t.id, t]));
    const order = [...l.nodes].sort((a, b) => a.x - b.x || a.y - b.y).map((n) => n.id);
    const groups: Node<GroupNodeData, "milestone">[] = l.groups.map((g) => {
      const m = plan.milestones.find((x) => x.id === g.id)!;
      return {
        id: `group-${g.id}`,
        type: "milestone",
        position: { x: g.x, y: g.y },
        width: g.width,
        height: g.height,
        data: { id: g.id, title: g.title, done: m.done, total: m.total },
        draggable: false,
        selectable: false,
        focusable: false,
        // A background: panning works across it, and only task cards take clicks.
        style: { pointerEvents: "none" },
        zIndex: 0,
      };
    });
    const tasks: Node<TaskNodeData, "task">[] = l.nodes.map((n) => ({
      id: n.id,
      type: "task",
      position: { x: n.x, y: n.y },
      width: n.width,
      height: n.height,
      data: { task: byId.get(n.id)!, open: onOpen, order: order.indexOf(n.id) },
      draggable: false,
      zIndex: 1,
    }));
    const flow: Edge[] = l.edges.map((e) => {
      const from = byId.get(e.source)!;
      const to = byId.get(e.target)!;
      const live = !isClosed(from.status) || to.status === "blocked";
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        zIndex: 1,
        style: { stroke: to.status === "blocked" ? "var(--color-danger)" : live ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.12)", strokeWidth: 1.5, strokeDasharray: to.status === "blocked" ? "4 4" : undefined },
      };
    });
    return { nodes: [...groups, ...tasks] as Node[], edges: flow, fit };
  }, [plan, onOpen, width, height]);

  return (
    <div className="relative overflow-hidden rounded-[20px] bg-pane shadow-[0_0_0_1px_rgba(0,0,0,0.05)]" style={{ height: tall ? "max(480px, calc(100dvh - 230px))" : height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={fit}
        minZoom={0.2}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll={false}
        preventScrolling={false}
        zoomOnDoubleClick={false}
        // Nodes only take the pointer when the flow handles a click; the card's own handler covers the keyboard.
        onNodeClick={(_, node) => node.type === "task" && onOpen(node.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(0,0,0,0.07)" />
        <ZoomPill />
      </ReactFlow>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ board

function BoardCard({ task, onOpen }: { task: TaskVM; onOpen: (id: string) => void }) {
  const env = useStateEnv();
  const closed = isClosed(task.status);
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={SPRING}
      {...pressable(() => onOpen(task.id))}
      aria-label={`${task.id} ${task.title}`}
      className={`block w-full cursor-pointer text-left ${closed ? "opacity-75" : ""}`}
    >
      <span className={`lift block rounded-[16px] bg-white px-3 py-2.5 ${TONE[statusMeta(task.status).tone].ring} hover:shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_8px_20px_rgba(0,0,0,0.08)]`}>
        <span className={`line-clamp-2 text-[13.5px] font-semibold leading-[19px] ${task.status === "dropped" ? "line-through" : ""}`}>{task.title}</span>
        <span className="mt-2 flex min-w-0 items-center gap-1.5">
          <IdChip id={task.id} />
          <WhoMascot who={task.owner} size={22} />
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{nameOf(task.owner, env)}</span>
          <Flag task={task} />
        </span>
      </span>
    </motion.div>
  );
}

const STACKED = ["blocked", "review", "doing", "next", "done", "closed"] as const;

function Board({ plan, onOpen, columns }: { plan: PlanVM; onOpen: (id: string) => void; columns: boolean }) {
  // Side by side the board reads left to right; stacked (a phone), what needs attention comes first.
  const order = columns ? BOARD_COLUMNS : STACKED.map((k) => BOARD_COLUMNS.find((c) => c.key === k)!);
  const cols = order.map((c) => ({ ...c, tasks: plan.tasks.filter((t) => statusMeta(t.status).column === c.key) })).filter((c) => c.key !== "closed" || c.tasks.length);
  return (
    <div className={columns ? "flex gap-3 overflow-x-auto pb-2" : "space-y-4"}>
      {cols.map((c) => {
        const tone = c.key === "blocked" ? "text-danger" : c.key === "review" ? "text-caution" : c.key === "doing" ? "text-accent" : "text-muted";
        return (
          <section key={c.key} className={columns ? "w-[228px] shrink-0" : ""}>
            <h4 className="mb-2 flex items-center gap-1.5 px-1 text-[12.5px] font-medium text-ink-2">
              <span className={tone}>{c.label}</span>
              <span className="tabular-nums text-muted">{c.tasks.length}</span>
            </h4>
            <div className={`space-y-2 rounded-[20px] ${columns ? "min-h-[120px] bg-black/[0.025] p-2" : ""}`}>
              {c.tasks.length ? c.tasks.map((t) => <BoardCard key={t.id} task={t} onOpen={onOpen} />) : <p className="px-2 py-2 text-[12.5px] text-muted">Nothing here.</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ drawer

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</h4>
      {children}
    </section>
  );
}

function DepRow({ task, onOpen }: { task: TaskVM; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(task.id)} className="tap-soft flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-black/[0.04]">
      <StatusDot task={task} />
      <IdChip id={task.id} />
      <span className="min-w-0 flex-1 truncate text-[13.5px]">{task.title}</span>
      <span className="shrink-0 text-[12px] text-muted">{statusMeta(task.status).label}</span>
    </button>
  );
}

const noop = () => () => {};

export function TaskDrawer({ plan, id, onOpen, onClose }: { plan: PlanVM; id: string | null; onOpen: (id: string) => void; onClose: () => void }) {
  const env = useStateEnv();
  const now = useNow();
  const client = useSyncExternalStore(noop, () => true, () => false);
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, onClose]);
  const task = id ? plan.tasks.find((t) => t.id === id) : undefined;
  const deps = task ? task.deps.flatMap((d) => plan.tasks.filter((t) => t.id === d)) : [];
  const unblocks = task ? plan.tasks.filter((t) => t.deps.includes(task.id)) : [];
  const milestone = task?.milestone ? plan.milestones.find((m) => m.id === task.milestone) : undefined;
  if (!client) return null;
  return createPortal(
    <AnimatePresence>
      {task && (
        <div key="task" className="fixed inset-0 z-[44]" onClick={(e) => e.stopPropagation()}>
          <motion.div className="absolute inset-0 bg-black/20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${task.id} ${task.title}`}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98, transition: { duration: 0.16 } }}
            transition={SPRING}
            className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-[26px] bg-pane shadow-[0_-12px_40px_rgba(0,0,0,0.18)] md:inset-x-auto md:bottom-3 md:right-3 md:top-3 md:max-h-none md:w-[440px] md:rounded-[26px] md:shadow-[0_18px_60px_rgba(0,0,0,0.2)]"
          >
            <div className="border-b border-line bg-white px-4 pb-3.5 pt-3">
              <div className="flex items-center gap-2">
                <IdChip id={task.id} />
                <StatusChip status={task.status} />
                {milestone && <span className="truncate text-[12px] text-muted">{milestone.title}</span>}
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => env.onOpenHistory({ path: `projects/${env.pid}/state/dag.json`, task: task.id, title: `${task.id} history` })}
                  aria-label={`History of ${task.id}`}
                  title={`History of ${task.id}`}
                  className="tap grid size-8 place-items-center rounded-full text-[#6b6b6b] hover:bg-black/[0.06] hover:text-ink"
                >
                  <HistoryIcon className="size-[17px]" strokeWidth={2.1} />
                </button>
                <button type="button" autoFocus aria-label="Close" onClick={onClose} className="tap grid size-8 place-items-center rounded-full text-[#6b6b6b] hover:bg-black/[0.06] hover:text-ink">
                  <X className="size-[18px]" />
                </button>
              </div>
              <h2 className="mt-2 text-[17px] font-semibold leading-[23px] tracking-[-0.01em]">{task.title}</h2>
              <div className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                <WhoMascot who={task.owner} size={24} />
                <span>{nameOf(task.owner, env)}</span>
                {task.due && <span className="text-muted">· due {shortDate(task.due)}</span>}
                {task.reopened > 0 && <span className="text-muted">· reopened {task.reopened}×</span>}
              </div>
            </div>
            <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">
              {task.blocker && (
                <div className="mt-4 rounded-2xl bg-danger-wash px-3.5 py-3">
                  <p className="text-[13.5px] font-semibold text-danger">Blocked{task.blocker.on ? ` on ${task.blocker.on}` : ""}</p>
                  <p className="mt-0.5 text-[13.5px] leading-[19px] text-ink">{task.blocker.text}</p>
                  <p className="mt-1 text-[12px] text-muted">since {ago(task.blocker.since, now)}</p>
                </div>
              )}
              {task.needsYou && (
                <div className="mt-4 rounded-2xl bg-caution-wash px-3.5 py-3 text-[13.5px] leading-[19px]">
                  <span className="font-semibold text-caution">Waiting on your approval.</span> Approve or send it back in the channel.
                </div>
              )}
              <Field label="Done when">
                <p className={`${card} px-3.5 py-3 text-[14px] leading-[21px]`}>{task.acceptance}</p>
              </Field>
              {task.detail && (
                <Field label="Detail">
                  <p className="px-1 text-[13.5px] leading-[20px] text-ink-2">{task.detail}</p>
                </Field>
              )}
              <Field label="Last report">
                {task.lastReport ? (
                  <div className={`${card} flex gap-2.5 px-3.5 py-3`}>
                    <WhoMascot who={task.lastReport.by} size={24} />
                    <div className="min-w-0">
                      <p className="text-[12.5px] text-muted">
                        {nameOf(task.lastReport.by, env)} · {ago(task.lastReport.at, now)}
                      </p>
                      <p className="mt-0.5 text-[13.5px] leading-[19px]">{task.lastReport.summary}</p>
                    </div>
                  </div>
                ) : (
                  <p className="px-1 text-[13px] text-muted">No report yet.</p>
                )}
              </Field>
              {task.notes.length > 0 && (
                <Field label="PM notes">
                  <ul className={`${card} divide-y divide-line`}>
                    {task.notes.map((n, i) => (
                      <li key={i} className="flex gap-2.5 px-3.5 py-2.5">
                        <WhoMascot who={{ kind: "pm" }} size={20} />
                        <span className="min-w-0 text-[13.5px] leading-[19px]">
                          {n.text}
                          <span className="ml-1.5 text-[12px] text-muted">{ago(n.at, now)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Field>
              )}
              <Field label="Evidence">
                {task.evidence.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {task.evidence.map((e) => (
                      <span key={e.ref} title={e.ref} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[12.5px] text-ink-2 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
                        <FileText className="size-3.5 text-muted" />
                        {e.label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="px-1 text-[13px] text-muted">None yet. Done needs at least one.</p>
                )}
              </Field>
              {deps.length > 0 && (
                <Field label="Waits on">
                  <div className={`${card} p-1`}>{deps.map((d) => <DepRow key={d.id} task={d} onOpen={onOpen} />)}</div>
                </Field>
              )}
              {unblocks.length > 0 && (
                <Field label="Unblocks">
                  <div className={`${card} p-1`}>{unblocks.map((d) => <DepRow key={d.id} task={d} onOpen={onOpen} />)}</div>
                </Field>
              )}
              <p className="mt-4 px-1 text-[12px] text-muted">Updated {ago(task.updated, now)}</p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ------------------------------------------------------------------------------------------------ view

/** The container's width, so the graph only shows when it can be read. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

export function ViewToggle<T extends string>({ id, value, onChange, items }: { id: string; value: T; onChange: (v: T) => void; items: { key: T; label: string; icon: ReactNode }[] }) {
  return (
    <div role="tablist" className="flex items-center rounded-full bg-black/[0.045] p-0.5">
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={it.label}
            title={it.label}
            onClick={() => onChange(it.key)}
            className={`tap relative grid h-7 w-8 place-items-center rounded-full ${on ? "text-ink" : "text-muted hover:text-ink"}`}
          >
            {on && <motion.span layoutId={`toggle-${id}`} transition={SPRING} className="absolute inset-0 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]" />}
            <span className="relative">{it.icon}</span>
          </button>
        );
      })}
    </div>
  );
}

export function OpenFullButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[12.5px] font-medium text-ink-2 shadow-[0_0_0_1px_#e2e2e2] hover:bg-[#f6f6f6] hover:text-ink"
      aria-label={label}
    >
      <Maximize2 className="size-3.5" />
      Open full
    </button>
  );
}

export function PlanView({ plan, full = false }: { plan: PlanVM; full?: boolean }) {
  const env = useStateEnv();
  const { ref, width } = useWidth();
  const [mode, setMode] = useState<"graph" | "board">("graph");
  const [open, setOpen] = useState<string | null>(null);
  // Narrower than this (a phone) the graph can't be read even on its front: show the board.
  const graphFits = width === 0 || width >= 420;
  const shown = graphFits ? mode : "board";
  const { done, total, blocked } = plan.progress;
  const close = useMemo(() => () => setOpen(null), []);

  return (
    <div ref={ref} className={full ? "mx-auto max-w-[1180px] px-5 pb-10 pt-6" : ""}>
      <div className={`flex flex-wrap items-center gap-2 ${full ? "" : "mt-6"}`}>
        <div className="min-w-0 flex-1">
          {full && <h2 className="text-[20px] font-semibold tracking-[-0.01em]">Plan</h2>}
          <p className="text-[13px] text-muted">
            {plan.tasks.length ? (
              <>
                {done}/{total} done{blocked > 0 && <span className="font-medium text-danger"> · {blocked} blocked</span>}
                {plan.milestones.length > 0 && ` · ${plan.milestones.length} milestones`}
              </>
            ) : (
              "No tasks yet"
            )}
          </p>
        </div>
        {graphFits && plan.tasks.length > 0 && (
          <ViewToggle
            id={`plan-${env.pid}-${full ? "full" : "panel"}`}
            value={mode}
            onChange={setMode}
            items={[
              { key: "graph", label: "Graph", icon: <Network className="size-[15px]" /> },
              { key: "board", label: "Board", icon: <Columns3 className="size-[15px]" /> },
            ]}
          />
        )}
        {!full && env.onOpenFull && plan.tasks.length > 0 && <OpenFullButton onClick={() => env.onOpenFull?.("plan")} label="Open the plan full size" />}
      </div>

      {plan.tasks.length === 0 ? (
        <p className={`${card} mt-3 px-4 py-4 text-center text-[13.5px] text-muted`}>No tasks yet. The PM writes the plan at kickoff.</p>
      ) : (
        <motion.div key={shown} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="mt-3">
          {shown === "graph" ? (
            <ReactFlowProvider>
              <PlanGraph plan={plan} onOpen={setOpen} height={full ? 640 : 420} width={full ? width - 40 : width} tall={full} />
            </ReactFlowProvider>
          ) : (
            <Board plan={plan} onOpen={setOpen} columns={width >= 720} />
          )}
        </motion.div>
      )}
      <TaskDrawer plan={plan} id={open} onOpen={setOpen} onClose={close} />
    </div>
  );
}
