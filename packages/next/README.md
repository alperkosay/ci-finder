<p align="center">
  <a href="https://alperkosay.github.io/thefinder/"><img src="https://alperkosay.github.io/thefinder/icon.svg" width="72" height="72" alt="theFinder logo" /></a>
</p>

<h1 align="center">@thefinder/next</h1>

<p align="center">
  Next.js integration for <a href="https://github.com/alperkosay/thefinder">theFinder</a>, a file manager for React.<br />
  Works with <code>next dev</code>, <code>next start</code> and <code>output: "standalone"</code>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@thefinder/next"><img alt="npm version" src="https://img.shields.io/npm/v/@thefinder/next?style=flat-square&label=npm&color=d6a03d&labelColor=33302b" /></a>
  <a href="https://github.com/alperkosay/thefinder/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/alperkosay/thefinder/ci.yml?branch=main&style=flat-square&label=CI&labelColor=33302b" /></a>
  <img alt="Next.js 14+" src="https://img.shields.io/badge/Next.js-14%2B-000000?style=flat-square&logo=nextdotjs&logoColor=white" />
  <img alt="App Router" src="https://img.shields.io/badge/App%20Router-ready-000000?style=flat-square&labelColor=33302b" />
  <img alt="Standalone" src="https://img.shields.io/badge/output-standalone-d6a03d?style=flat-square&labelColor=33302b" />
  <img alt="Types included" src="https://img.shields.io/badge/types-included-3178c6?style=flat-square&logo=typescript&logoColor=white&labelColor=33302b" />
  <a href="https://github.com/alperkosay/thefinder/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/@thefinder/next?style=flat-square&color=4c9a6a&labelColor=33302b" /></a>
</p>

<p align="center">
  <a href="https://alperkosay.github.io/thefinder/demo/"><b>Live demo</b></a> ·
  <a href="https://alperkosay.github.io/thefinder/docs/"><b>Docs</b></a> ·
  <a href="https://alperkosay.github.io/thefinder/docs/next.html"><b>API reference</b></a> ·
  <a href="https://alperkosay.github.io/thefinder/docs/tr/next.html">Türkçe</a>
</p>

---

## Install

```bash
npm i @thefinder/next @thefinder/react
```

## Setup in three files

```ts
// lib/finder.ts
import { createTheFinder, localDriver, uploadsDir } from "@thefinder/next";
import { sharpThumbnailer } from "@thefinder/core/sharp"; // sharp already ships with Next.js

export const finder = createTheFinder({
  volumes: [{ id: "uploads", name: "Uploads", driver: localDriver({ root: uploadsDir() }), url: "/uploads" }],
  thumbnails: { generator: sharpThumbnailer() },
});
```

```ts
// app/api/files/route.ts
import { createNextRoutes } from "@thefinder/next";
import { finder } from "@/lib/finder";

export const runtime = "nodejs";
export const { GET, POST } = createNextRoutes(finder);
```

```ts
// app/uploads/[...path]/route.ts
import { createUploadsRoute } from "@thefinder/next";

export const runtime = "nodejs";
export const { GET, HEAD } = createUploadsRoute();
```

Then render [`<TheFinder endpoint="/api/files" />`](https://www.npmjs.com/package/@thefinder/react) on any page.

## Why it's standalone-ready

- `uploadsDir()` always points to `<project root>/uploads`, also inside a standalone build where `server.js` runs from `.next/standalone`. Override it with `CI_FINDER_UPLOADS_DIR` or `CI_FINDER_ROOT`.
- `createUploadsRoute` serves files uploaded after the build (unlike `public/`), with Range, ETag/304 and a sandbox CSP for HTML/SVG.
- Environment variables are read in a way that keeps Next's file tracer from copying your whole project (and its uploads) into the bundle.
- Thumbnails in standalone: file tracing does not pick up sharp's native libraries, so add them to `next.config`:
  `outputFileTracingIncludes: { "/api/files": ["./node_modules/@img/**/*"] }`.
  Without it the file manager still works and serves the original images instead of thumbnails.

## Authorization

```ts
import { TheFinderError } from "@thefinder/next";

createTheFinder({
  volumes,
  authorize: async ({ request }) => {
    const session = await getSession(request);
    if (!session) throw new TheFinderError("UNAUTHORIZED"); // → 401
    if (session.role === "viewer") return { readOnly: true };
    return true;
  },
});
```

## All theFinder packages

| Package | |
|---|---|
| [`@thefinder/core`](https://www.npmjs.com/package/@thefinder/core) | Server engine, drivers, adapters, client |
| [`@thefinder/react`](https://www.npmjs.com/package/@thefinder/react) | The file manager UI and file picker |
| [`@thefinder/next`](https://www.npmjs.com/package/@thefinder/next) | Next.js routes, standalone-ready (this package) |
| [`@thefinder/ckeditor`](https://www.npmjs.com/package/@thefinder/ckeditor) | CKEditor 5 / 4 connector |

## License

[MIT](https://github.com/alperkosay/thefinder/blob/main/LICENSE) © Alper Koşay
