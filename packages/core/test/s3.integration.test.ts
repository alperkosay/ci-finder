/**
 * Runs the S3 driver against a real S3-compatible server. Skipped unless configured:
 *
 *   CI_FINDER_S3_ENDPOINT=http://127.0.0.1:7070 CI_FINDER_S3_KEY=... CI_FINDER_S3_SECRET=... npm test
 *
 * Optional: CI_FINDER_S3_REGION (default us-east-1). A fresh bucket is created per run.
 */
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { createCiFinder, type CiFinder } from "../src/index";
import { s3Driver } from "../src/drivers/s3";
import { signRequest } from "../src/drivers/sigv4";
import { sharpThumbnailer } from "../src/sharp";
import { api, bytes, id } from "./helpers";

const endpoint = process.env.CI_FINDER_S3_ENDPOINT;
const accessKeyId = process.env.CI_FINDER_S3_KEY ?? "";
const secretAccessKey = process.env.CI_FINDER_S3_SECRET ?? "";
const region = process.env.CI_FINDER_S3_REGION ?? "us-east-1";
const bucket = `ci-finder-${Date.now().toString(36)}`;
const MiB = 1024 * 1024;

describe.skipIf(!endpoint)("S3 driver against a real server", () => {
  let finder: CiFinder;
  let a: ReturnType<typeof api>;
  const ROOT = id("s3", "/");
  const driver = () => s3Driver({ bucket, endpoint, region, accessKeyId, secretAccessKey, prefix: "site/" });

  beforeAll(async () => {
    const url = new URL(`${endpoint}/${bucket}`);
    const headers = await signRequest({ method: "PUT", url, region, credentials: { accessKeyId, secretAccessKey } });
    const res = await fetch(url, { method: "PUT", headers });
    expect(res.status, await res.text()).toBe(200);
    finder = createCiFinder({ volumes: [{ id: "s3", driver: driver() }], thumbnails: { generator: sharpThumbnailer() } });
    a = api(finder);
  }, 30_000);

  it("rejects a wrong secret (signatures are really checked)", async () => {
    const bad = api(createCiFinder({ volumes: [{ id: "s3", driver: s3Driver({ bucket, endpoint, region, accessKeyId, secretAccessKey: "wrong" }) }] }));
    expect(await bad.fail("ls", { id: ROOT })).toBe("FORBIDDEN");
  });

  it("handles unicode and special characters in keys", async () => {
    const { entry: dir } = await a.ok("mkdir", { id: ROOT, name: "Özel Karakterler (1) & + %" });
    const names = ["çiçek böcek.txt", "a+b=c.txt", "yüzde %20.txt", "[köşeli] {süslü}.md"];
    for (const name of names) await a.ok("mkfile", { id: dir.id, name, content: `içerik:${name}` });
    const { entries } = await a.ok("ls", { id: dir.id });
    expect(entries.map((e: any) => e.name).sort()).toEqual([...names].sort());
    for (const e of entries) expect((await a.ok("get", { id: e.id })).content).toBe(`içerik:${e.name}`);
  });

  it("uploads an 11 MiB file as multipart and reads ranges", async () => {
    const data = bytes(11 * MiB + 321, 3);
    const entry = await a.upload(ROOT, "büyük video.mp4", data, 5 * MiB);
    expect(entry.size).toBe(data.length);
    const res = await a.get({ cmd: "file", id: entry.id });
    expect(res.status).toBe(302); // presigned redirect
    const signed = await fetch(res.headers.get("location")!, { headers: { range: "bytes=6000000-6000099" } });
    expect(signed.status).toBe(206);
    expect(Buffer.compare(Buffer.from(await signed.arrayBuffer()), Buffer.from(data.subarray(6_000_000, 6_000_100)))).toBe(0);
  }, 60_000);

  it("presigned download URLs carry the file name", async () => {
    const { entry } = await a.ok("mkfile", { id: ROOT, name: "rapor şubat.txt", content: "merhaba" });
    const res = await a.get({ cmd: "file", id: entry.id, download: "1" });
    const signed = await fetch(res.headers.get("location")!);
    expect(signed.status).toBe(200);
    expect(await signed.text()).toBe("merhaba");
    expect(signed.headers.get("content-disposition")).toContain("attachment");
  });

  it("paginates listings beyond 1000 keys", async () => {
    const { entry: dir } = await a.ok("mkdir", { id: ROOT, name: "çok" });
    const d = driver();
    const names = Array.from({ length: 1050 }, (_, i) => `f-${String(i).padStart(4, "0")}.txt`);
    for (let i = 0; i < names.length; i += 50) await Promise.all(names.slice(i, i + 50).map((n) => d.write(`/çok/${n}`, "x")));
    const { entries } = await a.ok("ls", { id: dir.id });
    expect(entries).toHaveLength(1050);
    const { entries: found } = await a.ok("search", { id: ROOT, q: "f-1049" });
    expect(found.map((e: any) => e.name)).toEqual(["f-1049.txt"]);
  }, 120_000);

  it("renames and copies folders with nested content", async () => {
    const { entry: dir } = await a.ok("mkdir", { id: ROOT, name: "kaynak" });
    const { entry: sub } = await a.ok("mkdir", { id: dir.id, name: "alt" });
    await a.ok("mkfile", { id: sub.id, name: "x.txt", content: "X" });
    const { entry: renamed } = await a.ok("rename", { id: dir.id, name: "hedef" });
    await a.ok("duplicate", { ids: [renamed.id] });
    expect((await a.ok("get", { id: id("s3", "/hedef (2)/alt/x.txt") })).content).toBe("X");
    expect(await a.fail("ls", { id: dir.id })).toBe("NOT_FOUND");
  });

  it("archives, extracts and empties folders", async () => {
    const { entry: dir } = await a.ok("mkdir", { id: ROOT, name: "arşiv" });
    await a.ok("mkfile", { id: dir.id, name: "a.md", content: "# A" });
    const { entry: zip } = await a.ok("archive", { ids: [dir.id] });
    const { entry: out } = await a.ok("extract", { id: zip.id });
    expect((await a.ok("get", { id: id("s3", `${out.path}/arşiv/a.md`) })).content).toBe("# A");
    await a.ok("rm", { ids: [out.id, zip.id], permanent: true });
    expect(await a.fail("ls", { id: out.id })).toBe("NOT_FOUND");
  });

  it("trash and thumbnails live inside the bucket", async () => {
    const img = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#2a64d6" } })
      .jpeg()
      .toBuffer();
    const entry = await a.upload(ROOT, "foto.jpg", new Uint8Array(img), 5 * MiB);
    const thumb = await a.get({ cmd: "thumb", id: entry.id, size: "256" });
    expect(thumb.headers.get("content-type")).toBe("image/webp");
    expect((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width).toBe(256);
    expect(await driver().stat("/.cf-thumbs/256")).toMatchObject({ kind: "dir" });

    const { trashed } = await a.ok("rm", { ids: [entry.id] });
    expect((await a.ok("trash")).entries.map((e: any) => e.name)).toContain("foto.jpg");
    await a.ok("restore", { ids: [trashed[0].id] });
    expect((await a.ok("info", { ids: [entry.id] })).entries[0].size).toBe(img.length);
  }, 60_000);
});
