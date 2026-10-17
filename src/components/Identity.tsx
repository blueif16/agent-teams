import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, Heart, Pencil } from "lucide-react";
import { AGENTS } from "@/lib/data";
import { IconButton, inline, POP, SPRING } from "./ui";

/*
 * An agent's SOUL.md and MEMORY.md, after Muse's identity tab: two textured
 * cards that open into the file. SOUL is how the agent works; MEMORY is what
 * it has learned by doing.
 */
type Which = "soul" | "memory";
interface FileInfo {
  content: string;
  updated: string;
}
interface Identity {
  type: string;
  soul: FileInfo;
  memory: FileInfo;
}

const CARDS: Record<Which, { title: string; file: string; blurb: string; background: string }> = {
  soul: {
    title: "SOUL",
    file: "SOUL.md",
    blurb: "How it works",
    background:
      "radial-gradient(120% 90% at 90% 100%, #ef4a62 0%, transparent 58%), radial-gradient(90% 80% at 0% 0%, #a81f39 0%, transparent 62%), linear-gradient(155deg, #bb2640, #d93a52)",
  },
  memory: {
    title: "MEMORY",
    file: "MEMORY.md",
    blurb: "What it learned",
    background:
      "radial-gradient(120% 90% at 90% 100%, #6a86f7 0%, transparent 58%), radial-gradient(90% 80% at 0% 0%, #2a3cb8 0%, transparent 62%), linear-gradient(155deg, #3248c8, #4d6aee)",
  },
};

// Film grain over the gradients, as on Muse's cards.
const GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`;

const stamp = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}.${p(d.getDate())}.${String(d.getFullYear()).slice(2)}`;
};

