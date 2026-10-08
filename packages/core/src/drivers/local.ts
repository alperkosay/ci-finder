import { constants, promises as fs, type Dirent } from "node:fs";
import * as nodePath from "node:path";
import { CiFinderError } from "../errors";
import { mapLimit } from "../stream";
import type { ByteRange, DriverStat, StorageDriver, UploadChunk, UploadChunkResult, VolumePath, WriteData } from "../types";

export interface LocalDriverOptions {
  /** Absolute (or cwd-relative) folder that becomes the volume root. */
  root: string;
  /** Create the root folder when it does not exist. Default: true. */
  create?: boolean;
  /**
   * Follow symbolic links. Links that resolve outside the root are always hidden, even when this is
   * true. Default: true.
   */
  followSymlinks?: boolean;
}

const UPLOAD_SUFFIX = ".cf-upload";
const TEMP_SUFFIX = ".cf-tmp";
const READ_CHUNK = 64 * 1024;

const isInternal = (name: string) => name.endsWith(UPLOAD_SUFFIX) || name.endsWith(TEMP_SUFFIX);
const random = () => Math.random().toString(36).slice(2, 10);

export class LocalDriver implements StorageDriver {
  readonly kind = "local";
  readonly root: string;
  private readonly create: boolean;
  private readonly followSymlinks: boolean;
  private realRoot: Promise<string> | null = null;

  constructor(options: LocalDriverOptions) {
    if (!options?.root) throw new Error("ciFinder localDriver: `root` is required");
    this.root = nodePath.resolve(options.root);
    this.create = options.create ?? true;
    this.followSymlinks = options.followSymlinks ?? true;
  }

  private getRealRoot(): Promise<string> {
    this.realRoot ??= (async () => {
      if (this.create) await fs.mkdir(this.root, { recursive: true });
      return fs.realpath(this.root);
    })().catch((e) => {
      this.realRoot = null;
      throw e;
    });
    return this.realRoot;
  }

  /** Maps a volume path to an absolute OS path. Volume paths are already normalized (no ".."). */
  abs(path: VolumePath): string {
    return path === "/" ? this.root : nodePath.join(this.root, ...path.slice(1).split("/"));
  }

  /** Resolves symlinks and verifies the real location is still inside the root. */
  private async contained(abs: string): Promise<boolean> {
    const realRoot = await this.getRealRoot();
    let real: string;
    try {
      real = await fs.realpath(abs);
    } catch {
      return true; // does not exist yet; its parent is checked by the caller
    }
    return real === realRoot || real.startsWith(realRoot + nodePath.sep);
  }

  private async safe(path: VolumePath): Promise<string> {
    await this.getRealRoot();
    const abs = this.abs(path);
    const parentOk = path === "/" || (await this.contained(nodePath.dirname(abs)));
    if (!parentOk || !(await this.contained(abs))) {
      throw new CiFinderError("FORBIDDEN", "Path resolves outside of the volume");
    }
    return abs;
  }

  private toStat(path: VolumePath, s: { isDirectory(): boolean; size: number; mtimeMs: number }): DriverStat {
    return {
      name: path === "/" ? "" : path.slice(path.lastIndexOf("/") + 1),
      path,
      kind: s.isDirectory() ? "dir" : "file",
      size: s.isDirectory() ? 0 : s.size,
      mtime: Math.floor(s.mtimeMs),
    };
  }

  async stat(path: VolumePath): Promise<DriverStat | null> {
    try {
      const abs = await this.safe(path);
      const l = await fs.lstat(abs);
      if (l.isSymbolicLink() && !this.followSymlinks) return null;
      return this.toStat(path, l.isSymbolicLink() ? await fs.stat(abs) : l);
    } catch (e) {
      if (isMissing(e) || (e as CiFinderError).code === "FORBIDDEN") return null;
      throw e;
    }
  }

  async list(path: VolumePath): Promise<DriverStat[]> {
    const abs = await this.safe(path);
    const dirents = await fs.readdir(abs, { withFileTypes: true });
    const base = path === "/" ? "" : path;
    const results = await mapLimit(dirents, 32, async (d: Dirent) => {
      if (isInternal(d.name)) return null;
      const childAbs = nodePath.join(abs, d.name);
      const childPath = `${base}/${d.name}`;
      try {
        if (d.isSymbolicLink()) {
          if (!this.followSymlinks || !(await this.contained(childAbs))) return null;
          return this.toStat(childPath, await fs.stat(childAbs));
        }
        if (!d.isFile() && !d.isDirectory()) return null; // sockets, fifos, devices
        return this.toStat(childPath, await fs.stat(childAbs));
      } catch {
        return null; // vanished or unreadable while listing
      }
    });
    return results.filter((s): s is DriverStat => s !== null);
  }

  async hasSubdirs(path: VolumePath): Promise<boolean> {
    const abs = await this.safe(path);
    for (const d of await fs.readdir(abs, { withFileTypes: true })) {
      if (d.name.startsWith(".")) continue;
      if (d.isDirectory()) return true;
      if (d.isSymbolicLink() && this.followSymlinks) {
        const child = nodePath.join(abs, d.name);
        if ((await this.contained(child)) && (await fs.stat(child).catch(() => null))?.isDirectory()) return true;
      }
    }
    return false;
  }

  async mkdir(path: VolumePath): Promise<void> {
    if (path === "/") {
      await fs.mkdir(this.root, { recursive: true });
      return;
    }
    await fs.mkdir(await this.safe(path));
  }

