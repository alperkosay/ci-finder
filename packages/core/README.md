# @ci-finder/core

Server engine of [ciFinder](https://github.com/alperkosay/ci-finder), a file manager for React. Framework-agnostic (`Request → Response`), zero runtime dependencies, runs on Node.js, Bun, Deno and edge runtimes.

```bash
npm i @ci-finder/core
```

```ts
import { createCiFinder, createFileServer } from "@ci-finder/core";
import { localDriver } from "@ci-finder/core/local";

const driver = localDriver({ root: "./uploads" });
const finder = createCiFinder({ volumes: [{ id: "files", name: "Files", driver, url: "/uploads" }] });

// Bun / Deno / Hono / Next.js route handlers
Bun.serve({ routes: { "/api/files": finder.handler, "/uploads/*": createFileServer({ driver, prefix: "/uploads" }) } });
```

## Entry points

| Import | What |
|---|---|
| `@ci-finder/core` | `createCiFinder`, `createFileServer`, `serveFile`, zip stream, errors, types |
| `@ci-finder/core/local` | `localDriver` (Node.js / Bun file system) |
| `@ci-finder/core/s3` | `s3Driver` for AWS S3, Cloudflare R2, MinIO, Spaces, B2 (no AWS SDK) |
| `@ci-finder/core/node` | `toNodeHandler`, `toExpress`, `toFastify`, `toKoa` |
| `@ci-finder/core/sharp` | `sharpThumbnailer` (optional peer `sharp`) |
| `@ci-finder/core/client` | Browser client used by the UI |

## Highlights

- Commands: list, tree, search, create, rename, copy/move (across volumes), chunked upload, zip download, archive/extract, text and binary save.
- Trash without a database (`.cf-trash` per volume, restore, retention).
- Server-side thumbnails cached per volume (`.cf-thumbs`).
- `authorize` hook: `false` → 403, throw `UNAUTHORIZED` → 401, `{ readOnly: true }` → read-only request.
- Safety: no path traversal, symlinks kept inside the root, CSRF header on writes, zip-slip and zip-bomb guards, sandboxed HTML/SVG.

Documentation: https://github.com/alperkosay/ci-finder#readme

License: MIT
