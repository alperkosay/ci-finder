import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "../src/id";
import { createTheFinder, type TheFinder } from "../src/index";
import { localDriver } from "../src/drivers/local";
import { s3Driver } from "../src/drivers/s3";
import { fakeS3 } from "./fake-s3";
import { api, bytes, id, tempDir } from "./helpers";

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
});
afterEach(() => cleanup());

const forge = (p: string, s: string) => base64UrlEncode(new TextEncoder().encode(JSON.stringify({ p, s })));
const sessionOf = (token: string) => JSON.parse(new TextDecoder().decode(base64UrlDecode(token))) as { p: string; s: string };

async function uploadChunk(finder: TheFinder, fields: Record<string, string>, data: Uint8Array) {
  const form = new FormData();
  form.set("cmd", "upload");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set("chunk", new Blob([data.slice()]), "chunk");
  const res = await finder.handler(new Request("http://localhost/api/files", { method: "POST", headers: { "x-thefinder": "1" }, body: form }));
  return (await res.json()) as { ok: boolean; data: { session: string; done: boolean }; error: { code: string } };
}

describe("hidden and reserved names", () => {
  it("does not create dot files through any command", async () => {
    const finder = createTheFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }) }] });
    const a = api(finder);
    await writeFile(join(dir, "a.txt"), "a");
    expect(await a.fail("mkfile", { id: id("local", "/"), name: ".htaccess", content: "x" })).toBe("INVALID_NAME");
    expect(await a.fail("mkdir", { id: id("local", "/"), name: ".git" })).toBe("INVALID_NAME");
    expect(await a.fail("rename", { id: id("local", "/a.txt"), name: ".user.ini" })).toBe("INVALID_NAME");
    expect(await a.upload(id("local", "/"), ".env", bytes(10), 1024).catch((e: Error) => e.message)).toContain("INVALID_NAME");
    expect(await readdir(dir)).toEqual(["a.txt"]);
  });

  it("still creates dot files when the volume shows them", async () => {
    const a = api(createTheFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }), showHidden: true }] }));
    await a.ok("mkfile", { id: id("local", "/"), name: ".editorconfig", content: "x" });
    expect(await a.fail("mkdir", { id: id("local", "/"), name: ".tf-trash" })).toBe("INVALID_NAME");
  });

  it("treats internal folders case-insensitively", async () => {
    const a = api(createTheFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }), showHidden: true }] }));
    await mkdir(join(dir, ".tf-trash"));
    await writeFile(join(dir, ".tf-trash", "x.txt"), "secret");
    expect(await a.fail("ls", { id: id("local", "/.TF-TRASH") })).toBe("NOT_FOUND");
    expect(await a.fail("get", { id: id("local", "/.Tf-Trash/x.txt") })).toBe("NOT_FOUND");
  });

  it("skips dot files inside archives", async () => {
    const finder = createTheFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }), showHidden: true }] });
    const a = api(finder);
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", ".htaccess"), "deny");
    await writeFile(join(dir, "src", "ok.txt"), "ok");
    const zip = (await a.ok("archive", { ids: [id("local", "/src")], name: "src.zip" })).entry;
    const hidden = api(createTheFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }) }] }));
    const out = await hidden.ok("extract", { id: zip.id });
    expect(out.skipped).toBe(1);
    expect(await readdir(join(dir, "src (2)", "src"))).toEqual(["ok.txt"]);
  });
});

describe("client-held upload sessions", () => {
  let finder: TheFinder;
  beforeEach(() => {
    finder = createTheFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }), denyExtensions: ["php"] }], chunkSize: 1024 });
  });

  async function startUpload(): Promise<string> {
    const r = await uploadChunk(finder, { dst: id("local", "/"), name: "big.txt", size: "2048", index: "0", total: "2", offset: "0" }, bytes(1024));
    expect(r.ok).toBe(true);
    return sessionOf(r.data.session).s;
  }

  for (const target of ["/.htaccess", "/shell.php.", "/a:b.txt", "/.tf-trash/aaaaaaaa-bbbbbbbb.json"]) {
    it(`rejects a forged target ${target}`, async () => {
      const s = await startUpload();
      const r = await uploadChunk(
        finder,
        { dst: id("local", "/"), session: forge(target, s), size: "2048", index: "1", total: "2", offset: "1024" },
        bytes(1024),
      );
      expect(r.ok).toBe(false);
      expect(r.error.code).toBe("INVALID_NAME");
    });
  }

  it("cannot write into internal folders on S3 either", async () => {
    const s3 = fakeS3("bucket");
    const f = createTheFinder({
      volumes: [{ id: "s3", driver: s3Driver({ bucket: "bucket", endpoint: "http://s3.test", accessKeyId: "k", secretAccessKey: "s", fetch: s3.fetch }) }],
    });
    const r = await uploadChunk(
      f,
      { dst: id("s3", "/"), session: forge("/.tf-versions/x/file.json", "single"), size: "4", index: "0", total: "1", offset: "0" },
      bytes(4),
    );
    expect(r.ok).toBe(false);
    expect([...s3.objects.keys()].some((k) => k.includes(".tf-versions"))).toBe(false);
  });

  it("abort needs write permission", async () => {
    const s = await startUpload();
    const ro = api(createTheFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }), readOnly: true }] }));
    expect(await ro.fail("abort", { dst: id("local", "/"), session: forge("/big.txt", s) })).toBe("READ_ONLY");
    expect((await readdir(dir)).some((n) => n.endsWith(".tf-upload"))).toBe(true);
  });
});

