import * as nodePath from "node:path";
import { TheFinder, createTheFinder, isReservedPath, normalizePath, serveFile, type TheFinderOptions, type StorageDriver } from "@thefinder/core";
import { localDriver } from "@thefinder/core/local";

export { createTheFinder };
export { TheFinderError } from "@thefinder/core";
export { localDriver } from "@thefinder/core/local";
export { s3Driver } from "@thefinder/core/s3";
export type * from "@thefinder/core";

/**
 * Read through `globalThis` on purpose: Next's output file tracing statically follows
 * `process.cwd()` expressions and would otherwise copy the whole project (and uploads)
 * into the standalone bundle.
 */
function cwd(): string {
  return (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
}

function env(name: string): string | undefined {
  const value = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env[name];
  return value ? value : undefined;
}

/**
 * The application's project root, in every mode:
 * - `next dev` / `next start`: the current working directory.
 * - `output: "standalone"`: `server.js` chdirs into `.next/standalone[/<app>]`; the part before
 *   `.next` is the project root, so files land in the same place as in development.
 * - Docker / custom deploys: set `CI_FINDER_ROOT` to override.
 */
export function projectRoot(): string {
  const override = env("CI_FINDER_ROOT");
  if (override) return nodePath.resolve(override);
  const dir = cwd();
  const marker = `${nodePath.sep}.next${nodePath.sep}standalone`;
  const i = dir.indexOf(marker);
  return i === -1 ? dir : dir.slice(0, i);
}

/** Resolves a path inside the project root (see {@link projectRoot}). */
export function projectPath(...segments: string[]): string {
  return nodePath.join(projectRoot(), ...segments);
}

/**
 * Folder the uploads are stored in. Default: `<project root>/uploads`.
 * Override with `CI_FINDER_UPLOADS_DIR` (absolute, or relative to the project root) to point
 * at a persistent volume in production.
 */
export function uploadsDir(name = "uploads"): string {
  const override = env("CI_FINDER_UPLOADS_DIR");
  if (override) return nodePath.isAbsolute(override) ? override : projectPath(override);
  return projectPath(name);
}

type RouteHandler = (request: Request) => Promise<Response>;

/**
 * Route handlers for `app/api/<name>/route.ts`:
 *
 * ```ts
 * export const { GET, POST } = createNextRoutes(finder);
 * ```
 */
export function createNextRoutes(finder: TheFinder | TheFinderOptions): { GET: RouteHandler; POST: RouteHandler; HEAD: RouteHandler } {
  const instance = finder instanceof TheFinder ? finder : createTheFinder(finder);
  const handle: RouteHandler = (request) => instance.handler(request);
  return { GET: handle, POST: handle, HEAD: handle };
}

export interface UploadsRouteOptions {
  /** Folder to serve. Default: {@link uploadsDir}(). Ignored when `driver` is given. */
  dir?: string;
  /** Serve from any storage driver instead (e.g. an S3 bucket proxied through your app). */
  driver?: StorageDriver;
  /** Name of the catch-all segment. Default: "path" (`app/uploads/[...path]/route.ts`). */
  param?: string;
  /** Return false to answer 404 (e.g. require a session for private files). */
  authorize?: (request: Request, path: string) => boolean | Promise<boolean>;
  /** Default: "public, max-age=0, must-revalidate" (always revalidated through ETag). */
  cacheControl?: string;
  /** Serve dot files. Default: false. */
  showHidden?: boolean;
}

type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> };

const notFound = () => new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/**
 * Serves uploaded files from `app/uploads/[...path]/route.ts`, with Range requests, ETag/304,
 * correct content types, `?download` for attachments and a sandbox CSP for HTML/SVG.
 *
 * Works with `output: "standalone"`: files are read from disk at request time, never bundled,
 * and files uploaded after the build are served immediately (unlike `public/`).
 *
 * ```ts
 * export const { GET, HEAD } = createUploadsRoute();
 * ```
 */
export function createUploadsRoute(options: UploadsRouteOptions = {}): {
  GET: (r: Request, c: RouteContext) => Promise<Response>;
  HEAD: (r: Request, c: RouteContext) => Promise<Response>;
} {
  let driver: StorageDriver | undefined = options.driver;
  const getDriver = () => (driver ??= localDriver({ root: options.dir ?? uploadsDir(), create: true }));
  const param = options.param ?? "path";

  const handle = async (request: Request, context: RouteContext): Promise<Response> => {
    const params = await context?.params;
    const raw = params?.[param];
    const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!segments.length) return notFound();

    let path: string;
    try {
      path = normalizePath("/" + segments.join("/"));
    } catch {
      return notFound();
    }
    // The trash and thumbnail cache are never public, even with showHidden.
    if (isReservedPath(path) || (!options.showHidden && path.split("/").some((s) => s.startsWith(".")))) return notFound();
    if (options.authorize && !(await options.authorize(request, path))) return notFound();

    const d = getDriver();
    const stat = await d.stat(path);
    if (!stat || stat.kind !== "file") return notFound();

    return serveFile({
      request,
      stat,
      download: new URL(request.url).searchParams.has("download"),
      cacheControl: options.cacheControl ?? "public, max-age=0, must-revalidate",
      open: (range) => d.read(path, range),
    });
  };
  return { GET: handle, HEAD: handle };
}
