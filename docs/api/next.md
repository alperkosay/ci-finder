# `@ci-finder/next`

🌐 **English** · [Türkçe](tr/next.md)

Next.js App Router integration. Works in every mode, `output: "standalone"` included. For the setup steps, see the root [README › Next.js](../../README.md#nextjs).

## Re-exports

So that one import is enough, these come straight from `@ci-finder/core`: `createCiFinder`, `CiFinderError`, `localDriver`, `s3Driver` and every type from core.

```ts
import { createCiFinder, localDriver, s3Driver, uploadsDir, CiFinderError } from "@ci-finder/next";
```

## `createNextRoutes(finder)`

Creates the route handlers for `app/api/<name>/route.ts`.

```ts
// app/api/files/route.ts
import { createNextRoutes } from "@ci-finder/next";
import { finder } from "@/lib/finder";

export const runtime = "nodejs";
export const { GET, POST } = createNextRoutes(finder);
```

| Parameter | Description |
|---|---|
| `finder` | A `CiFinder` instance or `CiFinderOptions`. With an options object the instance is created internally. |

Returns `{ GET, POST, HEAD }`. If you export `HEAD` too, `HEAD` requests for Range-capable file responses are answered as well.

`runtime = "nodejs"` is required for the local disk. If you only use S3 volumes it also runs on the Edge runtime.

## `createUploadsRoute(options?)`

A file server for `app/uploads/[...path]/route.ts`. It reads files from disk on every request, so files uploaded after the build are served right away (which is not the case with `public/`).

```ts
// app/uploads/[...path]/route.ts
import { createUploadsRoute } from "@ci-finder/next";

export const runtime = "nodejs";
export const { GET, HEAD } = createUploadsRoute();
```

| Option | Type | Default | Description |
|---|---|---|---|
| `dir` | `string` | `uploadsDir()` | Folder to serve. Ignored when `driver` is given. |
| `driver` | `StorageDriver` | — | Serve from another driver (for example a private S3 bucket through your app) |
| `param` | `string` | `"path"` | Name of the catch-all segment (`[...path]`) |
| `authorize` | `(request, path) => boolean \| Promise<boolean>` | — | `false` → `404`. Session check for private files. |
| `cacheControl` | `string` | `"public, max-age=0, must-revalidate"` | Revalidated with ETag on every request |
| `showHidden` | `boolean` | `false` | Serves dotfiles. The internal `.cf-*` folders are never served. |

Range (video seeking), ETag/`304`, the right `Content-Type` and `?download` are supported. HTML and SVG are served with `Content-Security-Policy: sandbox`. Works with Next.js 14 (sync `params`) and 15+ (`Promise` `params`).

## Project root and uploads folder

| Function | Returns |
|---|---|
| `projectRoot()` | The app's project root |
| `projectPath(...segments)` | A path under the project root |
| `uploadsDir(name = "uploads")` | `<project root>/uploads` |

How `projectRoot()` works:

| Environment | Result |
|---|---|
| `next dev`, `next start` | The working directory |
| `output: "standalone"` | `server.js` moves itself into `.next/standalone[/<app>]`; the path before `.next` is used. Files are written to the project root, not into the build output. |
| `CI_FINDER_ROOT` set | That value (made absolute) |

`uploadsDir()` also looks at the `CI_FINDER_UPLOADS_DIR` environment variable: an absolute path is used as is, a relative path is resolved against the project root. Handy for writing to a persistent disk in Docker.

> Environment variables and `process.cwd()` are read through `globalThis` on purpose. That way Next's file tracer doesn't copy the whole project (and the uploaded files) into the standalone bundle.

## Standalone checklist

- `output: "standalone"` in `next.config`. In a monorepo, add `outputFileTracingRoot` as well.
- Copy the `.next/static` and `public` folders into the standalone output. Example: [examples/next/scripts/copy-standalone-assets.mjs](../../examples/next/scripts/copy-standalone-assets.mjs).
- For thumbnails, include sharp's native libraries: `outputFileTracingIncludes: { "/api/files": ["./node_modules/@img/**/*"] }`.
