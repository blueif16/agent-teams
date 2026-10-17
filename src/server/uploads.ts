/*
 * Images the owner attaches in chat: screenshots, competitor UIs, mockups.
 *   <data>/uploads/<sha256>.<ext>   content-addressed, so the same image is stored once
 * The type comes from the file's leading bytes, never the name or the claimed MIME. Crusoe can't reach
 * localhost URLs, so imageParts() inlines stored images as base64 data: URLs for the model.
 * Server only.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 4;
/** `<sha256>.<ext>`: the only ids that are ever read, so a path can't climb out of the uploads folder. */
export const UPLOAD_ID = /^[a-f0-9]{64}\.(png|jpg|webp|gif)$/;

export interface StoredUpload {
  /** `<sha256>.<ext>` */
  id: string;
  /** Where the app shows it: `/api/uploads/<id>`. */
  url: string;
  width?: number;
  height?: number;
  /** The sniffed MIME type. */
  type: string;
  bytes: number;
}

/** An OpenAI-style content part, as the chat route and the runtime send them. */
export interface ImagePart {
  type: "image_url";
  image_url: { url: string };
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Ext = "png" | "jpg" | "webp" | "gif";
const ascii = (b: Buffer, from: number, to: number) => b.toString("latin1", from, to);
const FORMATS: { ext: Ext; type: string; is: (b: Buffer) => boolean }[] = [
  { ext: "png", type: "image/png", is: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", type: "image/jpeg", is: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", type: "image/gif", is: (b) => ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a" },
  { ext: "webp", type: "image/webp", is: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
];
const TYPE_OF = Object.fromEntries(FORMATS.map((f) => [f.ext, f.type])) as Record<Ext, string>;

// TODO: use dataDir() from src/server/paths.ts once it lands on main (another builder is adding it).
const uploadsDir = () => path.join(process.cwd(), ".data", "uploads");

/** Width and height from the file header, when it's one we can read without decoding. */
function dimensions(b: Buffer, ext: Ext): { width?: number; height?: number } {
  try {
    switch (ext) {
      case "png": // IHDR is always the first chunk.
        return ascii(b, 12, 16) === "IHDR" ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : {};
      case "gif":
        return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
      case "webp": {
        const chunk = ascii(b, 12, 16);
        if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
        if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
        if (chunk === "VP8L") {
          const bits = b.readUInt32LE(21);
          return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        return {};
      }
      case "jpg": // Walk the segments to the first start-of-frame (SOF0–SOF15, minus DHT, JPG and DAC).
        for (let i = 2; i + 9 < b.length; i += 2 + b.readUInt16BE(i + 2)) {
          if (b[i] !== 0xff) return {};
          const marker = b[i + 1];
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
          }
        }
        return {};
    }
  } catch {
    return {};
  }
}

/** Stores one image under its hash. Throws UploadError: 413 over 10 MB, 415 unless PNG, JPEG, WebP or GIF. */
export async function storeUpload(bytes: Uint8Array): Promise<StoredUpload> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadError("Images can be at most 10 MB.", 413);
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = FORMATS.find((f) => f.is(buf));
  if (!format) throw new UploadError("Only PNG, JPEG, WebP or GIF images can be attached.", 415);
  const id = `${createHash("sha256").update(buf).digest("hex")}.${format.ext}`;
  const file = path.join(uploadsDir(), id);
  if (!existsSync(file)) {
    await mkdir(uploadsDir(), { recursive: true });
    // Written beside it, then renamed, so a reader never sees half a file under the final name.
    const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, buf);
    await rename(tmp, file);
  }
  return { id, url: `/api/uploads/${id}`, ...dimensions(buf, format.ext), type: format.type, bytes: buf.byteLength };
}

/** A stored image and its type, or null for an unknown id or one that isn't `<sha256>.<ext>`. */
export async function readUpload(id: string): Promise<{ bytes: Buffer; type: string } | null> {
  const ext = UPLOAD_ID.exec(id)?.[1] as Ext | undefined;
  if (!ext) return null;
  try {
    return { bytes: await readFile(path.join(uploadsDir(), id)), type: TYPE_OF[ext] };
  } catch {
    return null;
  }
}

/**
 * The model content parts for one message's uploads, as base64 data: URLs (Crusoe can't reach this machine).
 * Throws on more than 4 ids or an id that isn't a stored upload.
 */
export async function imageParts(ids: string[]): Promise<ImagePart[]> {
  if (ids.length > MAX_IMAGES_PER_MESSAGE) throw new Error(`A message can carry at most ${MAX_IMAGES_PER_MESSAGE} images.`);
  return Promise.all(
    ids.map(async (id) => {
      const file = await readUpload(id);
      if (!file) throw new Error(`Unknown image "${String(id).slice(0, 80)}".`);
      return { type: "image_url", image_url: { url: `data:${file.type};base64,${file.bytes.toString("base64")}` } } as const;
    }),
  );
}
