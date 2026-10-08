import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createFileServer } from "../src/index";
import { localDriver } from "../src/drivers/local";
import { tempDir } from "./helpers";

let dir: string;
let cleanup: () => Promise<void>;
let serve: (r: Request) => Promise<Response>;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  await mkdir(join(dir, "Belgeler"));
  await writeFile(join(dir, "Belgeler", "özet rapor.txt"), "0123456789");
  await writeFile(join(dir, ".env"), "SECRET=1");
  serve = createFileServer({ driver: localDriver({ root: dir }), prefix: "/uploads" });
});
afterEach(() => cleanup());

const get = (path: string, headers: Record<string, string> = {}) => serve(new Request(`http://x${path}`, { headers }));

it("serves files with unicode names below the prefix", async () => {
  const res = await get("/uploads/Belgeler/%C3%B6zet%20rapor.txt");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("0123456789");
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
});

it("supports ranges and downloads", async () => {
  const res = await get("/uploads/Belgeler/%C3%B6zet%20rapor.txt", { range: "bytes=2-4" });
  expect(res.status).toBe(206);
  expect(await res.text()).toBe("234");
  const dl = await get("/uploads/Belgeler/%C3%B6zet%20rapor.txt?download");
  expect(dl.headers.get("content-disposition")).toMatch(/^attachment; filename="ozet rapor.txt"|^attachment;/);
});

it("hides dot files, folders, traversal and foreign prefixes", async () => {
  for (const path of ["/uploads/.env", "/uploads/Belgeler", "/uploads/../package.json", "/uploads/%2e%2e/x", "/other/Belgeler/a", "/uploads/"]) {
    expect((await get(path)).status, path).toBe(404);
  }
});
