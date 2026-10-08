# @ci-finder/react

The [ciFinder](https://github.com/alperkosay/ci-finder) file manager UI. Plain CSS (no Tailwind, no component library), React is the only (peer) dependency.

```bash
npm i @ci-finder/react
```

```tsx
"use client";
import { CiFinder } from "@ci-finder/react";
import "@ci-finder/react/styles.css";

export default function Files() {
  return (
    <div style={{ height: "100vh" }}>
      <CiFinder endpoint="/api/files" locale="tr" />
    </div>
  );
}
```

## Features

- Icon and list views (virtualized), folder tree, editable path bar, search
- Multi-select, lasso, keyboard shortcuts, context menus, drag & drop (also folders from the desktop)
- Chunked uploads with progress, zip downloads, trash with undo
- Quick look for images, video, audio, PDF, code and Markdown
- Built-in code editor, Markdown editor with preview, image editor (crop, rotate, flip, resize)
- Touch support, light/dark themes, two densities, Turkish and English
- Picker mode (`onSelect`, `accept`) and `useFilePicker()` / `openFilePicker()` for "choose a file" fields
- Version history, bulk image optimization (resize, quality, WebP/AVIF) and a storage dashboard

## Theming

All styles live in `@layer ci-finder` and use CSS custom properties, so any rule in your app wins:

```css
.cf-root {
  --cf-accent: #0f766e;
  --cf-radius: 4px;
}
```

Documentation and all props: https://github.com/alperkosay/ci-finder#readme

License: MIT
