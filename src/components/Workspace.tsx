import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Columns2,
  Copy,
  Download,
  Ellipsis,
  FileText,
  Globe,
  Hash,
  MessageSquareText,
  Plus,
  Presentation,
  RotateCw,
  SquareTerminal,
  Table2,
  X,
} from "lucide-react";
import { AGENTS, ARTIFACTS_BY_ID } from "@/lib/data";
import { useOrg } from "./org";
import type { AgentStatus, Artifact, ArtifactBody, Team } from "@/lib/types";
import { Mascot } from "./Mascot";
import { IconButton, SPRING } from "./ui";
import { ArtifactView } from "./ArtifactView";
import { AgentPanel, LibraryPanel, TeamPanel } from "./Panels";

export type Tab = { id: string } & (
  | { type: "artifact"; artifactId: string }
  | { type: "agent"; agentId: string }
  | { type: "team"; teamId: string }
  | { type: "library" }
);

export function KindIcon({ kind }: { kind: ArtifactBody["kind"] }) {
  const cls = "size-[15px] shrink-0";
  switch (kind) {
    case "slides":
      return (
        <span className="grid size-[17px] shrink-0 place-items-center rounded-[4px] bg-[#f6c33d]">
          <Presentation className="size-[11px] text-white" strokeWidth={2.4} />
        </span>
      );
    case "doc":
      return <FileText className={`${cls} text-[#3b78e7]`} />;
    case "sheet":
      return <Table2 className={`${cls} text-[#1e9a5a]`} />;
    case "code":
      return <SquareTerminal className={`${cls} text-ink-2`} />;
    case "browser":
      return <Globe className={`${cls} text-ink-2`} />;
  }
}

function tabMeta(tab: Tab, teamsById: Record<string, Team>): { title: string; icon: React.ReactNode; url: string } {
  switch (tab.type) {
    case "artifact": {
      const a = ARTIFACTS_BY_ID[tab.artifactId];
      return { title: a.title, icon: <KindIcon kind={a.body.kind} />, url: a.host };
    }
    case "agent": {
      const a = AGENTS[tab.agentId];
      return {
        title: `${a.name}: activity`,
        icon: <Mascot look={a.look} size={17} />,
        url: `agent-teams.app/agents/${a.id}`,
      };
    }
    case "team": {
      const t = teamsById[tab.teamId];
      return {
        title: `#${t.channel} plan`,
        icon: <Hash className="size-[15px] text-ink-2" />,
        url: `agent-teams.app/teams/${t.id}`,
      };
    }
    case "library":
      return { title: "Library", icon: <Copy className="size-[15px] text-ink-2" />, url: "agent-teams.app/library" };
  }
}

