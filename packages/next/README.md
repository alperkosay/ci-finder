# @ci-finder/next

Next.js integration for [ciFinder](https://github.com/alperkosay/ci-finder). Works with `next dev`, `next start` and `output: "standalone"`.

```bash
npm i @ci-finder/next @ci-finder/react
```

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
export const { GET, POST } = createNextRoutes(finder);
```

```ts
// app/uploads/[...path]/route.ts
import { createUploadsRoute } from "@ci-finder/next";
export const { GET, HEAD } = createUploadsRoute();
```

- `uploadsDir()` always points to `<project root>/uploads`, also inside a standalone build; override with `CI_FINDER_UPLOADS_DIR` or `CI_FINDER_ROOT`.
- `createUploadsRoute` serves files uploaded after the build (unlike `public/`), with Range, ETag/304 and a sandbox CSP for HTML/SVG.
- Standalone + thumbnails: file tracing does not pick up sharp's native libraries, add them to `next.config`:
  `outputFileTracingIncludes: { "/api/files": ["./node_modules/@img/**/*"] }`.
  Without it the file manager still works and serves original images instead of thumbnails.

Documentation: https://github.com/alperkosay/ci-finder#readme · API reference: https://github.com/alperkosay/ci-finder/blob/main/docs/api/next.md

License: MIT
