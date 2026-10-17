import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, AtSign, ListChecks, Mic, Plus } from "lucide-react";
import type { Agent } from "@/lib/types";
import { Mascot } from "./Mascot";
import { SPRING } from "./ui";

const POPOVER = {
  initial: { opacity: 0, y: 6, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.1 } },
  transition: SPRING,
  style: { transformOrigin: "bottom left" },
};

type SpeechCtor = new () => {
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

function getSpeechCtor(): SpeechCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const noop = () => () => {};

export function Composer({
  placeholder,
  busy,
  mentionable,
  prefill,
  onSend,
  onOpenPlan,
}: {
  placeholder: string;
  busy: boolean;
  mentionable: Agent[];
  prefill: { text: string; nonce: number } | null;
  onSend: (text: string) => void;
  onOpenPlan: () => void;
}) {
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const [listening, setListening] = useState(false);
  const [sent, setSent] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<InstanceType<SpeechCtor> | null>(null);

  // Apply a prefill once per nonce, then put the caret at the end.
  const [appliedNonce, setAppliedNonce] = useState<number | null>(null);
  if (prefill && prefill.nonce !== appliedNonce) {
    setAppliedNonce(prefill.nonce);
    setText(prefill.text);
  }
  useEffect(() => {
    const el = ref.current;
    if (!prefill || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [prefill]);

  // Grow with the text; an empty box stays one row even if the placeholder wraps.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "";
      if (el.value) el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [text]);

  const mentionQuery = mentionable.length ? /(?:^|\s)@(\w*)$/.exec(text)?.[1] : undefined;
  const suggestions =
    mentionQuery !== undefined
      ? mentionable.filter((a) => a.name.toLowerCase().startsWith(mentionQuery.toLowerCase()))
      : [];

  const insertMention = (a: Agent) => {
    setText((t) => t.replace(/@(\w*)$/, `@${a.name} `));
    ref.current?.focus();
  };

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    onSend(value);
    setText("");
    setSent((n) => n + 1);
  };

  // False on the server and during hydration, then the real value.
  const canDictate = useSyncExternalStore(noop, () => Boolean(getSpeechCtor()), () => false);

  const toggleDictation = () => {
    const Ctor = getSpeechCtor();
    if (!Ctor) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(" ");
      setText((t) => (t ? `${t} ${said}` : said));
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const canSend = text.trim().length > 0 && !busy;

  return (
    <div className="relative">
      <AnimatePresence>
      {suggestions.length > 0 && (
        <motion.div key="mentions" {...POPOVER} className="absolute bottom-full left-3 mb-2 w-64 overflow-hidden rounded-2xl border border-line bg-white p-1 shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
          {suggestions.map((a) => (
            <button
              key={a.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertMention(a)}
              className="tap-soft group flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-bubble"
            >
              <span className="squish-group">
                <Mascot look={a.look} size={24} />
              </span>
              <span className="text-[14px]">{a.name}</span>
              <span className="truncate text-[12.5px] text-muted">{a.role}</span>
            </button>
          ))}
        </motion.div>
      )}
      </AnimatePresence>

      {menu && <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />}
      <AnimatePresence>
      {menu && (
          <motion.div key="menu" {...POPOVER} className="absolute bottom-full left-1 z-20 mb-2 w-56 rounded-2xl border border-line bg-white p-1 text-[14px] shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
            {mentionable.length > 0 && (
              <button
                type="button"
                className="tap-soft flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-bubble"
                onClick={() => {
                  setMenu(false);
                  setText((t) => (t && !t.endsWith(" ") ? `${t} @` : `${t}@`));
                  ref.current?.focus();
                }}
              >
                <AtSign className="size-4 text-muted" /> Mention an agent
              </button>
            )}
            <button
              type="button"
              className="tap-soft flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-bubble"
              onClick={() => {
                setMenu(false);
                onOpenPlan();
              }}
            >
              <ListChecks className="size-4 text-muted" /> Show the plan
            </button>
          </motion.div>
      )}
      </AnimatePresence>

      <div className="flex items-end gap-1 rounded-[28px] border border-[#e6e6e6] bg-white py-[9px] pl-2 pr-[9px] shadow-[0_6px_24px_rgba(0,0,0,0.06)] transition-[border-color,box-shadow] focus-within:border-[#cfd8fb] focus-within:shadow-[0_6px_24px_rgba(0,0,0,0.06),0_0_0_3px_rgba(65,102,235,0.12)]">
        <button
          type="button"
          aria-label="More actions"
          onClick={() => setMenu((m) => !m)}
          aria-expanded={menu}
          className={`tap grid size-[34px] shrink-0 place-items-center rounded-full text-ink hover:bg-bubble ${menu ? "bg-bubble" : ""}`}
        >
          <Plus className={`size-5 transition-transform duration-200 ${menu ? "rotate-45" : ""}`} strokeWidth={1.8} />
        </button>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (suggestions.length) insertMention(suggestions[0]);
              else submit();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="scroll-quiet h-[34px] max-h-[168px] min-w-0 flex-1 resize-none bg-transparent px-1.5 py-[7px] text-[15px] leading-[20px] outline-none placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap placeholder:text-[#b4b4b4]"
        />
        <button
          type="button"
          aria-label={canDictate ? (listening ? "Stop dictation" : "Dictate") : "Dictation isn't supported in this browser"}
          title={canDictate ? (listening ? "Stop dictation" : "Dictate") : "Dictation isn't supported in this browser"}
          onClick={toggleDictation}
          disabled={!canDictate}
          className={`tap grid size-[34px] shrink-0 place-items-center rounded-full disabled:opacity-40 ${listening ? "listening-ring bg-accent-wash text-accent" : "text-ink hover:bg-bubble"}`}
        >
          <Mic className="size-[18px]" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Send"
          onClick={submit}
          disabled={!canSend}
          className={`tap grid size-[34px] shrink-0 place-items-center overflow-hidden rounded-full text-white ${canSend ? "bg-accent hover:bg-[#3557d6] hover:shadow-[0_4px_14px_rgba(65,102,235,0.4)]" : "bg-accent-soft"}`}
        >
          {/* The arrow flies off on send and a fresh one rises in. */}
          <motion.span
            key={sent}
            className="grid place-items-center"
            initial={sent ? { y: 16, opacity: 0 } : false}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 28, delay: 0.05 }}
          >
            <ArrowUp className="size-[18px]" strokeWidth={2.2} />
          </motion.span>
        </button>
      </div>
    </div>
  );
}
