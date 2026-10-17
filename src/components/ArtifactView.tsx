import { Check, Circle, Clapperboard, FolderOpen, Image as ImageIcon, LayoutTemplate, Blocks, Mic, SquarePlus, WandSparkles, Speaker } from "lucide-react";
import { AGENTS } from "@/lib/data";
import type { Artifact } from "@/lib/types";
import { Mascot } from "./Mascot";
import { SlideVariant } from "./SlideArt";

const TOOLS = [
  { label: "Slide", Icon: SquarePlus },
  { label: "Image", Icon: WandSparkles },
  { label: "Templates", Icon: LayoutTemplate },
  { label: "Blocks", Icon: Blocks },
  { label: "Media", Icon: ImageIcon },
  { label: "Uploads", Icon: FolderOpen },
  { label: "Record", Icon: Mic },
  { label: "Speaker", Icon: Speaker },
  { label: "Transform", Icon: Clapperboard },
];

function Byline({ artifact }: { artifact: Artifact }) {
  const agent = AGENTS[artifact.agentId];
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-muted">
      <Mascot look={agent.look} size={18} />
      <span>
        {agent.name} updated this at {artifact.updated}
      </span>
    </div>
  );
}

export function ArtifactView({
  artifact,
  onSendTo,
}: {
  artifact: Artifact;
  onSendTo: (agentId: string, text: string) => void;
}) {
  const b = artifact.body;

  if (b.kind === "slides") {
    return (
      <div className="flex min-h-full">
        <div className="min-w-0 flex-1">
          <div className="ruler relative mx-3 mt-1 h-5 text-[9px] text-[#6f6f6f]">
            {Array.from({ length: 13 }, (_, i) => (
              <span key={i} className="absolute top-0" style={{ left: `${(i + 1) * 40 - 2}px` }}>
                {i + 1}
              </span>
            ))}
          </div>
          <div className="flex flex-col items-center px-5 pb-8 pt-[12vh]" style={{ containerType: "inline-size" }}>
            <div
              className="aspect-[16/8.4] w-full max-w-[640px] border border-[#e6e2d9] bg-paper px-[3.2%] pb-[3%] pt-[2.4%]"
              style={{ fontSize: "min(3.3cqw, 21px)" }}
            >
              <div className="text-[0.82em] text-cobalt">{b.section}</div>
              <div className="mt-[0.9em] grid h-[78%] grid-cols-2 gap-[1.2em]">
                {b.variants.map((v, i) => (
                  <div key={v.label} className={i > 0 ? "border-l border-[#e6e2d9] pl-[1.2em]" : ""}>
                    <SlideVariant {...v} emphasis={i === 1} />
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {b.variants.map((v) => (
                <button
                  key={v.label}
                  type="button"
                  onClick={() => onSendTo(artifact.agentId, `Go with ${v.label} for slide 5: “${v.title}”`)}
                  className="tap rounded-full bg-white px-3.5 py-1.5 text-[13.5px] shadow-[0_0_0_1px_#e2e2e2] hover:bg-accent-wash hover:text-accent hover:shadow-[0_0_0_1px_rgba(65,102,235,0.35)]"
                >
                  Use {v.label}
                </button>
              ))}
            </div>
            <div className="mt-4">
              <Byline artifact={artifact} />
            </div>
          </div>
        </div>
        <div className="hidden w-[64px] shrink-0 flex-col items-center gap-3.5 pt-[22vh] sm:flex" aria-hidden>
          {TOOLS.map(({ label, Icon }) => (
            <div key={label} className="flex flex-col items-center gap-0.5 text-[10.5px] text-[#4a4a4a]">
              <Icon className="size-[15px]" strokeWidth={1.6} />
              {label}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (b.kind === "doc") {
    return (
      <div className="px-4 py-8 sm:px-8">
        <article className="mx-auto max-w-[600px] rounded-sm bg-white px-8 py-10 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.04)] sm:px-12">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em]">{b.heading}</h1>
          {b.sections.map((s, i) => (
            <section key={i} className="mt-5">
              {s.heading && <h2 className="mb-1.5 text-[15px] font-semibold">{s.heading}</h2>}
              <p className="whitespace-pre-line text-[14.5px] leading-[23px] text-[#2b2b2b]">{s.body}</p>
            </section>
          ))}
        </article>
        <div className="mx-auto mt-4 max-w-[600px]">
          <Byline artifact={artifact} />
        </div>
      </div>
    );
  }

  if (b.kind === "sheet") {
    const letters = b.columns.map((_, i) => String.fromCharCode(65 + i));
    return (
      <div className="p-4 sm:p-6">
        <div className="overflow-x-auto rounded-lg bg-white shadow-[0_0_0_1px_#e3e3e3]">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-[#f6f7f8] text-[11px] text-muted">
                <th className="w-9 border-b border-r border-[#e3e3e3]" />
                {letters.map((l) => (
                  <th key={l} className="border-b border-r border-[#e3e3e3] py-1 font-normal last:border-r-0">
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-b border-r border-[#e3e3e3] bg-[#f6f7f8] text-center text-[11px] text-muted">1</td>
                {b.columns.map((c) => (
                  <td key={c} className="border-b border-r border-[#e3e3e3] px-2.5 py-1.5 font-semibold last:border-r-0">
                    {c}
                  </td>
                ))}
              </tr>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  <td className="border-b border-r border-[#e3e3e3] bg-[#f6f7f8] text-center text-[11px] text-muted">{i + 2}</td>
                  {r.map((cell, j) => (
                    <td
                      key={j}
                      className={`border-b border-r border-[#e3e3e3] px-2.5 py-1.5 last:border-r-0 ${j > 0 ? "tabular-nums" : ""}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {b.note && <p className="mt-3 text-[13.5px] leading-[20px] text-ink-2">{b.note}</p>}
        <div className="mt-4">
          <Byline artifact={artifact} />
        </div>
      </div>
    );
  }

  if (b.kind === "code") {
    return (
      <div className="p-4 sm:p-6">
        <h1 className="text-[17px] font-semibold leading-snug">{artifact.title}</h1>
        <ul className="mt-3 flex flex-col gap-1.5">
          {b.checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-[13.5px]">
              {c.ok ? (
                <span className="grid size-4 place-items-center rounded-full bg-mint text-white">
                  <Check className="size-3" strokeWidth={3} />
                </span>
              ) : (
                <Circle className="size-4 text-amber" strokeWidth={2.2} />
              )}
              {c.label}
            </li>
          ))}
        </ul>
        <div className="mt-5 overflow-hidden rounded-lg bg-white shadow-[0_0_0_1px_#e3e3e3]">
          <div className="border-b border-[#e3e3e3] bg-[#f6f7f8] px-3 py-2 font-mono text-[12px] text-ink-2">{b.file}</div>
          <pre className="overflow-x-auto py-1 font-mono text-[12.5px] leading-[20px]">
            {b.lines.map((l, i) => (
              <div
                key={i}
                className={`px-3 ${
                  l.type === "add"
                    ? "bg-[#e9f7ee] text-[#14532d]"
                    : l.type === "del"
                      ? "bg-[#fdecec] text-[#7f1d1d]"
                      : l.type === "meta"
                        ? "bg-[#f1f4fb] text-[#5b6b8c]"
                        : ""
                }`}
              >
                <span className="inline-block w-4 select-none opacity-60">
                  {l.type === "add" ? "+" : l.type === "del" ? "−" : ""}
                </span>
                {l.text}
              </div>
            ))}
          </pre>
        </div>
        <div className="mt-4">
          <Byline artifact={artifact} />
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-[600px]">
        <h1 className="text-[24px] font-semibold tracking-[-0.01em]">{b.heading}</h1>
        <div className="mt-5 flex flex-col gap-3">
          {b.items.map((it) => (
            <div key={it.title} className="rounded-xl bg-white px-4 py-3.5 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
              <div className="text-[15px] font-medium">{it.title}</div>
              <div className="mt-1 text-[14px] leading-[21px] text-ink-2">{it.body}</div>
            </div>
          ))}
        </div>
        <div className="mt-5">
          <Byline artifact={artifact} />
        </div>
      </div>
    </div>
  );
}
