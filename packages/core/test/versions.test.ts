import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCiFinder, createFileServer, type CiFinder } from "../src/index";
import { localDriver } from "../src/drivers/local";
import { s3Driver } from "../src/drivers/s3";
import { fakeS3 } from "./fake-s3";
import { api, id, tempDir } from "./helpers";

let dir: string;
let cleanup: () => Promise<void>;
let finder: CiFinder;
let a: ReturnType<typeof api>;
const NOT = id("local", "/not.txt");

const save = (target: string, content: string) => a.ok("put", { id: target, content });
const versionsOf = async (target: string) =>
  (await a.ok("versions", { id: target })).versions as { id: string; size: number; reason: string; createdAt: number }[];

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  finder = createCiFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }), versions: { maxPerFile: 3 } }], chunkSize: 1024 });
  a = api(finder);
  await mkdir(join(dir, "Belgeler"));
  await writeFile(join(dir, "not.txt"), "v1");
});
afterEach(() => cleanup());

describe("version history (local)", () => {
  it("keeps the previous content when a file is overwritten", async () => {
    await save(NOT, "v2");
    await save(NOT, "v3");
    const versions = await versionsOf(NOT);
    expect(versions.map((v) => v.size)).toEqual([2, 2]);
    expect(versions[0]!.reason).toBe("edit");
    const res = await a.get({ cmd: "version", id: NOT, vid: versions[1]!.id });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("v1");
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("announces version settings in init and hides the folder", async () => {
    await save(NOT, "v2");
    const { volumes } = await a.ok("init");
    expect(volumes[0].versions).toEqual({ maxPerFile: 3, retentionDays: 0 });
    expect((await a.ok("ls", { id: id("local", "/") })).entries.map((e: any) => e.name)).not.toContain(".cf-versions");
    expect(await a.fail("ls", { id: id("local", "/.cf-versions") })).toBe("NOT_FOUND");
    expect(await a.fail("mkdir", { id: id("local", "/"), name: ".cf-versions" })).toBe("INVALID_NAME");
    const server = createFileServer({ driver: localDriver({ root: dir }), prefix: "/u", showHidden: true });
    const [group] = await readdir(join(dir, ".cf-versions"));
    expect((await server(new Request(`http://x/u/.cf-versions/${group}/file.json`))).status).toBe(404);
  });

  it("limits the number of versions per file", async () => {
    for (let i = 2; i <= 6; i++) await save(NOT, `v${i}`);
    const versions = await versionsOf(NOT);
    expect(versions).toHaveLength(3);
    const texts = await Promise.all(versions.map(async (v) => (await a.get({ cmd: "version", id: NOT, vid: v.id })).text()));
    expect(texts).toEqual(["v5", "v4", "v3"]);
  });

  it("reverting keeps the replaced content as a new version", async () => {
    await save(NOT, "v2");
    const [first] = await versionsOf(NOT);
    const { entry } = await a.ok("revert", { id: NOT, vid: first!.id });
    expect(entry.size).toBe(2);
    expect(await readFile(join(dir, "not.txt"), "utf8")).toBe("v1");
    const versions = await versionsOf(NOT);
    expect(versions[0]!.reason).toBe("revert");
    expect(await (await a.get({ cmd: "version", id: NOT, vid: versions[0]!.id })).text()).toBe("v2");
  });

  it("reverting the oldest version at the limit does not lose it", async () => {
    for (let i = 2; i <= 4; i++) await save(NOT, `v${i}`);
    const versions = await versionsOf(NOT);
    const oldest = versions[versions.length - 1]!;
    await a.ok("revert", { id: NOT, vid: oldest.id });
    expect(await readFile(join(dir, "not.txt"), "utf8")).toBe("v1");
    expect(await versionsOf(NOT)).toHaveLength(3);
  });

  it("follows renames and moves", async () => {
    await save(NOT, "v2");
    const { entry } = await a.ok("rename", { id: NOT, name: "yeni.txt" });
    expect(await versionsOf(entry.id)).toHaveLength(1);
    expect(await versionsOf(NOT)).toHaveLength(0);
    const { added } = await a.ok("paste", { ids: [entry.id], dst: id("local", "/Belgeler"), cut: true });
    expect(await versionsOf(added[0].id)).toHaveLength(1);
  });

  it("follows a renamed parent folder", async () => {
    await writeFile(join(dir, "Belgeler", "rapor.txt"), "r1");
    await save(id("local", "/Belgeler/rapor.txt"), "r2");
    await a.ok("rename", { id: id("local", "/Belgeler"), name: "Arşiv" });
    const versions = await versionsOf(id("local", "/Arşiv/rapor.txt"));
    expect(versions).toHaveLength(1);
    expect(await (await a.get({ cmd: "version", id: id("local", "/Arşiv/rapor.txt"), vid: versions[0]!.id })).text()).toBe("r1");
  });

  it("keeps the history through the trash, drops it when deleted for good", async () => {
    await save(NOT, "v2");
    const { trashed } = await a.ok("rm", { ids: [NOT] });
    expect(await versionsOf(NOT)).toHaveLength(1);
    await a.ok("restore", { ids: [trashed[0].id] });
    expect(await versionsOf(NOT)).toHaveLength(1);
    await a.ok("rm", { ids: [NOT], permanent: true });
    expect(await versionsOf(NOT)).toHaveLength(0);
  });

  it("purging from the trash drops the history", async () => {
    await save(NOT, "v2");
    const { trashed } = await a.ok("rm", { ids: [NOT] });
    await a.ok("purge", { ids: [trashed[0].id] });
    expect(await versionsOf(NOT)).toHaveLength(0);
  });

  it("brings a deleted file back from its history", async () => {
    await save(NOT, "v2");
    const [v] = await versionsOf(NOT);
    const { rm } = await import("node:fs/promises");
    await rm(join(dir, "not.txt")); // deleted outside ciFinder: the history is orphaned
    const { versions, entry } = await a.ok("versions", { id: NOT });
    expect(entry).toBeNull();
    expect(versions).toHaveLength(1);
    const res = await a.ok("revert", { id: NOT, vid: v!.id });
    expect(res.created).toBe(true);
    expect(await readFile(join(dir, "not.txt"), "utf8")).toBe("v1");
  });

  it("snapshots on upload with replace and on paste with overwrite", async () => {
    await a.upload(id("local", "/"), "not.txt", new TextEncoder().encode("uploaded"), 1024, { conflict: "overwrite" });
    expect((await versionsOf(NOT)).map((v) => v.reason)).toEqual(["upload"]);
    await writeFile(join(dir, "Belgeler", "not.txt"), "other");
    await a.ok("paste", { ids: [id("local", "/Belgeler/not.txt")], dst: id("local", "/"), cut: false, conflict: "overwrite" });
    expect((await versionsOf(NOT)).map((v) => v.reason)).toEqual(["replace", "upload"]);
  });

  it("does not keep versions of empty files", async () => {
    await writeFile(join(dir, "bos.txt"), "");
    await save(id("local", "/bos.txt"), "dolu");
    expect(await versionsOf(id("local", "/bos.txt"))).toHaveLength(0);
  });

  it("deletes single versions or the whole history", async () => {
    await save(NOT, "v2");
    await save(NOT, "v3");
    const [newest] = await versionsOf(NOT);
    expect(await a.ok("rmVersions", { id: NOT, vids: [newest!.id] })).toEqual({ removed: 1, freed: 2 });
    expect(await versionsOf(NOT)).toHaveLength(1);
    expect(await a.ok("rmVersions", { id: NOT })).toEqual({ removed: 1, freed: 2 });
    expect(await versionsOf(NOT)).toHaveLength(0);
    expect(await readdir(join(dir, ".cf-versions"))).toHaveLength(0);
  });

  it("rejects bad version ids", async () => {
    expect(await a.fail("revert", { id: NOT, vid: "../../not.txt" })).toBe("BAD_REQUEST");
    expect(await a.fail("revert", { id: NOT, vid: "abcdefgh-abcd-edit" })).toBe("NOT_FOUND");
  });

  it("can be disabled per volume, and is off for read-only viewers", async () => {
    const off = createCiFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }), versions: false }] });
    await api(off).ok("put", { id: NOT, content: "v2" });
    expect((await api(off).ok("versions", { id: NOT })).versions).toHaveLength(0);
    expect((await api(off).ok("init")).volumes[0].versions).toBeNull();

    const viewer = createCiFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }) }], authorize: () => ({ readOnly: true }) });
    expect(await api(viewer).fail("rmVersions", { id: NOT })).toBe("READ_ONLY");
  });
});

