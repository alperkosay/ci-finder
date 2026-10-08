import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CiFinder, encodeId } from "../src/index";

export async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "ci-finder-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function api(finder: CiFinder) {
  const post = async <T = any>(cmd: string, body: Record<string, unknown> = {}, headers: Record<string, string> = { "x-ci-finder": "1" }) => {
    const res = await finder.handler(
      new Request("http://localhost/api/files", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ cmd, ...body }),
      }),
    );
    return { status: res.status, body: (await res.json()) as { ok: boolean; data: T; error: { code: string; message: string } } };
  };

  const ok = async <T = any>(cmd: string, body: Record<string, unknown> = {}): Promise<T> => {
    const r = await post<T>(cmd, body);
    if (!r.body.ok) throw new Error(`${cmd} failed: ${r.body.error.code} ${r.body.error.message}`);
    return r.body.data;
  };

  const fail = async (cmd: string, body: Record<string, unknown> = {}): Promise<string> => {
    const r = await post(cmd, body);
    if (r.body.ok) throw new Error(`${cmd} unexpectedly succeeded`);
    return r.body.error.code;
  };

  const get = (params: Record<string, string>, headers: Record<string, string> = {}) =>
    finder.handler(new Request(`http://localhost/api/files?${new URLSearchParams(params)}`, { headers }));

  /** Uploads `data` in chunks exactly like the browser client does. */
  const upload = async (dst: string, name: string, data: Uint8Array, chunkSize: number, extra: Record<string, string> = {}) => {
    const total = Math.max(1, Math.ceil(data.length / chunkSize));
    let session = "";
    let last: any;
    for (let index = 0; index < total; index++) {
      const offset = index * chunkSize;
      const form = new FormData();
      form.set("cmd", "upload");
      form.set("dst", dst);
      form.set("name", name);
      form.set("size", String(data.length));
      form.set("index", String(index));
      form.set("total", String(total));
      form.set("offset", String(offset));
      if (session) form.set("session", session);
      for (const [k, v] of Object.entries(extra)) form.set(k, v);
      form.set("chunk", new Blob([data.slice(offset, offset + chunkSize)]), name);
      const res = await finder.handler(new Request("http://localhost/api/files", { method: "POST", headers: { "x-ci-finder": "1" }, body: form }));
      last = await res.json();
      if (!last.ok) throw new Error(`upload failed: ${last.error.code} ${last.error.message}`);
      session = last.data.session;
    }
    return last.data.entry;
  };

  return { post, ok, fail, get, upload };
}

export const id = encodeId;

export function bytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
}

export async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
