import { readUpload } from "@/server/uploads";

/*
 * A stored chat upload.
 *   GET /api/uploads/<sha256>.<png|jpg|webp|gif>   an image, with its type
 *   GET /api/uploads/<sha256>-<name>               a text document, always as text/plain, so it opens as its source
 *                                                  (an attached .html never runs on the app's origin)
 * The id holds the content's hash, so the bytes behind it never change: cached for a year, immutable.
 * Anything else is a 404, which also rules out path traversal.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const file = await readUpload((await params).id);
  if (!file) return Response.json({ error: "Not found." }, { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.name ? "text/plain; charset=utf-8" : file.type,
      "Content-Length": String(file.bytes.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