describe("storage dashboard", () => {
  it("summarizes usage by category, versions, trash and largest files", async () => {
    await writeFile(join(dir, "foto.jpg"), new Uint8Array(3000));
    await writeFile(join(dir, "Belgeler", "rapor.pdf"), new Uint8Array(1000));
    await writeFile(join(dir, "Belgeler", "kod.ts"), "x");
    await save(NOT, "v22");
    await writeFile(join(dir, "silinecek.txt"), "12345");
    await a.ok("rm", { ids: [id("local", "/silinecek.txt")] });

    const stats = await a.ok("stats", { volume: "local" });
    expect(stats.files).toBe(4);
    expect(stats.dirs).toBe(1);
    expect(stats.size).toBe(3000 + 1000 + 1 + 3);
    expect(stats.categories.image).toEqual({ files: 1, size: 3000 });
    expect(stats.categories.document).toEqual({ files: 2, size: 1003 });
    expect(stats.categories.code).toEqual({ files: 1, size: 1 });
    expect(stats.largest.map((e: any) => e.name)).toEqual(["foto.jpg", "rapor.pdf", "not.txt", "kod.ts"]);
    expect(stats.versions).toMatchObject({ files: 1, count: 1, size: 2, orphaned: 0 });
    expect(stats.versions.items[0]).toMatchObject({ name: "not.txt", path: "/not.txt", exists: true, count: 1 });
    expect(stats.trash).toEqual({ count: 1, size: 5 });
    expect(stats.capacity === null || stats.capacity.total > 0).toBe(true);
  });

  it("cleans up orphaned, old and surplus versions", async () => {
    await writeFile(join(dir, "b.txt"), "b1");
    await save(NOT, "v2");
    await save(NOT, "v3");
    await save(id("local", "/b.txt"), "b2");
    const { rm } = await import("node:fs/promises");
    await rm(join(dir, "b.txt"));

    expect((await a.ok("stats", { volume: "local" })).versions.orphaned).toBe(1);
    expect(await a.ok("cleanup", { volume: "local", target: "versions", mode: "orphaned" })).toEqual({ removed: 1, freed: 2 });
    expect(await a.ok("cleanup", { volume: "local", target: "versions", mode: "keep", keep: 1 })).toEqual({ removed: 1, freed: 2 });
    expect(await versionsOf(NOT)).toHaveLength(1);
    expect(await a.ok("cleanup", { volume: "local", target: "versions", mode: "older", days: 1 })).toEqual({ removed: 0, freed: 0 });
    expect(await a.ok("cleanup", { volume: "local", target: "versions", mode: "all" })).toEqual({ removed: 1, freed: 2 });
    expect((await a.ok("stats", { volume: "local" })).versions.count).toBe(0);
    expect(await a.fail("cleanup", { volume: "local", target: "versions", mode: "nope" })).toBe("BAD_REQUEST");
    expect(await a.fail("cleanup", { volume: "yok", target: "cache" })).toBe("NOT_FOUND");
  });
});

