<p align="center">
  <a href="https://alperkosay.github.io/ci-finder/"><img src="https://alperkosay.github.io/ci-finder/icon.svg" width="72" height="72" alt="ciFinder logo" /></a>
</p>

<h1 align="center">@ci-finder/next</h1>

<p align="center">
  Next.js integration for <a href="https://github.com/alperkosay/ci-finder">ciFinder</a>, a file manager for React.<br />
  Works with <code>next dev</code>, <code>next start</code> and <code>output: "standalone"</code>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@ci-finder/next"><img alt="npm version" src="https://img.shields.io/npm/v/@ci-finder/next?style=flat-square&label=npm&color=d6a03d&labelColor=33302b" /></a>
  <a href="https://github.com/alperkosay/ci-finder/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/alperkosay/ci-finder/ci.yml?branch=main&style=flat-square&label=CI&labelColor=33302b" /></a>
  <img alt="Next.js 14+" src="https://img.shields.io/badge/Next.js-14%2B-000000?style=flat-square&logo=nextdotjs&logoColor=white" />
  <img alt="App Router" src="https://img.shields.io/badge/App%20Router-ready-000000?style=flat-square&labelColor=33302b" />
  <img alt="Standalone" src="https://img.shields.io/badge/output-standalone-d6a03d?style=flat-square&labelColor=33302b" />
  <img alt="Types included" src="https://img.shields.io/badge/types-included-3178c6?style=flat-square&logo=typescript&logoColor=white&labelColor=33302b" />
  <a href="https://github.com/alperkosay/ci-finder/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/@ci-finder/next?style=flat-square&color=4c9a6a&labelColor=33302b" /></a>
</p>

<p align="center">
  <a href="https://alperkosay.github.io/ci-finder/demo/"><b>Live demo</b></a> ·
  <a href="https://alperkosay.github.io/ci-finder/docs/"><b>Docs</b></a> ·
  <a href="https://alperkosay.github.io/ci-finder/docs/next.html"><b>API reference</b></a> ·
  <a href="https://alperkosay.github.io/ci-finder/docs/tr/next.html">Türkçe</a>
</p>

---

## Install

```bash
npm i @ci-finder/next @ci-finder/react
```

## Setup in three files

```ts
// lib/finder.ts
import { createCiFinder, localDriver, uploadsDir } from "@ci-finder/next";
import { sharpThumbnailer } from "@ci-finder/core/sharp"; // sharp already ships with Next.js

export const finder = createCiFinder({
  volumes: [{ id: "uploads", name: "Uploads", driver: localDriver({ root: uploadsDir() }), url: "/uploads" }],
  thumbnails: { generator: sharpThumbnailer() },
});
```

```ts
// app/api/files/route.ts
import { createNextRoutes } from "@ci-finder/next";
import { finder } from "@/lib/finder";

export const runtime = "nodejs";
export const { GET, POST } = createNextRoutes(finder);
```

```ts
// app/uploads/[...path]/route.ts
import { createUploadsRoute } from "@ci-finder/next";

export const runtime = "nodejs";
export const { GET, HEAD } = createUploadsRoute();
```

Then render [`<CiFinder endpoint="/api/files" />`](https://www.npmjs.com/package/@ci-finder/react) on any page.

## Why it's standalone-ready

- `uploadsDir()` always points to `<project root>/uploads`, also inside a standalone build where `server.js` runs from `.next/standalone`. Override it with `CI_FINDER_UPLOADS_DIR` or `CI_FINDER_ROOT`.
- `createUploadsRoute` serves files uploaded after the build (unlike `public/`), with Range, ETag/304 and a sandbox CSP for HTML/SVG.
- Environment variables are read in a way that keeps Next's file tracer from copying your whole project (and its uploads) into the bundle.
- Thumbnails in standalone: file tracing does not pick up sharp's native libraries, so add them to `next.config`:
  `outputFileTracingIncludes: { "/api/files": ["./node_modules/@img/**/*"] }`.
  Without it the file manager still works and serves the original images instead of thumbnails.

## Authorization

```ts
import { CiFinderError } from "@ci-finder/next";

createCiFinder({
  volumes,
  authorize: async ({ request }) => {
    const session = await getSession(request);
    if (!session) throw new CiFinderError("UNAUTHORIZED"); // → 401
    if (session.role === "viewer") return { readOnly: true };
    return true;
  },
});
```

## The ciFinder family

| Package | |
|---|---|
| [`@ci-finder/core`](https://www.npmjs.com/package/@ci-finder/core) | Server engine, drivers, adapters, client |
| [`@ci-finder/react`](https://www.npmjs.com/package/@ci-finder/react) | The file manager UI and file picker |
| [`@ci-finder/next`](https://www.npmjs.com/package/@ci-finder/next) | Next.js routes, standalone-ready (this package) |
| [`@ci-finder/ckeditor`](https://www.npmjs.com/package/@ci-finder/ckeditor) | CKEditor 5 / 4 connector |

## License

[MIT](https://github.com/alperkosay/ci-finder/blob/main/LICENSE) © Alper Koşay
