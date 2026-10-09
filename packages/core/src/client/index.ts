import type { Entry, FileVersion, ImageFormat, InitResult, StorageStats, TransformResult } from "../types";

export type { Entry, InitResult, VolumeInfo, EntryKind, FileVersion, ImageFormat, StorageStats, TransformResult, UsageCategory, VersionedFile } from "../types";
export { encodeId } from "../id";

export type ConflictMode = "rename" | "overwrite" | "skip";

export interface ClientOptions {
  /** URL of theFinder's API route, e.g. "/api/files". */
  endpoint: string;
  /** Extra headers (e.g. Authorization) sent with every request. */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** Send cookies cross-origin. Default: "same-origin". */
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface UploadProgress {
  loaded: number;
  total: number;
}

export interface UploadOptions {
  /** Folder (relative to the destination) to recreate, used for folder uploads: "photos/2024". */
  relativePath?: string;
  conflict?: "rename" | "overwrite";
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
}

export interface TransformOptions {
  /** Target format, or "keep" to stay in the source format. */
  format?: ImageFormat | "keep";
  /** Fit inside this box (aspect ratio kept, never upscaled). */
  width?: number;
  height?: number;
  quality?: number;
  /** Same-format results: overwrite the source (old content goes to the history) or save a copy. */
  output?: "overwrite" | "copy";
  /** Leave a file alone when the result is not smaller. Default: true. */
  skipLarger?: boolean;
  /** What to do when the output name (e.g. "photo.webp") is taken. Default: "rename". */
  conflict?: "rename" | "overwrite";
  /** Name suffix of same-format copies. Default: "optimized". */
  suffix?: string;
}

export type CleanupRequest =
  | { target: "cache" }
  | { target: "versions"; mode: "all" | "orphaned" }
  | { target: "versions"; mode: "older"; days: number }
  | { target: "versions"; mode: "keep"; keep: number };

export interface SizeResult {
  size: number;
  files: number;
  dirs: number;
}

export class TheFinderClient {
  readonly endpoint: string;
  private chunkSize = 5 * 1024 * 1024;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: ClientOptions) {
    this.endpoint = options.endpoint;
    this.fetchFn = options.fetch ?? ((...a) => fetch(...a));
  }

  private headers(): Record<string, string> {
    const h = typeof this.options.headers === "function" ? this.options.headers() : this.options.headers;
    return { ...h };
  }

  private url(params: Record<string, string>): string {
    const base = typeof location !== "undefined" ? location.href : "http://localhost/";
    const u = new URL(this.endpoint, base);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return this.endpoint.startsWith("http") ? u.toString() : u.pathname + u.search;
  }

  private async parse<T>(res: Response): Promise<T> {
    let body: { ok: boolean; data?: T; error?: { code: string; message: string } };
    try {
      body = await res.json();
    } catch {
      throw new ApiError("NETWORK", `Unexpected response (${res.status})`, res.status);
    }
    if (!body.ok) throw new ApiError(body.error?.code ?? "UNKNOWN", body.error?.message ?? "Request failed", res.status);
    return body.data as T;
  }

  async get<T>(cmd: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
    const res = await this.fetchFn(this.url({ cmd, ...params }), {
      headers: this.headers(),
      credentials: this.options.credentials ?? "same-origin",
      signal,
    });
    return this.parse<T>(res);
  }

  async post<T>(cmd: string, body: Record<string, unknown> | FormData, signal?: AbortSignal): Promise<T> {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    if (isForm) body.set("cmd", cmd);
    const res = await this.fetchFn(this.endpoint, {
      method: "POST",
      headers: { ...this.headers(), "x-thefinder": "1", ...(isForm ? {} : { "content-type": "application/json" }) },
      body: isForm ? body : JSON.stringify({ cmd, ...body }),
      credentials: this.options.credentials ?? "same-origin",
      signal,
    });
    return this.parse<T>(res);
  }

  async init(): Promise<InitResult> {
    const result = await this.get<InitResult>("init");
    this.chunkSize = result.chunkSize;
    return result;
  }

