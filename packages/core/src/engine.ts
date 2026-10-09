import { version } from "../package.json";
import { TheFinderError, isTheFinderError } from "./errors";
import { base64UrlDecode, base64UrlEncode, decodeId } from "./id";
import { isActiveContent, mimeOf } from "./mime";
import { basename, dirname, extname, isInside, joinPath, normalizePath } from "./path";
import { contentDisposition, serveFile } from "./serve";
import { mapLimit, readAll, toUint8 } from "./stream";
import { collectStats } from "./stats";
import type {
  Action,
  TheFinderOptions,
  CommandContext,
  DriverStat,
  Entry,
  ImageFormat,
  ImageProcessor,
  InitResult,
  TransformResult,
  VolumePath,
} from "./types";
import { THUMBS_ROOT, ThumbnailService } from "./thumbnails";
import { emptyTrash, isReservedPath, listTrash, moveToTrash, parseTrashPath, purgeOne, restoreFromTrash, trashOrigin } from "./trash";
import {
  deleteVersions,
  forgetVersions,
  listVersions,
  pruneVersions,
  relocateVersions,
  restoreVersion,
  snapshot,
  versionStat,
  type PruneMode,
} from "./versions";
import { Volume } from "./volume";
import { walkAll } from "./walk";
import { openZipEntry, readZipEntries } from "./zip/reader";
import { createZipStream, type ZipSource } from "./zip/writer";

/** Package version, inlined at build time so it follows releases. */
export const VERSION: string = version;
const MiB = 1024 * 1024;

type Params = Record<string, unknown>;
type Target = { vol: Volume; path: VolumePath };
type Command = (engine: TheFinder, p: Params, ctx: CommandContext) => Promise<unknown>;

/** Commands that never change anything; they are the only ones accepted over GET. */
const READ_COMMANDS = new Set([
  "init",
  "ls",
  "tree",
  "parents",
  "info",
  "size",
  "search",
  "file",
  "thumb",
  "download",
  "get",
  "trash",
  "versions",
  "version",
  "stats",
]);

/** Extension written for each output format of the image processor. */
const FORMAT_EXT: Record<ImageFormat, string> = { jpeg: "jpg", png: "png", webp: "webp", avif: "avif", gif: "gif" };

function formatOfExt(ext: string): ImageFormat | null {
  if (ext === "jpg" || ext === "jpeg" || ext === "jfif") return "jpeg";
  return ext === "png" || ext === "webp" || ext === "avif" || ext === "gif" ? ext : null;
}

/** Short lowercase word stored with a version ("edit", "optimize"...). */
function reasonOf(p: Params, fallback: string): string {
  const v =
    typeof p.reason === "string"
      ? p.reason
          .toLowerCase()
          .replace(/[^a-z]/g, "")
          .slice(0, 16)
      : "";
  return v || fallback;
}

/** Header every state-changing request must carry. Browsers cannot add it to cross-site form posts. */
export const CSRF_HEADER = "x-thefinder";

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------------------------
// Param helpers
// ---------------------------------------------------------------------------------------------

function str(p: Params, key: string, required = true): string {
  const v = p[key];
  if (typeof v === "string" && v !== "") return v;
  if (typeof v === "number") return String(v);
  if (required) throw new TheFinderError("BAD_REQUEST", `"${key}" is required`);
  return "";
}

function int(p: Params, key: string, fallback?: number): number {
  const v = p[key];
  const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
  if (Number.isSafeInteger(n) && n >= 0) return n;
  if (fallback !== undefined) return fallback;
  throw new TheFinderError("BAD_REQUEST", `"${key}" must be a non-negative integer`);
}

function bool(p: Params, key: string): boolean {
  const v = p[key];
  return v === true || v === "true" || v === "1" || v === 1;
}

function list(p: Params, key: string): string[] {
  const v = p[key];
  const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out = items.filter((x): x is string => typeof x === "string" && x !== "");
  if (!out.length) throw new TheFinderError("BAD_REQUEST", `"${key}" is required`);
  if (out.length > 10_000) throw new TheFinderError("BAD_REQUEST", "Too many items");
  return out;
}

/** Case, accent and Turkish dotted/dotless i insensitive folding for search. */
function fold(s: string): string {
  return s.replace(/İ/g, "i").replace(/I/g, "i").toLowerCase().replace(/ı/g, "i").normalize("NFD").replace(/\p{M}/gu, "");
}

