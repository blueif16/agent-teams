import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, AtSign, ImagePlus, ListChecks, Mic, Plus, X } from "lucide-react";
import type { Agent } from "@/lib/types";
import { Mascot } from "./Mascot";
import { POP, SPRING } from "./ui";

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

/** What POST /api/uploads accepts. The server checks the bytes; this only saves a pointless upload. */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** An image in the composer: a local preview while it uploads, then its upload id. */
interface Attachment {
  key: string;
  preview: string;
  /** Upload progress, 0 to 1. */
  progress: number;
  id?: string;
}

/** A ring that fills with upload progress, then spins while the server stores the image. */
function UploadRing({ value }: { value: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className={`size-6 -rotate-90 ${value >= 1 ? "animate-spin" : ""}`} role="img" aria-label="Uploading">
      <circle cx="12" cy="12" r={r} fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="3" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="#4166eb"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(Math.max(value, 0.08), 0.92))}
        className="transition-[stroke-dashoffset] duration-200"
      />
    </svg>
  );
}

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
  onSend: (text: string, images?: string[]) => void;
  onOpenPlan: () => void;
}) {
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const [listening, setListening] = useState(false);
  const [sent, setSent] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<InstanceType<SpeechCtor> | null>(null);
  const [atts, setAtts] = useState<Attachment[]>([]);
  const attsRef = useRef(atts);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const patch = (key: string, change: Partial<Attachment>) => setAtts((a) => a.map((x) => (x.key === key ? { ...x, ...change } : x)));
  const remove = (key: string) =>
    setAtts((a) => {
      const gone = a.find((x) => x.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return a.filter((x) => x.key !== key);
    });

  // XHR rather than fetch, for upload progress.
  const upload = (file: File, key: string) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) patch(key, { progress: e.loaded / e.total });
    };
    const fail = (why: string) => {
      remove(key);
      setNote(why);
    };
    xhr.onload = () => {
      if (xhr.status === 201 && xhr.response?.id) patch(key, { id: xhr.response.id, progress: 1 });
      else fail(xhr.response?.error ?? `Couldn't attach that image (${xhr.status}).`);
    };
    xhr.onerror = () => fail("Couldn't attach that image. Check the connection and try again.");
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  };

  const addFiles = (files: File[]) => {
    if (!files.length) return;
    const images = files.filter((f) => IMAGE_TYPES.includes(f.type));
    const small = images.filter((f) => f.size <= MAX_IMAGE_BYTES);
    const take = small.slice(0, Math.max(0, MAX_IMAGES - atts.length));
    setNote(
      images.length < files.length
        ? "Only PNG, JPEG, WebP or GIF images can be attached."
        : small.length < images.length
          ? "Images can be at most 10 MB."
          : take.length < small.length
            ? `You can attach up to ${MAX_IMAGES} images.`
            : null,
    );
    for (const file of take) {
      const key = Math.random().toString(36).slice(2, 10);
      setAtts((a) => [...a, { key, preview: URL.createObjectURL(file), progress: 0 }]);
      upload(file, key);
    }
    ref.current?.focus();
  };
  // The window's drop listener and the unmount cleanup read the latest of these.
  const addRef = useRef(addFiles);
  useEffect(() => {
    addRef.current = addFiles;
    attsRef.current = atts;
  });

  // A note fades after a few seconds.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  // Images dropped anywhere on the page attach here, so a near miss never opens the file in the tab.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes("Files"));
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (hasFiles(e) && --depth <= 0) {
        depth = 0;
        setDragging(false);
      }
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addRef.current(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      for (const a of attsRef.current) URL.revokeObjectURL(a.preview);
    };
  }, []);

  const mentionQuery = mentionable.length ? /(?:^|\s)@(\w*)$/.exec(text)?.[1] : undefined;
  const suggestions =
    mentionQuery !== undefined
      ? mentionable.filter((a) => a.name.toLowerCase().startsWith(mentionQuery.toLowerCase()))
      : [];

  const insertMention = (a: Agent) => {
    setText((t) => t.replace(/@(\w*)$/, `@${a.name} `));
    ref.current?.focus();
  };

  const uploading = atts.some((a) => !a.id);
  const ready = atts.flatMap((a) => (a.id ? [a.id] : []));
  const canSend = (text.trim().length > 0 || ready.length > 0) && !busy && !uploading;

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), ready.length ? ready : undefined);
    for (const a of atts) URL.revokeObjectURL(a.preview);
    setAtts([]);
    setNote(null);
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
            <button
              type="button"
              disabled={atts.length >= MAX_IMAGES}
              className="tap-soft flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-bubble disabled:opacity-40"
              onClick={() => {
                setMenu(false);
                fileRef.current?.click();
              }}
            >
              <ImagePlus className="size-4 text-muted" /> Add images
            </button>
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

      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        multiple
        hidden
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <AnimatePresence>
        {note && (
          <motion.p
            key={note}
            role="status"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={SPRING}
            className="mb-1.5 px-4 text-[12.5px] text-danger"
          >
            {note}
          </motion.p>
        )}
      </AnimatePresence>

      <div
        className={`rounded-[28px] border bg-white py-[9px] pl-2 pr-[9px] transition-[border-color,box-shadow] ${
          dragging
            ? "border-accent shadow-[0_6px_24px_rgba(0,0,0,0.06),0_0_0_4px_rgba(65,102,235,0.18)]"
            : "border-[#e6e6e6] shadow-[0_6px_24px_rgba(0,0,0,0.06)] focus-within:border-[#cfd8fb] focus-within:shadow-[0_6px_24px_rgba(0,0,0,0.06),0_0_0_3px_rgba(65,102,235,0.12)]"
        }`}
      >
        <AnimatePresence initial={false}>
          {atts.length > 0 && (
            <motion.div
              key="thumbs"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING}
              className="overflow-hidden"
            >
              <div className="flex gap-2.5 px-1.5 pb-2 pt-1.5">
                <AnimatePresence initial={false}>
                  {atts.map((a) => (
                    <motion.div
                      key={a.key}
                      layout
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.12 } }}
                      transition={POP}
                      className="relative size-16 shrink-0"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: preview */}
                      <img src={a.preview} alt="" className="size-full rounded-[14px] object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.08)]" />
                      {!a.id && (
                        <span className="absolute inset-0 grid place-items-center rounded-[14px] bg-white/60">
                          <UploadRing value={a.progress} />
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label="Remove image"
                        onClick={() => remove(a.key)}
                        className="tap absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-ink text-white ring-2 ring-white hover:bg-[#3a3a3a]"
                      >
                        <X className="size-3" strokeWidth={2.6} />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-end gap-1">
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
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (!files.some((f) => f.type.startsWith("image/"))) return;
              e.preventDefault();
              addFiles(files);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (suggestions.length) insertMention(suggestions[0]);
                else submit();
              }
            }}
            placeholder={dragging ? "Drop images to attach" : placeholder}
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
            aria-label={uploading ? "Send (waiting for images to upload)" : "Send"}
            title={uploading ? "Waiting for images to upload" : undefined}
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
    </div>
  );
}
