import { readFile } from "node:fs/promises";
import path from "node:path";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 4;

export interface StoredUpload {
  id: string;
  url: string;
  width?: number;
  height?: number;
  type: string;
  bytes: number;
}

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

const uploadsDir = () => path.join(process.cwd(), ".data", "uploads");

// STUB (test-first): not implemented yet.
export async function storeUpload(bytes: Uint8Array): Promise<StoredUpload> {
  void bytes;
  throw new UploadError("Not implemented.", 501);
}

// STUB (test-first): naive, no id check.
export async function readUpload(id: string): Promise<{ bytes: Buffer; type: string } | null> {
  try {
    return { bytes: await readFile(path.join(uploadsDir(), id)), type: "image/png" };
  } catch {
    return null;
  }
}

// STUB (test-first).
export async function imageParts(ids: string[]): Promise<ImagePart[]> {
  void ids;
  return [];
}
