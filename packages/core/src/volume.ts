import { CiFinderError } from "./errors";
import { encodeId } from "./id";
import { DIRECTORY_MIME, mimeOf } from "./mime";
import { assertValidName, basename, dirname, extname, joinPath, numberedName } from "./path";
import { countTrash, isReservedPath, RESERVED_NAMES } from "./trash";
import type { Action, DriverStat, Entry, StorageDriver, VolumeInfo, VolumeOptions, VolumePath } from "./types";

const VOLUME_ID = /^[a-zA-Z0-9-]{1,32}$/;

export class Volume {
  readonly id: string;
  readonly name: string;
  readonly driver: StorageDriver;
  private readonly baseUrl: string | null;
  readonly trash: { enabled: boolean; retentionDays: number };

  constructor(readonly options: VolumeOptions) {
    if (!VOLUME_ID.test(options.id)) {
      throw new Error(`ciFinder: volume id "${options.id}" must match ${VOLUME_ID} (letters, digits and dashes)`);
    }
    if (!options.driver) throw new Error(`ciFinder: volume "${options.id}" has no driver`);
    this.id = options.id;
    this.name = options.name ?? options.id;
    this.driver = options.driver;
    this.baseUrl = options.url ? options.url.replace(/\/+$/, "") : null;
    const trash = options.trash ?? true;
    this.trash = {
      enabled: trash !== false && !options.readOnly,
      retentionDays: typeof trash === "object" ? (trash.retentionDays ?? 30) : 30,
    };
  }

  get readOnly(): boolean {
    return !!this.options.readOnly;
  }

  isHiddenName(name: string): boolean {
    return !this.options.showHidden && name.startsWith(".");
  }

  /** True when any segment of the path is hidden. Hidden paths behave as if they did not exist. */
  isHiddenPath(path: VolumePath): boolean {
    if (isReservedPath(path)) return true; // trash and thumbnail cache are never reachable directly
    if (this.options.showHidden) return false;
    return path.split("/").some((s) => s.startsWith("."));
  }

  can(action: Action, path: VolumePath): boolean {
    if (action !== "read" && this.readOnly) return false;
    return this.options.permission ? this.options.permission(action, path) !== false : true;
  }

  assertCan(action: Action, path: VolumePath): void {
    if (action !== "read" && this.readOnly) throw new CiFinderError("READ_ONLY", "This volume is read-only");
    if (!this.can(action, path)) throw new CiFinderError("FORBIDDEN", "Permission denied");
  }

  /** Root cannot be renamed, moved or deleted. */
  assertNotRoot(path: VolumePath): void {
    if (path === "/") throw new CiFinderError("LOCKED", "The root folder cannot be changed");
  }

  assertExtensionAllowed(name: string): void {
    const ext = extname(name);
    const { allowExtensions, denyExtensions } = this.options;
    if (denyExtensions?.length && denyExtensions.includes(ext)) {
      throw new CiFinderError("EXTENSION_DENIED", `".${ext}" files are not allowed`);
    }
    if (allowExtensions?.length && !allowExtensions.includes(ext)) {
      throw new CiFinderError("EXTENSION_DENIED", ext ? `".${ext}" files are not allowed` : "Files without an extension are not allowed");
    }
  }

  async stat(path: VolumePath): Promise<DriverStat> {
    if (this.isHiddenPath(path)) throw new CiFinderError("NOT_FOUND", "File not found");
    const stat = await this.driver.stat(path);
    if (!stat) throw new CiFinderError("NOT_FOUND", "File not found");
    return stat;
  }

  async statDir(path: VolumePath): Promise<DriverStat> {
    const stat = await this.stat(path);
    if (stat.kind !== "dir") throw new CiFinderError("NOT_A_DIRECTORY", "Not a folder");
    return stat;
  }

  async list(path: VolumePath): Promise<DriverStat[]> {
    const items = await this.driver.list(path);
    return items.filter((s) => !this.isHiddenName(s.name) && !(path === "/" && RESERVED_NAMES.has(s.name)));
  }

  /** Rejects creating anything at a reserved location (the trash folder). */
  assertCreatable(path: VolumePath): void {
    if (isReservedPath(path)) throw new CiFinderError("INVALID_NAME", "This name is reserved");
  }

  /** Picks "name", "name (2)", "name (3)"... whichever does not exist yet in `dir`. */
  async uniqueName(dir: VolumePath, name: string, isDir: boolean): Promise<string> {
    if (!(await this.driver.stat(joinPath(dir, name)))) return name;
    const taken = new Set((await this.driver.list(dir)).map((s) => s.name.toLowerCase()));
    for (let n = 2; ; n++) {
      const candidate = numberedName(name, n, isDir);
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  /** Creates every missing folder along `path`. */
  async mkdirp(path: VolumePath): Promise<void> {
    if (path === "/") return;
    const existing = await this.driver.stat(path);
    if (existing) {
      if (existing.kind !== "dir") throw new CiFinderError("NOT_A_DIRECTORY", `"${basename(path)}" is not a folder`);
      return;
    }
    await this.mkdirp(dirname(path));
    await this.driver.mkdir(path);
  }

  validateName(name: unknown): string {
    assertValidName(name);
    return name;
  }

  urlFor(path: VolumePath): string | undefined {
    if (!this.baseUrl || path === "/") return undefined;
    return this.baseUrl + path.split("/").map(encodeURIComponent).join("/");
  }

  entry(stat: DriverStat): Entry {
    const isRoot = stat.path === "/";
    const entry: Entry = {
      id: encodeId(this.id, stat.path),
      parent: isRoot ? null : encodeId(this.id, dirname(stat.path)),
      volume: this.id,
      name: isRoot ? this.name : stat.name,
      path: stat.path,
      kind: stat.kind,
      size: stat.kind === "dir" ? 0 : stat.size,
      mtime: stat.mtime,
      mime: stat.kind === "dir" ? DIRECTORY_MIME : mimeOf(stat.name),
      read: this.can("read", stat.path),
      write: this.can("write", stat.path),
    };
    if (isRoot) entry.locked = true;
    if (stat.kind === "file") {
      const url = this.urlFor(stat.path);
      if (url) entry.url = url;
    }
    return entry;
  }

  async info(): Promise<VolumeInfo> {
    let root = await this.driver.stat("/");
    if (!root) {
      await this.driver.mkdir("/");
      root = (await this.driver.stat("/")) ?? { name: "", path: "/", kind: "dir", size: 0, mtime: Date.now() };
    }
    return {
      id: this.id,
      name: this.name,
      kind: this.driver.kind,
      root: this.entry(root),
      readOnly: this.readOnly,
      maxUploadSize: this.options.maxUploadSize ?? null,
      allowExtensions: this.options.allowExtensions?.length ? this.options.allowExtensions : null,
      denyExtensions: this.options.denyExtensions ?? [],
      trash: this.trash.enabled ? { retentionDays: this.trash.retentionDays, count: await countTrash(this).catch(() => 0) } : null,
    };
  }
}
