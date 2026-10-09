import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTheFinder, type TheFinder } from "../src/index";
import { localDriver } from "../src/drivers/local";
import { s3Driver } from "../src/drivers/s3";
import { presignUrl, signRequest } from "../src/drivers/sigv4";
import { fakeS3 } from "./fake-s3";
import { api, bytes, id, tempDir } from "./helpers";

const MiB = 1024 * 1024;

describe("SigV4 (AWS documentation test vectors)", () => {
  const credentials = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
  const date = new Date("2013-05-24T00:00:00Z");

  it("signs a GET object request", async () => {
    const headers = await signRequest({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { range: "bytes=0-9" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      region: "us-east-1",
      credentials,
      date,
    });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("presigns a URL", async () => {
    const url = await presignUrl({
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      region: "us-east-1",
      credentials,
      expiresIn: 86400,
      date,
    });
    expect(url).toContain("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });
});

describe("S3 driver (in-memory S3)", () => {
  let s3: ReturnType<typeof fakeS3>;
  let finder: TheFinder;
  let a: ReturnType<typeof api>;
  let dir: string;
  let cleanup: () => Promise<void>;
  const ROOT = id("s3", "/");

  beforeEach(async () => {
    ({ dir, cleanup } = await tempDir());
    s3 = fakeS3("bucket");
    finder = createTheFinder({
      volumes: [
        {
          id: "s3",
          driver: s3Driver({ bucket: "bucket", endpoint: "http://s3.test", accessKeyId: "k", secretAccessKey: "s", prefix: "site/", fetch: s3.fetch }),
        },
        { id: "local", driver: localDriver({ root: dir }) },
      ],
      chunkSize: 5 * MiB,
    });
    a = api(finder);
  });
  afterEach(() => cleanup());

  it("creates folders and files under the prefix", async () => {
    const { entry: folder } = await a.ok("mkdir", { id: ROOT, name: "Belgeler" });
    await a.ok("mkfile", { id: folder.id, name: "not.txt", content: "selam" });
    expect([...s3.objects.keys()].sort()).toEqual(["site/Belgeler/", "site/Belgeler/not.txt"]);

    const root = await a.ok("ls", { id: ROOT });
    expect(root.entries.map((e: any) => [e.name, e.kind])).toEqual([["Belgeler", "dir"]]);
    const inner = await a.ok("ls", { id: folder.id });
    expect(inner.entries.map((e: any) => [e.name, e.size])).toEqual([["not.txt", 5]]);
    expect((await a.ok("get", { id: inner.entries[0].id })).content).toBe("selam");
  });

  it("treats key prefixes without markers as folders", async () => {
    s3.objects.set("site/a/b/c.txt", { body: new Uint8Array(3), mtime: Date.now(), type: "" });
    const root = await a.ok("ls", { id: ROOT });
    expect(root.entries.map((e: any) => e.name)).toEqual(["a"]);
    const tree = await a.ok("tree", { id: ROOT });
    expect(tree.entries[0].hasDirs).toBe(true);
    const info = await a.ok("info", { ids: [id("s3", "/a/b")] });
    expect(info.entries[0].kind).toBe("dir");
  });

  it("uploads large files as multipart", async () => {
    const data = bytes(11 * MiB + 123);
    const entry = await a.upload(ROOT, "video.mp4", data, 5 * MiB);
    expect(entry).toMatchObject({ name: "video.mp4", size: data.length });
    expect(Buffer.compare(s3.objects.get("site/video.mp4")!.body, data)).toBe(0);
    expect(s3.uploads.size).toBe(0);
  });

  it("renames, copies and removes folders recursively", async () => {
    const { entry: folder } = await a.ok("mkdir", { id: ROOT, name: "src" });
    await a.ok("mkfile", { id: folder.id, name: "a.txt", content: "A" });
    const { entry: sub } = await a.ok("mkdir", { id: folder.id, name: "sub" });
    await a.ok("mkfile", { id: sub.id, name: "b.txt", content: "B" });

    const { entry: renamed } = await a.ok("rename", { id: folder.id, name: "lib" });
    expect([...s3.objects.keys()].sort()).toEqual(["site/lib/", "site/lib/a.txt", "site/lib/sub/", "site/lib/sub/b.txt"]);

    await a.ok("duplicate", { ids: [renamed.id] });
    expect(s3.objects.has("site/lib (2)/sub/b.txt")).toBe(true);

    await a.ok("rm", { ids: [renamed.id] });
    expect([...s3.objects.keys()].filter((k) => k.startsWith("site/lib/"))).toEqual([]);
  });

  it("searches across nested keys", async () => {
    s3.objects.set("site/2024/Fatura-Ocak.pdf", { body: new Uint8Array(1), mtime: Date.now(), type: "" });
    s3.objects.set("site/2024/fotoğraf.jpg", { body: new Uint8Array(1), mtime: Date.now(), type: "" });
    const { entries } = await a.ok("search", { id: ROOT, q: "fatura" });
    expect(entries.map((e: any) => e.path)).toEqual(["/2024/Fatura-Ocak.pdf"]);
  });

  it("archives and extracts inside the bucket", async () => {
    const { entry: folder } = await a.ok("mkdir", { id: ROOT, name: "proje" });
    await a.ok("mkfile", { id: folder.id, name: "index.html", content: "<h1>hi</h1>" });
    const { entry: zip } = await a.ok("archive", { ids: [folder.id] });
    const { entry: out } = await a.ok("extract", { id: zip.id });
    expect(out.name).toBe("proje (2)");
    expect(new TextDecoder().decode(s3.objects.get("site/proje (2)/proje/index.html")!.body)).toBe("<h1>hi</h1>");
  });

  it("copies between local disk and S3", async () => {
    await mkdir(join(dir, "foto"));
    await writeFile(join(dir, "foto", "a.jpg"), bytes(1000));
    await a.ok("paste", { ids: [id("local", "/foto")], dst: ROOT, cut: false });
    expect(s3.objects.get("site/foto/a.jpg")!.body).toEqual(bytes(1000));

    await a.ok("paste", { ids: [id("s3", "/foto")], dst: id("local", "/foto"), cut: true });
    expect(new Uint8Array(await readFile(join(dir, "foto", "foto", "a.jpg")))).toEqual(bytes(1000));
    expect([...s3.objects.keys()].some((k) => k.startsWith("site/foto"))).toBe(false);
  });

  it("redirects file requests to a presigned URL", async () => {
    await a.ok("mkfile", { id: ROOT, name: "a.txt", content: "x" });
    const res = await a.get({ cmd: "file", id: id("s3", "/a.txt"), download: "1" });
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toMatch(/^http:\/\/s3\.test\/bucket\/site\/a\.txt\?/);
    expect(location).toContain("X-Amz-Signature=");
    expect(decodeURIComponent(location)).toContain("attachment;");
  });

  it("refuses a chunk size below the S3 minimum", () => {
    expect(() =>
      createTheFinder({
        volumes: [{ id: "s3", driver: s3Driver({ bucket: "b", accessKeyId: "k", secretAccessKey: "s", fetch: s3.fetch }) }],
        chunkSize: 1024,
      }),
    ).toThrow(/5 MiB/);
  });
});