  ls(id: string, signal?: AbortSignal) {
    return this.get<{ cwd: Entry; entries: Entry[] }>("ls", { id }, signal);
  }
  tree(id: string) {
    return this.get<{ entries: Entry[] }>("tree", { id });
  }
  parents(id: string) {
    return this.get<{ entries: Entry[] }>("parents", { id });
  }
  info(ids: string[]) {
    return this.get<{ entries: Entry[] }>("info", { ids: ids.join(",") });
  }
  size(ids: string[]) {
    return this.get<SizeResult>("size", { ids: ids.join(",") });
  }
  search(id: string, q: string, signal?: AbortSignal) {
    return this.get<{ entries: Entry[]; truncated: boolean }>("search", { id, q }, signal);
  }
  mkdir(id: string, name: string) {
    return this.post<{ entry: Entry }>("mkdir", { id, name });
  }
  mkfile(id: string, name: string, content = "") {
    return this.post<{ entry: Entry }>("mkfile", { id, name, content });
  }
  rename(id: string, name: string) {
    return this.post<{ entry: Entry; removed: string[] }>("rename", { id, name });
  }
  duplicate(ids: string[]) {
    return this.post<{ added: Entry[] }>("duplicate", { ids });
  }
  /** Moves items to the trash, or deletes them for good with `permanent`. */
  rm(ids: string[], permanent = false) {
    return this.post<{ removed: string[]; trashed: Entry[] }>("rm", { ids, permanent });
  }
  /** Items in the trash of every volume (or one `volume`). */
  trash(volume?: string) {
    return this.get<{ entries: Entry[] }>("trash", volume ? { volume } : {});
  }
  restore(ids: string[]) {
    return this.post<{ restored: Entry[]; removed: string[] }>("restore", { ids });
  }
  /** Permanently deletes trash items. */
  purge(ids: string[]) {
    return this.post<{ removed: string[] }>("purge", { ids });
  }
  emptyTrash(volume?: string) {
    return this.post<{ all: true }>("purge", { all: true, volume });
  }
  paste(ids: string[], dst: string, cut: boolean, conflict: ConflictMode = "rename") {
    return this.post<{ added: Entry[]; removed: string[]; skipped: string[] }>("paste", { ids, dst, cut, conflict });
  }
  getContent(id: string) {
    return this.post<{ content: string; bom: boolean; entry: Entry }>("get", { id });
  }
  putContent(id: string, content: string) {
    return this.post<{ entry: Entry }>("put", { id, content });
  }
  /** Overwrites a file with binary content (e.g. an edited image). The old content goes to the history. */
  putBlob(id: string, blob: Blob, reason?: string) {
    const form = new FormData();
    form.set("id", id);
    if (reason) form.set("reason", reason);
    form.set("file", blob, "blob");
    return this.post<{ entry: Entry }>("put", form);
  }
  /** Saves binary content as a new file in `dst`; a free name is picked when `name` is taken. */
  saveBlobAs(dst: string, name: string, blob: Blob) {
    const form = new FormData();
    form.set("dst", dst);
    form.set("name", name);
    form.set("file", blob, name);
    return this.post<{ entry: Entry }>("put", form);
  }
  /** Version history of a file, newest first (`entry` is null when the file was deleted). */
  versions(id: string) {
    return this.get<{ versions: FileVersion[]; entry: Entry | null }>("versions", { id });
  }
  /** Replaces a file with one of its versions (recreates it when deleted). */
  revert(id: string, vid: string) {
    return this.post<{ entry: Entry; created: boolean }>("revert", { id, vid });
  }
  /** Deletes some versions of a file, or its whole history when `vids` is omitted. */
  rmVersions(id: string, vids?: string[]) {
    return this.post<{ removed: number; freed: number }>("rmVersions", vids ? { id, vids } : { id });
  }
  /** Storage dashboard numbers of one volume (scans the whole volume). */
  stats(volume: string, signal?: AbortSignal) {
    return this.get<StorageStats>("stats", { volume }, signal);
  }
  cleanup(volume: string, request: CleanupRequest) {
    return this.post<{ removed: number; freed: number }>("cleanup", { volume, ...request });
  }
  /** Bulk resize / recompress / convert images on the server. */
  transform(ids: string[], options: TransformOptions = {}, signal?: AbortSignal) {
    return this.post<{ results: TransformResult[] }>("transform", { ids, ...options }, signal);
  }
  archive(ids: string[], name?: string) {
    return this.post<{ entry: Entry }>("archive", { ids, name });
  }
  extract(id: string) {
    return this.post<{ entry: Entry; skipped: number }>("extract", { id });
  }

