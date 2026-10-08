import { normalizePath } from "./path";
import { serveFile } from "./serve";
import { isReservedPath } from "./trash";
import type { StorageDriver } from "./types";

export interface FileServerOptions {
  driver: StorageDriver;
  /** URL prefix the files are mounted at, e.g. "/uploads". */
  prefix?: string;
  /** Serve dot files. Default: false. */
  showHidden?: boolean;
  /** Return false to answer 404 (e.g. private files that require a session). */
  authorize?: (request: Request, path: string) => boolean | Promise<boolean>;
  /** Default: "public, max-age=0, must-revalidate". */
  cacheControl?: string;
}

const notFound = () => new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/**
 * Web-standard handler that serves files from a driver under a URL prefix
 * (Range, ETag/304, content types, `?download`, sandbox CSP for HTML/SVG).
 *
 * ```ts
 * Bun.serve({ routes: { "/uploads/*": createFileServer({ driver, prefix: "/uploads" }) } });
 * ```
 */
export function createFileServer(options: FileServerOptions): (request: Request) => Promise<Response> {
  const prefix = (options.prefix ?? "").replace(/\/+$/, "");
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    const url = new URL(request.url);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return notFound();
    }
    if (prefix && pathname !== prefix && !pathname.startsWith(prefix + "/")) return notFound();
    let path: string;
    try {
      path = normalizePath(pathname.slice(prefix.length));
    } catch {
      return notFound();
    }
    if (path === "/") return notFound();
    if (isReservedPath(path) || (!options.showHidden && path.split("/").some((s) => s.startsWith(".")))) return notFound();
    if (options.authorize && !(await options.authorize(request, path))) return notFound();
    const stat = await options.driver.stat(path);
    if (!stat || stat.kind !== "file") return notFound();
    return serveFile({
      request,
      stat,
      download: url.searchParams.has("download"),
      cacheControl: options.cacheControl ?? "public, max-age=0, must-revalidate",
      open: (range) => options.driver.read(path, range),
    });
  };
}
