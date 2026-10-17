import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownRight, Hand } from "lucide-react";
import { CHIEF_ID } from "@/lib/data";
import type { OrderKey } from "@/lib/orders";
import { CHIEF_SHORTCUTS } from "@/lib/project";
import type { Agent, AgentStatus, Message } from "@/lib/types";
import { Mascot } from "./Mascot";
import { POP, RichText, StatusDot } from "./ui";
import { Composer } from "./Composer";
import { ActionMenu, HoverBar, ReactionChips, type MenuTarget, type Reaction } from "./MessageActions";
import { Markdown } from "./Markdown";
import { ChartBlock } from "./Charts";
import { splitCharts, trimPartialFence, withChartSummaries } from "@/lib/charts";
import { LaunchCard } from "./Chief";
import { useOrg } from "./org";
import type { View } from "./AgentTeams";

type Text = Extract<Message, { kind: "text" }>;

const authorOf = (m: Message) =>
  m.kind === "text" || m.kind === "approval" || m.kind === "proposal" ? m.from : null;

const textOf = (m: Message) => (m.kind === "text" ? withChartSummaries(m.text) : "");

const SUGGESTIONS = ["What are you working on?", "What's blocking you?", "Give me a progress update"].map((s) => ({ label: s, ask: s }));

const ENTER = { type: "spring", stiffness: 430, damping: 32 } as const;

export interface MessageHandlers {
  onOrder: (msgId: string, agentId: string, text: string, key: OrderKey) => void;
  onHandOff: (fromAgentId: string, text: string, toAgentId: string) => void;
  onAsk: (agentId: string, text: string) => void;
  onCopy: (text: string) => void;
}

