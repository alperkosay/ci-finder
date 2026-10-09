import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTheFinder, type TheFinder } from "../src/index";
import { localDriver } from "../src/drivers/local";
import { sharpImages } from "../src/sharp";
import { api, id, tempDir } from "./helpers";

let dir: string;
let cleanup: () => Promise<void>;
let finder: TheFinder;
let a: ReturnType<typeof api>;

/** A noisy photo-like PNG: compresses badly, so every conversion makes it smaller. */
async function photo(w: number, h: number): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  let x = 7;
  for (let i = 0; i < raw.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = (i % 3 === 0 ? (i / 3) % w : 0) + (x & 0x3f);
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}

const meta = async (name: string) => sharp(await readFile(join(dir, name))).metadata();

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  finder = createTheFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }) }], images: sharpImages() });
  a = api(finder);
  await writeFile(join(dir, "foto.png"), await photo(1600, 900));
  await writeFile(
    join(dir, "foto.jpg"),
    await sharp(await photo(1200, 800))
      .jpeg({ quality: 95 })
      .toBuffer(),
  );
  await writeFile(join(dir, "not.txt"), "metin");
});
afterEach(() => cleanup());

describe("bulk image processing", () => {
  it("announces the processor in init", async () => {
    const { images } = await a.ok("init");
    expect(images.formats).toEqual(["jpeg", "png", "webp", "avif", "gif"]);
    expect(images.extensions).toContain("png");
  });

  it("converts to webp next to the original, which is kept", async () => {
    const { results } = await a.ok("transform", { ids: [id("local", "/foto.png")], format: "webp", quality: 70 });
    expect(results[0]).toMatchObject({ name: "foto.png", created: true, width: 1600, height: 900 });
    expect(results[0].entry.name).toBe("foto.webp");
    expect(results[0].after).toBeLessThan(results[0].before);
    expect((await meta("foto.webp")).format).toBe("webp");
    expect((await meta("foto.png")).format).toBe("png");
  });

  it("reports the outcome without writing anything on a dry run", async () => {
    const before = await readdir(dir);
    const { results } = await a.ok("transform", { ids: [id("local", "/foto.png"), id("local", "/foto.jpg")], format: "webp", width: 800, dryRun: true });
    expect(results[0]).toMatchObject({ name: "foto.png", width: 800, height: 450 });
    expect(results[0].after).toBeLessThan(results[0].before);
    expect(results[0].entry).toBeUndefined();
    expect(results[1]).toMatchObject({ name: "foto.jpg", width: 800 });
    expect(await readdir(dir)).toEqual(before);
    expect((await a.ok("versions", { id: id("local", "/foto.png") })).versions).toHaveLength(0);
  });

  it("numbers or replaces an existing converted file", async () => {
    await a.ok("transform", { ids: [id("local", "/foto.png")], format: "webp" });
    const again = await a.ok("transform", { ids: [id("local", "/foto.png")], format: "webp" });
    expect(again.results[0].entry.name).toBe("foto (2).webp");
    const replace = await a.ok("transform", { ids: [id("local", "/foto.png")], format: "webp", conflict: "overwrite", quality: 40 });
    expect(replace.results[0]).toMatchObject({ created: false, entry: { name: "foto.webp" } });
    expect((await a.ok("versions", { id: id("local", "/foto.webp") })).versions).toHaveLength(1);
  });

  it("resizes and recompresses in place, keeping the original in the history", async () => {
    const before = (await readFile(join(dir, "foto.jpg"))).length;
    const { results } = await a.ok("transform", { ids: [id("local", "/foto.jpg")], width: 600, height: 600, quality: 60 });
    expect(results[0]).toMatchObject({ created: false, width: 600, height: 400 });
    expect(await meta("foto.jpg")).toMatchObject({ format: "jpeg", width: 600, height: 400 });
    const { versions } = await a.ok("versions", { id: id("local", "/foto.jpg") });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ size: before, reason: "optimize" });
  });

  it("saves a copy instead when asked", async () => {
    const { results } = await a.ok("transform", { ids: [id("local", "/foto.jpg")], width: 300, output: "copy" });
    expect(results[0].entry.name).toBe("foto-optimized.jpg");
    expect((await meta("foto.jpg")).width).toBe(1200);
    expect((await meta("foto-optimized.jpg")).width).toBe(300);
  });

  it("skips results that are not smaller, and never upscales", async () => {
    const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    await writeFile(join(dir, "ikon.png"), tiny);
    const { results } = await a.ok("transform", { ids: [id("local", "/ikon.png")], width: 4000, format: "keep", quality: 100 });
    expect(results[0]).toMatchObject({ skipped: "larger", width: 8, height: 8 });
    expect(await readdir(dir)).not.toContain(".tf-versions");
  });

  it("reports each file separately", async () => {
    await writeFile(join(dir, "bozuk.png"), "not a png");
    const { results } = await a.ok("transform", {
      ids: [id("local", "/not.txt"), id("local", "/bozuk.png"), id("local", "/yok.png"), id("local", "/foto.png")],
      format: "webp",
    });
    expect(results.map((r: any) => r.skipped ?? r.error ?? r.entry.name)).toEqual(["unsupported", "INVALID_IMAGE", "NOT_FOUND", "foto.webp"]);
  });

  it("flattens transparency onto white for JPEG", async () => {
    const alpha = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    await writeFile(join(dir, "seffaf.png"), alpha);
    await a.ok("transform", { ids: [id("local", "/seffaf.png")], format: "jpeg", skipLarger: false });
    const { data } = await sharp(await readFile(join(dir, "seffaf.jpg")))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
  });

  it("is refused when no processor is configured or the user is read-only", async () => {
    const plain = createTheFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }) }] });
    expect(await api(plain).fail("transform", { ids: [id("local", "/foto.png")], format: "webp" })).toBe("UNSUPPORTED");
    expect((await api(plain).ok("init")).images).toBeNull();
    const viewer = createTheFinder({
      volumes: [{ id: "local", driver: localDriver({ root: dir }) }],
      images: sharpImages(),
      authorize: () => ({ readOnly: true }),
    });
    const { results } = await api(viewer).ok("transform", { ids: [id("local", "/foto.png")], format: "webp" });
    expect(results[0].error).toBe("READ_ONLY");
    expect(await a.fail("transform", { ids: [id("local", "/foto.png")], format: "bmp" })).toBe("BAD_REQUEST");
  });
});
