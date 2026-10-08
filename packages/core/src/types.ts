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
  /** Optional size of the underlying disk, shown on the storage dashboard. Null when unknown. */
  capacity?(): Promise<{ total: number; free: number } | null>;
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
  /**
   * Version history: before a file is overwritten (editor save, image optimization, upload with
   * "replace") its previous content is kept in a hidden `.cf-versions` folder of the volume and can
   * be restored. No database involved. `false` disables. Default: enabled, 20 versions per file,
   * kept until removed from the storage dashboard.
   */
  versions?: boolean | { maxPerFile?: number; retentionDays?: number };
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
  /** null when version history is disabled for this volume. `retentionDays` 0 keeps versions forever. */
  versions: { maxPerFile: number; retentionDays: number } | null;
}

export interface InitResult {
  volumes: VolumeInfo[];
  chunkSize: number;
  version: string;
  /** Present when server-side thumbnails are enabled. */
  thumbnails: { sizes: number[]; extensions: string[] } | null;
  /** Present when server-side image processing (bulk resize / compress / convert) is enabled. */
  images: { extensions: string[]; formats: ImageFormat[] } | null;
}

/** A previous state of a file, kept by the version history. */
export interface FileVersion {
  /** Version id, unique per file. */
  id: string;
  size: number;
  /** When the version was taken, i.e. when the file was overwritten (ms since epoch). */
  createdAt: number;
  /** What replaced this content: "edit", "optimize", "upload", "revert"... */
  reason: string;
}

export type UsageCategory = "image" | "video" | "audio" | "document" | "archive" | "code" | "other";

/** A file with a version history, as listed on the storage dashboard. */
export interface VersionedFile {
  /** Entry id of the file (also valid when the file no longer exists). */
  id: string;
  path: VolumePath;
  name: string;
  /** False when the file was deleted or moved outside ciFinder; its versions are "orphaned". */
  exists: boolean;
  count: number;
  size: number;
  /** Time of the newest version. */
  latest: number;
}

/** Storage dashboard numbers of one volume. */
export interface StorageStats {
  volume: string;
  /** User files only (trash, versions and thumbnail cache are reported separately). */
  files: number;
  dirs: number;
  size: number;
  categories: Record<UsageCategory, { files: number; size: number }>;
  /** Biggest user files, largest first. */
  largest: Entry[];
  versions: { files: number; count: number; size: number; orphaned: number; items: VersionedFile[] };
  trash: { count: number; size: number };
  cache: { files: number; size: number };
  /** Disk size when the driver can tell (local disk). */
  capacity: { total: number; free: number } | null;
  /** True when the volume was too big to scan completely. */
  truncated: boolean;
  scannedAt: number;
}

export type ImageFormat = "jpeg" | "png" | "webp" | "avif" | "gif";

export interface ImageTransformOptions {
  /** Output format. */
  format: ImageFormat;
  /** Fit inside this box (keeps the aspect ratio, never upscales). */
  width?: number;
  height?: number;
  /** 1–100. For PNG a value below 100 enables palette quantization. Default: 80. */
  quality?: number;
}

/** Outcome of one file in a `transform` (bulk image) request. */
export interface TransformResult {
  /** Id of the source file. */
  id: string;
  name: string;
  /** Size of the source in bytes. */
  before: number;
  /** Size of the produced image. */
  after?: number;
  width?: number;
  height?: number;
  /** The written file: the source itself when overwritten, or the new copy. */
  entry?: Entry;
  /** True when a new file was created next to the source. */
  created?: boolean;
  /** "larger": the result was not smaller; "unsupported": the format cannot be processed. */
  skipped?: "larger" | "unsupported";
  /** Error code when this file failed. */
  error?: string;
}

/** Resizes, recompresses and converts images. See `sharpImages` in `@ci-finder/core/sharp`. */
export interface ImageProcessor {
  /** Lowercase file extensions it can read. */
  extensions: string[];
  /** Formats it can write. */
  formats: ImageFormat[];
  transform(input: Uint8Array, options: ImageTransformOptions): Promise<{ data: Uint8Array; width: number; height: number }>;
}

/** Turns image bytes into a small preview. See `sharpThumbnailer` in `@ci-finder/core/sharp`. */
export interface Thumbnailer {
  /** Lowercase file extensions the generator can read. */
  extensions: string[];
  /** Extension of the produced files. Default: "webp". */
  extension?: string;
  /** Returns the encoded thumbnail, fitting inside `size`×`size`. */
  generate(input: Uint8Array, size: number): Promise<Uint8Array>;
}

export interface ThumbnailOptions {
  generator: Thumbnailer;
  /** Allowed sizes in px; requests snap to the nearest one. Default: [128, 256, 512]. */
  sizes?: number[];
  /** Larger source files are not thumbnailed (served as-is). Default: 40 MiB. */
  maxInputSize?: number;
  /** Max thumbnails generated at the same time. Default: 2. */
  concurrency?: number;
}

export type AuthorizeResult = boolean | void | { readOnly?: boolean };

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
  /**
   * Called before every command.
   * - `false` rejects the request with 403; throw `new CiFinderError("UNAUTHORIZED")` for 401.
   * - `{ readOnly: true }` lets the request through but makes every volume read-only for it
   *   (e.g. a "viewer" role); the UI hides write actions automatically.
   */
  authorize?: (ctx: CommandContext) => AuthorizeResult | Promise<AuthorizeResult>;
  onBeforeCommand?: (ctx: CommandContext) => void | Promise<void>;
  onAfterCommand?: (ctx: CommandContext & { result: unknown }) => void | Promise<void>;
  /** Max size for the text editor `get`/`put` commands. Default: 5 MiB. */
  maxEditSize?: number;
  /** Max number of results returned by `search`. Default: 500. */
  searchLimit?: number;
  /** Server-side thumbnails, cached in a hidden `.cf-thumbs` folder of each volume. */
  thumbnails?: ThumbnailOptions;
  /** Server-side image processing for the bulk resize / compress / convert dialog. */
  images?: ImageProcessor;
  /** Larger images are refused by the image processor. Default: 60 MiB. */
  maxImageSize?: number;
  /** Max total uncompressed size when extracting an archive (zip bomb guard). Default: 4 GiB. */
  maxExtractSize?: number;
  /**
   * Require the `x-ci-finder` header on POST requests. Browsers cannot attach custom headers to
   * cross-site form submissions, so this blocks CSRF. Default: true.
   */
  csrfProtection?: boolean;
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
