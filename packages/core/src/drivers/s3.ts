import { CiFinderError } from "../errors";
import { mimeOf } from "../mime";
import { contentDisposition } from "../serve";
import { concatBytes, mapLimit, toUint8 } from "../stream";
import type { ByteRange, DriverStat, StorageDriver, UploadChunk, UploadChunkResult, VolumePath, WriteData } from "../types";
import { buildQuery, encodeKey, presignUrl, signRequest, type Credentials } from "./sigv4";

export interface S3DriverOptions {
  bucket: string;
  /** Default: "us-east-1". Use "auto" for Cloudflare R2. */
  region?: string;
  /**
   * Custom endpoint for S3-compatible services, e.g. "https://<account>.r2.cloudflarestorage.com",
   * "http://localhost:9000" (MinIO), "https://fra1.digitaloceanspaces.com".
   */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Key prefix used as the volume root, e.g. "uploads/". Default: bucket root. */
  prefix?: string;
  /** Path-style URLs (endpoint/bucket/key). Default: true with a custom endpoint, false for AWS. */
  forcePathStyle?: boolean;
  /**
   * How file content reaches the browser when the volume has no public `url`:
   * - "presigned" (default): redirect to a short-lived presigned URL, no traffic through your server.
   * - "proxy": stream through your server (works with private buckets behind strict networks).
   */
  delivery?: "presigned" | "proxy";
  /** Lifetime of presigned URLs in seconds. Default: 3600. */
  presignExpiresIn?: number;
  /** Part size for streamed writes (archives, cross-volume copies). Min 5 MiB. Default: 8 MiB. */
  partSize?: number;
  /** Custom fetch implementation. */
  fetch?: typeof fetch;
}

interface S3Object {
  key: string;
  size: number;
  mtime: number;
}

interface ListPage {
  objects: S3Object[];
  prefixes: string[];
  next?: string;
}

const MiB = 1024 * 1024;
/** Above this size CopyObject is not allowed; such objects are copied by streaming. */
const MAX_COPY_SIZE = 5 * 1024 * MiB;

// --- tiny XML helpers (S3 responses have a fixed, flat shape) -----------------------------------

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1]!);
  return out;
}

function value(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? decodeXml(m[1]!) : undefined;
}

// -------------------------------------------------------------------------------------------------

