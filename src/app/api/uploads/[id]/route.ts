import { readUpload } from "@/server/uploads";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const file = await readUpload((await params).id);
  if (!file) return Response.json({ error: "Not found." }, { status: 404 });
  return new Response(new Uint8Array(file.bytes), { headers: { "Content-Type": file.type } });
}
