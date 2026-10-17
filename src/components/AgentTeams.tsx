"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Columns2, Hash, ListChecks, SquarePen } from "lucide-react";
import { AGENTS, CHIEF, CHIEF_ID, HQ, TEAMS } from "@/lib/data";
import { excerpt, orderText, ORDERS_BY_KEY, type OrderKey } from "@/lib/orders";
import { launchPlanOf, openingUploads, parseProject, PROJECT_FENCE, START_PROJECT, visibleText, type LaunchOptions } from "@/lib/project";
import { withChartSummaries } from "@/lib/charts";
import { cache, prefetch, useCached, type Resource } from "@/lib/client-cache";
import { sendToThread } from "@/lib/thread-client";
import type { Agent, AgentStatus, Message, OrgPayload, OrgSnapshot, PlanStep, Team } from "@/lib/types";
import { ChiefMenu } from "./Chief";
import { identityOf } from "./Identity";
import { agentStats } from "./Performance";
import { rulesOf } from "./Rules";
import { Mascot } from "./Mascot";
import { OrgContext, orgResource, useOrgSource } from "./org";
import { IconButton, Toast } from "./ui";
import { Rail, type SideMode } from "./Rail";
import { archetypeList, skillLibrary } from "./Skills";
import { Sidebar } from "./Sidebar";
import { Conversation, type MessageHandlers } from "./Conversation";
import { WorkspaceBody, WorkspaceTabs, type Tab } from "./Workspace";
import type { Reaction } from "./MessageActions";

export type View = { kind: "channel"; teamId: string } | { kind: "dm"; agentId: string };

export const convKey = (v: View) => (v.kind === "channel" ? `team:${v.teamId}` : `dm:${v.agentId}`);

const sameView = (a: View, b: View) => convKey(a) === convKey(b);

const now = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const uid = () => Math.random().toString(36).slice(2, 10);
const plain = (text: string) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

const PANEL = { type: "spring", stiffness: 380, damping: 38 } as const;

const CHIEF_VIEW: View = { kind: "dm", agentId: CHIEF_ID };
/** Her DM's thread on the runtime (src/server/runtime/db.ts seeds it). */
const MIRA_THREAD = `a:${CHIEF_ID}:p:dm`;

/**
 * GET /api/chat says whether CRUSOE_API_KEY is set: server config, not chat state. It changes only with a
 * restart, which nothing announces (`config` is never sent); the stream's reconnect and window focus recheck it.
 */
const LIVE_REPLIES: Resource = { key: "/api/chat", topic: "config" };

/** A note that images came with a message; only the newest message's images go to the model. */
const withImages = (text: string, images?: string[]) =>
  images?.length ? `${text}${text ? "\n\n" : ""}(${images.length === 1 ? "an image" : `${images.length} images`} attached)` : text;

type Card = Extract<Message, { kind: "proposal" }>;

/** What a model sees of a thread: text, plus a line for each of the chief's option cards the owner saw. */
const toHistory = (msgs: Message[]) =>
  msgs
    .flatMap((m) =>
      m.kind === "text"
        ? [{ from: m.from, text: withImages(m.text, m.images) }]
        : m.kind === "proposal" && m.plan
          ? [
              {
                from: m.from,
                text: `(Proposed ${m.plan.options.map((o) => o.label).join(" / ")} for ${m.plan.charter.name}; ${m.state === "launched" ? `the owner launched ${m.plan.options[m.picked].label}` : "waiting for the owner"}.)`,
              },
            ]
          : [],
    )
    .slice(-16);

/** Adds a launched team (or solo DM) and its agents to the cached org, so it shows before the `org` refresh lands. */
function withTeam(org: OrgPayload | undefined, team: Team, solo: boolean): OrgPayload {
  const base = org ?? { teams: [], dms: [], agents: [] };
  const agents = new Map<string, Agent>(base.agents.map((a) => [a.id, a]));
  for (const a of team.agents) if (!AGENTS[a.id]) agents.set(a.id, { ...a, teamId: team.id });
  const list = solo ? base.dms : base.teams;
  const next = [...list.filter((t) => t.id !== team.id), team];
  return { ...base, teams: solo ? base.teams : next, dms: solo ? next : base.dms, agents: [...agents.values()] };
}

function useMedia(query: string, fallback: boolean) {
  const [match, setMatch] = useState(fallback);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return match;
}

