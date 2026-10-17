import { readUpload } from "@/server/uploads";

/*
 * A stored chat image.
 *   GET /api/uploads/<sha256>.<png|jpg|webp|gif>
 * The id is the content's hash, so the bytes behind it never change: cached for a year, immutable.
 * Anything else is a 404, which also rules out path traversal.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const file = await readUpload((await params).id);
  if (!file) return Response.json({ error: "Not found." }, { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.type,
      "Content-Length": String(file.bytes.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
