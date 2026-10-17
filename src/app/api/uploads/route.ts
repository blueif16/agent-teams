import { MAX_UPLOAD_BYTES, storeUpload, UploadError } from "@/server/uploads";

/*
 * An image the owner attaches in chat.
 *   POST /api/uploads   multipart, one image as `file`  →  201 { id, url, width?, height?, type, bytes }
 * PNG, JPEG, WebP or GIF by their bytes (415 otherwise), at most 10 MB (413). See src/server/uploads.ts.
 */
const tooBig = () => Response.json({ error: "Images can be at most 10 MB." }, { status: 413 });

export async function POST(req: Request) {
  // Refuse an oversized body before parsing it; the multipart envelope adds a little over the file.
  if (Number(req.headers.get("content-length")) > MAX_UPLOAD_BYTES + 64 * 1024) return tooBig();
  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return Response.json({ error: "Send the image as multipart form data." }, { status: 400 });
  }
  if (!(file instanceof File)) return Response.json({ error: "Send one image as the `file` field." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return tooBig();
  try {
    return Response.json(await storeUpload(new Uint8Array(await file.arrayBuffer())), { status: 201 });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
