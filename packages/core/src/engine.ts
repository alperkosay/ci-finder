import { CiFinderError, isCiFinderError } from "./errors";
import { base64UrlDecode, base64UrlEncode, decodeId } from "./id";
import { mimeOf } from "./mime";
import { basename, dirname, extname, isInside, joinPath, normalizePath } from "./path";
import { contentDisposition, serveFile } from "./serve";
import { mapLimit, readAll, toUint8 } from "./stream";
import type { CiFinderOptions, CommandContext, DriverStat, Entry, InitResult, VolumePath } from "./types";
import { emptyTrash, listTrash, moveToTrash, parseTrashPath, purgeOne, restoreFromTrash } from "./trash";
import { Volume } from "./volume";
import { openZipEntry, readZipEntries } from "./zip/reader";
import { createZipStream, type ZipSource } from "./zip/writer";

export const VERSION = "0.1.0";
const MiB = 1024 * 1024;

type Params = Record<string, unknown>;
type Target = { vol: Volume; path: VolumePath };
type Command = (p: Params, ctx: CommandContext) => Promise<unknown>;

/** Commands that never change anything; they are the only ones accepted over GET. */
const READ_COMMANDS = new Set(["init", "ls", "tree", "parents", "info", "size", "search", "file", "download", "get", "trash"]);

/** Header every state-changing request must carry. Browsers cannot add it to cross-site form posts. */
export const CSRF_HEADER = "x-ci-finder";

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------------------------
// Param helpers
// ---------------------------------------------------------------------------------------------

function str(p: Params, key: string, required = true): string {
  const v = p[key];
  if (typeof v === "string" && v !== "") return v;
  if (typeof v === "number") return String(v);
  if (required) throw new CiFinderError("BAD_REQUEST", `"${key}" is required`);
  return "";
}

function int(p: Params, key: string, fallback?: number): number {
  const v = p[key];
  const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
  if (Number.isSafeInteger(n) && n >= 0) return n;
  if (fallback !== undefined) return fallback;
  throw new CiFinderError("BAD_REQUEST", `"${key}" must be a non-negative integer`);
}

function bool(p: Params, key: string): boolean {
  const v = p[key];
  return v === true || v === "true" || v === "1" || v === 1;
}

function list(p: Params, key: string): string[] {
  const v = p[key];
  const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out = items.filter((x): x is string => typeof x === "string" && x !== "");
  if (!out.length) throw new CiFinderError("BAD_REQUEST", `"${key}" is required`);
  if (out.length > 10_000) throw new CiFinderError("BAD_REQUEST", "Too many items");
  return out;
}

/** Case, accent and Turkish dotted/dotless i insensitive folding for search. */
function fold(s: string): string {
  return s.replace(/İ/g, "i").replace(/I/g, "i").toLowerCase().replace(/ı/g, "i").normalize("NFD").replace(/\p{M}/gu, "");
}