function mapNativeError(e: unknown): TheFinderError {
  if (isTheFinderError(e)) return e;
  const code = (e as { code?: unknown })?.code;
  switch (code) {
    case "ENOENT":
      return new TheFinderError("NOT_FOUND", "File not found");
    case "EEXIST":
    case "ENOTEMPTY":
      return new TheFinderError("EXISTS", "An item with this name already exists");
    case "EACCES":
    case "EPERM":
      return new TheFinderError("FORBIDDEN", "Permission denied by the file system");
    case "ENOTDIR":
      return new TheFinderError("NOT_A_DIRECTORY", "Not a folder");
    case "EISDIR":
      return new TheFinderError("NOT_A_FILE", "Not a file");
    case "ENOSPC":
      return new TheFinderError("STORAGE", "No space left on the storage");
    case "ENAMETOOLONG":
      return new TheFinderError("INVALID_NAME", "Name is too long");
  }
  return new TheFinderError("INTERNAL", "Internal error");
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

export class TheFinder {
  readonly options: Required<Pick<TheFinderOptions, "chunkSize" | "maxEditSize" | "searchLimit">> & TheFinderOptions;
  private readonly volumes = new Map<string, Volume>();
  private readonly commands: Record<string, Command>;
  private readonly thumbs: ThumbnailService | null;
  private readonly images: ImageProcessor | null;
  private imageJobs = 0;
  private readonly imageQueue: (() => void)[] = [];
  private readOnlyView: TheFinder | null = null;

  constructor(options: TheFinderOptions) {
    if (!options?.volumes?.length) throw new Error("theFinder: at least one volume is required");
    this.options = {
      chunkSize: 5 * MiB,
      maxEditSize: 5 * MiB,
      searchLimit: 500,
      ...options,
    };
    for (const v of options.volumes) {
      if (this.volumes.has(v.id)) throw new Error(`theFinder: duplicate volume id "${v.id}"`);
      this.volumes.set(v.id, new Volume(v));
    }
    this.thumbs = options.thumbnails ? new ThumbnailService(options.thumbnails) : null;
    this.images = options.images ?? null;
    if (options.volumes.some((v) => v.driver.kind === "s3") && this.options.chunkSize < 5 * MiB) {
      throw new Error("theFinder: chunkSize must be at least 5 MiB when an S3 volume is configured");
    }

    // Commands receive the engine to run on: the instance itself, or a read-only view of it.
    this.commands = {
      init: (e) => e.init(),
      ls: (e, p) => e.ls(p),
      tree: (e, p) => e.tree(p),
      parents: (e, p) => e.parents(p),
      info: (e, p) => e.info(p),
      size: (e, p) => e.size(p),
      search: (e, p) => e.search(p),
      mkdir: (e, p) => e.mkdir(p),
      mkfile: (e, p) => e.mkfile(p),
      rename: (e, p) => e.rename(p),
      duplicate: (e, p) => e.duplicate(p),
      rm: (e, p) => e.rm(p),
      trash: (e, p) => e.trashList(p),
      restore: (e, p) => e.restore(p),
      purge: (e, p) => e.purge(p),
      paste: (e, p) => e.paste(p),
      upload: (e, p) => e.upload(p),
      abort: (e, p) => e.abort(p),
      get: (e, p) => e.get(p),
      put: (e, p) => e.put(p),
      archive: (e, p) => e.archive(p),
      extract: (e, p) => e.extract(p),
      file: (e, p, ctx) => e.file(p, ctx.request),
      thumb: (e, p, ctx) => e.thumb(p, ctx.request),
      download: (e, p, ctx) => e.download(p, ctx.request),
      versions: (e, p) => e.versions(p),
      version: (e, p, ctx) => e.version(p, ctx.request),
      revert: (e, p) => e.revert(p),
      rmVersions: (e, p) => e.rmVersions(p),
      stats: (e, p) => e.stats(p),
      cleanup: (e, p) => e.cleanup(p),
      transform: (e, p) => e.transform(p),
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
      if (!Object.hasOwn(this.commands, cmd)) throw new TheFinderError("UNKNOWN_COMMAND", `Unknown command "${cmd}"`);
      if (method !== "POST" && !READ_COMMANDS.has(cmd)) {
        throw new TheFinderError("BAD_REQUEST", `"${cmd}" requires POST`);
      }
      if (method === "POST" && this.options.csrfProtection !== false && !request.headers.has(CSRF_HEADER)) {
        throw new TheFinderError("FORBIDDEN", `Missing ${CSRF_HEADER} header`);
      }
      ctx = { cmd, params, request };
      const result = await this.run(ctx);
      return result instanceof Response ? result : json({ ok: true, data: result });
    } catch (e) {
      const err = mapNativeError(e);
      if (err.code === "INTERNAL") console.error("[thefinder]", ctx?.cmd ?? "", e);
      return json({ ok: false, error: { code: err.code, message: err.message } }, err.status);
    }
  };

  /** Runs a command programmatically (hooks included). */
  async execute<T = unknown>(cmd: string, params: Params = {}, request?: Request): Promise<T> {
    if (!Object.hasOwn(this.commands, cmd)) throw new TheFinderError("UNKNOWN_COMMAND", `Unknown command "${cmd}"`);
    return (await this.run({ cmd, params, request: request ?? new Request("http://localhost/") })) as T;
  }

  getVolume(id: string): Volume | undefined {
    return this.volumes.get(id);
  }

  private async run(ctx: CommandContext): Promise<unknown> {
    const verdict = this.options.authorize ? await this.options.authorize(ctx) : true;
    if (verdict === false) throw new TheFinderError("FORBIDDEN", "Not authorized");
    const engine = typeof verdict === "object" && verdict?.readOnly ? this.readOnly() : this;
    await this.options.onBeforeCommand?.(ctx);
    const result = await this.commands[ctx.cmd]!(engine, ctx.params, ctx);
    await this.options.onAfterCommand?.({ ...ctx, result });
    return result;
  }

  /** Same engine and hooks, but every volume is read-only. Created once and reused. */
  private readOnly(): TheFinder {
    if (!this.readOnlyView) {
      const volumes = new Map([...this.volumes].map(([id, v]) => [id, new Volume({ ...v.options, readOnly: true })]));
      this.readOnlyView = Object.create(this, { volumes: { value: volumes } }) as TheFinder;
    }
    return this.readOnlyView;
  }

  private target(id: unknown): Target {
    const { volume, path } = decodeId(id);
    const vol = this.volumes.get(volume);
    if (!vol) throw new TheFinderError("NOT_FOUND", "Volume not found");
    if (vol.isHiddenPath(path)) throw new TheFinderError("NOT_FOUND", "File not found");
    return { vol, path };
  }

  private async entryAt(vol: Volume, path: VolumePath): Promise<Entry> {
    return vol.entry(await vol.stat(path));
  }

  /**
   * Depth-first walk below `path` (excluding `path` itself), skipping hidden items, and items the
   * `permission` callback does not let the user read (so a readable folder never exposes an
   * unreadable one inside it through search, size, download or archive).
   */
  private async *walk(vol: Volume, path: VolumePath): AsyncGenerator<DriverStat> {
    for (const s of await vol.list(path)) {
      if (!vol.can("read", s.path)) continue;
      yield s;
      if (s.kind === "dir") yield* this.walk(vol, s.path);
    }
  }

  /**
   * Permissions are per path, so an action on a folder also acts on everything inside it: deleting,
   * moving or copying "/docs" must not reach "/docs/locked" when the callback protects it.
   * Free when the volume has no `permission` callback.
   */
  private async assertTree(vol: Volume, path: VolumePath, action: Action): Promise<void> {
    if (!vol.options.permission) return;
    const visit = async (dir: VolumePath): Promise<void> => {
      for (const s of await vol.driver.list(dir)) {
        if (isReservedPath(s.path)) continue;
        vol.assertCan(action, s.path);
        if (s.kind === "dir") await visit(s.path);
      }
    };
    if ((await vol.stat(path)).kind === "dir") await visit(path);
  }

  // --- navigation ----------------------------------------------------------------------------

  private async init(): Promise<InitResult> {
    const volumes = await Promise.all([...this.volumes.values()].map((v) => v.info()));
    const thumbnails = this.thumbs ? { sizes: this.thumbs.sizes, extensions: [...this.thumbs.extensions] } : null;
    const images = this.images ? { extensions: [...this.images.extensions], formats: [...this.images.formats] } : null;
    return { volumes, chunkSize: this.options.chunkSize, version: VERSION, thumbnails, images };
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
        if (!vol.can("read", path)) vol.assertCan("read", dirname(path));
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
      vol.assertCan("read", path);
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
      const readable = (p: VolumePath): boolean => {
        for (let cur = p; cur !== path && cur !== "/"; cur = dirname(cur)) if (!vol.can("read", cur)) return false;
        return true;
      };
      for (const s of await vol.driver.search(path, match, limit * 2)) {
        if (!vol.isHiddenPath(s.path) && readable(s.path)) results.push(vol.entry(s));
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
    if (await vol.driver.stat(target)) throw new TheFinderError("EXISTS", `"${name}" already exists`);
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
    if (await vol.driver.stat(target)) throw new TheFinderError("EXISTS", `"${name}" already exists`);
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
    if (!caseOnly && (await vol.driver.stat(target))) throw new TheFinderError("EXISTS", `"${name}" already exists`);
    await this.assertTree(vol, path, "write");
    await vol.driver.move(path, target);
    if (stat.kind === "file") await this.thumbs?.forget(vol, path);
    await relocateVersions(vol, path, target, stat.kind);
    return { entry: await this.entryAt(vol, target), removed: [p.id] };
  }

  private async duplicate(p: Params) {
    const added: Entry[] = [];
    for (const id of list(p, "ids")) {
      const { vol, path } = this.target(id);
      vol.assertNotRoot(path);
      vol.assertCan("read", path);
      vol.assertCan("write", dirname(path));
      const stat = await vol.stat(path);
      await this.assertTree(vol, path, "read");
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
      await this.assertTree(vol, path, "delete");
      if (!permanent && vol.trash.enabled) {
        trashed.push(await moveToTrash(vol, stat));
      } else {
        await vol.driver.remove(path);
        await forgetVersions(vol, path, stat.kind);
      }
      if (stat.kind === "file") await this.thumbs?.forget(vol, path);
      removed.push(id);
    }
    return { removed, trashed };
  }

  /** Resolves a trash item id ("<volume>_<base64 of /.tf-trash/<tid>>"). */
  private trashTarget(id: unknown): { vol: Volume; tid: string } {
    const { volume, path } = decodeId(id);
    const vol = this.volumes.get(volume);
    const tid = parseTrashPath(path);
    if (!vol || !tid || !vol.trash.enabled) throw new TheFinderError("NOT_FOUND", "Item is not in the trash");
    return { vol, tid };
  }

  private async trashList(p: Params) {
    const only = str(p, "volume", false);
    const vols = [...this.volumes.values()].filter((v) => v.trash.enabled && (!only || v.id === only));
    const lists = await Promise.all(vols.map(async (v) => (await listTrash(v)).filter((e) => v.can("read", dirname(e.trash!.originalPath)))));
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
        const items = await listTrash(vol);
        await emptyTrash(vol);
        for (const e of items) await this.forgetIfGone(vol, e.trash!.originalPath, e.kind);
      }
      return { removed: [], all: true };
    }
    const removed: string[] = [];
    for (const id of list(p, "ids")) {
      const { vol, tid } = this.trashTarget(id);
      vol.assertCan("delete", "/");
      const origin = await trashOrigin(vol, tid);
      await purgeOne(vol, tid);
      if (origin) await this.forgetIfGone(vol, origin.path, origin.kind);
      removed.push(id);
    }
    return { removed, all: false };
  }

  /** A history follows its file into the trash; it is dropped once the item is gone for good. */
  private async forgetIfGone(vol: Volume, path: VolumePath, kind: DriverStat["kind"]): Promise<void> {
    if (!(await vol.driver.stat(path).catch(() => null))) await forgetVersions(vol, path, kind);
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
        throw new TheFinderError("MOVE_INTO_ITSELF", `"${stat.name}" cannot be placed inside itself`);
      }
      if (stat.kind === "file") dst.vol.assertExtensionAllowed(stat.name);
      await this.assertTree(src.vol, src.path, cut ? "delete" : "read");
      if (!sameVolume && stat.kind === "dir") {
        // Another volume may have stricter rules: check everything before copying anything.
        for await (const s of this.walk(src.vol, src.path)) {
          if (s.kind === "file") dst.vol.assertExtensionAllowed(s.name);
          dst.vol.assertCreatable(joinPath(dst.path, `${stat.name}${s.path.slice(src.path.length)}`));
        }
      }

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
          // The replaced file stays in the history of its path.
          if (existing.kind === "file" && stat.kind === "file") await snapshot(dst.vol, existing, "replace");
          await dst.vol.driver.remove(existing.path);
          removed.push(dst.vol.entry(existing).id);
        } else {
          throw new TheFinderError("BAD_REQUEST", `Unknown conflict mode "${conflict}"`);
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
      if (cut) {
        removed.push(id);
        if (stat.kind === "file") await this.thumbs?.forget(src.vol, src.path);
        if (sameVolume) await relocateVersions(src.vol, src.path, target, stat.kind);
        else await forgetVersions(src.vol, src.path, stat.kind);
      }
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
      if (!from.can("read", child.path)) continue;
      await this.copyAcross(from, child.path, child, to, joinPath(target, child.name));
    }
  }

  // --- upload --------------------------------------------------------------------------------

  private async upload(p: Params) {
    const dst = this.target(p.dst);
    dst.vol.assertCan("write", dst.path);
    const { vol } = dst;
    const chunk = p.chunk;
    if (!(chunk instanceof Blob)) throw new TheFinderError("BAD_REQUEST", '"chunk" must be a file');

    const size = int(p, "size");
    const index = int(p, "index");
    const total = int(p, "total");
    const offset = int(p, "offset");
    if (total < 1 || index >= total) throw new TheFinderError("BAD_REQUEST", "Invalid chunk index");
    if (chunk.size > this.options.chunkSize) throw new TheFinderError("TOO_LARGE", "Chunk is larger than the configured chunk size");
    if (offset + chunk.size > size) throw new TheFinderError("BAD_REQUEST", "Chunk exceeds the declared file size");
    const max = vol.options.maxUploadSize;
    if (max != null && size > max) throw new TheFinderError("TOO_LARGE", "File exceeds the maximum upload size");

    let target: VolumePath;
    let driverSession: string | undefined;
    const token = str(p, "session", false);

    if (!token) {
      if (index !== 0) throw new TheFinderError("BAD_REQUEST", "Missing upload session");
      await vol.statDir(dst.path);
      const name = vol.validateName(p.name);
      vol.assertExtensionAllowed(name);
      // Folder uploads send the file's relative folder ("photos/2024"); recreate it under dst.
      let dir = dst.path;
      for (const segment of str(p, "relativePath", false).split("/").filter(Boolean)) {
        dir = joinPath(dir, vol.validateName(segment));
      }
      if (vol.isHiddenPath(dir)) throw new TheFinderError("INVALID_NAME", "Hidden folders are not allowed");
      vol.assertCreatable(dir);
      await vol.mkdirp(dir);
      target = joinPath(dir, name);
      vol.assertCreatable(target);
      const existing = await vol.driver.stat(target);
      if (existing) {
        if (str(p, "conflict", false) === "overwrite" && existing.kind === "file") {
          vol.assertCan("write", target);
          await snapshot(vol, existing, "upload");
        } else {
          target = joinPath(dir, await vol.uniqueName(dir, name, false));
        }
      }
    } else {
      let session: { p?: unknown; s?: unknown };
      try {
        session = JSON.parse(new TextDecoder().decode(base64UrlDecode(token)));
      } catch {
        throw new TheFinderError("BAD_REQUEST", "Invalid upload session");
      }
      target = normalizePath(String(session.p ?? ""));
      driverSession = typeof session.s === "string" ? session.s : undefined;
      // The session is client-held: re-check everything a first chunk would have checked.
      if (target === dst.path || !isInside(dst.path, target) || !driverSession) throw new TheFinderError("BAD_REQUEST", "Invalid upload session");
      for (const segment of target.slice(dst.path.length).split("/").filter(Boolean)) vol.validateName(segment);
      vol.assertCreatable(target);
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
    dst.vol.assertCan("write", dst.path);
    try {
      const session = JSON.parse(new TextDecoder().decode(base64UrlDecode(token)));
      const target = normalizePath(String(session.p ?? ""));
      if (isInside(dst.path, target) && !dst.vol.isHiddenPath(target) && dst.vol.can("write", target) && typeof session.s === "string") {
        await dst.vol.driver.abortUpload?.(target, session.s);
      }
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
    if (stat.kind !== "file") throw new TheFinderError("NOT_A_FILE", "Not a file");
    const download = bool(p, "download");
    // HTML/SVG go through serveFile, which adds a sandbox CSP; a storage URL could not carry it.
    const signed = isActiveContent(mimeOf(stat.name)) ? null : await vol.driver.signedUrl?.(path, { download, filename: stat.name });
    if (signed) return Response.redirect(signed, 302);
    return serveFile({ request, stat, download, open: (range) => vol.driver.read(path, range) });
  }

  /**
   * Small preview of an image, generated on first use and cached. Falls back to the original file
   * when thumbnails are disabled, the format is not supported or generation fails.
   */
  private async thumb(p: Params, request: Request): Promise<Response> {
    const { vol, path } = this.target(p.id);
    vol.assertCan("read", path);
    const stat = await vol.stat(path);
    if (stat.kind !== "file") throw new TheFinderError("NOT_A_FILE", "Not a file");
    if (!this.thumbs?.supports(stat)) return this.file({ id: p.id }, request);
    const size = this.thumbs.pick(int(p, "size", 256));
    let thumb: DriverStat;
    try {
      thumb = await this.thumbs.get(vol, stat, size);
    } catch (e) {
      if (!isTheFinderError(e)) console.warn("[thefinder] thumbnail failed:", stat.path, (e as Error)?.message ?? e);
      return this.file({ id: p.id }, request);
    }
    return serveFile({
      request,
      stat: thumb,
      mime: "image/webp",
      filename: `${stat.name}.webp`,
      // The URL carries the source mtime (`v`), so a changed image gets a new URL.
      cacheControl: "private, max-age=31536000, immutable",
      open: (range) => vol.driver.read(thumb.path, range),
    });
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
    if (stat.kind !== "file") throw new TheFinderError("NOT_A_FILE", "Not a file");
    if (stat.size > this.options.maxEditSize) throw new TheFinderError("TOO_LARGE", "File is too large to edit");
    const bytes = await readAll(await vol.driver.read(path), this.options.maxEditSize);
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bom ? bytes.subarray(3) : bytes);
    } catch {
      throw new TheFinderError("UNSUPPORTED", "This file is not a UTF-8 text file");
    }
    if (content.includes("\0")) throw new TheFinderError("UNSUPPORTED", "This file is not a text file");
    return { content, bom, entry: vol.entry(stat) };
  }

  /**
   * Saves content. JSON: { id, content } overwrites a text file.
   * Multipart: { id, file } overwrites, or { dst, name, file } saves a new copy (unique name).
   */
  private async put(p: Params) {
    const blob = p.file instanceof Blob ? p.file : null;
    if (!blob && typeof p.content !== "string") throw new TheFinderError("BAD_REQUEST", '"content" or "file" is required');
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
    if (stat.kind !== "file") throw new TheFinderError("NOT_A_FILE", "Not a file");
    if (!blob && data.byteLength > this.options.maxEditSize) throw new TheFinderError("TOO_LARGE", "Content is too large");
    const max = vol.options.maxUploadSize;
    if (max != null && data.byteLength > max) throw new TheFinderError("TOO_LARGE", "Content is too large");
    await snapshot(vol, stat, reasonOf(p, "edit"));
    await vol.driver.write(path, data);
    if (blob) await this.thumbs?.forget(vol, path);
    return { entry: await this.entryAt(vol, path), created: false };
  }

  // --- archives ------------------------------------------------------------------------------

  private async archive(p: Params) {
    const targets = list(p, "ids").map((id) => this.target(id));
    const { vol } = targets[0]!;
    const dir = dirname(targets[0]!.path);
    if (targets.some((t) => t.vol !== vol || dirname(t.path) !== dir || t.path === "/")) {
      throw new TheFinderError("BAD_REQUEST", "All items must be in the same folder");
    }
    vol.assertCan("write", dir);
    vol.assertExtensionAllowed("a.zip");
    for (const t of targets) vol.assertCan("read", t.path);
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
    vol.assertCan("read", path);
    const stat = await vol.stat(path);
    if (stat.kind !== "file" || extname(stat.name) !== "zip") throw new TheFinderError("UNSUPPORTED", "Only .zip archives can be extracted");
    const dir = dirname(path);
    vol.assertCan("write", dir);

    const read = (range: { start: number; end: number }) => vol.driver.read(path, range);
    const entries = await readZipEntries(read, stat.size);
    const maxTotal = this.options.maxExtractSize ?? 4 * 1024 * MiB;
    const declared = entries.reduce((n, e) => n + e.size, 0);
    if (declared > maxTotal) throw new TheFinderError("TOO_LARGE", "Archive is too large to extract");

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
      if (vol.isHiddenPath(out) || !vol.can("write", out)) {
        skipped++;
        continue;
      }
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
          if (written > maxTotal) throw new TheFinderError("TOO_LARGE", "Archive is too large to extract");
          controller.enqueue(chunk);
        },
      });
      await vol.driver.write(out, (await openZipEntry(read, e)).pipeThrough(counter));
    }
    return { entry: await this.entryAt(vol, root), skipped };
  }

  // --- version history -----------------------------------------------------------------------

  /** History of a file, newest first. Also answers for a deleted file, so it can be brought back. */
  private async versions(p: Params) {
    const { vol, path } = this.target(p.id);
    vol.assertNotRoot(path);
    vol.assertCan("read", path);
    const current = await vol.driver.stat(path);
    if (current?.kind === "dir") throw new TheFinderError("NOT_A_FILE", "Not a file");
    return { versions: await listVersions(vol, path), entry: current ? vol.entry(current) : null };
  }

  /** Streams one stored version (inline for previews, or `download: 1`). */
  private async version(p: Params, request: Request): Promise<Response> {
    const { vol, path } = this.target(p.id);
    vol.assertCan("read", path);
    const stat = await versionStat(vol, path, p.vid);
    const name = basename(path);
    return serveFile({
      request,
      stat,
      mime: mimeOf(name),
      filename: name,
      download: bool(p, "download"),
      // A version never changes once written.
      cacheControl: "private, max-age=31536000, immutable",
      open: (range) => vol.driver.read(stat.path, range),
    });
  }

  /** Replaces a file with one of its versions; the replaced content becomes a version too. */
  private async revert(p: Params) {
    const { vol, path } = this.target(p.id);
    vol.assertNotRoot(path);
    vol.assertCan("write", path);
    const existing = await vol.driver.stat(path);
    if (!existing) {
      vol.assertCan("write", dirname(path));
      vol.assertExtensionAllowed(basename(path));
    }
    await restoreVersion(vol, path, p.vid);
    await this.thumbs?.forget(vol, path);
    return { entry: await this.entryAt(vol, path), created: !existing };
  }

  /** Deletes some versions of a file (`vids`), or its whole history. */
  private async rmVersions(p: Params) {
    const { vol, path } = this.target(p.id);
    vol.assertNotRoot(path);
    vol.assertCan("delete", path);
    return deleteVersions(vol, path, p.vids === undefined ? undefined : list(p, "vids"));
  }

  // --- storage dashboard ---------------------------------------------------------------------

  private volumeParam(p: Params): Volume {
    const vol = this.volumes.get(str(p, "volume"));
    if (!vol) throw new TheFinderError("NOT_FOUND", "Volume not found");
    return vol;
  }

  private async stats(p: Params) {
    const vol = this.volumeParam(p);
    vol.assertCan("read", "/");
    return collectStats(vol);
  }

  /**
   * Dashboard cleanup.
   * - `{ volume, target: "versions", mode: "all" | "orphaned" }`
   * - `{ volume, target: "versions", mode: "older", days }` / `{ ..., mode: "keep", keep }`
   * - `{ volume, target: "cache" }` drops the thumbnail cache (regenerated on demand).
   */
  private async cleanup(p: Params) {
    const vol = this.volumeParam(p);
    vol.assertCan("delete", "/");
    const target = str(p, "target");
    if (target === "cache") {
      const files = (await walkAll(vol.driver, THUMBS_ROOT)).items.filter((s) => s.kind === "file");
      if (await vol.driver.stat(THUMBS_ROOT)) await vol.driver.remove(THUMBS_ROOT);
      return { removed: files.length, freed: files.reduce((n, s) => n + s.size, 0) };
    }
    if (target !== "versions") throw new TheFinderError("BAD_REQUEST", `Unknown cleanup target "${target}"`);
    const mode = str(p, "mode");
    let prune: PruneMode;
    if (mode === "all" || mode === "orphaned") prune = { mode };
    else if (mode === "older") prune = { mode, days: int(p, "days") };
    else if (mode === "keep") prune = { mode, keep: int(p, "keep") };
    else throw new TheFinderError("BAD_REQUEST", `Unknown cleanup mode "${mode}"`);
    return pruneVersions(vol, prune);
  }

  // --- images --------------------------------------------------------------------------------

  /** Image encoding is CPU heavy: at most two run at the same time, the rest wait in line. */
  private async imageSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.imageJobs >= 2) await new Promise<void>((resolve) => this.imageQueue.push(resolve));
    this.imageJobs++;
    try {
      return await fn();
    } finally {
      this.imageJobs--;
      this.imageQueue.shift()?.();
    }
  }

  /**
   * Bulk resize / recompress / convert:
   * `{ ids, format?: "keep" | "webp" | ..., width?, height?, quality?, output?: "overwrite" | "copy",
   *    skipLarger?, conflict?: "rename" | "overwrite", suffix? }`.
   * Converting to another format always writes a new file next to the original, which is kept.
   * Overwritten files keep their previous content in the version history. Each file reports its own
   * outcome, so one broken image does not fail the batch.
   */
  private async transform(p: Params) {
    const images = this.images;
    if (!images) throw new TheFinderError("UNSUPPORTED", "Image processing is not enabled on the server");
    const requested = str(p, "format", false) || "keep";
    if (requested !== "keep" && !images.formats.includes(requested as ImageFormat)) {
      throw new TheFinderError("BAD_REQUEST", `Unsupported format "${requested}"`);
    }
    const width = int(p, "width", 0);
    const height = int(p, "height", 0);
    if (width > 20_000 || height > 20_000) throw new TheFinderError("BAD_REQUEST", "Size is too large");
    const options = {
      requested: requested as ImageFormat | "keep",
      width,
      height,
      quality: Math.min(100, Math.max(1, int(p, "quality", 80))),
      overwrite: str(p, "output", false) !== "copy",
      skipLarger: p.skipLarger === undefined ? true : bool(p, "skipLarger"),
      replaceExisting: str(p, "conflict", false) === "overwrite",
      suffix: str(p, "suffix", false) || "optimized",
      dryRun: bool(p, "dryRun"),
    };
    const results: TransformResult[] = [];
    for (const id of list(p, "ids")) {
      try {
        results.push(await this.transformOne(images, id, options));
      } catch (e) {
        const err = mapNativeError(e);
        if (err.code === "INTERNAL") console.error("[thefinder] transform", e);
        let name = "";
        try {
          name = basename(decodeId(id).path);
        } catch {
          // invalid id: report it without a name
        }
        results.push({ id, name, before: 0, error: err.code });
      }
    }
    return { results };
  }

  private async transformOne(
    images: ImageProcessor,
    id: string,
    o: {
      requested: ImageFormat | "keep";
      width: number;
      height: number;
      quality: number;
      overwrite: boolean;
      skipLarger: boolean;
      replaceExisting: boolean;
      suffix: string;
      dryRun: boolean;
    },
  ): Promise<TransformResult> {
    const { vol, path } = this.target(id);
    vol.assertCan("read", path);
    const stat = await vol.stat(path);
    if (stat.kind !== "file") throw new TheFinderError("NOT_A_FILE", "Not a file");
    const result: TransformResult = { id, name: stat.name, before: stat.size };
    const ext = extname(stat.name);
    const source = formatOfExt(ext);
    const format = o.requested === "keep" ? source : o.requested;
    if (!images.extensions.includes(ext) || !format || !images.formats.includes(format)) return { ...result, skipped: "unsupported" };

    const dir = dirname(path);
    const inPlace = format === source && o.overwrite;
    vol.assertCan("write", inPlace ? path : dir);
    const maxSize = this.options.maxImageSize ?? 60 * MiB;
    if (stat.size > maxSize) throw new TheFinderError("TOO_LARGE", "Image is too large to process");

    const input = await readAll(await vol.driver.read(path), maxSize);
    const out = await this.imageSlot(() => images.transform(input, { format, width: o.width, height: o.height, quality: o.quality }));
    Object.assign(result, { after: out.data.byteLength, width: out.width, height: out.height });
    if (o.skipLarger && out.data.byteLength >= stat.size) return { ...result, skipped: "larger" };
    // A preview of the outcome (sizes for the bulk dialog): nothing is written.
    if (o.dryRun) return result;

    if (inPlace) {
      await snapshot(vol, stat, "optimize");
      await vol.driver.write(path, out.data);
      await this.thumbs?.forget(vol, path);
      return { ...result, entry: await this.entryAt(vol, path), created: false };
    }

    const base = stat.name.slice(0, stat.name.length - ext.length - 1);
    const wanted = vol.validateName(format === source ? `${base}-${o.suffix}.${ext}` : `${base}.${FORMAT_EXT[format]}`);
    vol.assertExtensionAllowed(wanted);
    let target = joinPath(dir, wanted);
    const existing = await vol.driver.stat(target);
    let replaced = false;
    if (existing && o.replaceExisting && existing.kind === "file") {
      vol.assertCan("write", target);
      await snapshot(vol, existing, "optimize");
      replaced = true;
    } else if (existing) {
      target = joinPath(dir, await vol.uniqueName(dir, wanted, false));
    }
    vol.assertCreatable(target);
    await vol.driver.write(target, out.data);
    if (replaced) await this.thumbs?.forget(vol, target);
    return { ...result, entry: await this.entryAt(vol, target), created: !replaced };
  }
}

async function parseParams(request: Request): Promise<Params> {
  const url = new URL(request.url);
  const params: Params = {};
  // `params.__proto__ = {...}` would swap the prototype and smuggle in parameters nobody sent.
  const set = (k: string, v: unknown) => {
    if (k !== "__proto__") params[k] = v;
  };
  for (const [k, v] of url.searchParams) set(k, v);
  if (url.searchParams.getAll("ids").length > 1) params.ids = url.searchParams.getAll("ids");

  if (request.method.toUpperCase() !== "POST") return params;
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new TheFinderError("BAD_REQUEST", "Invalid JSON body");
    }
    if (body && typeof body === "object" && !Array.isArray(body)) for (const [k, v] of Object.entries(body)) set(k, v);
  } else if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    for (const [k, v] of form) set(k, v);
  }
  return params;
}

export function createTheFinder(options: TheFinderOptions): TheFinder {
  return new TheFinder(options);
}

export { mimeOf };
