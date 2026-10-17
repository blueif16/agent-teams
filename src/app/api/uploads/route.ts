import { MAX_UPLOAD_BYTES, storeUpload, UploadError } from "@/server/uploads";

/*
 * A file the owner attaches in chat.
 *   POST /api/uploads   multipart, one file as `file`  →  201 { id, url, name?, width?, height?, type, bytes }
 * PNG, JPEG, WebP or GIF by their bytes, at most 10 MB; or a UTF-8 text document named .md, .txt, .csv, .json or
 * .html, at most 2 MB (413 over the cap, 400 for a text name on bytes that aren't text, 415 for anything else).
 * See src/server/uploads.ts.
 */
const tooBig = () => Response.json({ error: "Images can be at most 10 MB, text files 2 MB." }, { status: 413 });

export async function POST(req: Request) {
  // Refuse an oversized body before parsing it; the multipart envelope adds a little over the file.
  if (Number(req.headers.get("content-length")) > MAX_UPLOAD_BYTES + 64 * 1024) return tooBig();
  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return Response.json({ error: "Send the file as multipart form data." }, { status: 400 });
  }
  if (!(file instanceof File)) return Response.json({ error: "Send one file as the `file` field." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return tooBig();
  try {
    return Response.json(await storeUpload(new Uint8Array(await file.arrayBuffer()), file.name), { status: 201 });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
