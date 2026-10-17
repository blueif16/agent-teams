"use client";

import { createContext, useContext, type ReactNode } from "react";
import { defaultRehypePlugins, defaultUrlTransform, Streamdown, type Components } from "streamdown";
import { code } from "@streamdown/code";

/*
 * Agent replies as Markdown, rendered with Streamdown so half-streamed syntax (an open **, a table
 * mid-row, an unclosed fence) still reads cleanly. Styled to sit inside a chat bubble: chat-sized
 * headings, tight lists, tables as a white card. [label](artifact:id) links open in the workspace.
 */

const OpenArtifact = createContext<((id: string) => void) | undefined>(undefined);

function Link({ href = "", children }: { href?: string; children?: ReactNode }) {
  const onOpenArtifact = useContext(OpenArtifact);
  const look = "underline decoration-1 underline-offset-[3px] transition-[color,text-underline-offset] hover:text-accent hover:underline-offset-[5px] active:opacity-70";
  if (href.startsWith("artifact:") && onOpenArtifact) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenArtifact(href.slice("artifact:".length));
        }}
        className={look}
      >
        {children}
      </button>
    );
  }
  if (/^(https?:|mailto:)/.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={look}>
        {children}
      </a>
    );
  }
  return <span className="underline decoration-1 underline-offset-[3px]">{children}</span>;
}

// Module-level so Streamdown's memoized blocks don't re-render on every streamed chunk.
const COMPONENTS: Components = {
  p: ({ children }) => <p>{children}</p>,
  h1: ({ children }) => <h3 className="text-[17px] font-semibold leading-[24px]">{children}</h3>,
  h2: ({ children }) => <h3 className="text-[16px] font-semibold leading-[23px]">{children}</h3>,
  h3: ({ children }) => <h4 className="text-[15px] font-semibold">{children}</h4>,
  h4: ({ children }) => <h4 className="text-[15px] font-semibold">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 marker:text-[#a3a3a3]">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 marker:text-[#8a8a8a] marker:tabular-nums">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 [&>ol]:mt-1 [&>ul]:mt-1">{children}</li>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-[#d6d6d6] pl-3 text-ink-2">{children}</blockquote>,
  hr: () => <hr className="border-[#e2e2e2]" />,
  a: ({ href, children }) => <Link href={href}>{children}</Link>,
  inlineCode: ({ children }) => <code className="rounded bg-black/[0.06] px-1 py-px font-mono text-[0.86em]">{children}</code>,
  table: ({ children }) => (
    <div className="scroll-quiet -mx-1 overflow-x-auto rounded-[14px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
      <table className="w-full border-collapse text-[14px] leading-[20px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tr: ({ children }) => <tr className="border-t border-line first:border-t-0 [thead_&]:border-t-0">{children}</tr>,
  th: ({ children, style }) => (
    <th style={style} className="whitespace-nowrap border-b border-line px-3 py-2 text-left text-[12.5px] font-medium text-ink-2">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="px-3 py-2 align-top tabular-nums">
      {children}
    </td>
  ),
};

const PLUGINS = { code };
const CONTROLS = { code: { copy: true, download: false }, table: false, mermaid: false } as const;
const ANIMATE = { animation: "fadeIn", duration: 220, sep: "word" } as const;

// Let the app's own artifact: links through the URL transform and the sanitizer; everything else
// keeps Streamdown's safe defaults.
const urlTransform = (url: string, key: string, node: Parameters<typeof defaultUrlTransform>[2]) =>
  url.startsWith("artifact:") ? url : defaultUrlTransform(url, key, node);

type Schema = { protocols?: Record<string, string[]> };
const [sanitize, schema] = defaultRehypePlugins.sanitize as [unknown, Schema];
const REHYPE = [
  defaultRehypePlugins.raw,
  [sanitize, { ...schema, protocols: { ...schema.protocols, href: [...(schema.protocols?.href ?? []), "artifact"] } }],
  defaultRehypePlugins.harden,
] as NonNullable<Parameters<typeof Streamdown>[0]["rehypePlugins"]>;

export function Markdown({ text, streaming = false, onOpenArtifact }: { text: string; streaming?: boolean; onOpenArtifact?: (id: string) => void }) {
  return (
    <OpenArtifact.Provider value={onOpenArtifact}>
      <Streamdown
        className="md space-y-3"
        components={COMPONENTS}
        plugins={PLUGINS}
        controls={CONTROLS}
        urlTransform={urlTransform}
        rehypePlugins={REHYPE}
        lineNumbers={false}
        codeBlockMaxHeight={360}
        animated={ANIMATE}
        isAnimating={streaming}
      >
        {text}
      </Streamdown>
    </OpenArtifact.Provider>
  );
}
