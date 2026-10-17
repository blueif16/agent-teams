import { Fragment, useState, type ReactNode } from "react";
import { AlarmClock, CalendarClock, ChartColumn, Check, Fingerprint, Hash, List, Loader, Pause, Pin, Play } from "lucide-react";
import { motion } from "motion/react";
import { AGENTS, CHIEF_ID } from "@/lib/data";
import type { AgentStatus } from "@/lib/types";
import { Mascot } from "./Mascot";
import { IdentityTab, Markdown } from "./Identity";
import { useOrg } from "./org";
import { formatDue } from "@/lib/project";
import { AgentPerformance, TeamPerformance } from "./Performance";
import { Progress, SPRING, StatusChip } from "./ui";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 px-1 text-[13px] font-medium text-muted">{title}</h3>
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">{children}</div>
    </section>
  );
}

/** Muse-style icon tabs: a quiet pill bar; the selected tab slides. */
function Segmented<T extends string>({
  id,
  items,
  value,
  onChange,
}: {
  id: string;
  items: { key: T; label: string; icon: ReactNode }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div role="tablist" className="mt-6 flex items-center rounded-full bg-black/[0.045] p-1">
      {items.map((item, i) => {
        const on = item.key === value;
        const besideOn = on || items[i - 1]?.key === value;
        return (
          <Fragment key={item.key}>
            {i > 0 && <span className={`h-4 w-px shrink-0 bg-black/10 transition-opacity ${besideOn ? "opacity-0" : ""}`} />}
            <button
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={item.label}
              title={item.label}
              onClick={() => onChange(item.key)}
              className={`tap relative flex h-9 flex-1 items-center justify-center rounded-full ${on ? "text-ink" : "text-muted hover:bg-black/[0.04] hover:text-ink"}`}
            >
              {on && (
                <motion.span
                  layoutId={`seg-${id}`}
                  transition={SPRING}
                  className="absolute inset-0 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                />
              )}
              <span className="relative">{item.icon}</span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

function TabBody({ tab, children }: { tab: string; children: ReactNode }) {
  return (
    <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}

const icon = "size-[18px]";

const pillBtn = "tap inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[14px] font-medium";

export function AgentPanel({
  agentId,
  status,
  doing,
  memories,
  checkIns,
  onMessage,
  onToggleRun,
  onOpenChannel,
  onNotify,
}: {
  agentId: string;
  status: AgentStatus;
  /** The agent's "now" line, shared with the chat. */
  doing: string;
  memories: string[];
  checkIns: string[];
  onMessage: (id: string) => void;
  onToggleRun: (id: string) => void;
  onOpenChannel: (teamId: string) => void;
  onNotify: (text: string) => void;
}) {
  const org = useOrg();
  const a = AGENTS[agentId];
  const team = org.teamsById[a.teamId];
  const chief = a.id === CHIEF_ID;
  const isLead = team.leadId === a.id && !chief;
  // Projects the chief staffed this agent on, besides its home team.
  const projects = org.teams.filter((t) => t.launched && t.agents.some((x) => x.id === a.id));
  const [tab, setTab] = useState<"overview" | "performance" | "identity">("overview");

  return (
    <div className="mx-auto max-w-[560px] px-5 pb-10 pt-8">
      <div className="flex flex-col items-center text-center">
        <span className="squish cursor-pointer" aria-hidden>
          <Mascot look={a.look} size={112} bob={status === "working"} status={status} />
        </span>
        <h2 className="mt-3 text-[22px] font-semibold tracking-[-0.01em]">{a.name}</h2>
        <p className="mt-0.5 text-[14px] text-ink-2">
          {chief ? (
            `${a.role} over all ${org.teams.length} teams`
          ) : (
            <>
              {a.role}
              {isLead ? ", team lead" : ""} in{" "}
              <button type="button" className="hover:underline" onClick={() => onOpenChannel(team.id)}>
                #{team.channel}
              </button>
              {projects.map((t) => (
                <span key={t.id}>
                  {" "}
                  and{" "}
                  <button type="button" className="hover:underline" onClick={() => onOpenChannel(t.id)}>
                    #{t.channel}
                  </button>
                </span>
              ))}
            </>
          )}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <StatusChip status={status} />
          <span className="rounded-full bg-black/[0.05] px-2 py-0.5 font-mono text-[11.5px] text-ink-2" title="Crusoe model">
            {a.model}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => onMessage(a.id)} className={`${pillBtn} bg-accent text-white hover:bg-[#3557d6]`}>
            Message
          </button>
          {status !== "done" && (
            <button
              type="button"
              onClick={() => onToggleRun(a.id)}
              className={`${pillBtn} bg-white shadow-[0_0_0_1px_#e2e2e2] hover:bg-[#f6f6f6]`}
            >
              {status === "idle" ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {status === "idle" ? "Resume" : "Pause"}
            </button>
          )}
        </div>
      </div>

      <Segmented
        id={`agent-${a.id}`}
        value={tab}
        onChange={setTab}
        items={[
          { key: "overview", label: "Overview", icon: <List className={icon} /> },
          { key: "performance", label: "Performance", icon: <ChartColumn className={icon} /> },
          { key: "identity", label: "Soul and memory", icon: <Fingerprint className={icon} /> },
        ]}
      />

      {tab === "performance" && (
        <TabBody tab={tab}>
          <AgentPerformance agentId={a.id} />
        </TabBody>
      )}
      {tab === "identity" && (
        <TabBody tab={tab}>
          <IdentityTab agentId={a.id} onNotify={onNotify} />
        </TabBody>
      )}
      {tab === "overview" && (
        <TabBody tab={tab}>
          <Group title="Now">
            <div className="px-4 py-3.5">
              <p className="text-[15px] leading-[22px]">{doing}</p>
              <Progress value={a.progress} className="mt-3" />
              <div className="mt-2 flex justify-between text-[12.5px] text-muted">
                <span>
                  {Math.round(a.progress * 100)}% of plan, running {a.elapsed}
                </span>
                {a.subAgents ? <span>{a.subAgents} sub-agents</span> : null}
              </div>
            </div>
          </Group>

          <Group title="Plan">
            <ol>
              {a.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-3 border-t border-line px-4 py-2.5 first:border-t-0">
                  {s.state === "done" ? (
                    <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full bg-accent text-white">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  ) : s.state === "active" ? (
                    <Loader className="mt-0.5 size-[18px] shrink-0 animate-[spin_2.4s_linear_infinite] text-accent motion-reduce:animate-none" />
                  ) : (
                    <span className="mt-0.5 size-[18px] shrink-0 rounded-full border-[1.5px] border-[#cfcfcf]" />
                  )}
                  <span className={`text-[14.5px] leading-[22px] ${s.state === "done" ? "text-muted line-through decoration-[#c8c8c8]" : ""}`}>
                    {s.label}
                  </span>
                </li>
              ))}
            </ol>
          </Group>

          {memories.length > 0 && (
            <Group title="Remembers">
              {memories.map((m, i) => (
                <motion.div
                  key={`${i}-${m}`}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-3 border-t border-line px-4 py-2.5 text-[14px] leading-[20px] first:border-t-0"
                >
                  <Pin className="mt-0.5 size-4 shrink-0 text-accent" />
                  {m}
                </motion.div>
              ))}
            </Group>
          )}

          {(a.schedule?.length || checkIns.length > 0) && (
            <Group title="Scheduled">
              {(a.schedule ?? []).map((s) => (
                <div key={s} className="flex items-center gap-3 border-t border-line px-4 py-2.5 text-[14px] first:border-t-0">
                  <CalendarClock className="size-4 shrink-0 text-muted" />
                  {s}
                </div>
              ))}
              {checkIns.map((s, i) => (
                <motion.div
                  key={`${i}-${s}`}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 border-t border-line px-4 py-2.5 text-[14px] first:border-t-0"
                >
                  <AlarmClock className="size-4 shrink-0 text-accent" />
                  {s}
                </motion.div>
              ))}
            </Group>
          )}
        </TabBody>
      )}
    </div>
  );
}

export function TeamPanel({
  teamId,
  status,
  doing,
  onOpenAgent,
  onOpenChannel,
}: {
  teamId: string;
  status: Record<string, AgentStatus>;
  doing: Record<string, string>;
  onOpenAgent: (id: string) => void;
  onOpenChannel: (teamId: string) => void;
}) {
  const t = useOrg().teamsById[teamId];
  // A launched team starts from zero; seed teams average their agents' plans.
  const progress = t.launched ? 0 : t.agents.reduce((s, a) => s + a.progress, 0) / t.agents.length;
  const [tab, setTab] = useState<"overview" | "performance">("overview");

  return (
    <div className="mx-auto max-w-[560px] px-5 pb-10 pt-8">
      <div className="flex flex-col items-center text-center">
        <span className="flex items-end -space-x-3">
          {t.agents.map((a, i) => (
            <button
              key={a.id}
              type="button"
              style={{ zIndex: 10 - i }}
              onClick={() => onOpenAgent(a.id)}
              className="squish relative block"
              aria-label={`${a.name}'s profile`}
              title={`${a.name}: ${doing[a.id]}`}
            >
              <Mascot look={a.look} size={i === 0 ? 72 : 58} bob={status[a.id] === "working"} status={status[a.id]} />
            </button>
          ))}
        </span>
        <h2 className="mt-3 flex items-center gap-1 text-[22px] font-semibold tracking-[-0.01em]">
          <Hash className="size-5 text-muted" strokeWidth={2.2} />
          {t.channel}
        </h2>
        <p className="mt-1 max-w-[440px] text-[14px] leading-[21px] text-ink-2">{t.goal}</p>
        {t.launched && <p className="mt-1 text-[12.5px] text-muted">Launched by Mira{t.launched.due ? ` · due ${formatDue(t.launched.due)}` : ""}</p>}
        <button
          type="button"
          onClick={() => onOpenChannel(t.id)}
          className={`${pillBtn} mt-4 bg-white shadow-[0_0_0_1px_#e2e2e2] hover:bg-[#f6f6f6]`}
        >
          Open channel
        </button>
      </div>

      <Segmented
        id={`team-${t.id}`}
        value={tab}
        onChange={setTab}
        items={[
          { key: "overview", label: "Overview", icon: <List className={icon} /> },
          { key: "performance", label: "Performance", icon: <ChartColumn className={icon} /> },
        ]}
      />

      {tab === "performance" && (
        <TabBody tab={tab}>
          <TeamPerformance teamId={t.id} onOpenAgent={onOpenAgent} />
        </TabBody>
      )}
      {tab === "overview" && (
        <TabBody tab={tab}>
          {t.launched?.spec && (
            <Group title="Spec">
              <div className="px-4 py-2 [&_h4:first-child]:mt-1">
                <Markdown text={t.launched.spec} />
              </div>
            </Group>
          )}

          <Group title="Team progress">
            <div className="px-4 py-3.5">
              <Progress value={progress} />
              <p className="mt-2 text-[12.5px] text-muted">{Math.round(progress * 100)}% across {t.agents.length} agents</p>
            </div>
          </Group>

          <Group title="Agents">
            {t.agents.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onOpenAgent(a.id)}
                className="tap-soft group flex w-full items-start gap-3 border-t border-line px-4 py-3 text-left first:border-t-0 hover:bg-[#f6f6f6]"
              >
                <span className="squish-group shrink-0">
                  <Mascot look={a.look} size={38} bob={status[a.id] === "working"} status={status[a.id]} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[14.5px] font-semibold">{a.name}</span>
                    <span className="truncate text-[12.5px] text-muted">
                      {a.role}
                      {t.leadId === a.id ? ", lead" : ""}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[13.5px] leading-[19px] text-ink-2">{doing[a.id]}</span>
                  {!t.launched && <Progress value={a.progress} className="mt-2" />}
                </span>
                <StatusChip status={status[a.id]} />
              </button>
            ))}
          </Group>
        </TabBody>
      )}
    </div>
  );
}