export function WorkspaceTabs({
  tabs,
  active,
  onSelect,
  onClose,
  onNew,
  onHide,
}: {
  tabs: Tab[];
  active: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onHide: () => void;
}) {
  const { teamsById } = useOrg();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 pl-1" role="tablist">
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        <AnimatePresence initial={false}>
        {tabs.map((tab) => {
          const meta = tabMeta(tab, teamsById);
          const on = tab.id === active;
          return (
            <motion.div
              key={tab.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
              transition={SPRING}
              className={`group relative flex h-[34px] min-w-[44px] max-w-[250px] shrink items-center gap-2 rounded-[10px] pl-2.5 pr-1.5 text-[14px] transition-colors ${
                on ? "" : "text-ink-2 hover:bg-black/[0.05]"
              }`}
            >
              {on && (
                <motion.span
                  layoutId="tab-active"
                  transition={SPRING}
                  className="absolute inset-0 rounded-[10px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                />
              )}
              <button
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onSelect(tab.id)}
                className="relative flex min-w-0 flex-1 items-center gap-2 active:opacity-70"
                title={meta.title}
              >
                {meta.icon}
                <span className="truncate [mask-image:linear-gradient(to_right,#000_85%,transparent)]">{meta.title}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${meta.title}`}
                onClick={() => onClose(tab.id)}
                className={`tap relative grid size-5 shrink-0 place-items-center rounded-md text-muted hover:bg-black/[0.07] hover:text-ink ${on ? "" : "opacity-0 group-hover:opacity-100"}`}
              >
                <X className="size-3.5" />
              </button>
            </motion.div>
          );
        })}
        </AnimatePresence>
      </div>
      <IconButton label="Open library tab" onClick={onNew}>
        <Plus className="size-[18px]" strokeWidth={1.6} />
      </IconButton>
      <div className="flex-1" />
      <IconButton label="Hide workspace" onClick={onHide} active>
        <Columns2 className="size-[17px]" strokeWidth={1.7} />
      </IconButton>
    </div>
  );
}

function toMarkdown(a: Artifact): string {
  const b = a.body;
  const head = `# ${a.title}\n\n`;
  switch (b.kind) {
    case "slides":
      return head + b.variants.map((v) => `## ${v.label}\n\n**${v.title}**\n\n${v.body}\n\nCTA: ${v.cta}\n`).join("\n");
    case "doc":
      return head + `## ${b.heading}\n\n` + b.sections.map((s) => (s.heading ? `### ${s.heading}\n\n` : "") + s.body).join("\n\n");
    case "sheet":
      return (
        head +
        `| ${b.columns.join(" | ")} |\n| ${b.columns.map(() => "---").join(" | ")} |\n` +
        b.rows.map((r) => `| ${r.join(" | ")} |`).join("\n") +
        (b.note ? `\n\n${b.note}` : "")
      );
    case "code":
      return head + "```diff\n" + b.lines.map((l) => (l.type === "add" ? "+" : l.type === "del" ? "-" : " ") + l.text).join("\n") + "\n```";
    case "browser":
      return head + `## ${b.heading}\n\n` + b.items.map((i) => `- **${i.title}**: ${i.body}`).join("\n");
  }
}

function download(a: Artifact) {
  const blob = new Blob([toMarkdown(a)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${a.id}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

const pill = "flex items-center rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06)]";

export function WorkspaceBody({
  tab,
  status,
  doing,
  memories,
  checkIns,
  onNotify,
  onOpenArtifact,
  onOpenAgent,
  onMessage,
  onOpenChannel,
  onToggleRun,
  onAsk,
  onSendTo,
  onCloseOthers,
  onCloseTab,
}: {
  tab: Tab | undefined;
  status: Record<string, AgentStatus>;
  doing: Record<string, string>;
  memories: Record<string, string[]>;
  checkIns: Record<string, string[]>;
  onNotify: (text: string) => void;
  onOpenArtifact: (id: string) => void;
  onOpenAgent: (id: string) => void;
  onMessage: (agentId: string) => void;
  onOpenChannel: (teamId: string) => void;
  onToggleRun: (agentId: string) => void;
  onAsk: (artifactId: string) => void;
  onSendTo: (agentId: string, text: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseTab: (id: string) => void;
}) {
  const [reloads, setReloads] = useState(0);
  const [menu, setMenu] = useState(false);
  const { teamsById } = useOrg();
  if (!tab) return null;
  const meta = tabMeta(tab, teamsById);
  const artifact = tab.type === "artifact" ? ARTIFACTS_BY_ID[tab.artifactId] : null;

  return (
    <>
      <div className="flex h-[54px] shrink-0 items-center gap-2 px-2.5">
        <div className={`${pill} p-0.5`}>
          <IconButton label="Back" disabled className="rounded-full">
            <ArrowLeft className="size-[17px]" strokeWidth={1.7} />
          </IconButton>
          <IconButton label="Forward" disabled className="rounded-full">
            <ArrowRight className="size-[17px]" strokeWidth={1.7} />
          </IconButton>
        </div>
        <div className={`${pill} p-0.5`}>
          <IconButton label="Reload" onClick={() => setReloads((r) => r + 1)} className="rounded-full">
            <motion.span
              key={reloads}
              className="grid place-items-center"
              initial={{ rotate: reloads ? -300 : 0 }}
              animate={{ rotate: 0 }}
              transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <RotateCw className="size-[16px]" strokeWidth={1.8} />
            </motion.span>
          </IconButton>
        </div>
        <div className={`${pill} h-9 min-w-0 flex-1 justify-center px-4 text-[14.5px] text-ink`}>
          <span className="truncate">{meta.url}</span>
        </div>
        {artifact && (
          <div className={`${pill} p-0.5`}>
            <IconButton label={`Ask ${AGENTS[artifact.agentId].name} about this`} onClick={() => onAsk(artifact.id)} className="rounded-full">
              <MessageSquareText className="size-[16px]" strokeWidth={1.8} />
            </IconButton>
            <IconButton label="Download as Markdown" onClick={() => {
                download(artifact);
                onNotify(`Downloaded ${artifact.id}.md`);
              }} className="rounded-full">
              <Download className="size-[16px]" strokeWidth={1.8} />
            </IconButton>
          </div>
        )}
        <div className="relative">
          <div className={`${pill} p-0.5`}>
            <IconButton label="More" onClick={() => setMenu((m) => !m)} className="rounded-full">
              <Ellipsis className="size-[17px]" strokeWidth={1.8} />
            </IconButton>
          </div>
          {menu && <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />}
          <AnimatePresence>
            {menu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.1 } }}
                transition={SPRING}
                style={{ transformOrigin: "top right" }}
                className="absolute right-0 top-full z-20 mt-1.5 w-44 rounded-xl border border-line bg-white p-1 text-[13.5px] shadow-[0_8px_30px_rgba(0,0,0,0.08)]"
              >
                <button
                  type="button"
                  className="tap-soft w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-bubble"
                  onClick={() => {
                    setMenu(false);
                    onCloseTab(tab.id);
                  }}
                >
                  Close tab
                </button>
                <button
                  type="button"
                  className="tap-soft w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-bubble"
                  onClick={() => {
                    setMenu(false);
                    onCloseOthers(tab.id);
                  }}
                >
                  Close other tabs
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <motion.div
        key={`${tab.id}-${reloads}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        className="scroll-quiet min-h-0 flex-1 overflow-y-auto border-t border-line"
      >
        {tab.type === "artifact" && artifact && <ArtifactView artifact={artifact} onSendTo={onSendTo} />}
        {tab.type === "agent" && (
          <AgentPanel
            agentId={tab.agentId}
            status={status[tab.agentId]}
            doing={doing[tab.agentId]}
            memories={memories[tab.agentId] ?? []}
            checkIns={checkIns[tab.agentId] ?? []}
            onMessage={onMessage}
            onToggleRun={onToggleRun}
            onOpenArtifact={onOpenArtifact}
            onOpenChannel={onOpenChannel}
            onNotify={onNotify}
          />
        )}
        {tab.type === "team" && (
          <TeamPanel teamId={tab.teamId} status={status} doing={doing} onOpenAgent={onOpenAgent} onOpenChannel={onOpenChannel} />
        )}
        {tab.type === "library" && <LibraryPanel onOpenArtifact={onOpenArtifact} />}
      </motion.div>
    </>
  );
}