describe("fine-grained read permissions", () => {
  let a: ReturnType<typeof api>;
  beforeEach(async () => {
    await mkdir(join(dir, "public"));
    await mkdir(join(dir, "secret"));
    await writeFile(join(dir, "public", "report.txt"), "public");
    await writeFile(join(dir, "secret", "report-salaries.txt"), "secret");
    const finder = createTheFinder({
      volumes: [
        {
          id: "local",
          driver: localDriver({ root: dir }),
          trash: true,
          permission: (_action, path) => !(path === "/secret" || path.startsWith("/secret/")),
        },
      ],
    });
    a = api(finder);
  });

  it("downloads and archives leave unreadable folders out", async () => {
    const res = await a.get({ cmd: "download", ids: id("local", "/") });
    const zip = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder("latin1").decode(zip);
    expect(text).toContain("report.txt");
    expect(text).not.toContain("salaries");
    const archived = (await a.ok("archive", { ids: [id("local", "/public"), id("local", "/secret")] }).catch((e: Error) => e.message)) as string;
    expect(archived).toContain("FORBIDDEN");
  });

  it("search does not look inside unreadable folders", async () => {
    const { entries } = await a.ok("search", { id: id("local", "/"), q: "report" });
    expect(entries.map((e: { name: string }) => e.name)).toEqual(["report.txt"]);
  });

  it("size and info need read access", async () => {
    expect(await a.fail("size", { ids: [id("local", "/secret")] })).toBe("FORBIDDEN");
    expect(await a.fail("info", { ids: [id("local", "/secret/report-salaries.txt")] })).toBe("FORBIDDEN");
  });
});

it("cross-volume copies respect the target's extension rules", async () => {
  await mkdir(join(dir, "a", "pkg"), { recursive: true });
  await mkdir(join(dir, "b"));
  await writeFile(join(dir, "a", "pkg", "shell.php"), "<?php");
  const a = api(
    createTheFinder({
      volumes: [
        { id: "a", driver: localDriver({ root: join(dir, "a") }) },
        { id: "b", driver: localDriver({ root: join(dir, "b") }), denyExtensions: ["php"] },
      ],
    }),
  );
  expect(await a.fail("paste", { ids: [id("a", "/pkg")], dst: id("b", "/") })).toBe("EXTENSION_DENIED");
  expect(await readdir(join(dir, "b"))).toEqual([]);
});

it("active content on S3 is proxied with a sandbox instead of redirected", async () => {
  const s3 = fakeS3("bucket");
  const finder = createTheFinder({
    volumes: [{ id: "s3", driver: s3Driver({ bucket: "bucket", endpoint: "http://s3.test", accessKeyId: "k", secretAccessKey: "s", fetch: s3.fetch }) }],
  });
  const a = api(finder);
  await a.ok("mkfile", { id: id("s3", "/"), name: "x.svg", content: "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>" });
  const res = await a.get({ cmd: "file", id: id("s3", "/x.svg") });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-security-policy")).toContain("sandbox");
});

it("a JSON body cannot replace the parameter prototype", async () => {
  const finder = createTheFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }) }] });
  const res = await finder.handler(
    new Request("http://localhost/api/files", {
      method: "POST",
      headers: { "content-type": "application/json", "x-thefinder": "1" },
      body: `{"cmd":"mkdir","id":"${id("local", "/")}","__proto__":{"name":"injected"}}`,
    }),
  );
  expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  expect(await readdir(dir)).toEqual([]);
});

it.skipIf(process.platform !== "win32")("refuses Windows path aliases (streams, trailing dots, devices)", async () => {
  await writeFile(join(dir, "secret.txt"), "secret");
  const a = api(createTheFinder({ volumes: [{ id: "local", driver: localDriver({ root: dir }) }] }));
  for (const path of ["/secret.txt::$DATA", "/secret.txt.", "/secret.txt ", "/nul", "/CON.txt"]) {
    expect(await a.fail("get", { id: id("local", path) })).toBe("NOT_FOUND");
  }
});
