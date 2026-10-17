import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Hash, Search } from "lucide-react";
import { AGENTS, CHIEF, CHIEF_ID } from "@/lib/data";
import type { AgentStatus, Message } from "@/lib/types";
import { Mascot } from "./Mascot";
import { useOrg } from "./org";
import { POP, SPRING, StatusDot, STATUS_LABEL, YouAvatar } from "./ui";
import type { SideMode } from "./Rail";
import type { View } from "./AgentTeams";

type Pending = { key: string; msg: Extract<Message, { kind: "approval" }> };

const TITLES: Record<SideMode, string> = {
  home: "Agent Teams",
  activity: "Activity",
  agents: "All agents",
};

function Row({
  active = false,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`tap-soft group relative flex w-full items-center rounded-lg px-2 py-[5px] text-left text-[14px] ${
        active ? "text-ink" : "text-[#3f3f3f] hover:bg-black/[0.05]"
      }`}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          transition={SPRING}
          className="absolute inset-0 rounded-lg bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
        />
      )}
      <span className="relative flex min-w-0 flex-1 items-center gap-2">{children}</span>
    </button>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-1">
      <div className="mb-1 flex items-center gap-1 px-2 text-[12.5px] font-medium text-muted">
        <span>{title}</span>
        {count !== undefined && <span className="tabular-nums">{count}</span>}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  );
}

