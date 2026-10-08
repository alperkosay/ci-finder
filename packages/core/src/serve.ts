import { isActiveContent, mimeOf } from "./mime";
import type { ByteRange, DriverStat } from "./types";

export interface ServeOptions {
  request: Request;
  stat: DriverStat;
  open: (range?: ByteRange) => Promise<ReadableStream<Uint8Array>>;
  /** Send as attachment instead of inline. */
  download?: boolean;
  /** Override the file name used in Content-Disposition. */
  filename?: string;
  /** Default: "private, max-age=0, must-revalidate". */
  cacheControl?: string;
  mime?: string;
}

/** RFC 6266 / 5987 Content-Disposition with a UTF-8 file name and an ASCII fallback. */
export function contentDisposition(type: "inline" | "attachment", filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function etagOf(stat: DriverStat): string {
  return `W/"${stat.size.toString(36)}-${Math.floor(stat.mtime).toString(36)}"`;
}

/** Parses a single "bytes=a-b" range. Multi-range requests are answered with the full body. */
export function parseRange(header: string | null, size: number): ByteRange | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === "" && b === "") return "invalid";
  let start: number;
  let end: number;
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

/**
 * Builds a file response with conditional GET (ETag / Last-Modified), Range requests (video seeking,
 * resumable downloads), HEAD support and safe headers for active content such as HTML and SVG.
 */
export async function serveFile(options: ServeOptions): Promise<Response> {
  const { request, stat } = options;
  const mime = options.mime ?? mimeOf(stat.name);
  const etag = etagOf(stat);
  const lastModified = new Date(stat.mtime || 0).toUTCString();
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Last-Modified": lastModified,
    "Cache-Control": options.cacheControl ?? "private, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    "Content-Type": mime.startsWith("text/") || mime === "application/json" ? `${mime}; charset=utf-8` : mime,
    "Content-Disposition": contentDisposition(options.download ? "attachment" : "inline", options.filename ?? stat.name),
  });
  if (isActiveContent(mime)) {
    // Uploaded HTML/SVG must never run script on the app's origin.
    headers.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; media-src 'self'");
  }

  const ifNoneMatch = request.headers.get("if-none-match");
  const ifModifiedSince = request.headers.get("if-modified-since");
  const notModified = ifNoneMatch
    ? ifNoneMatch.split(",").some((t) => t.trim() === etag || t.trim() === "*")
    : ifModifiedSince
      ? Math.floor(stat.mtime / 1000) <= Math.floor(Date.parse(ifModifiedSince) / 1000)
      : false;
  if (notModified) return new Response(null, { status: 304, headers });

  const ifRange = request.headers.get("if-range");
  const rangeAllowed = !ifRange || ifRange === etag || ifRange === lastModified;
  const range = rangeAllowed ? parseRange(request.headers.get("range"), stat.size) : null;

  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${stat.size}`);
    return new Response(null, { status: 416, headers });
  }

  const head = request.method === "HEAD";
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new Response(head ? null : await options.open(range), { status: 206, headers });
  }

  headers.set("Content-Length", String(stat.size));
  if (head || stat.size === 0) return new Response(null, { status: 200, headers });
  return new Response(await options.open(), { status: 200, headers });
}
