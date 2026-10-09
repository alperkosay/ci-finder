import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTheFinder, readZipEntries, openZipEntry, type TheFinder } from "../src/index";
import { localDriver } from "../src/drivers/local";
import { api, bytes, id, streamToBytes, tempDir } from "./helpers";

let dir: string;
let cleanup: () => Promise<void>;
let finder: TheFinder;
let a: ReturnType<typeof api>;
const ROOT = id("local", "/");

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  finder = createTheFinder({
    volumes: [{ id: "local", name: "Files", driver: localDriver({ root: dir }), url: "/uploads" }],
    chunkSize: 1024,
  });
  a = api(finder);
});
afterEach(() => cleanup());

describe("navigation", () => {
  it("init describes volumes", async () => {
    const data = await a.ok("init");
    expect(data.volumes).toHaveLength(1);
    expect(data.volumes[0].root).toMatchObject({ id: ROOT, name: "Files", kind: "dir", locked: true });
    expect(data.chunkSize).toBe(1024);
  });

  it("lists folders and files, hides dot files", async () => {
    await mkdir(join(dir, "docs"));
    await writeFile(join(dir, "a.txt"), "hello");
    await writeFile(join(dir, ".secret"), "x");
    const { cwd, entries } = await a.ok("ls", { id: ROOT });
    expect(cwd.id).toBe(ROOT);
    const names = entries.map((e: any) => e.name).sort();
    expect(names).toEqual(["a.txt", "docs"]);
    const file = entries.find((e: any) => e.name === "a.txt");
    expect(file).toMatchObject({ kind: "file", size: 5, mime: "text/plain", url: "/uploads/a.txt", parent: ROOT });
  });

  it("refuses hidden paths and traversal ids", async () => {
    await writeFile(join(dir, ".secret"), "x");
    expect(await a.fail("info", { ids: [id("local", "/.secret")] })).toBe("NOT_FOUND");
    expect(await a.fail("ls", { id: id("local", "/../") })).toBe("BAD_REQUEST");
    expect(await a.fail("ls", { id: "nope_Lw" })).toBe("NOT_FOUND");
  });

  it("tree reports sub-folders", async () => {
    await mkdir(join(dir, "a", "b"), { recursive: true });
    await mkdir(join(dir, "c"));
    const { entries } = await a.ok("tree", { id: ROOT });
    const byName = Object.fromEntries(entries.map((e: any) => [e.name, e.hasDirs]));
    expect(byName).toEqual({ a: true, c: false });
  });

  it("parents returns the chain from the root", async () => {
    await mkdir(join(dir, "a", "b"), { recursive: true });
    const { entries } = await a.ok("parents", { id: id("local", "/a/b") });
    expect(entries.map((e: any) => e.path)).toEqual(["/", "/a", "/a/b"]);
  });

  it("search folds case, accents and Turkish i", async () => {
    await mkdir(join(dir, "Belgeler"));
    await writeFile(join(dir, "Belgeler", "Çiçek Listesi.txt"), "");
    await writeFile(join(dir, "IŞIK.md"), "");
    expect((await a.ok("search", { id: ROOT, q: "cicek" })).entries.map((e: any) => e.name)).toEqual(["Çiçek Listesi.txt"]);
    expect((await a.ok("search", { id: ROOT, q: "ışık" })).entries.map((e: any) => e.name)).toEqual(["IŞIK.md"]);
  });

  it("size sums folders recursively", async () => {
    await mkdir(join(dir, "a", "b"), { recursive: true });
    await writeFile(join(dir, "a", "1.bin"), bytes(100));
    await writeFile(join(dir, "a", "b", "2.bin"), bytes(50));
    expect(await a.ok("size", { ids: [id("local", "/a")] })).toEqual({ size: 150, files: 2, dirs: 1 });
  });
});