export function Sidebar({
  className = "",
  mode,
  view,
  unread,
  status,
  doing,
  dmIds,
  convos,
  pending,
  live,
  chiefUnread,
  onMode,
  onNavigate,
}: {
  className?: string;
  mode: SideMode;
  view: View;
  unread: Record<string, number>;
  status: Record<string, AgentStatus>;
  doing: Record<string, string>;
  dmIds: string[];
  convos: Record<string, Message[]>;
  pending: Pending[];
  live: boolean | null;
  chiefUnread: boolean;
  onMode: (m: SideMode) => void;
  onNavigate: (v: View) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const org = useOrg();
  const teamOf = (key: string) =>
    key.startsWith("team:") ? org.teamsById[key.slice(5)] : org.teamsById[AGENTS[key.slice(3)].teamId];

  const teams = org.teams.filter((t) => !q || t.channel.includes(q) || t.name.toLowerCase().includes(q));
  const dms = dmIds.map((id) => AGENTS[id]).filter((a) => !q || a.name.toLowerCase().includes(q));
  const matchingAgents = q
    ? Object.values(AGENTS).filter((a) => a.id !== CHIEF_ID && a.name.toLowerCase().includes(q) && !dmIds.includes(a.id))
    : [];
  const showChief = !q || CHIEF.name.toLowerCase().includes(q) || "ceo".includes(q);

  const handoffs = useMemo(
    () =>
      Object.entries(convos).flatMap(([key, msgs]) =>
        msgs.filter((m): m is Extract<Message, { kind: "handoff" }> => m.kind === "handoff").map((m) => ({ key, msg: m })),
      ),
    [convos],
  );

  const goKey = (key: string) =>
    onNavigate(key.startsWith("team:") ? { kind: "channel", teamId: key.slice(5) } : { kind: "dm", agentId: key.slice(3) });

  const isView = (v: View) =>
    v.kind === view.kind && (v.kind === "channel" ? v.teamId === (view as { teamId: string }).teamId : v.agentId === (view as { agentId: string }).agentId);

  return (
    <aside className={`flex w-[252px] shrink-0 flex-col bg-frame ${className}`}>
      <div className="flex h-11 shrink-0 items-center px-3">
        <span className="text-[15px] font-semibold tracking-[-0.01em]">{TITLES[mode]}</span>
      </div>

      <motion.div
        key={mode}
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
        className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-2 pb-3"
      >
        {mode === "home" && (
          <>
            <label className="mb-2 flex h-8 items-center gap-2 rounded-lg bg-black/[0.05] px-2.5 text-[13.5px] text-muted focus-within:bg-white focus-within:shadow-[0_0_0_1px_#d6d6d6]">
              <Search className="size-3.5" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Jump to a team or agent"
                className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
              />
            </label>

            <Section title="Teams" count={org.teams.length}>
              {teams.map((t) => {
                const v: View = { kind: "channel", teamId: t.id };
                const working = t.agents.filter((a) => status[a.id] === "working" || status[a.id] === "needs-you");
                const n = unread[t.id] ?? 0;
                return (
                  <Row key={t.id} active={isView(v)} onClick={() => onNavigate(v)}>
                    <Hash className="size-[15px] shrink-0 text-muted" strokeWidth={2} />
                    <span className={`min-w-0 flex-1 truncate ${n ? "font-semibold text-ink" : ""}`}>{t.channel}</span>
                    {n > 0 ? (
                      <motion.span
                        key={n}
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={POP}
                        className="rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-white"
                      >
                        {n}
                      </motion.span>
                    ) : (
                      <span className="squish-group flex -space-x-1.5" title={`${working.length} active`}>
                        {working.slice(0, 3).map((a) => (
                          <Mascot key={a.id} look={a.look} size={17} />
                        ))}
                      </span>
                    )}
                  </Row>
                );
              })}
            </Section>

            <Section title="Direct messages">
              {showChief && (
                <Row active={isView({ kind: "dm", agentId: CHIEF_ID })} onClick={() => onNavigate({ kind: "dm", agentId: CHIEF_ID })}>
                  <span className="squish-group relative shrink-0">
                    <Mascot look={CHIEF.look} size={20} />
                    <StatusDot status={status[CHIEF_ID]} className="absolute -bottom-0.5 -right-0.5 size-[7px] ring-2 ring-frame" />
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${chiefUnread ? "font-semibold text-ink" : ""}`}>{CHIEF.name}</span>
                  {chiefUnread ? (
                    <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={POP} className="size-2 rounded-full bg-accent" />
                  ) : (
                    <span className="text-[12px] text-muted">CEO</span>
                  )}
                </Row>
              )}
              {[...dms, ...matchingAgents].map((a) => {
                const v: View = { kind: "dm", agentId: a.id };
                return (
                  <Row key={a.id} active={isView(v)} onClick={() => onNavigate(v)}>
                    <span className="squish-group relative shrink-0">
                      <Mascot look={a.look} size={20} />
                      <StatusDot status={status[a.id]} className="absolute -bottom-0.5 -right-0.5 size-[7px] ring-2 ring-frame" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="truncate text-[12px] text-muted">{a.role}</span>
                  </Row>
                );
              })}
            </Section>
          </>
        )}

        {mode === "activity" && (
          <>
            <Section title="Needs you" count={pending.length}>
              {pending.length === 0 && <p className="px-2 py-1 text-[13px] text-muted">Nothing is waiting on you.</p>}
              {pending.map(({ key, msg }) => {
                const a = AGENTS[msg.from];
                // An approval is a hand-off to you: the agent's mascot passes to your avatar.
                return (
                  <Row key={msg.id} onClick={() => goKey(key)}>
                    <span className="squish-group flex shrink-0 items-center -space-x-1.5 self-start pt-0.5">
                      <Mascot look={a.look} size={20} />
                      <YouAvatar size={17} className="rounded-full ring-2 ring-frame" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] text-ink">{msg.title}</span>
                      <span className="block truncate text-[12px] text-muted">
                        {a.name} in #{teamOf(key).channel}
                      </span>
                    </span>
                  </Row>
                );
              })}
            </Section>
            <Section title="Handoffs">
              {handoffs.map(({ key, msg }) => (
                <Row key={msg.id} onClick={() => goKey(key)}>
                  <span className="flex shrink-0 -space-x-1.5 self-start pt-0.5">
                    <Mascot look={AGENTS[msg.from].look} size={18} />
                    <Mascot look={AGENTS[msg.to].look} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-ink">{msg.task}</span>
                    <span className="block truncate text-[12px] text-muted">
                      {AGENTS[msg.from].name} to {AGENTS[msg.to].name}, {msg.at}
                    </span>
                  </span>
                </Row>
              ))}
            </Section>
          </>
        )}

        {mode === "agents" && (
          <Section title="Company">
            <Row onClick={() => onMode("activity")}>
              <YouAvatar size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-ink">You</span>
                <span className="block truncate text-[12px] text-muted">
                  Owner · {pending.length ? `${pending.length} waiting on you` : "nothing waiting on you"}
                </span>
              </span>
            </Row>
            <div className="relative pl-[19px]">
              <span aria-hidden className="absolute left-[19px] top-[-3px] h-[22px] w-[10px] rounded-bl-[8px] border-b-[1.5px] border-l-[1.5px] border-[#c9c9c9]" />
              <Row active={isView({ kind: "dm", agentId: CHIEF_ID })} onClick={() => onNavigate({ kind: "dm", agentId: CHIEF_ID })}>
                <span className="ml-2.5 squish-group shrink-0">
                  <Mascot look={CHIEF.look} size={24} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{CHIEF.name}</span>
                  <span className="block truncate text-[12px] text-muted">
                    CEO · {org.teams.length} teams · {doing[CHIEF_ID]}
                  </span>
                </span>
              </Row>
            </div>
          </Section>
        )}

        {mode === "agents" &&
          (["needs-you", "working", "idle", "done"] as AgentStatus[]).map((s) => {
            const list = Object.values(AGENTS).filter((a) => a.id !== CHIEF_ID && status[a.id] === s);
            if (!list.length) return null;
            return (
              <Section key={s} title={STATUS_LABEL[s]} count={list.length}>
                {list.map((a) => (
                  <Row key={a.id} active={isView({ kind: "dm", agentId: a.id })} onClick={() => onNavigate({ kind: "dm", agentId: a.id })}>
                    <span className="squish-group shrink-0">
                      <Mascot look={a.look} size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] text-ink">{a.name}</span>
                      <span className="block truncate text-[12px] text-muted">{doing[a.id]}</span>
                    </span>
                  </Row>
                ))}
              </Section>
            );
          })}
      </motion.div>

      <div className="flex items-center gap-2 px-4 pb-4 pt-2 text-[12px] text-muted">
        <span className={`size-1.5 rounded-full ${live ? "bg-mint" : live === false ? "bg-amber" : "bg-[#c4c4c4]"}`} />
        {live ? "Live replies via Crusoe" : live === false ? "Live replies off: add CRUSOE_API_KEY" : "Checking Crusoe…"}
      </div>
    </aside>
  );
}