/** Just enough Markdown for these files: headings, bullets, paragraphs, _placeholders_. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    const items = list;
    list = [];
    blocks.push(
      <ul key={blocks.length} className="my-2 space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-[14px] leading-[21px]">
            <span className="mt-[9px] size-1 shrink-0 rounded-full bg-[#b5b5b5]" />
            <span>{inline(item)}</span>
          </li>
        ))}
      </ul>,
    );
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("- ")) {
      list.push(line.slice(2));
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const k = blocks.length;
    if (line.startsWith("### ")) blocks.push(<h5 key={k} className="mt-4 text-[13px] font-semibold text-ink-2">{line.slice(4)}</h5>);
    else if (line.startsWith("## ")) blocks.push(<h4 key={k} className="mt-6 text-[15px] font-semibold">{line.slice(3)}</h4>);
    else if (line.startsWith("# ")) blocks.push(<h3 key={k} className="text-[18px] font-semibold tracking-[-0.01em]">{line.slice(2)}</h3>);
    else if (/^_.*_$/.test(line)) blocks.push(<p key={k} className="my-1.5 text-[13.5px] italic text-muted">{line.slice(1, -1)}</p>);
    else blocks.push(<p key={k} className="my-1.5 text-[14px] leading-[21px] text-ink-2">{inline(line)}</p>);
  }
  flush();
  return <div>{blocks}</div>;
}

function Card({ which, updated, onOpen }: { which: Which; updated: string; onOpen: () => void }) {
  const c = CARDS[which];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${c.file}`}
      className="lift group relative block aspect-[1.12] w-full overflow-hidden rounded-[26px] p-4 text-left text-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:shadow-[0_10px_28px_rgba(0,0,0,0.16)]"
      style={{ background: c.background }}
    >
      <span className="pointer-events-none absolute inset-0 opacity-[0.22] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
      <span className="relative block text-[21px] font-bold leading-none tracking-[0.01em]">{c.title}</span>
      <span className="relative mt-1.5 block font-mono text-[11px] uppercase tracking-[0.08em] text-white/75">Access with care</span>
      <span className="absolute inset-x-4 bottom-3.5 flex items-center justify-between">
        <span className="font-mono text-[16px] tabular-nums text-white/90">{stamp(updated)}</span>
        <Heart className="size-5 fill-white/65 text-transparent transition-transform duration-300 group-hover:scale-110" />
      </span>
    </button>
  );
}

function FileView({
  agentId,
  which,
  file,
  startEditing,
  onBack,
  onSaved,
}: {
  agentId: string;
  which: Which;
  file: FileInfo;
  startEditing: boolean;
  onBack: () => void;
  onSaved: (f: FileInfo) => void;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(file.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = CARDS[which];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/identity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: which, content: draft }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
      onSaved(body as FileInfo);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <IconButton label="Back to identity" onClick={onBack}>
          <ChevronLeft className="size-[18px]" />
        </IconButton>
        <span className="size-2.5 rounded-full" style={{ background: c.background }} />
        <span className="font-mono text-[13px] font-medium">{c.file}</span>
        <span className="text-[12px] text-muted">updated {stamp(file.updated)}</span>
        <div className="flex-1" />
        {editing ? (
          <>
            <button
              type="button"
              onClick={() => {
                setDraft(file.content);
                setEditing(false);
                setError(null);
              }}
              className="tap rounded-full px-3 py-1 text-[13px] font-medium text-ink-2 hover:bg-bubble"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || draft === file.content}
              className="tap rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-white hover:bg-[#3557d6] disabled:bg-accent-soft"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="tap inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[13px] font-medium shadow-[0_0_0_1px_#e2e2e2] hover:bg-[#f6f6f6]"
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-[12.5px] text-[#c4321b]">{error}</p>}
      <div className="mt-3 rounded-2xl bg-white px-5 py-4 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label={`Edit ${c.file}`}
            className="min-h-[420px] w-full resize-y bg-transparent font-mono text-[12.5px] leading-[19px] outline-none"
          />
        ) : (
          <Markdown text={file.content} />
        )}
      </div>
    </div>
  );
}

export function IdentityTab({ agentId, onNotify }: { agentId: string; onNotify: (text: string) => void }) {
  const [data, setData] = useState<Identity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ which: Which; edit: boolean } | null>(null);
  const agent = AGENTS[agentId];

  useEffect(() => {
    let alive = true;
    fetch(`/api/agents/${agentId}/identity`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Couldn't load ${agent.name}'s files (${r.status})`))))
      .then((d: Identity) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [agentId, agent.name]);

  if (!data) return <p className="mt-6 text-center text-[13px] text-muted">{error ?? "Loading…"}</p>;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {open ? (
        <motion.div key={open.which} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={SPRING} className="mt-5">
          <FileView
            agentId={agentId}
            which={open.which}
            file={data[open.which]}
            startEditing={open.edit}
            onBack={() => setOpen(null)}
            onSaved={(f) => {
              setData((d) => (d ? { ...d, [open.which]: f } : d));
              onNotify(`Saved ${agent.name}'s ${CARDS[open.which].file}`);
            }}
          />
        </motion.div>
      ) : (
        <motion.div key="cards" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={SPRING} className="mt-5">
          <div className="rounded-[22px] bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
            <div className="flex items-baseline gap-2">
              <span className="text-[16px] font-semibold">{agent.name}</span>
              <span className="text-[12.5px] text-muted">{data.type}</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen({ which: "soul", edit: true })}
              className="tap-soft mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-bubble text-[14px] font-medium hover:bg-[#ebebeb]"
            >
              <Pencil className="size-4" />
              Edit
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {(["soul", "memory"] as const).map((w, i) => (
              <motion.div key={w} initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...POP, delay: i * 0.05 }}>
                <Card which={w} updated={data[w].updated} onOpen={() => setOpen({ which: w, edit: false })} />
              </motion.div>
            ))}
          </div>
          <p className="mt-3 px-1 text-[12.5px] leading-[18px] text-muted">
            {CARDS.soul.blurb}: its craft and what to master on this team. {CARDS.memory.blurb}: work done, mistakes, and what works.
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
