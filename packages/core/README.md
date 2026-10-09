<p align="center">
  <a href="https://alperkosay.github.io/ci-finder/"><img src="https://alperkosay.github.io/ci-finder/icon.svg" width="72" height="72" alt="ciFinder logo" /></a>
</p>

<h1 align="center">@ci-finder/core</h1>

<p align="center">
  The server engine of <a href="https://github.com/alperkosay/ci-finder">ciFinder</a>, a file manager for React.<br />
  Framework-agnostic <code>Request → Response</code>, zero runtime dependencies, local disk and S3.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@ci-finder/core"><img alt="npm version" src="https://img.shields.io/npm/v/@ci-finder/core?style=flat-square&label=npm&color=d6a03d&labelColor=33302b" /></a>
  <a href="https://github.com/alperkosay/ci-finder/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/alperkosay/ci-finder/ci.yml?branch=main&style=flat-square&label=CI&labelColor=33302b" /></a>
  <img alt="Zero runtime dependencies" src="https://img.shields.io/badge/dependencies-0-4c9a6a?style=flat-square&labelColor=33302b" />
  <img alt="Types included" src="https://img.shields.io/badge/types-included-3178c6?style=flat-square&logo=typescript&logoColor=white&labelColor=33302b" />
  <img alt="ESM and CJS" src="https://img.shields.io/badge/module-ESM%20%2B%20CJS-555555?style=flat-square&labelColor=33302b" />
  <a href="https://github.com/alperkosay/ci-finder/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/@ci-finder/core?style=flat-square&color=4c9a6a&labelColor=33302b" /></a>
</p>

<p align="center">
  <img alt="Node.js 18.17+" src="https://img.shields.io/badge/Node.js-%E2%89%A518.17-5fa04e?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img alt="Bun" src="https://img.shields.io/badge/Bun-supported-fbf0df?style=flat-square&logo=bun&logoColor=fbf0df&labelColor=14151a" />
  <img alt="Deno and edge runtimes" src="https://img.shields.io/badge/Deno%20%C2%B7%20Edge-supported-555555?style=flat-square&logo=deno&logoColor=white" />
  <img alt="S3, R2, MinIO" src="https://img.shields.io/badge/S3%20%C2%B7%20R2%20%C2%B7%20MinIO-no%20AWS%20SDK-f38020?style=flat-square&logo=cloudflare&logoColor=white" />
</p>

<p align="center">
  <a href="https://alperkosay.github.io/ci-finder/demo/"><b>Live demo</b></a> ·
  <a href="https://alperkosay.github.io/ci-finder/docs/"><b>Docs</b></a> ·
  <a href="https://alperkosay.github.io/ci-finder/docs/core.html"><b>API reference</b></a> ·
  <a href="https://alperkosay.github.io/ci-finder/docs/tr/core.html">Türkçe</a>
</p>

---

## Install

```bash
npm i @ci-finder/core
```

## Quick start

```ts
import { createCiFinder, createFileServer } from "@ci-finder/core";
import { localDriver } from "@ci-finder/core/local";

const driver = localDriver({ root: "./uploads" });
const finder = createCiFinder({
  volumes: [{ id: "files", name: "Files", driver, url: "/uploads" }],
});

// Bun, Deno, Hono, Next.js route handlers, Cloudflare Workers…
Bun.serve({
  routes: {
    "/api/files": finder.handler,
    "/uploads/*": createFileServer({ driver, prefix: "/uploads" }),
  },
});
```

On Express, Fastify, Koa or plain `node:http`, wrap the handler with an adapter:

```ts
import { toExpress } from "@ci-finder/core/node";

app.all("/api/files", toExpress(finder.handler));
```

Then point the UI at it: [`@ci-finder/react`](https://www.npmjs.com/package/@ci-finder/react).

## Entry points

| Import | What |
|---|---|
| `@ci-finder/core` | `createCiFinder`, `createFileServer`, `serveFile`, zip stream, errors, types |
| `@ci-finder/core/local` | `localDriver` (Node.js / Bun file system) |
| `@ci-finder/core/s3` | `s3Driver` for AWS S3, Cloudflare R2, MinIO, Spaces, B2 (no AWS SDK) |
| `@ci-finder/core/node` | `toNodeHandler`, `toExpress`, `toFastify`, `toKoa` |
| `@ci-finder/core/sharp` | `sharpThumbnailer`, `sharpImages` (optional peer `sharp`) |
| `@ci-finder/core/client` | The browser client used by the UI |

## Highlights

- **Commands:** list, tree, search, create, rename, copy/move (also across volumes), chunked upload, zip download, archive/extract, text and binary save.
- **Trash without a database:** `.cf-trash` per volume, restore, retention.
- **Version history without a database:** `.cf-versions` per volume. Overwritten files keep their previous content; restore, follows renames, retention limits.
- **Thumbnails:** generated on the server and cached per volume (`.cf-thumbs`).
- **Bulk images:** resize / compress / convert with `images: sharpImages()`; converting keeps the original next to the new file.
- **Storage stats and cleanup** for a dashboard (`stats`, `cleanup`).
- **`authorize` hook:** `false` → 403, throw `UNAUTHORIZED` → 401, `{ readOnly: true }` → a read-only request.
- **Safe by default:** no path traversal, symlinks kept inside the root, CSRF header on writes, zip-slip and zip-bomb guards, HTML/SVG served in a sandbox.

## S3, R2, MinIO

```ts
import { s3Driver } from "@ci-finder/core/s3";

const cloud = s3Driver({
  bucket: "my-bucket",
  region: "auto",                                    // "auto" for R2
  endpoint: "https://<id>.r2.cloudflarestorage.com", // leave empty for AWS
  accessKeyId: process.env.S3_KEY!,
  secretAccessKey: process.env.S3_SECRET!,
  prefix: "uploads/",
});
```

Signing (SigV4) uses Web Crypto, so it also runs on edge runtimes. Uploads use multipart and the server keeps no state between requests.

## The ciFinder family

| Package | |
|---|---|
| [`@ci-finder/core`](https://www.npmjs.com/package/@ci-finder/core) | Server engine, drivers, adapters, client (this package) |
| [`@ci-finder/react`](https://www.npmjs.com/package/@ci-finder/react) | The file manager UI and file picker |
| [`@ci-finder/next`](https://www.npmjs.com/package/@ci-finder/next) | Next.js routes, standalone-ready |
| [`@ci-finder/ckeditor`](https://www.npmjs.com/package/@ci-finder/ckeditor) | CKEditor 5 / 4 connector |

## License

[MIT](https://github.com/alperkosay/ci-finder/blob/main/LICENSE) © Alper Koşay