describe("modification", () => {
  it("mkdir / mkfile / rename", async () => {
    const { entry: folder } = await a.ok("mkdir", { id: ROOT, name: "Yeni klasör" });
    expect(folder.path).toBe("/Yeni klasör");
    expect(await a.fail("mkdir", { id: ROOT, name: "Yeni klasör" })).toBe("EXISTS");

    const { entry: file } = await a.ok("mkfile", { id: folder.id, name: "not.txt" });
    const { entry: renamed } = await a.ok("rename", { id: file.id, name: "notlar.md" });
    expect(renamed.path).toBe("/Yeni klasör/notlar.md");
    expect(renamed.mime).toBe("text/markdown");

    // case-only rename works on case-insensitive file systems too
    const { entry: upper } = await a.ok("rename", { id: renamed.id, name: "NOTLAR.md" });
    expect(upper.name).toBe("NOTLAR.md");
  });

  it("validates names", async () => {
    for (const name of ["", "a/b", "..", "con", "x:y", "trailing.", " lead"]) {
      expect(await a.fail("mkdir", { id: ROOT, name })).toBe("INVALID_NAME");
    }
  });

  it("protects the root", async () => {
    expect(await a.fail("rm", { ids: [ROOT] })).toBe("LOCKED");
    expect(await a.fail("rename", { id: ROOT, name: "x" })).toBe("LOCKED");
  });

  it("duplicate picks numbered names", async () => {
    await writeFile(join(dir, "rapor.pdf"), "x");
    const { added } = await a.ok("duplicate", { ids: [id("local", "/rapor.pdf"), id("local", "/rapor.pdf")] });
    expect(added.map((e: any) => e.name)).toEqual(["rapor (2).pdf", "rapor (3).pdf"]);
  });

  it("paste copies, moves and resolves conflicts", async () => {
    await mkdir(join(dir, "src", "inner"), { recursive: true });
    await mkdir(join(dir, "dst"));
    await writeFile(join(dir, "src", "inner", "f.txt"), "data");
    await writeFile(join(dir, "dst", "src"), "conflict");

    const copy = await a.ok("paste", { ids: [id("local", "/src")], dst: id("local", "/dst"), cut: false });
    expect(copy.added[0].name).toBe("src (2)");
    expect(await readFile(join(dir, "dst", "src (2)", "inner", "f.txt"), "utf8")).toBe("data");

    const skipped = await a.ok("paste", { ids: [id("local", "/src")], dst: id("local", "/dst"), cut: false, conflict: "skip" });
    expect(skipped.skipped).toHaveLength(1);

    const move = await a.ok("paste", { ids: [id("local", "/src")], dst: id("local", "/dst/src (2)"), cut: true });
    expect(move.removed).toEqual([id("local", "/src")]);
    expect(await a.fail("info", { ids: [id("local", "/src")] })).toBe("NOT_FOUND");

    expect(await a.fail("paste", { ids: [id("local", "/dst")], dst: id("local", "/dst/src (2)"), cut: true })).toBe("MOVE_INTO_ITSELF");
  });

  it("rm deletes files and folders", async () => {
    await mkdir(join(dir, "a", "b"), { recursive: true });
    await writeFile(join(dir, "x.txt"), "");
    const { removed } = await a.ok("rm", { ids: [id("local", "/a"), id("local", "/x.txt")] });
    expect(removed).toHaveLength(2);
    expect((await a.ok("ls", { id: ROOT })).entries).toHaveLength(0);
  });

  it("get / put text content", async () => {
    await writeFile(join(dir, "a.txt"), "﻿merhaba");
    const got = await a.ok("get", { id: id("local", "/a.txt") });
    expect(got).toMatchObject({ content: "merhaba", bom: true });
    await a.ok("put", { id: id("local", "/a.txt"), content: "güncel" });
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("güncel");

    await writeFile(join(dir, "bin.dat"), new Uint8Array([0xff, 0xfe, 0x00, 0x80]));
    expect(await a.fail("get", { id: id("local", "/bin.dat") })).toBe("UNSUPPORTED");
  });
});