  async read(path: VolumePath, range?: ByteRange): Promise<ReadableStream<Uint8Array>> {
    const handle = await fs.open(await this.safe(path), "r");
    let position = range?.start ?? 0;
    const end = range ? range.end + 1 : Infinity;
    let closed = false;
    const close = async () => {
      if (!closed) {
        closed = true;
        await handle.close().catch(() => {});
      }
    };
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const want = Math.min(READ_CHUNK, end - position);
          if (want <= 0) {
            await close();
            controller.close();
            return;
          }
          const buffer = new Uint8Array(want);
          const { bytesRead } = await handle.read(buffer, 0, want, position);
          if (bytesRead === 0) {
            await close();
            controller.close();
            return;
          }
          position += bytesRead;
          controller.enqueue(bytesRead === want ? buffer : buffer.subarray(0, bytesRead));
        } catch (e) {
          await close();
          controller.error(e);
        }
      },
      cancel: close,
    });
  }

  /** Writes to a temporary sibling first and renames, so readers never see a half-written file. */
  async write(path: VolumePath, data: WriteData): Promise<void> {
    const abs = await this.safe(path);
    const tmp = nodePath.join(nodePath.dirname(abs), `.${nodePath.basename(abs)}.${random()}${TEMP_SUFFIX}`);
    try {
      if (data instanceof ReadableStream) {
        const handle = await fs.open(tmp, "wx");
        try {
          const reader = data.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            await handle.write(value);
          }
        } finally {
          await handle.close();
        }
      } else {
        await fs.writeFile(tmp, typeof data === "string" ? data : data instanceof Uint8Array ? data : new Uint8Array(data), { flag: "wx" });
      }
      await replaceFile(tmp, abs);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
  }

  async remove(path: VolumePath): Promise<void> {
    if (path === "/") throw new CiFinderError("LOCKED", "The root folder cannot be removed");
    await fs.rm(await this.safe(path), { recursive: true });
  }

  async copy(from: VolumePath, to: VolumePath): Promise<void> {
    await this.copyRecursive(await this.safe(from), await this.safe(to));
  }

  /** Recursive copy that never follows a symlink out of the root. */
  private async copyRecursive(src: string, dst: string): Promise<void> {
    const l = await fs.lstat(src);
    if (l.isSymbolicLink() && (!this.followSymlinks || !(await this.contained(src)))) return;
    const s = l.isSymbolicLink() ? await fs.stat(src) : l;
    if (!s.isDirectory()) {
      await fs.copyFile(src, dst, constants.COPYFILE_EXCL);
      return;
    }
    await fs.mkdir(dst);
    for (const d of await fs.readdir(src, { withFileTypes: true })) {
      if (isInternal(d.name)) continue;
      await this.copyRecursive(nodePath.join(src, d.name), nodePath.join(dst, d.name));
    }
  }

  async move(from: VolumePath, to: VolumePath): Promise<void> {
    const src = await this.safe(from);
    const dst = await this.safe(to);
    const caseOnly = src.toLowerCase() === dst.toLowerCase();
    if (!caseOnly && (await exists(dst))) throw new CiFinderError("EXISTS", "Target already exists");
    try {
      await fs.rename(src, dst);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
      await this.copyRecursive(src, dst);
      await fs.rm(src, { recursive: true });
    }
  }

  async uploadChunk(chunk: UploadChunk): Promise<UploadChunkResult> {
    const dst = await this.safe(chunk.path);
    const dir = nodePath.dirname(dst);
    let session = chunk.session;
    if (!session) {
      session = `.${nodePath.basename(dst)}.${random()}${UPLOAD_SUFFIX}`;
    } else if (session.includes("/") || session.includes("\\") || !session.startsWith(".") || !session.endsWith(UPLOAD_SUFFIX)) {
      throw new CiFinderError("BAD_REQUEST", "Invalid upload session");
    }
    const tmp = nodePath.join(dir, session);
    const handle = await fs.open(tmp, chunk.session ? "r+" : "wx").catch((e) => {
      if (isMissing(e)) throw new CiFinderError("BAD_REQUEST", "Upload session expired");
      throw e;
    });
    try {
      await handle.write(chunk.data, 0, chunk.data.byteLength, chunk.offset);
    } finally {
      await handle.close();
    }

    const done = chunk.index === chunk.total - 1;
    if (done) {
      const { size } = await fs.stat(tmp);
      if (size !== chunk.size) {
        await fs.rm(tmp, { force: true });
        throw new CiFinderError("BAD_REQUEST", `Upload incomplete: received ${size} of ${chunk.size} bytes`);
      }
      await replaceFile(tmp, dst);
    }
    return { session, done };
  }

  async abortUpload(path: VolumePath, session: string): Promise<void> {
    if (session.includes("/") || session.includes("\\") || !session.endsWith(UPLOAD_SUFFIX)) return;
    const dir = nodePath.dirname(await this.safe(path));
    await fs.rm(nodePath.join(dir, session), { force: true });
  }

  /** Size and free space of the disk holding the root (Node >= 18.15 and Bun). */
  async capacity(): Promise<{ total: number; free: number } | null> {
    if (typeof fs.statfs !== "function") return null;
    const s = await fs.statfs(await this.getRealRoot());
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Atomically replaces `dst` with `tmp`. On Windows a rename over a file that is currently open
 * (e.g. being streamed to a browser) fails with EPERM/EACCES/EBUSY: retry briefly, then fall back
 * to copying the content over the destination, which shared-mode handles allow.
 */
async function replaceFile(tmp: string, dst: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, dst);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw e;
      if (attempt < 3) {
        await sleep(40 * (attempt + 1));
        continue;
      }
      await fs.copyFile(tmp, dst);
      await fs.rm(tmp, { force: true });
      return;
    }
  }
}

function isMissing(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.lstat(abs);
    return true;
  } catch {
    return false;
  }
}

/** Stores files on the local disk. Works on Node.js and Bun. */
export function localDriver(options: LocalDriverOptions): LocalDriver {
  return new LocalDriver(options);
}
