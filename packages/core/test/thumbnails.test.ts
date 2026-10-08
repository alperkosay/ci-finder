import { readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCiFinder, createFileServer, type CiFinder } from "../src/index";
import { localDriver } from "../src/drivers/local";
import { sharpThumbnailer } from "../src/sharp";
import { api, id, tempDir } from "./helpers";

let dir: string;
let cleanup: () => Promise<void>;
let finder: CiFinder;
let a: ReturnType<typeof api>;

const png = (w: number, h: number, color = { r: 42, g: 100, b: 214 }) =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .png()
    .toBuffer();

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  finder = createCiFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }) }], thumbnails: { generator: sharpThumbnailer() } });
  a = api(finder);
  await writeFile(join(dir, "foto.png"), await png(2000, 1000));
  await writeFile(join(dir, "küçük.png"), await png(64, 32));
  await writeFile(join(dir, "not.txt"), "metin");
});
afterEach(() => cleanup());

const thumb = (name: string, size?: number, headers: Record<string, string> = {}) =>
  a.get({ cmd: "thumb", id: id("local", `/${name}`), ...(size ? { size: String(size) } : {}) }, headers);

describe("thumbnails", () => {
  it("announces thumbnail support in init", async () => {
    const { thumbnails } = await a.ok("init");
    expect(thumbnails.sizes).toEqual([128, 256, 512]);
    expect(thumbnails.extensions).toContain("jpg");
  });

  it("generates a webp that fits the requested size", async () => {
    const res = await thumb("foto.png", 256);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 256, 128]);
  });

  it("snaps arbitrary sizes to the allowed ones and never upscales", async () => {
    const big = await sharp(Buffer.from(await (await thumb("foto.png", 3000)).arrayBuffer())).metadata();
    expect(big.width).toBe(512);
    const odd = await sharp(Buffer.from(await (await thumb("foto.png", 200)).arrayBuffer())).metadata();
    expect(odd.width).toBe(256);
    const small = await sharp(Buffer.from(await (await thumb("küçük.png", 512)).arrayBuffer())).metadata();
    expect([small.width, small.height]).toEqual([64, 32]);
  });

  it("caches thumbnails and regenerates when the source changes", async () => {
    await thumb("foto.png", 128);
    const cached = await readdir(join(dir, ".cf-thumbs", "128"));
    expect(cached).toHaveLength(1);
    const first = await thumb("foto.png", 128);
    const etag = first.headers.get("etag")!;
    expect((await thumb("foto.png", 128, { "if-none-match": etag })).status).toBe(304);

    await writeFile(join(dir, "foto.png"), await png(1000, 1000, { r: 200, g: 20, b: 20 }));
    const future = new Date(Date.now() + 5000);
    await utimes(join(dir, "foto.png"), future, future);
    const meta = await sharp(Buffer.from(await (await thumb("foto.png", 128)).arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([128, 128]);
  });

  it("falls back to the original for unsupported or broken files", async () => {
    const text = await thumb("not.txt", 128);
    expect(text.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    await writeFile(join(dir, "bozuk.jpg"), "not really a jpeg");
    const broken = await thumb("bozuk.jpg", 128);
    expect(broken.status).toBe(200);
    expect(broken.headers.get("content-type")).toBe("image/jpeg");
  });

  it("keeps the cache hidden and cleans it when a file is deleted", async () => {
    await thumb("foto.png", 128);
    expect((await a.ok("ls", { id: id("local", "/") })).entries.map((e: any) => e.name)).not.toContain(".cf-thumbs");
    expect(await a.fail("ls", { id: id("local", "/.cf-thumbs") })).toBe("NOT_FOUND");
    expect(await a.fail("mkdir", { id: id("local", "/"), name: ".cf-thumbs" })).toBe("INVALID_NAME");
    const server = createFileServer({ driver: localDriver({ root: dir }), prefix: "/u", showHidden: true });
    const [file] = await readdir(join(dir, ".cf-thumbs", "128"));
    expect((await server(new Request(`http://x/u/.cf-thumbs/128/${file}`))).status).toBe(404);

    await a.ok("rm", { ids: [id("local", "/foto.png")], permanent: true });
    expect(await readdir(join(dir, ".cf-thumbs", "128"))).toHaveLength(0);
  });

  it("serves originals when thumbnails are not configured", async () => {
    const plain = api(createCiFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }) }] }));
    expect((await plain.ok("init")).thumbnails).toBeNull();
    const res = await plain.get({ cmd: "thumb", id: id("local", "/foto.png"), size: "128" });
    expect(res.headers.get("content-type")).toBe("image/png");
  });
});