describe("upload", () => {
  it("assembles chunks and resolves name conflicts", async () => {
    const data = bytes(2500);
    const entry = await a.upload(ROOT, "photo.jpg", data, 1024);
    expect(entry).toMatchObject({ name: "photo.jpg", size: 2500 });
    expect(new Uint8Array(await readFile(join(dir, "photo.jpg")))).toEqual(data);

    const second = await a.upload(ROOT, "photo.jpg", bytes(10), 1024);
    expect(second.name).toBe("photo (2).jpg");

    const over = await a.upload(ROOT, "photo.jpg", bytes(10, 7), 1024, { conflict: "overwrite" });
    expect(over.name).toBe("photo.jpg");
    expect(over.size).toBe(10);

    // no temp files left behind
    const { entries } = await a.ok("ls", { id: ROOT });
    expect(entries.map((e: any) => e.name).sort()).toEqual(["photo (2).jpg", "photo.jpg"]);
  });

  it("recreates folders for folder uploads", async () => {
    const entry = await a.upload(ROOT, "a.txt", bytes(5), 1024, { relativePath: "Tatil/2024" });
    expect(entry.path).toBe("/Tatil/2024/a.txt");
  });

  it("rejects bad chunks and denied extensions", async () => {
    const f = createTheFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }), denyExtensions: ["php"], maxUploadSize: 100 }], chunkSize: 1024 });
    const b = api(f);
    await expect(b.upload(ROOT, "shell.php", bytes(5), 1024)).rejects.toThrow(/EXTENSION_DENIED/);
    await expect(b.upload(ROOT, "big.bin", bytes(500), 1024)).rejects.toThrow(/TOO_LARGE/);
    await expect(b.upload(ROOT, "chunk.bin", bytes(50), 10_000)).resolves.toBeTruthy();
    await expect(a.upload(ROOT, "huge-chunk.bin", bytes(3000), 3000)).rejects.toThrow(/TOO_LARGE/);
  });

  it("rejects a tampered session that points outside the destination", async () => {
    await mkdir(join(dir, "inbox"));
    const form = new FormData();
    const session = btoa(JSON.stringify({ p: "/elsewhere.txt", s: ".x.tf-upload" })).replace(/=+$/, "");
    for (const [k, v] of Object.entries({ cmd: "upload", dst: id("local", "/inbox"), name: "a.txt", size: "4", index: "1", total: "2", offset: "2", session }))
      form.set(k, v);
    form.set("chunk", new Blob([new Uint8Array(2)]));
    const res = await finder.handler(new Request("http://localhost/", { method: "POST", headers: { "x-thefinder": "1" }, body: form }));
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });
});

describe("security", () => {
  it("requires the CSRF header on POST", async () => {
    const r = await a.post("mkdir", { id: ROOT, name: "x" }, {});
    expect(r.status).toBe(403);
  });

  it("rejects mutations over GET", async () => {
    const res = await a.get({ cmd: "rm", ids: ROOT });
    expect(res.status).toBe(400);
  });

  it("read-only volumes reject writes", async () => {
    const f = createTheFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }), readOnly: true }] });
    expect(await api(f).fail("mkdir", { id: ROOT, name: "x" })).toBe("READ_ONLY");
  });

  it("authorize hook can block commands", async () => {
    const f = createTheFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }) }], authorize: ({ cmd }) => cmd !== "rm" });
    await writeFile(join(dir, "a.txt"), "");
    expect(await api(f).fail("rm", { ids: [id("local", "/a.txt")] })).toBe("FORBIDDEN");
  });

  it("hides symlinks that escape the root", async () => {
    const outside = await tempDir();
    await writeFile(join(outside.dir, "passwd"), "secret");
    try {
      await symlink(outside.dir, join(dir, "escape"), "junction");
    } catch {
      await outside.cleanup();
      return; // symlinks not permitted on this machine
    }
    const { entries } = await a.ok("ls", { id: ROOT });
    expect(entries.map((e: any) => e.name)).not.toContain("escape");
    expect(await a.fail("ls", { id: id("local", "/escape") })).toMatch(/NOT_FOUND|FORBIDDEN/);
    expect(await a.fail("get", { id: id("local", "/escape/passwd") })).toMatch(/NOT_FOUND|FORBIDDEN/);
    await outside.cleanup();
  });
});