function mapNativeError(e: unknown): CiFinderError {
  if (isCiFinderError(e)) return e;
  const code = (e as { code?: unknown })?.code;
  switch (code) {
    case "ENOENT":
      return new CiFinderError("NOT_FOUND", "File not found");
    case "EEXIST":
    case "ENOTEMPTY":
      return new CiFinderError("EXISTS", "An item with this name already exists");
    case "EACCES":
    case "EPERM":
      return new CiFinderError("FORBIDDEN", "Permission denied by the file system");
    case "ENOTDIR":
      return new CiFinderError("NOT_A_DIRECTORY", "Not a folder");
    case "EISDIR":
      return new CiFinderError("NOT_A_FILE", "Not a file");
    case "ENOSPC":
      return new CiFinderError("STORAGE", "No space left on the storage");
    case "ENAMETOOLONG":
      return new CiFinderError("INVALID_NAME", "Name is too long");
  }
  return new CiFinderError("INTERNAL", "Internal error");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------

export class CiFinder {
  readonly options: Required<Pick<CiFinderOptions, "chunkSize" | "maxEditSize" | "searchLimit">> & CiFinderOptions;
  private readonly volumes = new Map<string, Volume>();
  private readonly commands: Record<string, Command>;

  constructor(options: CiFinderOptions) {
    if (!options?.volumes?.length) throw new Error("ciFinder: at least one volume is required");
    this.options = {
      chunkSize: 5 * MiB,
      maxEditSize: 5 * MiB,
      searchLimit: 500,
      ...options,
    };
    for (const v of options.volumes) {
      if (this.volumes.has(v.id)) throw new Error(`ciFinder: duplicate volume id "${v.id}"`);
      this.volumes.set(v.id, new Volume(v));
    }
    if (options.volumes.some((v) => v.driver.kind === "s3") && this.options.chunkSize < 5 * MiB) {
      throw new Error("ciFinder: chunkSize must be at least 5 MiB when an S3 volume is configured");
    }

    this.commands = {
      init: () => this.init(),
      ls: (p) => this.ls(p),
      tree: (p) => this.tree(p),
      parents: (p) => this.parents(p),
      info: (p) => this.info(p),
      size: (p) => this.size(p),
      search: (p) => this.search(p),
      mkdir: (p) => this.mkdir(p),
      mkfile: (p) => this.mkfile(p),
      rename: (p) => this.rename(p),
      duplicate: (p) => this.duplicate(p),
      rm: (p) => this.rm(p),
      trash: (p) => this.trashList(p),
      restore: (p) => this.restore(p),
      purge: (p) => this.purge(p),
      paste: (p) => this.paste(p),
      upload: (p) => this.upload(p),
      abort: (p) => this.abort(p),
      get: (p) => this.get(p),
      put: (p) => this.put(p),
      archive: (p) => this.archive(p),
      extract: (p) => this.extract(p),
      file: (p, ctx) => this.file(p, ctx.request),
      download: (p, ctx) => this.download(p, ctx.request),
    };
  }

  /** Web-standard request handler. Mount it on any framework that speaks Request/Response. */
  handler = async (request: Request): Promise<Response> => {
    let ctx: CommandContext | undefined;
    try {
      const method = request.method.toUpperCase();
      if (method !== "GET" && method !== "HEAD" && method !== "POST") {
        return json({ ok: false, error: { code: "BAD_REQUEST", message: "Method not allowed" } }, 405);
      }
      const params = await parseParams(request);
      const cmd = typeof params.cmd === "string" ? params.cmd : "";
      if (!Object.hasOwn(this.commands, cmd)) throw new CiFinderError("UNKNOWN_COMMAND", `Unknown command "${cmd}"`);
      if (method !== "POST" && !READ_COMMANDS.has(cmd)) {
        throw new CiFinderError("BAD_REQUEST", `"${cmd}" requires POST`);
      }
      if (method === "POST" && this.options.csrfProtection !== false && !request.headers.has(CSRF_HEADER)) {
        throw new CiFinderError("FORBIDDEN", `Missing ${CSRF_HEADER} header`);
      }
      ctx = { cmd, params, request };
      const result = await this.run(ctx);
      return result instanceof Response ? result : json({ ok: true, data: result });
    } catch (e) {
      const err = mapNativeError(e);
      if (err.code === "INTERNAL") console.error("[ci-finder]", ctx?.cmd ?? "", e);
      return json({ ok: false, error: { code: err.code, message: err.message } }, err.status);
    }
  };

  /** Runs a command programmatically (hooks included). */
  async execute<T = unknown>(cmd: string, params: Params = {}, request?: Request): Promise<T> {
    if (!Object.hasOwn(this.commands, cmd)) throw new CiFinderError("UNKNOWN_COMMAND", `Unknown command "${cmd}"`);
    return (await this.run({ cmd, params, request: request ?? new Request("http://localhost/") })) as T;
  }

  getVolume(id: string): Volume | undefined {
    return this.volumes.get(id);
  }

  private async run(ctx: CommandContext): Promise<unknown> {
    if (this.options.authorize && (await this.options.authorize(ctx)) === false) {
      throw new CiFinderError("FORBIDDEN", "Not authorized");
    }
    await this.options.onBeforeCommand?.(ctx);
    const result = await this.commands[ctx.cmd]!(ctx.params, ctx);
    await this.options.onAfterCommand?.({ ...ctx, result });
    return result;
  }

  private target(id: unknown): Target {
    const { volume, path } = decodeId(id);
    const vol = this.volumes.get(volume);
    if (!vol) throw new CiFinderError("NOT_FOUND", "Volume not found");
    if (vol.isHiddenPath(path)) throw new CiFinderError("NOT_FOUND", "File not found");
    return { vol, path };
  }

  private async entryAt(vol: Volume, path: VolumePath): Promise<Entry> {
    return vol.entry(await vol.stat(path));
  }

  /** Depth-first walk below `path` (excluding `path` itself), skipping hidden items. */
  private async *walk(vol: Volume, path: VolumePath): AsyncGenerator<DriverStat> {
    for (const s of await vol.list(path)) {
      yield s;
      if (s.kind === "dir") yield* this.walk(vol, s.path);
    }
  }

  // --- navigation ----------------------------------------------------------------------------

  private async init(): Promise<InitResult> {
    const volumes = await Promise.all([...this.volumes.values()].map((v) => v.info()));
    return { volumes, chunkSize: this.options.chunkSize, version: VERSION };
  }

  private async ls(p: Params) {
    const { vol, path } = this.target(p.id);
    vol.assertCan("read", path);
    const cwd = await vol.statDir(path);
    const items = await vol.list(path);
    return { cwd: vol.entry(cwd), entries: items.map((s) => vol.entry(s)) };
  }

  private async tree(p: Params) {
    const { vol, path } = this.target(p.id);
    vol.assertCan("read", path);
    await vol.statDir(path);
    const dirs = (await vol.list(path)).filter((s) => s.kind === "dir");
    const hasSubdirs = vol.driver.hasSubdirs?.bind(vol.driver);
    return {
      entries: await mapLimit(dirs, 8, async (s) => {
        const entry = vol.entry(s);
        if (hasSubdirs) entry.hasDirs = await hasSubdirs(s.path).catch(() => true);
        return entry;
      }),
    };
  }

  private async parents(p: Params) {
    const { vol, path } = this.target(p.id);
    const chain: VolumePath[] = ["/"];
    for (let cur = path; cur !== "/"; cur = dirname(cur)) chain.splice(1, 0, cur);
    return { entries: await mapLimit(chain, 6, (x) => this.entryAt(vol, x)) };
  }

  private async info(p: Params) {
    const ids = list(p, "ids");
    return {
      entries: await mapLimit(ids, 8, (id) => {
        const { vol, path } = this.target(id);
        return this.entryAt(vol, path);
      }),
    };
  }

  private async size(p: Params) {
    let size = 0;
    let files = 0;
    let dirs = 0;
    for (const id of list(p, "ids")) {
      const { vol, path } = this.target(id);
      const stat = await vol.stat(path);
      if (stat.kind === "file") {
        size += stat.size;
        files++;
        continue;
      }
      for await (const s of this.walk(vol, path)) {
        if (s.kind === "dir") {
          dirs++;
        } else {
          files++;
          size += s.size;
        }
      }
    }
    return { size, files, dirs };
  }

  private async search(p: Params) {
    const { vol, path } = this.target(p.id);
    vol.assertCan("read", path);
    const q = fold(str(p, "q").trim());
    if (!q) return { entries: [] };
    const limit = this.options.searchLimit;
    const results: Entry[] = [];
    if (vol.driver.search) {
      const match = (name: string) => fold(name).includes(q);
      for (const s of await vol.driver.search(path, match, limit * 2)) {
        if (!vol.isHiddenPath(s.path)) results.push(vol.entry(s));
        if (results.length >= limit) break;
      }
    } else {
      for await (const s of this.walk(vol, path)) {
        if (fold(s.name).includes(q)) results.push(vol.entry(s));
        if (results.length >= limit) break;
      }
    }
    return { entries: results, truncated: results.length >= limit };
  }

  // --- create / modify -----------------------------------------------------------------------

  private async mkdir(p: Params) {
    const { vol, path } = this.target(p.id);
    vol.assertCan("write", path);
    await vol.statDir(path);
    const name = vol.validateName(p.name);
    const target = joinPath(path, name);
    vol.assertCreatable(target);
    if (await vol.driver.stat(target)) throw new CiFinderError("EXISTS", `"${name}" already exists`);
    await vol.driver.mkdir(target);
    return { entry: await this.entryAt(vol, target) };
  }

  private async mkfile(p: Params) {
    const { vol, path } = this.target(p.id);
    vol.assertCan("write", path);
    await vol.statDir(path);
    const name = vol.validateName(p.name);
    vol.assertExtensionAllowed(name);
    const target = joinPath(path, name);
    vol.assertCreatable(target);
    if (await vol.driver.stat(target)) throw new CiFinderError("EXISTS", `"${name}" already exists`);
    await vol.driver.write(target, typeof p.content === "string" ? p.content : "");
    return { entry: await this.entryAt(vol, target) };
  }

  private async rename(p: Params) {
    const { vol, path } = this.target(p.id);
    vol.assertNotRoot(path);
    vol.assertCan("write", path);
    const stat = await vol.stat(path);
    const name = vol.validateName(p.name);
    if (name === stat.name) return { entry: vol.entry(stat), removed: [] };
    if (stat.kind === "file") vol.assertExtensionAllowed(name);
    const target = joinPath(dirname(path), name);
    vol.assertCreatable(target);
    const caseOnly = name.toLowerCase() === stat.name.toLowerCase();
    if (!caseOnly && (await vol.driver.stat(target))) throw new CiFinderError("EXISTS", `"${name}" already exists`);
    await vol.driver.move(path, target);
    return { entry: await this.entryAt(vol, target), removed: [p.id] };
  }

  private async duplicate(p: Params) {
    const added: Entry[] = [];
    for (const id of list(p, "ids")) {
      const { vol, path } = this.target(id);
      vol.assertNotRoot(path);
      vol.assertCan("write", dirname(path));
      const stat = await vol.stat(path);
      const name = await vol.uniqueName(dirname(path), stat.name, stat.kind === "dir");
      const target = joinPath(dirname(path), name);
      await vol.driver.copy(path, target);
      added.push(await this.entryAt(vol, target));
    }
    return { added };
  }

  /** Moves items to the trash (default) or deletes them for good with `permanent: true`. */
  private async rm(p: Params) {
    const permanent = bool(p, "permanent");
    const removed: string[] = [];
    const trashed: Entry[] = [];
    for (const id of list(p, "ids")) {
      const { vol, path } = this.target(id);
      vol.assertNotRoot(path);
      vol.assertCan("delete", path);
      const stat = await vol.stat(path);
      if (!permanent && vol.trash.enabled) trashed.push(await moveToTrash(vol, stat));
      else await vol.driver.remove(path);
      removed.push(id);
    }
    return { removed, trashed };
  }

  /** Resolves a trash item id ("<volume>_<base64 of /.cf-trash/<tid>>"). */
  private trashTarget(id: unknown): { vol: Volume; tid: string } {
    const { volume, path } = decodeId(id);
    const vol = this.volumes.get(volume);
    const tid = parseTrashPath(path);
    if (!vol || !tid || !vol.trash.enabled) throw new CiFinderError("NOT_FOUND", "Item is not in the trash");
    return { vol, tid };
  }

  private async trashList(p: Params) {
    const only = str(p, "volume", false);
    const vols = [...this.volumes.values()].filter((v) => v.trash.enabled && (!only || v.id === only));
    const lists = await Promise.all(vols.map((v) => listTrash(v)));
    return { entries: lists.flat().sort((a, b) => b.mtime - a.mtime) };
  }

  private async restore(p: Params) {
    const restored: Entry[] = [];
    const removed: string[] = [];
    for (const id of list(p, "ids")) {
      const { vol, tid } = this.trashTarget(id);
      restored.push(await restoreFromTrash(vol, tid));
      removed.push(id);
    }
    return { restored, removed };
  }

  /** Permanently deletes trash items: `{ ids }`, or everything with `{ all: true }` (optionally one `volume`). */
  private async purge(p: Params) {
    if (bool(p, "all")) {
      const only = str(p, "volume", false);
      for (const vol of this.volumes.values()) {
        if (!vol.trash.enabled || (only && vol.id !== only)) continue;
        vol.assertCan("delete", "/");
        await emptyTrash(vol);
      }
      return { removed: [], all: true };
    }
    const removed: string[] = [];
    for (const id of list(p, "ids")) {
      const { vol, tid } = this.trashTarget(id);
      vol.assertCan("delete", "/");
      await purgeOne(vol, tid);
      removed.push(id);
    }
    return { removed, all: false };
  }

  private async paste(p: Params) {
    const dst = this.target(p.dst);
    dst.vol.assertCan("write", dst.path);
    await dst.vol.statDir(dst.path);
    const cut = bool(p, "cut");
    const conflict = str(p, "conflict", false) || "rename";
    const added: Entry[] = [];
    const removed: string[] = [];
    const skipped: string[] = [];

    for (const id of list(p, "ids")) {
      const src = this.target(id);
      src.vol.assertCan("read", src.path);
      if (cut) {
        src.vol.assertNotRoot(src.path);
        src.vol.assertCan("delete", src.path);
      }
      const stat = await src.vol.stat(src.path);
      const sameVolume = src.vol === dst.vol;
      const sameFolder = sameVolume && dirname(src.path) === dst.path;
      if (cut && sameFolder) continue;
      if (stat.kind === "dir" && sameVolume && isInside(src.path, dst.path)) {
        throw new CiFinderError("MOVE_INTO_ITSELF", `"${stat.name}" cannot be placed inside itself`);
      }
      if (stat.kind === "file") dst.vol.assertExtensionAllowed(stat.name);

      let name = stat.name;
      const existing = await dst.vol.driver.stat(joinPath(dst.path, name));
      if (existing) {
        if (sameFolder || conflict === "rename") {
          name = await dst.vol.uniqueName(dst.path, name, stat.kind === "dir");
        } else if (conflict === "skip") {
          skipped.push(id);
          continue;
        } else if (conflict === "overwrite") {
          dst.vol.assertCan("delete", existing.path);
          await dst.vol.driver.remove(existing.path);
          removed.push(dst.vol.entry(existing).id);
        } else {
          throw new CiFinderError("BAD_REQUEST", `Unknown conflict mode "${conflict}"`);
        }
      }
      const target = joinPath(dst.path, name);
      dst.vol.assertCreatable(target);

      if (sameVolume) {
        await (cut ? src.vol.driver.move(src.path, target) : src.vol.driver.copy(src.path, target));
      } else {
        await this.copyAcross(src.vol, src.path, stat, dst.vol, target);
        if (cut) await src.vol.driver.remove(src.path);
      }
      if (cut) removed.push(id);
      added.push(await this.entryAt(dst.vol, target));
    }
    return { added, removed, skipped };
  }

  /** Copies between two different volumes (e.g. local disk to S3) by streaming every file. */
  private async copyAcross(from: Volume, path: VolumePath, stat: DriverStat, to: Volume, target: VolumePath): Promise<void> {
    if (stat.kind === "file") {
      await to.driver.write(target, await from.driver.read(path));
      return;
    }
    await to.driver.mkdir(target);
    for (const child of await from.list(path)) {
      await this.copyAcross(from, child.path, child, to, joinPath(target, child.name));
    }
  }

  // --- upload --------------------------------------------------------------------------------

  private async upload(p: Params) {
    const dst = this.target(p.dst);
    dst.vol.assertCan("write", dst.path);
    const { vol } = dst;
    const chunk = p.chunk;
    if (!(chunk instanceof Blob)) throw new CiFinderError("BAD_REQUEST", '"chunk" must be a file');

    const size = int(p, "size");
    const index = int(p, "index");
    const total = int(p, "total");
    const offset = int(p, "offset");
    if (total < 1 || index >= total) throw new CiFinderError("BAD_REQUEST", "Invalid chunk index");
    if (chunk.size > this.options.chunkSize) throw new CiFinderError("TOO_LARGE", "Chunk is larger than the configured chunk size");
    if (offset + chunk.size > size) throw new CiFinderError("BAD_REQUEST", "Chunk exceeds the declared file size");
    const max = vol.options.maxUploadSize;
    if (max != null && size > max) throw new CiFinderError("TOO_LARGE", "File exceeds the maximum upload size");

    let target: VolumePath;
    let driverSession: string | undefined;
    const token = str(p, "session", false);

    if (!token) {
      if (index !== 0) throw new CiFinderError("BAD_REQUEST", "Missing upload session");
      await vol.statDir(dst.path);
      const name = vol.validateName(p.name);
      vol.assertExtensionAllowed(name);
      // Folder uploads send the file's relative folder ("photos/2024"); recreate it under dst.
      let dir = dst.path;
      for (const segment of str(p, "relativePath", false).split("/").filter(Boolean)) {
        dir = joinPath(dir, vol.validateName(segment));
      }
      if (vol.isHiddenPath(dir)) throw new CiFinderError("INVALID_NAME", "Hidden folders are not allowed");
      vol.assertCreatable(dir);
      await vol.mkdirp(dir);
      target = joinPath(dir, name);
      vol.assertCreatable(target);
      const existing = await vol.driver.stat(target);
      if (existing) {
        if (str(p, "conflict", false) === "overwrite" && existing.kind === "file") vol.assertCan("write", target);
        else target = joinPath(dir, await vol.uniqueName(dir, name, false));
      }
    } else {
      let session: { p?: unknown; s?: unknown };
      try {
        session = JSON.parse(new TextDecoder().decode(base64UrlDecode(token)));
      } catch {
        throw new CiFinderError("BAD_REQUEST", "Invalid upload session");
      }
      target = normalizePath(String(session.p ?? ""));
      driverSession = typeof session.s === "string" ? session.s : undefined;
      // The session is client-held: re-check everything a first chunk would have checked.
      if (target === "/" || !isInside(dst.path, target) || !driverSession) throw new CiFinderError("BAD_REQUEST", "Invalid upload session");
      vol.assertCan("write", target);
      vol.assertExtensionAllowed(basename(target));
    }

    const result = await vol.driver.uploadChunk({
      path: target,
      session: driverSession,
      index,
      total,
      size,
      offset,
      data: new Uint8Array(await chunk.arrayBuffer()),
    });
    const session = base64UrlEncode(encoder.encode(JSON.stringify({ p: target, s: result.session })));
    if (!result.done) return { done: false, session };
    return { done: true, session, entry: await this.entryAt(vol, target) };
  }

  private async abort(p: Params) {
    const dst = this.target(p.dst);
    const token = str(p, "session");
    try {
      const session = JSON.parse(new TextDecoder().decode(base64UrlDecode(token)));
      const target = normalizePath(String(session.p ?? ""));
      if (isInside(dst.path, target) && typeof session.s === "string") await dst.vol.driver.abortUpload?.(target, session.s);
    } catch {
      // Aborting is best effort.
    }
    return { aborted: true };
  }

  // --- content -------------------------------------------------------------------------------

  private async file(p: Params, request: Request): Promise<Response> {
    const { vol, path } = this.target(p.id);
    vol.assertCan("read", path);
    const stat = await vol.stat(path);
    if (stat.kind !== "file") throw new CiFinderError("NOT_A_FILE", "Not a file");
    const download = bool(p, "download");
    const signed = await vol.driver.signedUrl?.(path, { download, filename: stat.name });
    if (signed) return Response.redirect(signed, 302);
    return serveFile({ request, stat, download, open: (range) => vol.driver.read(path, range) });
  }

  private async download(p: Params, request: Request): Promise<Response> {
    const ids = list(p, "ids");
    const targets = ids.map((id) => this.target(id));
    const stats = await Promise.all(
      targets.map(async (t) => {
        t.vol.assertCan("read", t.path);
        return t.vol.stat(t.path);
      }),
    );
    if (targets.length === 1 && stats[0]!.kind === "file") {
      return this.file({ id: ids[0], download: "1" }, request);
    }

    const zipName = targets.length === 1 ? `${stats[0]!.name || targets[0]!.vol.name}.zip` : "download.zip";
    const walk = (vol: Volume, path: VolumePath) => this.walk(vol, path);
    async function* sources(): AsyncGenerator<ZipSource> {
      for (let i = 0; i < targets.length; i++) {
        const { vol, path } = targets[i]!;
        const stat = stats[i]!;
        const base = stat.name || vol.name;
        if (stat.kind === "file") {
          yield { name: base, mtime: stat.mtime, size: stat.size, open: () => vol.driver.read(path) };
          continue;
        }
        yield { name: base + "/", mtime: stat.mtime };
        const prefix = path === "/" ? 1 : path.length + 1;
        for await (const s of walk(vol, path)) {
          const name = `${base}/${s.path.slice(prefix)}`;
          if (s.kind === "dir") yield { name: name + "/", mtime: s.mtime };
          else yield { name, mtime: s.mtime, size: s.size, open: () => vol.driver.read(s.path) };
        }
      }
    }
    return new Response(createZipStream(sources()), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition("attachment", zipName),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  private async get(p: Params) {
    const { vol, path } = this.target(p.id);
    vol.assertCan("read", path);
    const stat = await vol.stat(path);
    if (stat.kind !== "file") throw new CiFinderError("NOT_A_FILE", "Not a file");
    if (stat.size > this.options.maxEditSize) throw new CiFinderError("TOO_LARGE", "File is too large to edit");
    const bytes = await readAll(await vol.driver.read(path), this.options.maxEditSize);
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bom ? bytes.subarray(3) : bytes);
    } catch {
      throw new CiFinderError("UNSUPPORTED", "This file is not a UTF-8 text file");
    }
    if (content.includes("\0")) throw new CiFinderError("UNSUPPORTED", "This file is not a text file");
    return { content, bom, entry: vol.entry(stat) };
  }

  /**
   * Saves content. JSON: { id, content } overwrites a text file.
   * Multipart: { id, file } overwrites, or { dst, name, file } saves a new copy (unique name).
   */
  private async put(p: Params) {
    const blob = p.file instanceof Blob ? p.file : null;
    if (!blob && typeof p.content !== "string") throw new CiFinderError("BAD_REQUEST", '"content" or "file" is required');
    const data = blob ? new Uint8Array(await blob.arrayBuffer()) : toUint8(p.content as string);

    if (!p.id) {
      const dst = this.target(p.dst);
      dst.vol.assertCan("write", dst.path);
      await dst.vol.statDir(dst.path);
      const requested = dst.vol.validateName(p.name);
      dst.vol.assertExtensionAllowed(requested);
      const name = await dst.vol.uniqueName(dst.path, requested, false);
      const target = joinPath(dst.path, name);
      dst.vol.assertCreatable(target);
      await dst.vol.driver.write(target, data);
      return { entry: await this.entryAt(dst.vol, target), created: true };
    }

    const { vol, path } = this.target(p.id);
    vol.assertCan("write", path);
    const stat = await vol.stat(path);
    if (stat.kind !== "file") throw new CiFinderError("NOT_A_FILE", "Not a file");
    if (!blob && data.byteLength > this.options.maxEditSize) throw new CiFinderError("TOO_LARGE", "Content is too large");
    const max = vol.options.maxUploadSize;
    if (max != null && data.byteLength > max) throw new CiFinderError("TOO_LARGE", "Content is too large");
    await vol.driver.write(path, data);
    return { entry: await this.entryAt(vol, path), created: false };
  }

  // --- archives ------------------------------------------------------------------------------

  private async archive(p: Params) {
    const targets = list(p, "ids").map((id) => this.target(id));
    const { vol } = targets[0]!;
    const dir = dirname(targets[0]!.path);
    if (targets.some((t) => t.vol !== vol || dirname(t.path) !== dir || t.path === "/")) {
      throw new CiFinderError("BAD_REQUEST", "All items must be in the same folder");
    }
    vol.assertCan("write", dir);
    vol.assertExtensionAllowed("a.zip");
    const stats = await Promise.all(targets.map((t) => vol.stat(t.path)));
    const requested = str(p, "name", false) || (stats.length === 1 ? `${stats[0]!.name}.zip` : "Archive.zip");
    const name = await vol.uniqueName(dir, vol.validateName(requested.endsWith(".zip") ? requested : `${requested}.zip`), false);
    const target = joinPath(dir, name);
    vol.assertCreatable(target);

    const walk = (path: VolumePath) => this.walk(vol, path);
    async function* sources(): AsyncGenerator<ZipSource> {
      for (const stat of stats) {
        if (stat.kind === "file") {
          yield { name: stat.name, mtime: stat.mtime, size: stat.size, open: () => vol.driver.read(stat.path) };
          continue;
        }
        yield { name: stat.name + "/", mtime: stat.mtime };
        for await (const s of walk(stat.path)) {
          const name = `${stat.name}/${s.path.slice(stat.path.length + 1)}`;
          if (s.kind === "dir") yield { name: name + "/", mtime: s.mtime };
          else yield { name, mtime: s.mtime, size: s.size, open: () => vol.driver.read(s.path) };
        }
      }
    }
    await vol.driver.write(target, createZipStream(sources()));
    return { entry: await this.entryAt(vol, target) };
  }

  private async extract(p: Params) {
    const { vol, path } = this.target(p.id);
    const stat = await vol.stat(path);
    if (stat.kind !== "file" || extname(stat.name) !== "zip") throw new CiFinderError("UNSUPPORTED", "Only .zip archives can be extracted");
    const dir = dirname(path);
    vol.assertCan("write", dir);

    const read = (range: { start: number; end: number }) => vol.driver.read(path, range);
    const entries = await readZipEntries(read, stat.size);
    const maxTotal = this.options.maxExtractSize ?? 4 * 1024 * MiB;
    const declared = entries.reduce((n, e) => n + e.size, 0);
    if (declared > maxTotal) throw new CiFinderError("TOO_LARGE", "Archive is too large to extract");

    const folderName = await vol.uniqueName(dir, stat.name.replace(/\.zip$/i, "") || "archive", true);
    const root = joinPath(dir, folderName);
    vol.assertCreatable(root);
    await vol.driver.mkdir(root);

    let written = 0;
    let skipped = 0;
    for (const e of entries) {
      let rel: VolumePath;
      try {
        rel = normalizePath(e.name);
        // Zip-slip protection: every segment must be a valid single name.
        for (const seg of rel.split("/").filter(Boolean)) vol.validateName(seg);
      } catch {
        skipped++;
        continue;
      }
      if (rel === "/" || rel.startsWith("/__MACOSX") || rel.endsWith("/.DS_Store")) continue;
      const out = root + rel;
      if (e.dir) {
        await vol.mkdirp(out);
        continue;
      }
      try {
        vol.assertExtensionAllowed(basename(out));
      } catch {
        skipped++;
        continue;
      }
      await vol.mkdirp(dirname(out));
      const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          written += chunk.byteLength;
          if (written > maxTotal) throw new CiFinderError("TOO_LARGE", "Archive is too large to extract");
          controller.enqueue(chunk);
        },
      });
      await vol.driver.write(out, (await openZipEntry(read, e)).pipeThrough(counter));
    }
    return { entry: await this.entryAt(vol, root), skipped };
  }
}

async function parseParams(request: Request): Promise<Params> {
  const url = new URL(request.url);
  const params: Params = {};
  for (const [k, v] of url.searchParams) params[k] = v;
  if (url.searchParams.getAll("ids").length > 1) params.ids = url.searchParams.getAll("ids");

  if (request.method.toUpperCase() !== "POST") return params;
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new CiFinderError("BAD_REQUEST", "Invalid JSON body");
    }
    if (body && typeof body === "object" && !Array.isArray(body)) Object.assign(params, body);
  } else if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    for (const [k, v] of form) params[k] = v;
  }
  return params;
}

export function createCiFinder(options: CiFinderOptions): CiFinder {
  return new CiFinder(options);
}

export { mimeOf };
