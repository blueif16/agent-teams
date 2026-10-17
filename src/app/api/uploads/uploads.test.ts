import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { png, sha256 } from "@/server/uploads.testing";
import { GET } from "./[id]/route";
import { POST } from "./route";

let root: string;
let cwd: { mockRestore(): void };
const uploads = () => path.join(root, ".data", "uploads");
const stored = () => readdir(uploads()).catch(() => [] as string[]);

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "uploads-route-"));
  cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
});
afterEach(async () => {
  cwd.mockRestore();
  await rm(root, { recursive: true, force: true });
});

const upload = async (bytes: Uint8Array, name = "shot.png", type = "image/png") => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  const res = await POST(new Request("http://localhost/api/uploads", { method: "POST", body: form }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const get = (id: string) => GET(new Request(`http://localhost/api/uploads/${encodeURIComponent(id)}`), { params: Promise.resolve({ id }) });

describe("POST /api/uploads", () => {
  it("stores a PNG under its sha256 and returns its id, url, size and type", async () => {
    const bytes = png(3, 2);
    const id = `${sha256(bytes)}.png`;

    const { status, body } = await upload(bytes);

    expect(status).toBe(201);
    expect(body).toEqual({ id, url: `/api/uploads/${id}`, width: 3, height: 2, type: "image/png", bytes: bytes.length });
    expect(await readFile(path.join(uploads(), id))).toEqual(bytes);
  });

  it("stores the same bytes once and gives the same id both times", async () => {
    const bytes = png(4, 4, 200);

    const first = await upload(bytes, "a.png");
    const second = await upload(bytes, "copy of a.png");

    expect(first.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await stored()).toEqual([`${sha256(bytes)}.png`]);
  });

  it("refuses a text file renamed .png and sent as image/png: the bytes decide, not the name or type", async () => {
    const { status, body } = await upload(new TextEncoder().encode("just some notes, not a picture\n"), "notes.png", "image/png");

    expect(status).toBe(415);
    expect(body.error).toMatch(/png, jpeg, webp or gif/i);
    expect(await stored()).toEqual([]);
  });

  it("refuses an image over 10 MB with 413 and stores nothing", async () => {
    const big = Buffer.alloc(11 * 1024 * 1024);
    png(1, 1).copy(big);

    const { status, body } = await upload(big, "huge.png");

    expect(status).toBe(413);
    expect(body.error).toMatch(/10 MB/);
    expect(await stored()).toEqual([]);
  });
});

describe("GET /api/uploads/[id]", () => {
  it("serves a stored image with its type and an immutable cache header", async () => {
    const bytes = png(2, 2, 90);
    const { body } = await upload(bytes);

    const res = await get(String(body.id));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toMatch(/immutable/);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it("is a 404 for ../ and for any id that isn't <sha256>.<png|jpg|webp|gif>, even when such a file exists", async () => {
    const hex = "a".repeat(64);
    await mkdir(uploads(), { recursive: true });
    await writeFile(path.join(root, ".data", "secret.png"), png(1, 1));
    for (const name of ["abc.png", `${hex}.jpeg`, `${hex}.svg`, `${hex.slice(1)}.png`, `${hex.toUpperCase()}x.png`]) {
      await writeFile(path.join(uploads(), name), png(1, 1));
    }

    for (const id of ["../secret.png", "..%2Fsecret.png", "abc.png", `${hex}.jpeg`, `${hex}.svg`, `${hex.slice(1)}.png`, `${hex.toUpperCase()}x.png`, `${hex}.png`]) {
      expect((await get(id)).status, id).toBe(404);
    }
  });
});