describe("version history (s3)", () => {
  it("works the same on S3", async () => {
    const s3 = fakeS3("b");
    const driver = s3Driver({ bucket: "b", region: "us-east-1", endpoint: "http://s3.test", accessKeyId: "k", secretAccessKey: "s", fetch: s3.fetch });
    const f = createCiFinder({ volumes: [{ id: "s3", driver }] });
    const s = api(f);
    await s.ok("mkfile", { id: id("s3", "/"), name: "a.txt", content: "v1" });
    await s.ok("put", { id: id("s3", "/a.txt"), content: "v2" });
    const { versions } = await s.ok("versions", { id: id("s3", "/a.txt") });
    expect(versions).toHaveLength(1);
    expect(await (await s.get({ cmd: "version", id: id("s3", "/a.txt"), vid: versions[0].id })).text()).toBe("v1");
    const { entry } = await s.ok("rename", { id: id("s3", "/a.txt"), name: "b.txt" });
    expect((await s.ok("versions", { id: entry.id })).versions).toHaveLength(1);
    const stats = await s.ok("stats", { volume: "s3" });
    expect(stats).toMatchObject({ files: 1, size: 2, versions: { files: 1, count: 1, size: 2, orphaned: 0 } });
    await s.ok("revert", { id: entry.id, vid: versions[0].id });
    expect((await s.ok("get", { id: entry.id })).content).toBe("v1");
  });
});
