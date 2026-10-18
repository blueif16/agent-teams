/*
 * What an upload id says, shared by the server (src/server/uploads.ts), the composer and the bubbles. No I/O.
 *   <sha256>.<png|jpg|webp|gif>              an image, content-addressed
 *   <sha256>-<name>.<md|txt|csv|json|html>   a text document: its bytes' hash and its cleaned file name
 * Neither form has a slash, so an id can never climb out of the uploads folder.
 */

/** The text documents that can be attached, by extension. */
export const TEXT_TYPES = { md: "text/markdown", txt: "text/plain", csv: "text/csv", json: "application/json", html: "text/html" } as const;
export type TextExt = keyof typeof TEXT_TYPES;
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export const IMAGE_ID = /^[a-f0-9]{64}\.(png|jpg|webp|gif)$/;
const TEXT_ID = /^[a-f0-9]{64}-([A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(md|txt|csv|json|html))$/;

export const isImageUpload = (id: string) => IMAGE_ID.test(id);

/** A text upload's file name, or null when the id isn't a text upload. */
export const textUploadName = (id: string): string | null => TEXT_ID.exec(id)?.[1] ?? null;
export const isTextUpload = (id: string) => TEXT_ID.test(id);

/** What the composer's file picker offers. The server checks the bytes; this only saves a pointless upload. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const ACCEPT = [...IMAGE_TYPES, ...Object.keys(TEXT_TYPES).map((e) => `.${e}`)].join(",");

/** The text extension of a file name ("Spec.MD" → "md"), or null when it isn't one we take. */
export function textExt(name: string): TextExt | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1].toLowerCase();
  return ext && ext in TEXT_TYPES ? (ext as TextExt) : null;
}

/** A file name safe for an id and a folder: letters, digits, `.`, `_` and `-` ("Q3 facts (v2).MD" → "Q3-facts-v2-.md"). */
export function cleanFileName(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? "";
  const ext = textExt(base);
  if (!ext) return null;
  const stem = base
    .slice(0, -(ext.length + 1))
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+/, "")
    .slice(0, 80);
  return `${stem || "file"}.${ext}`;
}

/** 1536 → "1.5 KB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
