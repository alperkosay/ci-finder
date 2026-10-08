/** Absolute, normalized POSIX path inside a volume. The volume root is "/". */
export type VolumePath = string;

export type EntryKind = "file" | "dir";

/** Raw metadata returned by a storage driver. */
export interface DriverStat {
  name: string;
  path: VolumePath;
  kind: EntryKind;
  size: number;
  /** Last modification time in ms since epoch. */
  mtime: number;
}

export interface ByteRange {
  /** Inclusive start offset. */
  start: number;
  /** Inclusive end offset. */
  end: number;
}

export type WriteData = ReadableStream<Uint8Array> | Uint8Array | ArrayBuffer | string;

export interface UploadChunk {
  /** Final destination of the file. Already validated and conflict-free on the first chunk. */
  path: VolumePath;
  /** Opaque driver state returned by the previous chunk. Undefined on the first chunk. */
  session?: string;
  index: number;
  total: number;
  /** Total file size in bytes. */
  size: number;
  /** Byte offset of this chunk in the file. */
  offset: number;
  data: Uint8Array;
}

export interface UploadChunkResult {
  /** State to send back with the next chunk. */
  session: string;
  done: boolean;
}

/**
 * Storage backend contract. Every command in the engine is implemented on top of these
 * primitives, so adding a new backend (FTP, Azure, Google Drive...) means implementing this interface.
 *
 * Paths are always normalized volume paths ("/", "/docs/a.txt"); drivers never see "..".
 */
export interface StorageDriver {
  readonly kind: string;
  stat(path: VolumePath): Promise<DriverStat | null>;
  list(path: VolumePath): Promise<DriverStat[]>;
  /** Whether a directory has at least one sub-directory. Used for tree expanders. */
  hasSubdirs?(path: VolumePath): Promise<boolean>;
  mkdir(path: VolumePath): Promise<void>;
  read(path: VolumePath, range?: ByteRange): Promise<ReadableStream<Uint8Array>>;
  write(path: VolumePath, data: WriteData): Promise<void>;
  /** Removes a file, or a directory recursively. */
  remove(path: VolumePath): Promise<void>;
  /** Copies a file, or a directory recursively. Destination must not exist. */
  copy(from: VolumePath, to: VolumePath): Promise<void>;
  /** Moves/renames a file or directory. Destination must not exist. */
  move(from: VolumePath, to: VolumePath): Promise<void>;
  uploadChunk(chunk: UploadChunk): Promise<UploadChunkResult>;
  abortUpload?(path: VolumePath, session: string): Promise<void>;
  /**
   * Optional fast recursive search below `path`. Return entries whose name satisfies `match`,
   * at most `limit`. The engine falls back to a tree walk when missing.
   */
  search?(path: VolumePath, match: (name: string) => boolean, limit: number): Promise<DriverStat[]>;
  /**
   * Optional direct URL for a file (e.g. an S3 presigned URL). When it returns a URL the
   * engine redirects instead of streaming the file through the server.
   */
  signedUrl?(path: VolumePath, options: { download?: boolean; filename?: string; expiresIn?: number }): Promise<string | null>;
}

export interface VolumeOptions {
  /** Short, URL-safe identifier. Used as the prefix of every entry id. */
  id: string;
  /** Display name of the root folder. */
  name?: string;
  driver: StorageDriver;
  /**
   * Public base URL the files are served from (e.g. "/uploads" or "https://cdn.example.com").
   * When set, entries carry a direct `url` the UI uses for thumbnails and previews.
   */
  url?: string;
  readOnly?: boolean;
  /** Show dot files. Default: false. */
  showHidden?: boolean;
  /** Lowercase extensions (without dot) that are allowed. Empty/undefined means all. */
  allowExtensions?: string[];
  /** Lowercase extensions (without dot) that are rejected for uploads and renames. */
  denyExtensions?: string[];
  /** Max size of a single uploaded file in bytes. */
  maxUploadSize?: number;
  /** Fine grained permission check. Return false to deny the action on that path. */
  permission?: (action: Action, path: VolumePath) => boolean;
  /**
   * Trash: deleted items are moved to a hidden `.cf-trash` folder inside the volume and can be
   * restored. No database involved. `false` deletes permanently. Default: enabled, kept 30 days.
   */
  trash?: boolean | { retentionDays?: number };
}

export type Action = "read" | "write" | "delete";

export interface Entry {
  id: string;
  /** Id of the parent directory, null for a volume root. */
  parent: string | null;
  volume: string;
  name: string;
  path: VolumePath;
  kind: EntryKind;
  size: number;
  mtime: number;
  mime: string;
  read: boolean;
  write: boolean;
  /** Volume roots are locked: they cannot be renamed, moved or removed. */
  locked?: boolean;
  /** Only set by the `tree` command. */
  hasDirs?: boolean;
  /** Direct public URL when the volume defines one. */
  url?: string;
  /** Only on items returned by the trash commands. `path` is then the original location. */
  trash?: { id: string; originalPath: VolumePath; deletedAt: number };
}

export interface VolumeInfo {
  id: string;
  name: string;
  /** Driver kind ("local", "s3", ...), useful for picking an icon. */
  kind: string;
  root: Entry;
  readOnly: boolean;
  maxUploadSize: number | null;
  allowExtensions: string[] | null;
  denyExtensions: string[];
  /** null when the trash is disabled for this volume. */
  trash: { retentionDays: number; count: number } | null;
}

export interface InitResult {
  volumes: VolumeInfo[];
  chunkSize: number;
  version: string;
}

export interface CommandContext {
  cmd: string;
  request: Request;
  params: Record<string, unknown>;
}

export interface CiFinderOptions {
  volumes: VolumeOptions[];
  /**
   * Upload chunk size in bytes. Must be >= 5 MiB when an S3 volume is used (S3 multipart minimum).
   * Default: 5 MiB.
   */
  chunkSize?: number;
  /** Called before every command. Return false (or throw) to reject the request with 403. */
  authorize?: (ctx: CommandContext) => boolean | Promise<boolean>;
  onBeforeCommand?: (ctx: CommandContext) => void | Promise<void>;
  onAfterCommand?: (ctx: CommandContext & { result: unknown }) => void | Promise<void>;
  /** Max size for the text editor `get`/`put` commands. Default: 5 MiB. */
  maxEditSize?: number;
  /** Max number of results returned by `search`. Default: 500. */
  searchLimit?: number;
  /** Max total uncompressed size when extracting an archive (zip bomb guard). Default: 4 GiB. */
  maxExtractSize?: number;
  /**
   * Require the `x-ci-finder` header on POST requests. Browsers cannot attach custom headers to
   * cross-site form submissions, so this blocks CSRF. Default: true.
   */
  csrfProtection?: boolean;
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
