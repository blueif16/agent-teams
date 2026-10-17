import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imageParts, storeUpload } from "./uploads";
import { png } from "./uploads.testing";

let root: string;
let cwd: { mockRestore(): void };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "uploads-"));
  cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
});
afterEach(async () => {
  cwd.mockRestore();
  await rm(root, { recursive: true, force: true });
});

describe("imageParts()", () => {
  it("turns a stored id into an image_url part holding a data:image/png;base64 URL of its bytes", async () => {
    const bytes = png(5, 3, 40);
    const { id } = await storeUpload(bytes);

    expect(await imageParts([id])).toEqual([{ type: "image_url", image_url: { url: `data:image/png;base64,${bytes.toString("base64")}` } }]);
  });

  it("refuses more than 4 images for one message", async () => {
    const ids = [];
    for (let shade = 0; shade < 5; shade++) ids.push((await storeUpload(png(2, 2, shade * 40))).id);

    await expect(imageParts(ids.slice(0, 4))).resolves.toHaveLength(4);
    await expect(imageParts(ids)).rejects.toThrow(/at most 4/i);
  });

  it("refuses an id that isn't a stored upload", async () => {
    await expect(imageParts([`${"b".repeat(64)}.png`])).rejects.toThrow(/unknown image/i);
    await expect(imageParts(["../ledger.jsonl"])).rejects.toThrow(/unknown image/i);
  });
});