interface SendOptions {
  /** Route to this agent instead of the mention or the team lead. */
  agentId?: string;
  /** What to show in the thread instead of your bubble; null shows nothing. */
  shown?: Message | null;
  /** Quote line on the agent's reply, so you can see what it answers. */
  replyQuote?: string;
  /** This message is a reaction order; the server records it as a performance signal. */
  order?: { key: OrderKey; text: string; trace?: string };
  /** Upload ids attached to this message (at most 8, 4 of them images). */
  images?: string[];
}

export function AgentTeams() {
  const wide = useMedia("(min-width: 1024px)", true);
  const medium = useMedia("(min-width: 768px)", true);

  const [view, setView] = useState<View>(CHIEF_VIEW);
  const [past, setPast] = useState<View[]>([]);
  const [future, setFuture] = useState<View[]>([]);
  const [side, setSide] = useState<SideMode>("home");
  // Desktop and mobile keep separate open states so resizing never fights the user.
  const [sidebarDesktop, setSidebarDesktop] = useState(true);
  const [sidebarMobile, setSidebarMobile] = useState(false);
  const [workspaceDesktop, setWorkspaceDesktop] = useState(false);
  const [workspaceMobile, setWorkspaceMobile] = useState(false);
  const sidebarOpen = medium ? sidebarDesktop : sidebarMobile;
  const setSidebarOpen = (open: boolean) => (medium ? setSidebarDesktop(open) : setSidebarMobile(open));
  const workspaceOpen = wide ? workspaceDesktop : workspaceMobile;
  const setWorkspaceOpen = useCallback((open: boolean) => {
    setWorkspaceDesktop(open);
    setWorkspaceMobile(open);
  }, []);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState("");
  const [convos, setConvos] = useState<Record<string, Message[]>>(() => {
    const c: Record<string, Message[]> = {};
    for (const t of TEAMS) c[`team:${t.id}`] = t.messages;
    return c;
  });
  // The org: the constants plus the runtime db's teams and agents, refreshed on the `org` topic.
  const org = useOrgSource();
  // One source for what each agent is doing: every mascot, chip and "now" line reads these.
  const [status, setStatus] = useState<Record<string, AgentStatus>>(() =>
    Object.fromEntries(Object.keys(AGENTS).map((id) => [id, id === CHIEF_ID ? "working" : "idle"])),
  );
  const [doing, setDoing] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.keys(AGENTS).map((id) => [id, id === CHIEF_ID ? "Watching the company" : ""])),
  );
  const setActivity = useCallback((agentId: string, s: AgentStatus, now?: string) => {
    setStatus((st) => ({ ...st, [agentId]: s }));
    if (now) setDoing((d) => ({ ...d, [agentId]: now }));
  }, []);
  const [typing, setTyping] = useState<Record<string, string | null>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [memories, setMemories] = useState<Record<string, string[]>>({});
  const [plans] = useState<Record<string, PlanStep[]>>({});
  // null while it's never been checked; painted from the cache after that.
  const chat = useCached<{ live: boolean }>(LIVE_REPLIES);
  const live = chat.data ? chat.data.live : chat.error ? false : null;
  const [prefill, setPrefill] = useState<{ key: string; text: string; nonce: number } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Agents the db added start idle until something says otherwise.
  const statusAll = useMemo(() => {
    const s = { ...status };
    for (const id of Object.keys(org.agents)) s[id] ??= "idle";
    return s;
  }, [status, org.agents]);
  const [chiefOpen, setChiefOpen] = useState(false);
  const [chiefNote, setChiefNote] = useState<string | null>(null);
  const [chiefUnread, setChiefUnread] = useState(false);
  // Callbacks that run after awaits read the latest state through these.
  const convosRef = useRef(convos);
  convosRef.current = convos;
  const teamsRef = useRef(org.teamsById);
  teamsRef.current = org.teamsById;
  const agentsRef = useRef(org.agents);
  agentsRef.current = org.agents;
  const statusRef = useRef(statusAll);
  statusRef.current = statusAll;
  const doingRef = useRef(doing);
  doingRef.current = doing;
  const viewRef = useRef(view);
  viewRef.current = view;

  // Mira's panel is the one opened most, so her stats and files are ready before it is; the Skills tab's
  // library and chips too, so its first open paints at once.
  useEffect(() => {
    void prefetch(agentStats(CHIEF_ID));
    void prefetch(identityOf(CHIEF_ID));
    void prefetch(rulesOf({ agentId: CHIEF_ID }));
    void prefetch(skillLibrary);
    void prefetch(archetypeList);
  }, []);

  const notify = useCallback((text: string) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text });
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const navigate = useCallback(
    (v: View) => {
      if (sameView(v, view)) return;
      setPast((p) => [...p.slice(-30), view]);
      setFuture([]);
      setView(v);
      if (v.kind === "channel") setUnread((u) => ({ ...u, [v.teamId]: 0 }));
      if (sameView(v, CHIEF_VIEW)) setChiefUnread(false);
      setSidebarMobile(false);
    },
    [view],
  );

  /** Every team's live state, so the chief answers from exactly what the app shows. */
  const snapshot = useCallback((): OrgSnapshot => {
    const pending: Record<string, string[]> = {};
    for (const [k, msgs] of Object.entries(convosRef.current)) {
      const teamId = k.startsWith("team:") ? k.slice(5) : (agentsRef.current[k.slice(3)]?.teamId ?? HQ.id);
      for (const m of msgs) if (m.kind === "approval" && m.state === "pending") (pending[teamId] ??= []).push(m.title);
    }
    return {
      teams: Object.values(teamsRef.current)
        .filter((t) => t.id !== HQ.id)
        .map((t) => ({
          id: t.id,
          channel: t.channel,
          name: t.name,
          goal: t.goal,
          leadId: t.leadId,
          launched: Boolean(t.launched),
          pending: pending[t.id] ?? [],
          agents: t.agents.map((a) => ({ id: a.id, status: statusRef.current[a.id], doing: doingRef.current[a.id] })),
        })),
    };
  }, []);

  const back = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [view, ...f]);
    setView(prev);
  };
  const forward = () => {
    const next = future[0];
    if (!next) return;
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, view]);
    setView(next);
  };

  const openTab = useCallback(
    (tab: Tab) => {
      setTabs((ts) => (ts.some((t) => t.id === tab.id) ? ts : [...ts.slice(-5), tab]));
      setActiveTab(tab.id);
      setWorkspaceOpen(true);
    },
    [setWorkspaceOpen],
  );

  const openAgent = useCallback((agentId: string) => openTab({ id: `agent:${agentId}`, type: "agent", agentId }), [openTab]);
  const openTeam = useCallback((teamId: string) => openTab({ id: `team:${teamId}`, type: "team", teamId }), [openTab]);
  const openSkills = useCallback(() => openTab({ id: "skills", type: "skills" }), [openTab]);

  const closeTab = (id: string) => {
    setTabs((ts) => {
      const next = ts.filter((t) => t.id !== id);
      if (id === activeTab) setActiveTab(next[next.length - 1]?.id ?? "");
      if (next.length === 0) setWorkspaceOpen(false);
      return next;
    });
  };

  const append = (key: string, msg: Message) =>
    setConvos((c) => ({ ...c, [key]: [...(c[key] ?? []), msg] }));

  const decide = (key: string, msgId: string, decision: "approved" | "declined") => {
    const msg = convos[key]?.find((m) => m.id === msgId);
    setConvos((c) => ({
      ...c,
      [key]: c[key].map((m) => (m.id === msgId && m.kind === "approval" ? { ...m, state: decision } : m)),
    }));
    if (msg?.kind === "approval") {
      // Approvals count toward the agent's acceptance rate.
      fetch("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: msg.from, decision }),
      }).catch(() => {});
      if (decision === "approved") setActivity(msg.from, "working", msg.title);
      else setActivity(msg.from, "idle", `Stopped: you declined “${excerpt(msg.title, 70)}”`);
      append(key, {
        id: uid(),
        kind: "status",
        at: now(),
        text: `You ${decision === "approved" ? "approved" : "declined"}: ${msg.title}`,
      });
    }
  };

  const updateCard = useCallback((key: string, id: string, update: (m: Card) => Card) => {
    setConvos((c) => ({ ...c, [key]: (c[key] ?? []).map((m) => (m.id === id && m.kind === "proposal" ? update(m) : m)) }));
  }, []);
  const dropCard = useCallback((key: string, id: string) => {
    setConvos((c) => ({ ...c, [key]: (c[key] ?? []).filter((m) => m.id !== id) }));
  }, []);

  /** Parse Mira's fence and staff every option; the card shows only once all of it is back, else it goes. */
  const planCard = useCallback(
    async (key: string, id: string, reply: string) => {
      const proposal = parseProject(reply);
      if (!proposal) {
        console.warn("[launch] Mira's project block didn't parse, so no option cards:", reply.slice(reply.indexOf(PROJECT_FENCE), reply.indexOf(PROJECT_FENCE) + 400));
        return dropCard(key, id);
      }
      updateCard(key, id, (m) => ({ ...m, state: "planning", proposal }));
      try {
        const res = await fetch("/api/projects/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposal }) });
        const body = (await res.json().catch(() => null)) as (LaunchOptions & { error?: string }) | null;
        if (!res.ok || !body?.options?.length) throw new Error(body?.error ?? `the plan route answered ${res.status}`);
        updateCard(key, id, (m) => ({ ...m, state: "ready", plan: body }));
      } catch (e) {
        console.warn("[launch] Couldn't staff Mira's options, so no option cards:", (e as Error).message);
        dropCard(key, id);
      }
    },
    [updateCard, dropCard],
  );

  const send = useCallback(async (target: View, text: string, opts: SendOptions = {}) => {
    const key = convKey(target);
    let agentId: string;
    let teamId: string;
    if (target.kind === "dm") {
      agentId = opts.agentId ?? target.agentId;
      teamId = agentsRef.current[agentId]?.teamId ?? HQ.id;
    } else {
      const team = teamsRef.current[target.teamId];
      const mentioned = team.agents.find((a) => new RegExp(`@${a.name}\\b`, "i").test(text));
      agentId = opts.agentId ?? mentioned?.id ?? team.leadId;
      teamId = team.id;
    }
    const chief = agentId === CHIEF_ID;
    // A launched team exists only here, so its goal, members and spec ride along.
    const launched = target.kind === "channel" ? teamsRef.current[teamId] : undefined;
    const project = launched?.launched && {
      id: launched.id,
      channel: launched.channel,
      name: launched.name,
      goal: launched.goal,
      leadId: launched.leadId,
      members: launched.agents.map((a) => ({ id: a.id, assignment: launched.launched!.assignments[a.id] ?? "" })),
      spec: launched.launched.spec,
    };

    const images = opts.images?.length ? opts.images : undefined;
    const userMsg: Message = { id: uid(), kind: "text", from: "you", at: now(), text, images };
    const history = toHistory([...(convosRef.current[key] ?? []), userMsg]);

    const shown = opts.shown === undefined ? userMsg : opts.shown;
    if (shown) setConvos((c) => ({ ...c, [key]: [...(c[key] ?? []), shown] }));
    setTyping((t) => ({ ...t, [key]: agentId }));

    const replyId = uid();
    let started = false;
    let traceId: string | undefined;
    // The chief's option cards: a placeholder (a shimmer line) from the moment her fence starts streaming.
    let cardId: string | null = null;
    /** Shows the reply so far: a new bubble on the first text, then updates it in place. */
    const show = (acc: string) => {
      if (!acc.trim()) return;
      // A project block streams as JSON; show the sentence before it and a placeholder for the rest.
      const shownText = visibleText(acc) || "Putting the team together…";
      const reply: Message = { id: replyId, kind: "text", from: agentId, at: now(), text: shownText, quote: opts.replyQuote, traceId, streaming: true };
      if (!started) {
        started = true;
        setTyping((t) => ({ ...t, [key]: null }));
        setConvos((c) => ({ ...c, [key]: [...(c[key] ?? []), reply] }));
      } else {
        setConvos((c) => ({ ...c, [key]: c[key].map((m) => (m.id === replyId ? reply : m)) }));
      }
      if (chief && !cardId && acc.includes(PROJECT_FENCE)) {
        const card: Card = { id: (cardId = uid()), kind: "proposal", from: CHIEF_ID, at: now(), state: "drafting", nonce: crypto.randomUUID(), picked: 0 };
        setConvos((c) => ({ ...c, [key]: [...(c[key] ?? []), card] }));
      }
    };
    try {
      let acc = "";
      if (chief && target.kind === "dm" && !opts.order) {
        // Mira's DM runs on her persistent agent (src/server/runtime): her thread keeps the conversation,
        // so no history rides along; the reply and her "now" line stream from the run. Attachments ride along.
        acc = await sendToThread(MIRA_THREAD, text, {
          text: show,
          now: (line) => setActivity(CHIEF_ID, "working", line),
        }, images);
        show(acc);
        setActivity(CHIEF_ID, "working", "Watching the company");
      } else acc = await streamChat();
      if (!started) throw new Error(`${agentsRef.current[agentId]?.name ?? agentId} returned an empty reply. Try again, or pick a different model.`);
      if (chief && cardId) {
        const intro = visibleText(acc);
        setConvos((c) => ({ ...c, [key]: c[key].flatMap((m) => (m.id !== replyId ? [m] : intro ? [{ ...m, text: intro } as Message] : [])) }));
        void planCard(key, cardId, acc);
      }
    } catch (e) {
      if (cardId) dropCard(key, cardId);
      setConvos((c) => ({ ...c, [key]: [...(c[key] ?? []), { id: uid(), kind: "status", at: now(), text: (e as Error).message }] }));
    } finally {
      setTyping((t) => ({ ...t, [key]: null }));
      // Settle the reply, even if the stream broke off, so it stops animating and draws its charts.
      setConvos((c) => ({ ...c, [key]: (c[key] ?? []).map((m) => (m.id === replyId && m.kind === "text" && m.streaming ? { ...m, streaming: false } : m)) }));
    }

    /** A single chat completion through /api/chat, streamed; returns the whole text. */
    async function streamChat(): Promise<string> {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          teamId,
          mode: target.kind,
          history,
          uploads: images,
          order: opts.order,
          org: chief ? snapshot() : undefined,
          project: project || undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
        throw new Error(err.error);
      }
      traceId = res.headers.get("X-Trace-Id") ?? undefined;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        show(acc);
      }
      return acc;
    }
  }, [snapshot, setActivity, planCard, dropCard]);

  // The chief speaks up on her own, like dots' dreamer: a quiet check-in that stays silent unless
  // something is worth your attention. Once shortly after load, then every 20 minutes while visible.
  const heartbeat = useCallback(async () => {
    if (statusRef.current[CHIEF_ID] === "idle") return; // paused from her profile
    const key = convKey(CHIEF_VIEW);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: CHIEF_ID, mode: "dm", history: toHistory(convosRef.current[key] ?? []), org: snapshot(), heartbeat: true }),
      });
      if (!res.ok) return;
      const text = (await res.text()).trim();
      if (!text || /^quiet\b/i.test(text) || text.includes(PROJECT_FENCE)) return;
      const traceId = res.headers.get("X-Trace-Id") ?? undefined;
      setConvos((c) => ({ ...c, [key]: [...(c[key] ?? []), { id: uid(), kind: "text", from: CHIEF_ID, at: now(), text, traceId }] }));
      setChiefNote(withChartSummaries(text));
      if (!sameView(viewRef.current, CHIEF_VIEW)) {
        setChiefUnread(true);
        notify(`${CHIEF.name} has a suggestion`);
      }
    } catch {
      // A missed check-in is fine; the next one will come.
    }
  }, [snapshot, notify]);

  useEffect(() => {
    if (!live) return;
    const first = setTimeout(heartbeat, 25_000);
    const every = setInterval(() => document.visibilityState === "visible" && heartbeat(), 20 * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [live, heartbeat]);

  const askChief = (text: string) => {
    setChiefOpen(false);
    navigate(CHIEF_VIEW);
    send(CHIEF_VIEW, text);
  };
  const startProject = () => {
    setChiefOpen(false);
    navigate(CHIEF_VIEW);
    setPrefill({ key: convKey(CHIEF_VIEW), text: START_PROJECT, nonce: Date.now() });
  };

  /**
   * Launch the picked option: POST /api/projects provisions it (rows, home files, skills, charter, and the lead's
   * kickoff in its inbox; nothing runs a model here). The same card nonce on a retry can't make a second team.
   */
  const launchProject = async (key: string, msgId: string) => {
    const msg = convosRef.current[key]?.find((m) => m.id === msgId);
    if (msg?.kind !== "proposal" || msg.state !== "ready" || !msg.plan) return;
    updateCard(key, msgId, (m) => ({ ...m, state: "launching", error: undefined }));
    const plan = { ...launchPlanOf(msg.plan, msg.picked, msg.edits), uploads: openingUploads(convosRef.current[key] ?? [], msgId) };
    const solo = plan.charter.kind === "solo";
    try {
      const res = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, nonce: msg.nonce }) });
      const body = (await res.json().catch(() => null)) as { projectId?: string; team?: Team | null; error?: string } | null;
      if (!res.ok || !body?.projectId || !body.team) throw new Error(body?.error ?? `Launch failed (${res.status}).`);
      const team = body.team;
      cache.mutate<OrgPayload>(orgResource.key, (d) => withTeam(d, team, solo));
      void cache.revalidate(orgResource.key);
      updateCard(key, msgId, (m) => ({ ...m, state: "launched", launched: { projectId: team.id, channel: solo ? null : team.channel, leadId: team.leadId } }));
      const lead = team.agents.find((a) => a.id === team.leadId) ?? team.agents[0];
      setActivity(lead.id, "idle", solo ? "Kickoff in the inbox: start on the brief" : "Kickoff in the inbox: write the plan and assign first tasks");
      const where = solo ? `dm:${lead.id}` : `team:${team.id}`;
      setConvos((c) => ({
        ...c,
        [where]: [
          ...(c[where] ?? []),
          { id: uid(), kind: "status", at: now(), text: solo ? `You launched ${plan.option?.label ?? "the option"} with ${lead.name}` : `You launched #${team.channel}` },
          {
            id: uid(),
            kind: "text",
            from: CHIEF_ID,
            at: now(),
            text: `${solo ? `${lead.name} has` : `${lead.name} leads, and has`} the charter for ${plan.charter.name}: ${plan.charter.goal.replace(/[.!]?\s*$/, ".")} The kickoff is waiting in ${solo ? "their" : "the PM's"} inbox.`,
          },
        ],
      }));
      if (solo) navigate({ kind: "dm", agentId: lead.id });
      else {
        navigate({ kind: "channel", teamId: team.id });
        openTeam(team.id);
      }
    } catch (e) {
      updateCard(key, msgId, (m) => ({ ...m, state: "ready", error: (e as Error).message }));
    }
  };

  const key = convKey(view);
  const messages = convos[key] ?? [];

  // Quick actions on agent messages. Reactions are orders the agent acts on.
  const handlers: MessageHandlers = {
    onOrder: (msgId, agentId, text, orderKey: OrderKey) => {
      const order = ORDERS_BY_KEY[orderKey];
      const name = org.agents[agentId]?.name ?? agentId;
      if ((reactions[msgId] ?? []).some((r) => r.order === orderKey)) {
        notify(`${name} already has “${order.label}” for this`);
        return;
      }
      setReactions((r) => ({ ...r, [msgId]: [...(r[msgId] ?? []), { order: orderKey, at: now() }] }));
      if (order.doing) setActivity(agentId, orderKey === "hold" ? "idle" : "working", `${order.doing} “${excerpt(plain(text), 70)}”`);
      if (orderKey === "pin") setMemories((m) => ({ ...m, [agentId]: [...(m[agentId] ?? []), excerpt(plain(text), 120)] }));
      const reacted = convos[key]?.find((m) => m.id === msgId);
      send(view, orderText(order, text), {
        agentId,
        shown: null,
        replyQuote: `${order.emoji} ${order.label}: ${excerpt(plain(text), 90)}`,
        order: { key: orderKey, text: plain(text), trace: reacted?.kind === "text" ? reacted.traceId : undefined },
      });
    },
    onHandOff: (fromId, text, toId) => {
      const from = org.agents[fromId];
      if (!from) return;
      setActivity(toId, "working", `Taking over from ${from.name}: “${excerpt(plain(text), 70)}”`);
      send(view, `${from.name} posted: “${excerpt(plain(text), 200)}”. Please take this on and say how you'll handle it.`, {
        agentId: toId,
        shown: { id: uid(), kind: "handoff", from: fromId, to: toId, at: now(), task: excerpt(plain(text), 90), byYou: true },
        replyQuote: `Handed over from ${from.name}`,
      });
    },
    onAsk: (agentId, text) => {
      const quote = `“${excerpt(plain(text), 80)}”`;
      const t = view.kind === "channel" ? `@${org.agents[agentId]?.name ?? agentId} about ${quote}: ` : `About ${quote}: `;
      setPrefill({ key, text: t, nonce: Date.now() });
    },
    onCopy: (text) => {
      navigator.clipboard?.writeText(plain(text)).then(
        () => notify("Copied to clipboard"),
        () => notify("Couldn't copy: clipboard access was blocked"),
      );
    },
  };

  const pending = useMemo(
    () =>
      Object.entries(convos).flatMap(([k, msgs]) =>
        msgs
          .filter((m): m is Extract<Message, { kind: "approval" }> => m.kind === "approval" && m.state === "pending")
          .map((m) => ({ key: k, msg: m })),
      ),
    [convos],
  );

  const dmIds = useMemo(() => {
    // The chief is pinned above the DMs, so she isn't listed again. Solo experts are DMs from the moment they launch.
    const talked = Object.keys(convos).filter((k) => k.startsWith("dm:") && k !== convKey(CHIEF_VIEW) && convos[k].length > 0).map((k) => k.slice(3));
    const channels = new Set(org.teams.map((t) => t.id));
    const solo = Object.values(org.agents)
      .filter((a) => a.id !== CHIEF_ID && a.teamId !== HQ.id && org.teamsById[a.teamId] && !channels.has(a.teamId))
      .map((a) => a.id);
    return [...new Set([...talked, ...solo])].filter((id) => org.agents[id]);
  }, [convos, org]);

  const workspace = workspaceOpen && tabs.length > 0;
  const shownTab = tabs.find((t) => t.id === activeTab) ?? tabs[tabs.length - 1];
  const tabsEl = (
    <WorkspaceTabs
      tabs={tabs}
      active={activeTab}
      onSelect={setActiveTab}
      onClose={closeTab}
      onHide={() => setWorkspaceOpen(false)}
    />
  );
  const bodyEl = (
    <WorkspaceBody
      tab={shownTab}
      status={statusAll}
      doing={doing}
      memories={memories}
      plans={plans}
      onNotify={notify}
      onOpenAgent={openAgent}
      onMessage={(agentId) => navigate({ kind: "dm", agentId })}
      onOpenChannel={(teamId) => navigate({ kind: "channel", teamId })}
      onToggleRun={(agentId) => {
        const resuming = statusAll[agentId] === "idle";
        setStatus((s) => ({ ...s, [agentId]: resuming ? "working" : "idle" }));
        notify(`${org.agents[agentId]?.name ?? agentId} ${resuming ? "is back to work" : "is paused"}`);
      }}
      onOpenSkills={openSkills}
      onCloseOthers={(id) => {
        setTabs((ts) => ts.filter((t) => t.id === id));
        setActiveTab(id);
      }}
      onCloseTab={closeTab}
    />
  );

  return (
    <MotionConfig reducedMotion="user">
      <OrgContext.Provider value={org}>
      <div className="flex h-dvh overflow-hidden bg-frame text-ink">
        <Rail
          mode={side}
          onMode={(m) => {
            setSide(m);
            setSidebarOpen(true);
          }}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          needsYou={pending.length}
          skills={{ active: workspace && shownTab?.type === "skills", onClick: openSkills }}
          chief={{
            open: chiefOpen,
            unread: chiefUnread,
            onClick: () => {
              setChiefOpen((o) => !o);
              setChiefUnread(false);
            },
          }}
        />
        <ChiefMenu
          open={chiefOpen}
          status={statusAll[CHIEF_ID]}
          note={chiefNote}
          onClose={() => setChiefOpen(false)}
          onAsk={askChief}
          onStartProject={startProject}
          onOpenChat={() => {
            setChiefOpen(false);
            navigate(CHIEF_VIEW);
          }}
        />

        <AnimatePresence initial={false}>
          {sidebarOpen && !medium && (
            <motion.div
              key="scrim"
              className="fixed inset-0 z-20 bg-black/10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
            />
          )}
          {sidebarOpen && (
            <motion.div
              key={medium ? "sidebar" : "sidebar-mobile"}
              className={medium ? "shrink-0 overflow-hidden" : "fixed inset-y-0 left-14 z-30 shadow-xl"}
              initial={medium ? { width: 0, opacity: 0 } : { x: -24, opacity: 0 }}
              animate={medium ? { width: 252, opacity: 1 } : { x: 0, opacity: 1 }}
              exit={medium ? { width: 0, opacity: 0 } : { x: -24, opacity: 0 }}
              transition={PANEL}
            >
              <Sidebar
                className={medium ? "h-full" : "h-full"}
                mode={side}
                view={view}
                unread={unread}
                status={statusAll}
                doing={doing}
                dmIds={dmIds}
                convos={convos}
                pending={pending}
                live={live}
                chiefUnread={chiefUnread}
                onMode={setSide}
                onNavigate={navigate}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="mr-2.5 flex h-11 shrink-0 items-center">
            <div className="flex min-w-0 flex-1 items-center gap-0.5 pl-2">
              <IconButton label="Back" onClick={back} disabled={past.length === 0}>
                <ArrowLeft className="size-[18px]" strokeWidth={1.7} />
              </IconButton>
              <IconButton label="Forward" onClick={forward} disabled={future.length === 0}>
                <ArrowRight className="size-[18px]" strokeWidth={1.7} />
              </IconButton>
              <IconButton label="New message" onClick={() => document.querySelector<HTMLTextAreaElement>("#composer")?.focus()}>
                <SquarePen className="size-[17px]" strokeWidth={1.7} />
              </IconButton>
              <div className="flex-1" />
              {view.kind === "dm" ? (
                <IconButton label={`${org.agents[view.agentId]?.name ?? "Agent"}'s profile`} onClick={() => openAgent(view.agentId)}>
                  <span className="squish">{org.agents[view.agentId] && <Mascot look={org.agents[view.agentId].look} size={20} />}</span>
                </IconButton>
              ) : (
                <IconButton label="Team overview" onClick={() => openTeam(view.teamId)}>
                  <Hash className="size-[17px]" strokeWidth={1.7} />
                </IconButton>
              )}
              <IconButton label="Plan" onClick={() => (view.kind === "dm" ? openAgent(view.agentId) : openTeam(view.teamId))}>
                <ListChecks className="size-[18px]" strokeWidth={1.7} />
              </IconButton>
              {!workspace && tabs.length > 0 && (
                <IconButton label="Show workspace" onClick={() => setWorkspaceOpen(true)}>
                  <Columns2 className="size-[17px]" strokeWidth={1.7} />
                </IconButton>
              )}
            </div>
            <AnimatePresence initial={false}>
              {workspace && wide && (
                <motion.div
                  key="tabs"
                  className="flex h-full w-[44%] max-w-[820px] min-w-[420px]"
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  transition={PANEL}
                >
                  {tabsEl}
                </motion.div>
              )}
            </AnimatePresence>
          </header>

          <div className="mb-2.5 mr-2.5 flex min-h-0 flex-1 overflow-hidden rounded-2xl bg-surface shadow-[0_0_0_1px_rgba(0,0,0,0.03)]">
            <Conversation
              key={key}
              view={view}
              messages={messages}
              typingAgentId={typing[key] ?? null}
              status={statusAll}
              doing={doing}
              prefill={prefill?.key === key ? prefill : null}
              reactions={reactions}
              handlers={handlers}
              onSend={(text, images) => send(view, text, { images })}
              onDecide={(id, d) => decide(key, id, d)}
              onOpenAgent={openAgent}
              onOpenTeam={openTeam}
              onMessageAgent={(agentId) => navigate({ kind: "dm", agentId })}
              onOpenChannel={(teamId) => navigate({ kind: "channel", teamId })}
              onLaunchProject={(msgId) => void launchProject(key, msgId)}
              onEditProposal={(msgId, update) => updateCard(key, msgId, update)}
              onRequestChanges={(text) => send(CHIEF_VIEW, text)}
            />
            <AnimatePresence initial={false}>
              {workspace && wide && (
                <motion.section
                  key="workspace"
                  className="flex w-[44%] max-w-[820px] min-w-[420px] flex-col border-l border-line bg-pane"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  transition={PANEL}
                >
                  {bodyEl}
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </div>

        <AnimatePresence>
          {workspace && !wide && (
            <motion.div
              key="workspace-mobile"
              className="fixed inset-0 z-40 flex flex-col bg-frame"
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 32 }}
              transition={PANEL}
            >
              <div className="flex h-11 shrink-0 px-1">{tabsEl}</div>
              <section className="mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-pane">{bodyEl}</section>
            </motion.div>
          )}
        </AnimatePresence>

        <Toast toast={toast} />
      </div>
      </OrgContext.Provider>
    </MotionConfig>
  );
}
