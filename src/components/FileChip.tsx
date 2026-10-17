import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { formatBytes, textExt, textUploadName } from "@/lib/uploads";

/*
 * A text document the owner attached (.md, .txt, .csv, .json, .html): an icon, the name, the type and size.
 * The composer shows it while it uploads; your bubble shows it as a link that opens the raw file in a new tab.
 */

/** Sizes the composer learned from POST /api/uploads, so a fresh bubble needn't ask again. */
const sizes = new Map<string, number>();
export const rememberUploadSize = (id: string, bytes: number) => void sizes.set(id, bytes);

/** A text upload's size: remembered, else one HEAD request for its Content-Length. */
function useUploadSize(id: string): number | undefined {
  const [bytes, setBytes] = useState(() => sizes.get(id));
  useEffect(() => {
    if (sizes.has(id)) return;
    let live = true;
    fetch(`/api/uploads/${encodeURIComponent(id)}`, { method: "HEAD" })
      .then((r) => {
        const n = Number(r.headers.get("content-length"));
        if (!r.ok || !Number.isFinite(n)) return;
        sizes.set(id, n);
        if (live) setBytes(n);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);
  return bytes;
}

export function FileChip({ name, bytes }: { name: string; bytes?: number }) {
  const ext = textExt(name)?.toUpperCase();
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-accent-wash text-accent">
        <FileText className="size-[18px]" strokeWidth={1.8} />
      </span>
      <span className="flex min-w-0 flex-col text-left">
        <span className="truncate text-[13.5px] font-medium leading-[18px] text-ink">{name}</span>
        <span className="text-[12px] leading-[16px] text-muted">
          {ext}
          {bytes !== undefined && ` · ${formatBytes(bytes)}`}
        </span>
      </span>
    </span>
  );
}

function SentFile({ id }: { id: string }) {
  const name = textUploadName(id) ?? id;
  const bytes = useUploadSize(id);
  return (
    <a
      href={`/api/uploads/${encodeURIComponent(id)}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${name}`}
      className="lift block max-w-[260px] rounded-[16px] bg-white py-2 pl-2 pr-3.5 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_4px_14px_rgba(0,0,0,0.1)]"
    >
      <FileChip name={name} bytes={bytes} />
    </a>
  );
}

/** The text documents you sent, as chips above your bubble. */
export function SentFiles({ ids }: { ids: string[] }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {ids.map((id) => (
        <SentFile key={id} id={id} />
      ))}
    </div>
  );
}