describe("serving", () => {
  it("serves ranges, ETags and sandboxes active content", async () => {
    await writeFile(join(dir, "v.mp4"), bytes(1000));
    await writeFile(join(dir, "x.svg"), "<svg/>");
    const fileId = id("local", "/v.mp4");

    const full = await a.get({ cmd: "file", id: fileId });
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/mp4");
    expect(full.headers.get("content-length")).toBe("1000");
    const etag = full.headers.get("etag")!;

    const partial = await a.get({ cmd: "file", id: fileId }, { range: "bytes=100-199" });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(bytes(1000).slice(100, 200));

    expect((await a.get({ cmd: "file", id: fileId }, { "if-none-match": etag })).status).toBe(304);
    expect((await a.get({ cmd: "file", id: fileId }, { range: "bytes=5000-" })).status).toBe(416);

    const svg = await a.get({ cmd: "file", id: id("local", "/x.svg") });
    expect(svg.headers.get("content-security-policy")).toContain("sandbox");

    const dl = await a.get({ cmd: "file", id: fileId, download: "1" });
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment/);
  });
});

describe("archives", () => {
  it("archive and extract round-trip", async () => {
    await mkdir(join(dir, "proje", "src"), { recursive: true });
    await writeFile(join(dir, "proje", "src", "index.ts"), "export const x = 1;\n".repeat(200));
    await writeFile(join(dir, "proje", "logo.png"), bytes(3000));
    await mkdir(join(dir, "proje", "empty"));

    const { entry: zip } = await a.ok("archive", { ids: [id("local", "/proje")] });
    expect(zip.name).toBe("proje.zip");

    const { entry: folder } = await a.ok("extract", { id: zip.id });
    expect(folder.name).toBe("proje (2)");
    expect(await readFile(join(dir, "proje (2)", "proje", "src", "index.ts"), "utf8")).toBe("export const x = 1;\n".repeat(200));
    expect(new Uint8Array(await readFile(join(dir, "proje (2)", "proje", "logo.png")))).toEqual(bytes(3000));
    const { entries } = await a.ok("ls", { id: id("local", "/proje (2)/proje") });
    expect(entries.map((e: any) => e.name).sort()).toEqual(["empty", "logo.png", "src"]);
  });

  it("download streams a zip of several items", async () => {
    await writeFile(join(dir, "a.txt"), "A");
    await mkdir(join(dir, "f"));
    await writeFile(join(dir, "f", "b.txt"), "B");
    const res = await a.get({ cmd: "download", ids: `${id("local", "/a.txt")},${id("local", "/f")}` });
    expect(res.headers.get("content-type")).toBe("application/zip");
    const zip = new Uint8Array(await res.arrayBuffer());
    const read = async (r: { start: number; end: number }) => new Blob([zip.slice(r.start, r.end + 1)]).stream();
    const entries = await readZipEntries(read, zip.length);
    expect(entries.map((e) => e.name)).toEqual(["a.txt", "f/", "f/b.txt"]);
    const b = entries.find((e) => e.name === "f/b.txt")!;
    expect(new TextDecoder().decode(await streamToBytes(await openZipEntry(read, b)))).toBe("B");
  });

  it("skips zip-slip entries", async () => {
    const { createZipStream } = await import("../src/zip/writer");
    const evil = createZipStream([
      { name: "../evil.txt", mtime: Date.now(), open: async () => new Blob(["x"]).stream() },
      { name: "ok.txt", mtime: Date.now(), open: async () => new Blob(["ok"]).stream() },
    ]);
    await writeFile(join(dir, "evil.zip"), await streamToBytes(evil));
    const { skipped } = await a.ok("extract", { id: id("local", "/evil.zip") });
    expect(skipped).toBe(1);
    expect(await readFile(join(dir, "evil", "ok.txt"), "utf8")).toBe("ok");
  });
});