  /** URL that streams a file inline (used for previews when the volume has no public URL). */
  fileUrl(entry: Pick<Entry, "id" | "mtime">, download = false): string {
    return this.url({ cmd: "file", id: entry.id, v: String(entry.mtime), ...(download ? { download: "1" } : {}) });
  }

  /** URL of a server-generated thumbnail (falls back to the original on the server when unavailable). */
  thumbUrl(entry: Pick<Entry, "id" | "mtime">, size: number): string {
    return this.url({ cmd: "thumb", id: entry.id, size: String(size), v: String(entry.mtime) });
  }

  /** URL of a stored version of a file (inline, or as a download). */
  versionUrl(id: string, vid: string, download = false): string {
    return this.url({ cmd: "version", id, vid, ...(download ? { download: "1" } : {}) });
  }

  /** URL that downloads one file, or a ZIP of several files / folders. */
  downloadUrl(ids: string[]): string {
    return this.url({ cmd: "download", ids: ids.join(",") });
  }

  /** Uploads a file in chunks. Resolves with the created entry. */
  async upload(file: Blob & { name?: string }, dst: string, options: UploadOptions = {}): Promise<Entry> {
    const name = file.name || "file";
    const total = Math.max(1, Math.ceil(file.size / this.chunkSize));
    let session = "";
    for (let index = 0; index < total; index++) {
      if (options.signal?.aborted) {
        if (session) this.post("abort", { dst, session }).catch(() => {});
        throw new ApiError("ABORTED", "Upload cancelled", 0);
      }
      const offset = index * this.chunkSize;
      const chunk = file.slice(offset, Math.min(file.size, offset + this.chunkSize));
      const form = new FormData();
      form.set("cmd", "upload");
      form.set("dst", dst);
      form.set("name", name);
      form.set("size", String(file.size));
      form.set("index", String(index));
      form.set("total", String(total));
      form.set("offset", String(offset));
      if (session) form.set("session", session);
      if (options.relativePath) form.set("relativePath", options.relativePath);
      if (options.conflict) form.set("conflict", options.conflict);
      form.set("chunk", chunk, name);

      let result: { done: boolean; session: string; entry?: Entry };
      try {
        result = await this.sendChunk(form, (loaded) => options.onProgress?.({ loaded: offset + loaded, total: file.size }), options.signal);
      } catch (e) {
        if (session) this.post("abort", { dst, session }).catch(() => {});
        throw e;
      }
      session = result.session;
      options.onProgress?.({ loaded: Math.min(file.size, offset + chunk.size), total: file.size });
      if (result.done) return result.entry!;
    }
    throw new ApiError("UPLOAD", "Upload did not complete", 0);
  }

  /** Uses XHR in browsers for byte-level progress; falls back to fetch elsewhere. */
  private sendChunk(form: FormData, onProgress: (loaded: number) => void, signal?: AbortSignal) {
    type R = { done: boolean; session: string; entry?: Entry };
    if (typeof XMLHttpRequest === "undefined" || this.options.fetch) return this.post<R>("upload", form, signal);
    return new Promise<R>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", this.endpoint);
      xhr.withCredentials = this.options.credentials === "include";
      for (const [k, v] of Object.entries({ ...this.headers(), "x-thefinder": "1" })) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => onProgress(e.loaded);
      xhr.onload = () => {
        this.parse<R>(new Response(xhr.responseText, { status: xhr.status })).then(resolve, reject);
      };
      xhr.onerror = () => reject(new ApiError("NETWORK", "Network error", 0));
      xhr.onabort = () => reject(new ApiError("ABORTED", "Upload cancelled", 0));
      signal?.addEventListener("abort", () => xhr.abort(), { once: true });
      xhr.send(form);
    });
  }
}

export function createClient(options: ClientOptions): TheFinderClient {
  return new TheFinderClient(options);
}