export function Conversation({
  view,
  messages,
  typingAgentId,
  status,
  doing,
  prefill,
  reactions,
  handlers,
  onSend,
  onDecide,
  onOpenAgent,
  onOpenTeam,
  onMessageAgent,
  onOpenChannel,
  onLaunchProject,
  onEditProposal,
  onRequestChanges,
}: {
  view: View;
  messages: Message[];
  typingAgentId: string | null;
  status: Record<string, AgentStatus>;
  /** Each agent's "now" line, shared with the side panel. */
  doing: Record<string, string>;
  prefill: { text: string; nonce: number } | null;
  reactions: Record<string, Reaction[]>;
  handlers: MessageHandlers;
  onSend: (text: string) => void;
  onDecide: (id: string, d: "approved" | "declined") => void;
  onOpenAgent: (id: string) => void;
  onOpenTeam: (id: string) => void;
  onMessageAgent: (id: string) => void;
  onOpenChannel: (teamId: string) => void;
  onLaunchProject: (msgId: string) => void;
  onEditProposal: (msgId: string, update: (m: Extract<Message, { kind: "proposal" }>) => Extract<Message, { kind: "proposal" }>) => void;
  /** "Request changes" on the option cards: sent to Mira as a normal message. */
  onRequestChanges: (text: string) => void;
}) {
  const { teamsById, agents } = useOrg();
  const scroller = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  // Messages present on mount render still; anything newer animates in.
  const [initialIds] = useState(() => new Set(messages.map((m) => m.id)));
  // Reactions present on mount don't replay their acknowledgement.
  const [initialReactions] = useState(
    () => new Set(Object.entries(reactions).flatMap(([id, rs]) => rs.map((r) => `${id}:${r.order}`))),
  );
  const [decided, setDecided] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<MenuTarget | null>(null);

  const channel = view.kind === "channel";
  const dmAgent = view.kind === "dm" ? agents[view.agentId] : null;
  const team = (channel ? teamsById[view.teamId] : teamsById[dmAgent?.teamId ?? ""]) ?? teamsById.company;
  const last = messages[messages.length - 1];
  const lastLen = last?.kind === "text" ? last.text.length : 0;
  // Mira's option cards arrive taller than the shimmer line they replace: bring them, and Launch, into view.
  const cardsArrived = last?.kind === "proposal" && last.state === "ready";

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
    if (!mounted.current || nearBottom || cardsArrived) {
      el.scrollTo({ top: el.scrollHeight, behavior: mounted.current ? "smooth" : "auto" });
    }
    mounted.current = true;
  }, [messages.length, lastLen, typingAgentId, cardsArrived]);

  const active = team.agents.filter((a) => status[a.id] === "working").length;
  const needs = team.agents.filter((a) => status[a.id] === "needs-you").length;

  const openMenu = (m: Message, anchor: MenuTarget["anchor"]) => {
    const from = authorOf(m);
    if (!from || from === "you") return;
    setMenu({ msgId: m.id, agentId: from, text: textOf(m), anchor });
  };
  const fromRect = (r: DOMRect) => ({ x: r.left, top: r.top, bottom: r.bottom });
  const closeMenu = () => setMenu(null);

  // Each mascot opens that agent; only the channel pill opens the whole team.
  const header = channel ? (
    <div className="pointer-events-auto flex flex-col items-center">
      <span className="flex items-end -space-x-3">
        {team.agents.map((a, i) => (
          <motion.span
            key={a.id}
            style={{ zIndex: 10 - i }}
            className="relative"
            initial={{ scale: 0.55, y: 10, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ ...POP, delay: 0.04 * i }}
          >
            <button
              type="button"
              onClick={() => onOpenAgent(a.id)}
              className="squish block"
              aria-label={`${a.name}'s profile`}
              title={doing[a.id] ? `${a.name}: ${doing[a.id]}` : a.name}
            >
              <Mascot look={a.look} size={i === 0 ? 60 : 50} bob={status[a.id] === "working"} status={status[a.id]} />
            </button>
          </motion.span>
        ))}
      </span>
      <button
        type="button"
        onClick={() => onOpenTeam(team.id)}
        className="group relative z-20 -mt-1.5 flex flex-col items-center"
        aria-label={`Open ${team.name} overview`}
      >
        <span className="tap block rounded-full bg-white px-3 py-[3px] text-[15px] shadow-[0_0_0_1px_rgba(0,0,0,0.07)] transition-shadow group-hover:shadow-[0_2px_10px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.08)]">
          # {team.channel}
        </span>
        <span className="mt-1 text-[12.5px] text-muted">
          {team.agents.length} agents, {active} working{needs ? `, ${needs} need you` : ""}
        </span>
      </button>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => onOpenAgent(dmAgent!.id)}
      className="group pointer-events-auto flex flex-col items-center"
      aria-label={`Open ${dmAgent!.name}'s profile`}
    >
      <motion.span initial={{ scale: 0.6, y: 10, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} transition={POP}>
        <span className="squish block">
          <Mascot look={dmAgent!.look} size={78} bob={status[dmAgent!.id] === "working"} status={status[dmAgent!.id]} />
        </span>
      </motion.span>
      <span className="-mt-2 flex items-center gap-1.5 rounded-full bg-white px-3 py-[3px] text-[16px] shadow-[0_0_0_1px_rgba(0,0,0,0.07)] transition-shadow group-hover:shadow-[0_2px_10px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.08)]">
        {dmAgent!.name}
        <StatusDot status={status[dmAgent!.id]} className="size-[7px]" />
      </span>
    </button>
  );

  const rows: React.ReactNode[] = [];
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    const author = authorOf(m);
    const first = !prev || authorOf(prev) !== author || author === null;
    const fresh = !initialIds.has(m.id);
    let node: React.ReactNode;

    if (m.kind === "status") {
      node = <p className="my-4 text-center text-[12.5px] text-muted">{m.text}</p>;
    } else if (m.kind === "handoff") {
      const from = agents[m.from];
      const to = agents[m.to];
      node = !from || !to ? null : (
        <div className="my-4 flex flex-col items-center gap-1 text-center">
          <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
            {m.byYou ? (
              <>You handed {from.name}&apos;s message to</>
            ) : (
              <>
                <Mascot look={from.look} size={18} />
                {from.name} handed a task to
              </>
            )}
            <Mascot look={to.look} size={18} />
            {to.name}
          </span>
          <span className="text-[13.5px] text-ink-2">{m.task}</span>
        </div>
      );
    } else if (!agents[author!]) {
      // An author the org doesn't know (yet): nothing to draw.
      node = null;
    } else if (m.kind === "text" && m.from === "you") {
      node = (
        <div className={`flex justify-end ${first ? "mt-5" : "mt-1.5"}`}>
          <div className="group/msg relative max-w-[min(520px,85%)]">
            <div className="rounded-[20px] bg-accent px-4 py-2.5 text-[15px] leading-[22px] text-white">
              <RichText text={m.text} />
            </div>
            <span className="pointer-events-none absolute bottom-1.5 right-full mr-2 whitespace-nowrap text-[11.5px] text-muted opacity-0 transition-opacity group-hover/msg:opacity-100">
              {m.at}
            </span>
          </div>
        </div>
      );
    } else {
      const agent = agents[author!];
      const msgReactions = reactions[m.id] ?? [];
      const lastReaction = msgReactions[msgReactions.length - 1];
      const acked = lastReaction && !initialReactions.has(`${m.id}:${lastReaction.order}`);
      let body: React.ReactNode;

      if (m.kind === "approval") {
        body = (
          <ApprovalCard
            m={m}
            flash={decided.has(m.id)}
            onDecide={(d) => {
              setDecided((s) => new Set(s).add(m.id));
              onDecide(m.id, d);
            }}
          />
        );
      } else if (m.kind === "proposal") {
        body = (
          <LaunchCard
            m={m}
            onEdit={(update) => onEditProposal(m.id, update)}
            onLaunch={() => onLaunchProject(m.id)}
            onRequestChanges={onRequestChanges}
            onOpen={() => m.launched && (m.launched.channel ? onOpenChannel(m.launched.projectId) : onMessageAgent(m.launched.leadId))}
          />
        );
      } else {
        // Text takes reactions and quick actions.
        body = (
          <>
            {m.quote && (
              <p className="mb-1.5 flex items-center gap-1.5 text-[13px] text-[#818181]">
                <CornerDownRight className="size-4 shrink-0" strokeWidth={1.6} />
                <span className="truncate">{m.quote}</span>
              </p>
            )}
            <div
              className="group/msg tap-soft relative w-fit max-w-full cursor-pointer"
              aria-haspopup="menu"
              onClick={(e) => {
                if (window.getSelection()?.toString()) return;
                openMenu(m, fromRect(e.currentTarget.getBoundingClientRect()));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                openMenu(m, { x: e.clientX, top: e.clientY, bottom: e.clientY });
              }}
            >
              <HoverBar
                onOrder={(k) => handlers.onOrder(m.id, agent.id, textOf(m), k)}
                onMore={(el) => openMenu(m, fromRect(el.getBoundingClientRect()))}
              />
              <motion.div
                key={`${m.id}-${msgReactions.length}`}
                initial={acked ? { scale: 1.025 } : false}
                animate={{ scale: 1 }}
                transition={POP}
                style={{ transformOrigin: "0% 100%" }}
              >
                <AgentBubble m={m} />
              </motion.div>
              {!channel && (
                <span className="pointer-events-none absolute bottom-1.5 left-full ml-2 whitespace-nowrap text-[11.5px] text-muted opacity-0 transition-opacity group-hover/msg:opacity-100">
                  {m.at}
                </span>
              )}
            </div>
            <ReactionChips items={msgReactions} agentName={agent.name} />
          </>
        );
      }

      node = channel ? (
        <div className={`flex gap-2.5 ${first ? "mt-5" : "mt-1.5"}`}>
          <div className="w-9 shrink-0">
            {first && (
              <button type="button" className="squish" onClick={() => onOpenAgent(agent.id)} aria-label={`${agent.name}'s profile`}>
                <Mascot look={agent.look} size={36} />
              </button>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {first && (
              <div className="mb-1 flex items-baseline gap-2 text-[13px]">
                <button type="button" className="font-semibold hover:underline" onClick={() => onOpenAgent(agent.id)}>
                  {agent.name}
                </button>
                <span className="text-muted">{agent.role}</span>
                <span className="text-[12px] text-[#a6a6a6]">{m.at}</span>
              </div>
            )}
            {body}
          </div>
        </div>
      ) : (
        <div className={first ? "mt-5" : "mt-1.5"}>{body}</div>
      );
    }

    rows.push(
      fresh ? (
        <motion.div
          key={m.id}
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={ENTER}
          style={{ transformOrigin: m.kind === "text" && m.from === "you" ? "100% 100%" : "0% 100%" }}
        >
          {node}
        </motion.div>
      ) : (
        <div key={m.id}>{node}</div>
      ),
    );
  });

  const typingAgent = typingAgentId ? (agents[typingAgentId] ?? null) : null;
  const mentionable: Agent[] = channel ? team.agents : [];
  const menuAgent = menu ? (agents[menu.agentId] ?? null) : null;

  return (
    <section className="relative flex min-w-0 flex-1 flex-col" aria-label={channel ? `#${team.channel}` : dmAgent!.name}>
      <div ref={scroller} className="scroll-quiet absolute inset-0 overflow-y-auto" onScroll={menu ? closeMenu : undefined}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          className={`mx-auto max-w-[740px] px-5 pb-36 sm:px-6 ${channel ? "pt-[196px]" : "pt-[140px]"}`}
        >
          {channel && (
            <p className="mx-auto mb-6 max-w-[460px] text-center text-[13.5px] leading-[20px] text-ink-2">{team.goal}</p>
          )}
          {rows}
          <AnimatePresence>
            {typingAgent && (
              <motion.div
                key="typing"
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.1 } }}
                transition={ENTER}
                style={{ transformOrigin: "0% 100%" }}
                className={channel ? "mt-5 flex gap-2.5" : "mt-5"}
              >
                {channel && <Mascot look={typingAgent.look} size={36} bob status="working" />}
                <div>
                  {channel && <div className="mb-1 text-[13px] font-semibold">{typingAgent.name}</div>}
                  <div className="flex w-fit items-center gap-1 rounded-[20px] bg-bubble px-4 py-[15px]" aria-label={`${typingAgent.name} is typing`}>
                    <span className="typing-dot size-1.5 rounded-full bg-[#8d8d8d]" />
                    <span className="typing-dot size-1.5 rounded-full bg-[#8d8d8d]" />
                    <span className="typing-dot size-1.5 rounded-full bg-[#8d8d8d]" />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {!channel && messages.length === 0 && !typingAgentId && (
            <div className="flex flex-col items-center pt-4 text-center">
              {doing[dmAgent!.id] && (
                <p className="mb-4 max-w-[420px] text-[14px] leading-[21px] text-ink-2">
                  {dmAgent!.name} is on: {doing[dmAgent!.id].charAt(0).toLowerCase() + doing[dmAgent!.id].slice(1)}.
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                {(dmAgent!.id === CHIEF_ID ? CHIEF_SHORTCUTS : SUGGESTIONS).map((s, i) => (
                  <motion.button
                    key={s.label}
                    type="button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...ENTER, delay: 0.15 + 0.05 * i }}
                    onClick={() => onSend(s.ask)}
                    className="rounded-full bg-white shadow-[0_0_0_1px_#e4e4e4]"
                  >
                    <span className="tap block rounded-full px-3.5 py-1.5 text-[14px] hover:bg-bubble">{s.label}</span>
                  </motion.button>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </div>

      <div className={`thread-fade pointer-events-none absolute inset-x-0 top-0 z-10 ${channel ? "h-[196px]" : "h-[140px]"}`} />
      <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center">{header}</div>

      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-white via-white/90 to-transparent px-4 pb-3 pt-8 sm:px-5">
        <div className="mx-auto max-w-[740px]">
          <Composer
            placeholder={channel ? `Message #${team.channel}` : "Send a message"}
            busy={typingAgentId !== null}
            mentionable={mentionable}
            prefill={prefill}
            onSend={onSend}
            onOpenPlan={() => (channel ? onOpenTeam(team.id) : onOpenAgent(dmAgent!.id))}
          />
        </div>
      </div>

      <AnimatePresence>
        {menu && menuAgent && (
          <ActionMenu
            key={menu.msgId}
            target={menu}
            agent={menuAgent}
            teammates={channel ? team.agents.filter((a) => a.id !== menuAgent.id) : []}
            onClose={closeMenu}
            onOrder={(k) => {
              handlers.onOrder(menu.msgId, menuAgent.id, menu.text, k);
              closeMenu();
            }}
            onMessage={() => {
              closeMenu();
              onMessageAgent(menuAgent.id);
            }}
            onAsk={() => {
              handlers.onAsk(menuAgent.id, menu.text);
              closeMenu();
            }}
            onHandOff={(to) => {
              handlers.onHandOff(menuAgent.id, menu.text, to);
              closeMenu();
            }}
            onProfile={() => {
              closeMenu();
              onOpenAgent(menuAgent.id);
            }}
            onCopy={() => {
              handlers.onCopy(menu.text);
              closeMenu();
            }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

/** An agent's reply: Markdown bubbles, with each chart block drawn as its own card between them. */
function AgentBubble({ m }: { m: Text }) {
  const segments = splitCharts(m.streaming ? trimPartialFence(m.text) : m.text);
  const lastText = segments.findLastIndex((s) => s.kind === "text");
  return (
    <div className="flex flex-col items-start gap-1.5">
      {segments.map((s, i) =>
        s.kind === "chart" ? (
          <ChartBlock key={i} code={s.code} open={s.open && !!m.streaming} />
        ) : (
          <div
            key={i}
            className="w-fit max-w-[min(620px,100%)] rounded-[20px] bg-bubble px-4 py-[11px] text-[15px] leading-[22px] text-ink transition-colors group-hover/msg:bg-[#ececec]"
          >
            <Markdown text={s.text.trim()} streaming={!!m.streaming && i === lastText} />
          </div>
        ),
      )}
    </div>
  );
}

function ApprovalCard({
  m,
  flash,
  onDecide,
}: {
  m: Extract<Message, { kind: "approval" }>;
  flash: boolean;
  onDecide: (d: "approved" | "declined") => void;
}) {
  const approved = m.state === "approved";
  return (
    <motion.div
      animate={flash && m.state !== "pending" ? { backgroundColor: [approved ? "#dcf3e6" : "#ececec", "#f4f4f4"] } : undefined}
      transition={{ duration: 1.1, ease: "easeOut" }}
      className="max-w-[min(540px,100%)] rounded-[20px] bg-bubble px-4 py-3.5"
    >
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#9a5b00]">
        <Hand className="size-3.5" />
        Needs your approval
      </div>
      <p className="mt-1.5 text-[15px] font-semibold leading-snug">{m.title}</p>
      <p className="mt-1 text-[14px] leading-[20px] text-ink-2">{m.detail}</p>
      <div className="mt-3 h-[34px]">
        <AnimatePresence mode="wait" initial={false}>
          {m.state === "pending" ? (
            <motion.div key="pending" exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }} className="flex gap-2">
              <button
                type="button"
                onClick={() => onDecide("approved")}
                className="tap rounded-full bg-accent px-4 py-1.5 text-[14px] font-medium text-white hover:bg-[#3557d6] hover:shadow-[0_4px_14px_rgba(65,102,235,0.35)]"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => onDecide("declined")}
                className="tap rounded-full bg-white px-4 py-1.5 text-[14px] font-medium shadow-[0_0_0_1px_#e2e2e2] hover:bg-[#fafafa] hover:shadow-[0_0_0_1px_#d0d0d0]"
              >
                Decline
              </button>
            </motion.div>
          ) : (
            <motion.p
              key="done"
              initial={{ opacity: 0, scale: 0.85, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={POP}
              style={{ transformOrigin: "0% 50%" }}
              className={`flex h-full items-center gap-1.5 text-[14px] font-medium ${approved ? "text-[#16794c]" : "text-muted"}`}
            >
              {approved && (
                <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                  <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.08, ease: "easeOut" }} />
                </svg>
              )}
              {approved ? "Approved" : "Declined"}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