export class S3Driver implements StorageDriver {
  readonly kind = "s3";
  private readonly bucket: string;
  private readonly region: string;
  private readonly credentials: Credentials;
  private readonly prefix: string;
  private readonly base: string;
  private readonly pathStyle: boolean;
  private readonly delivery: "presigned" | "proxy";
  private readonly expiresIn: number;
  private readonly partSize: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: S3DriverOptions) {
    for (const k of ["bucket", "accessKeyId", "secretAccessKey"] as const) {
      if (!options?.[k]) throw new Error(`ciFinder s3Driver: \`${k}\` is required`);
    }
    this.bucket = options.bucket;
    this.region = options.region ?? "us-east-1";
    this.credentials = { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, sessionToken: options.sessionToken };
    const prefix = (options.prefix ?? "").replace(/^\/+|\/+$/g, "");
    this.prefix = prefix ? prefix + "/" : "";
    this.pathStyle = options.forcePathStyle ?? !!options.endpoint;
    const endpoint = (options.endpoint ?? `https://s3.${this.region}.amazonaws.com`).replace(/\/+$/, "");
    if (this.pathStyle) {
      this.base = `${endpoint}/${encodeKey(this.bucket)}`;
    } else {
      const u = new URL(endpoint);
      this.base = `${u.protocol}//${this.bucket}.${u.host}`;
    }
    this.delivery = options.delivery ?? "presigned";
    this.expiresIn = options.presignExpiresIn ?? 3600;
    this.partSize = Math.max(5 * MiB, options.partSize ?? 8 * MiB);
    this.fetchFn = options.fetch ?? ((...args) => fetch(...args));
  }

  // --- key mapping -----------------------------------------------------------------------------

  private key(path: VolumePath): string {
    return this.prefix + path.slice(1);
  }

  private dirKey(path: VolumePath): string {
    return path === "/" ? this.prefix : this.key(path) + "/";
  }

  private pathOf(key: string): VolumePath {
    return "/" + key.slice(this.prefix.length).replace(/\/$/, "");
  }

  private url(key: string, query?: Record<string, string | undefined>): URL {
    const q = query ? buildQuery(query) : "";
    const path = key ? `/${encodeKey(key)}` : this.pathStyle ? "" : "/";
    return new URL(`${this.base}${path}${q ? `?${q}` : ""}`);
  }

  // --- transport -------------------------------------------------------------------------------

  private async send(
    method: string,
    key: string,
    init: { query?: Record<string, string | undefined>; headers?: Record<string, string>; body?: Uint8Array | string; allow?: number[] } = {},
  ): Promise<Response> {
    const url = this.url(key, init.query);
    const headers = await signRequest({ method, url, headers: init.headers, region: this.region, credentials: this.credentials });
    const res = await this.fetchFn(url, { method, headers, body: init.body as BodyInit | undefined });
    if (res.ok || init.allow?.includes(res.status)) return res;
    throw await this.error(res);
  }

  private async error(res: Response): Promise<CiFinderError> {
    const text = await res.text().catch(() => "");
    const code = value(text, "Code") ?? String(res.status);
    const message = value(text, "Message") ?? res.statusText;
    if (res.status === 404 || code === "NoSuchKey") return new CiFinderError("NOT_FOUND", "File not found");
    if (res.status === 403) return new CiFinderError("FORBIDDEN", `S3 denied the request: ${message}`);
    return new CiFinderError("STORAGE", `S3 error ${code}: ${message}`);
  }

  /** Some S3 operations (CopyObject, CompleteMultipartUpload) report errors inside a 200 body. */
  private async checkedXml(res: Response): Promise<string> {
    const text = await res.text();
    if (/<Error>/.test(text)) {
      throw new CiFinderError("STORAGE", `S3 error ${value(text, "Code")}: ${value(text, "Message")}`);
    }
    return text;
  }

  private async listPage(prefix: string, delimiter: string | undefined, token?: string, maxKeys = 1000): Promise<ListPage> {
    const res = await this.send("GET", "", {
      query: {
        "list-type": "2",
        prefix,
        delimiter,
        "continuation-token": token,
        "max-keys": String(maxKeys),
      },
    });
    const xml = await res.text();
    const objects = blocks(xml, "Contents").map((b) => ({
      key: value(b, "Key") ?? "",
      size: Number(value(b, "Size") ?? 0),
      mtime: Date.parse(value(b, "LastModified") ?? "") || 0,
    }));
    const prefixes = blocks(xml, "CommonPrefixes").map((b) => value(b, "Prefix") ?? "");
    const truncated = value(xml, "IsTruncated") === "true";
    return { objects, prefixes, next: truncated ? value(xml, "NextContinuationToken") : undefined };
  }

  private async *listAll(prefix: string, delimiter?: string): AsyncGenerator<ListPage> {
    let token: string | undefined;
    do {
      const page = await this.listPage(prefix, delimiter, token);
      yield page;
      token = page.next;
    } while (token);
  }

  // --- StorageDriver ---------------------------------------------------------------------------

  async stat(path: VolumePath): Promise<DriverStat | null> {
    if (path === "/") return { name: "", path, kind: "dir", size: 0, mtime: 0 };
    const name = path.slice(path.lastIndexOf("/") + 1);
    const head = await this.send("HEAD", this.key(path), { allow: [404] });
    if (head.status !== 404) {
      return {
        name,
        path,
        kind: "file",
        size: Number(head.headers.get("content-length") ?? 0),
        mtime: Date.parse(head.headers.get("last-modified") ?? "") || 0,
      };
    }
    const dirKey = this.dirKey(path);
    const page = await this.listPage(dirKey, "/", undefined, 1);
    if (!page.objects.length && !page.prefixes.length) return null;
    const marker = page.objects.find((o) => o.key === dirKey);
    return { name, path, kind: "dir", size: 0, mtime: marker?.mtime ?? 0 };
  }

  async list(path: VolumePath): Promise<DriverStat[]> {
    const dirKey = this.dirKey(path);
    const out: DriverStat[] = [];
    for await (const page of this.listAll(dirKey, "/")) {
      for (const p of page.prefixes) {
        const name = p.slice(dirKey.length, -1);
        if (name) out.push({ name, path: this.pathOf(p), kind: "dir", size: 0, mtime: 0 });
      }
      for (const o of page.objects) {
        const name = o.key.slice(dirKey.length);
        if (!name || name.includes("/")) continue; // directory marker of `path` itself
        out.push({ name, path: this.pathOf(o.key), kind: "file", size: o.size, mtime: o.mtime });
      }
    }
    return out;
  }

  async hasSubdirs(path: VolumePath): Promise<boolean> {
    const page = await this.listPage(this.dirKey(path), "/");
    return page.prefixes.some((p) => !p.slice(this.dirKey(path).length).startsWith("."));
  }

  async mkdir(path: VolumePath): Promise<void> {
    if (path === "/") return;
    await this.send("PUT", this.dirKey(path), { body: new Uint8Array(0), headers: { "content-type": "application/x-directory" } });
  }

  async read(path: VolumePath, range?: ByteRange): Promise<ReadableStream<Uint8Array>> {
    const res = await this.send("GET", this.key(path), {
      headers: range ? { range: `bytes=${range.start}-${range.end}` } : undefined,
    });
    return res.body ?? new ReadableStream({ start: (c) => c.close() });
  }

  async write(path: VolumePath, data: WriteData): Promise<void> {
    const key = this.key(path);
    const contentType = mimeOf(path);
    if (!(data instanceof ReadableStream)) {
      await this.send("PUT", key, { body: toUint8(data), headers: { "content-type": contentType } });
      return;
    }

    // Stream into a multipart upload, buffering one part at a time.
    const reader = data.getReader();
    let buffered: Uint8Array[] = [];
    let bufferedSize = 0;
    let uploadId: string | undefined;
    let partNumber = 0;
    const parts: { n: number; etag: string }[] = [];

    const flush = async () => {
      const body = concatBytes(buffered, bufferedSize);
      buffered = [];
      bufferedSize = 0;
      uploadId ??= await this.createMultipart(key, contentType);
      partNumber++;
      parts.push({ n: partNumber, etag: await this.uploadPart(key, uploadId, partNumber, body) });
    };

    try {
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffered.push(chunk);
        bufferedSize += chunk.byteLength;
        if (bufferedSize >= this.partSize) await flush();
      }
      if (!uploadId) {
        await this.send("PUT", key, { body: concatBytes(buffered, bufferedSize), headers: { "content-type": contentType } });
        return;
      }
      if (bufferedSize > 0) await flush();
      await this.completeMultipart(key, uploadId, parts);
    } catch (e) {
      await reader.cancel().catch(() => {});
      if (uploadId) await this.send("DELETE", key, { query: { uploadId } }).catch(() => {});
      throw e;
    }
  }

  async remove(path: VolumePath): Promise<void> {
    const stat = await this.stat(path);
    if (!stat) return;
    if (stat.kind === "file") {
      await this.send("DELETE", this.key(path));
      return;
    }
    const keys: string[] = [];
    for await (const page of this.listAll(this.dirKey(path))) keys.push(...page.objects.map((o) => o.key));
    await mapLimit(keys, 8, (k) => this.send("DELETE", k, { allow: [404] }));
    await this.send("DELETE", this.dirKey(path), { allow: [404] });
  }

  private async copyObject(from: string, to: string, size: number): Promise<void> {
    if (size > MAX_COPY_SIZE) {
      const res = await this.send("GET", from);
      await this.write(this.pathOf(to), res.body!);
      return;
    }
    const res = await this.send("PUT", to, {
      headers: { "x-amz-copy-source": `/${encodeKey(this.bucket)}/${encodeKey(from)}`, "x-amz-metadata-directive": "COPY" },
    });
    await this.checkedXml(res);
  }

  async copy(from: VolumePath, to: VolumePath): Promise<void> {
    const stat = await this.stat(from);
    if (!stat) throw new CiFinderError("NOT_FOUND", "File not found");
    if (await this.stat(to)) throw new CiFinderError("EXISTS", "Target already exists");
    if (stat.kind === "file") {
      await this.copyObject(this.key(from), this.key(to), stat.size);
      return;
    }
    const src = this.dirKey(from);
    const dst = this.dirKey(to);
    await this.send("PUT", dst, { body: new Uint8Array(0), headers: { "content-type": "application/x-directory" } });
    const objects: S3Object[] = [];
    for await (const page of this.listAll(src)) objects.push(...page.objects.filter((o) => o.key !== src));
    await mapLimit(objects, 8, (o) => this.copyObject(o.key, dst + o.key.slice(src.length), o.size));
  }

  async move(from: VolumePath, to: VolumePath): Promise<void> {
    if (from === to) return;
    // Case-only renames would make copy() see the target as existing on case-insensitive gateways.
    if (from.toLowerCase() === to.toLowerCase()) {
      const tmp = `${to}.cf-move-${Math.random().toString(36).slice(2, 8)}`;
      await this.move(from, tmp);
      await this.move(tmp, to);
      return;
    }
    await this.copy(from, to);
    await this.remove(from);
  }

  // --- multipart -------------------------------------------------------------------------------

  private async createMultipart(key: string, contentType: string): Promise<string> {
    const res = await this.send("POST", key, { query: { uploads: "" }, headers: { "content-type": contentType } });
    const id = value(await res.text(), "UploadId");
    if (!id) throw new CiFinderError("STORAGE", "S3 did not return an upload id");
    return id;
  }

  private async uploadPart(key: string, uploadId: string, partNumber: number, body: Uint8Array): Promise<string> {
    const res = await this.send("PUT", key, { query: { partNumber: String(partNumber), uploadId }, body });
    return res.headers.get("etag") ?? "";
  }

  private async completeMultipart(key: string, uploadId: string, parts: { n: number; etag: string }[]): Promise<void> {
    const xml =
      "<CompleteMultipartUpload>" +
      parts.map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`).join("") +
      "</CompleteMultipartUpload>";
    const res = await this.send("POST", key, { query: { uploadId }, body: xml, headers: { "content-type": "application/xml" } });
    await this.checkedXml(res);
  }

  private async listParts(key: string, uploadId: string): Promise<{ n: number; etag: string }[]> {
    const parts: { n: number; etag: string }[] = [];
    let marker: string | undefined;
    for (;;) {
      const res = await this.send("GET", key, { query: { uploadId, "part-number-marker": marker } });
      const xml = await res.text();
      for (const b of blocks(xml, "Part")) parts.push({ n: Number(value(b, "PartNumber")), etag: value(b, "ETag") ?? "" });
      if (value(xml, "IsTruncated") !== "true") break;
      marker = value(xml, "NextPartNumberMarker");
      if (!marker) break;
    }
    return parts.sort((a, b) => a.n - b.n);
  }

  /**
   * Browser chunks map 1:1 to multipart parts. The S3 UploadId is the session, so the server keeps
   * no state between requests (works on serverless and across instances).
   */
  async uploadChunk(chunk: UploadChunk): Promise<UploadChunkResult> {
    const key = this.key(chunk.path);
    const contentType = mimeOf(chunk.path);
    if (chunk.total === 1) {
      if (chunk.data.byteLength !== chunk.size) throw new CiFinderError("BAD_REQUEST", "Upload incomplete");
      await this.send("PUT", key, { body: chunk.data, headers: { "content-type": contentType } });
      return { session: "single", done: true };
    }
    const uploadId = chunk.session ?? (await this.createMultipart(key, contentType));
    await this.uploadPart(key, uploadId, chunk.index + 1, chunk.data);
    const done = chunk.index === chunk.total - 1;
    if (done) {
      const parts = await this.listParts(key, uploadId);
      if (parts.length !== chunk.total) {
        await this.abortUpload(chunk.path, uploadId);
        throw new CiFinderError("BAD_REQUEST", `Upload incomplete: ${parts.length} of ${chunk.total} parts received`);
      }
      await this.completeMultipart(key, uploadId, parts);
    }
    return { session: uploadId, done };
  }

  async abortUpload(path: VolumePath, session: string): Promise<void> {
    if (session === "single") return;
    await this.send("DELETE", this.key(path), { query: { uploadId: session }, allow: [404] });
  }

  // --- search & delivery -----------------------------------------------------------------------

  async search(path: VolumePath, match: (name: string) => boolean, limit: number): Promise<DriverStat[]> {
    const root = this.dirKey(path);
    const out: DriverStat[] = [];
    const seenDirs = new Set<string>();
    let scanned = 0;
    for await (const page of this.listAll(root)) {
      for (const o of page.objects) {
        const rel = o.key.slice(root.length);
        const segments = rel.split("/");
        // Folders only exist implicitly through their keys; surface each one once.
        for (let i = 0; i < segments.length - 1; i++) {
          const dirRel = segments.slice(0, i + 1).join("/");
          if (!segments[i] || seenDirs.has(dirRel)) continue;
          seenDirs.add(dirRel);
          if (match(segments[i]!)) out.push({ name: segments[i]!, path: this.pathOf(root + dirRel), kind: "dir", size: 0, mtime: 0 });
        }
        const name = segments[segments.length - 1]!;
        if (name && match(name)) out.push({ name, path: this.pathOf(o.key), kind: "file", size: o.size, mtime: o.mtime });
        if (out.length >= limit) return out;
      }
      scanned += page.objects.length;
      if (scanned > 100_000) break; // keep a single search request bounded
    }
    return out;
  }

  async signedUrl(path: VolumePath, options: { download?: boolean; filename?: string; expiresIn?: number }): Promise<string | null> {
    if (this.delivery !== "presigned") return null;
    const filename = options.filename ?? path.slice(path.lastIndexOf("/") + 1);
    const url = this.url(this.key(path), {
      "response-content-disposition": contentDisposition(options.download ? "attachment" : "inline", filename),
    });
    return presignUrl({ url, region: this.region, credentials: this.credentials, expiresIn: options.expiresIn ?? this.expiresIn });
  }
}

/** Stores files in AWS S3 or any S3-compatible service (R2, MinIO, Spaces, B2). No AWS SDK needed. */
export function s3Driver(options: S3DriverOptions): S3Driver {
  return new S3Driver(options);
}
