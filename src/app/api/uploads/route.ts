import { storeUpload, UploadError } from "@/server/uploads";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Send one image as the `file` field." }, { status: 400 });
    return Response.json(await storeUpload(new Uint8Array(await file.arrayBuffer())), { status: 201 });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
