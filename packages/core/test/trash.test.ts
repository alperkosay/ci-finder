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
const ROOT = id("local", "/");

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  finder = createCiFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }) }], chunkSize: 1024 });
  a = api(finder);
  await mkdir(join(dir, "Belgeler", "2026"), { recursive: true });
  await writeFile(join(dir, "Belgeler", "2026", "rapor.txt"), "rapor");
  await writeFile(join(dir, "not.txt"), "not");
});
afterEach(() => cleanup());

describe("trash (local)", () => {
  it("rm moves to the trash instead of deleting", async () => {
    const { removed, trashed } = await a.ok("rm", { ids: [id("local", "/not.txt"), id("local", "/Belgeler")] });
    expect(removed).toHaveLength(2);
    expect(trashed.map((e: any) => [e.name, e.trash.originalPath])).toEqual([
      ["not.txt", "/not.txt"],
      ["Belgeler", "/Belgeler"],
    ]);
    // gone from listings, invisible in the root, but still on disk inside .cf-trash
    expect((await a.ok("ls", { id: ROOT })).entries).toHaveLength(0);
    expect(await readdir(join(dir, ".cf-trash"))).toHaveLength(4);
    const { entries } = await a.ok("trash");
    expect(entries.map((e: any) => e.name).sort()).toEqual(["Belgeler", "not.txt"]);
  });

  it("permanent rm skips the trash", async () => {
    await a.ok("rm", { ids: [id("local", "/not.txt")], permanent: true });
    expect((await a.ok("trash")).entries).toHaveLength(0);
  });

  it("restores to the original place, recreating missing folders", async () => {
    const { trashed } = await a.ok("rm", { ids: [id("local", "/Belgeler/2026/rapor.txt")] });
    await a.ok("rm", { ids: [id("local", "/Belgeler")], permanent: true });
    const { restored } = await a.ok("restore", { ids: [trashed[0].id] });
    expect(restored[0].path).toBe("/Belgeler/2026/rapor.txt");
    expect(await readFile(join(dir, "Belgeler", "2026", "rapor.txt"), "utf8")).toBe("rapor");
    expect((await a.ok("trash")).entries).toHaveLength(0);
  });

  it("restoring next to a same-named item keeps both", async () => {
    const { trashed } = await a.ok("rm", { ids: [id("local", "/not.txt")] });
    await writeFile(join(dir, "not.txt"), "yeni");
    const { restored } = await a.ok("restore", { ids: [trashed[0].id] });
    expect(restored[0].name).toBe("not (2).txt");
    expect(await readFile(join(dir, "not (2).txt"), "utf8")).toBe("not");
  });

  it("restores a whole folder tree", async () => {
    const { trashed } = await a.ok("rm", { ids: [id("local", "/Belgeler")] });
    await a.ok("restore", { ids: [trashed[0].id] });
    expect(await readFile(join(dir, "Belgeler", "2026", "rapor.txt"), "utf8")).toBe("rapor");
  });

  it("purges single items and empties the trash", async () => {
    const { trashed } = await a.ok("rm", { ids: [id("local", "/not.txt"), id("local", "/Belgeler")] });
    await a.ok("purge", { ids: [trashed[0].id] });
    expect((await a.ok("trash")).entries.map((e: any) => e.name)).toEqual(["Belgeler"]);
    await a.ok("purge", { all: true });
    expect((await a.ok("trash")).entries).toHaveLength(0);
    expect(await a.fail("restore", { ids: [trashed[1].id] })).toBe("NOT_FOUND");
  });

  it("forgets items past the retention period", async () => {
    await a.ok("rm", { ids: [id("local", "/not.txt")] });
    const sidecar = (await readdir(join(dir, ".cf-trash"))).find((n) => n.endsWith(".json"))!;
    const meta = JSON.parse(await readFile(join(dir, ".cf-trash", sidecar), "utf8"));
    meta.deletedAt = Date.now() - 31 * 86_400_000;
    await writeFile(join(dir, ".cf-trash", sidecar), JSON.stringify(meta));
    expect((await a.ok("trash")).entries).toHaveLength(0);
    expect(await readdir(join(dir, ".cf-trash"))).toHaveLength(0);
  });

  it("reports the trash in init and can be disabled", async () => {
    await a.ok("rm", { ids: [id("local", "/not.txt")] });
    expect((await a.ok("init")).volumes[0].trash).toEqual({ retentionDays: 30, count: 1 });
    const plain = api(createCiFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }), trash: false }] }));
    expect((await plain.ok("init")).volumes[0].trash).toBeNull();
    await plain.ok("rm", { ids: [id("local", "/Belgeler")] });
    expect((await a.ok("trash")).entries).toHaveLength(1);
  });

  it("keeps the trash folder unreachable", async () => {
    await a.ok("rm", { ids: [id("local", "/not.txt")] });
    const shown = api(createCiFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }), showHidden: true }] }));
    expect((await shown.ok("ls", { id: ROOT })).entries.map((e: any) => e.name)).not.toContain(".cf-trash");
    expect(await shown.fail("ls", { id: id("local", "/.cf-trash") })).toBe("NOT_FOUND");
    expect(await shown.fail("mkdir", { id: ROOT, name: ".cf-trash" })).toMatch(/INVALID_NAME|EXISTS/);
    expect(await a.fail("restore", { ids: [id("local", "/not.txt")] })).toBe("NOT_FOUND");
    expect((await a.ok("search", { id: ROOT, q: "not" })).entries).toHaveLength(0);

    const server = createFileServer({ driver: localDriver({ root: dir }), prefix: "/u", showHidden: true });
    const sidecar = (await readdir(join(dir, ".cf-trash"))).find((n) => n.endsWith(".json"))!;
    expect((await server(new Request(`http://x/u/.cf-trash/${sidecar}`))).status).toBe(404);
  });
});

describe("trash (S3)", () => {
  it("moves to and restores from the trash inside the bucket", async () => {
    const s3 = fakeS3("bucket");
    const b = api(
      createCiFinder({
        volumes: [{ id: "s3", driver: s3Driver({ bucket: "bucket", endpoint: "http://s3.test", accessKeyId: "k", secretAccessKey: "s", fetch: s3.fetch }) }],
      }),
    );
    const { entry: folder } = await b.ok("mkdir", { id: id("s3", "/"), name: "Fotoğraflar" });
    await b.ok("mkfile", { id: folder.id, name: "a.jpg", content: "x" });
    const { trashed } = await b.ok("rm", { ids: [folder.id] });
    expect([...s3.objects.keys()].some((k) => k.startsWith("Fotoğraflar/"))).toBe(false);
    expect((await b.ok("ls", { id: id("s3", "/") })).entries).toHaveLength(0);
    expect((await b.ok("trash")).entries.map((e: any) => e.name)).toEqual(["Fotoğraflar"]);
    await b.ok("restore", { ids: [trashed[0].id] });
    expect(s3.objects.has("Fotoğraflar/a.jpg")).toBe(true);
    expect((await b.ok("trash")).entries).toHaveLength(0);
  });
});
