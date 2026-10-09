<p align="center">
  <a href="https://alperkosay.github.io/ci-finder/"><img src="https://alperkosay.github.io/ci-finder/icon.svg" width="72" height="72" alt="ciFinder logo" /></a>
</p>

<h1 align="center">@ci-finder/react</h1>

<p align="center">
  <b>A Finder for the web.</b> The <a href="https://github.com/alperkosay/ci-finder">ciFinder</a> file manager UI for React.<br />
  Plain CSS, no Tailwind, no component library. React is the only (peer) dependency.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@ci-finder/react"><img alt="npm version" src="https://img.shields.io/npm/v/@ci-finder/react?style=flat-square&label=npm&color=d6a03d&labelColor=33302b" /></a>
  <a href="https://github.com/alperkosay/ci-finder/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/alperkosay/ci-finder/ci.yml?branch=main&style=flat-square&label=CI&labelColor=33302b" /></a>
  <img alt="React 18 and 19" src="https://img.shields.io/badge/React-18%20%7C%2019-61dafb?style=flat-square&logo=react&logoColor=61dafb&labelColor=20232a" />
  <img alt="Types included" src="https://img.shields.io/badge/types-included-3178c6?style=flat-square&logo=typescript&logoColor=white&labelColor=33302b" />
  <img alt="Plain CSS" src="https://img.shields.io/badge/styles-plain%20CSS-663399?style=flat-square&logo=css&logoColor=white&labelColor=33302b" />
  <img alt="WCAG 2.1 AA" src="https://img.shields.io/badge/axe--core-0%20WCAG%202.1%20AA%20issues-4c9a6a?style=flat-square&labelColor=33302b" />
  <a href="https://github.com/alperkosay/ci-finder/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/@ci-finder/react?style=flat-square&color=4c9a6a&labelColor=33302b" /></a>
</p>

<p align="center">
  <a href="https://alperkosay.github.io/ci-finder/demo/"><b>Live demo</b></a> ·
  <a href="https://alperkosay.github.io/ci-finder/docs/"><b>Docs</b></a> ·
  <a href="https://alperkosay.github.io/ci-finder/docs/react.html"><b>API reference</b></a> ·
  <a href="https://alperkosay.github.io/ci-finder/docs/tr/react.html">Türkçe</a>
</p>

<p align="center">
  <a href="https://alperkosay.github.io/ci-finder/demo/"><img src="https://alperkosay.github.io/ci-finder/media/cifinder-hero.png" alt="ciFinder file manager in light and dark mode" /></a>
</p>

---

## Install

```bash
npm i @ci-finder/react
```

You also need a backend: [`@ci-finder/core`](https://www.npmjs.com/package/@ci-finder/core) (any server) or [`@ci-finder/next`](https://www.npmjs.com/package/@ci-finder/next) (Next.js).

## Usage

```tsx
"use client";
import { CiFinder } from "@ci-finder/react";
import "@ci-finder/react/styles.css";

export default function Files() {
  return (
    <div style={{ height: "100vh" }}>
      <CiFinder endpoint="/api/files" />
    </div>
  );
}
```

### A "choose file" button

```tsx
import { useFilePicker } from "@ci-finder/react";

const picker = useFilePicker({ endpoint: "/api/files", accept: "image/*" });

<button onClick={async () => {
  const files = await picker.open();
  if (files) setCover(files[0].url); // "/uploads/cover.png"
}}>Choose image</button>
```

Outside React (vanilla JS, Vue…): `const files = await openFilePicker({ endpoint: "/api/files" })`.

## Features

- Icon and list views (virtualized, 10,000+ files stay smooth), folder tree, editable path bar, search
- Multi-select, lasso, keyboard shortcuts, context menus, drag & drop (also folders from the desktop)
- Chunked uploads with progress, zip downloads, trash with undo
- Quick look (Space) for images, video, audio, PDF, code and Markdown
- Built-in code editor, Markdown editor with preview, image editor (crop, rotate, flip, resize)
- Version history, bulk image optimization (resize, quality, WebP/AVIF) and a storage dashboard
- Picker mode (`onSelect`, `accept`) plus `useFilePicker()` / `openFilePicker()`
- Touch support, light/dark themes, a Finder-like `macos` skin, two densities
- English and Turkish built in, more via the `messages` prop

## Theming

All styles live in `@layer ci-finder` and use CSS custom properties, so any rule in your app wins without `!important`:

```css
.cf-root {
  --cf-accent: #0f766e;
  --cf-radius: 4px;
  --cf-font: "Inter", system-ui, sans-serif;
}
```

The full list of props, events and variables is in the [API reference](https://alperkosay.github.io/ci-finder/docs/react.html).

## The ciFinder family

| Package | |
|---|---|
| [`@ci-finder/core`](https://www.npmjs.com/package/@ci-finder/core) | Server engine, drivers, adapters, client |
| [`@ci-finder/react`](https://www.npmjs.com/package/@ci-finder/react) | The file manager UI and file picker (this package) |
| [`@ci-finder/next`](https://www.npmjs.com/package/@ci-finder/next) | Next.js routes, standalone-ready |
| [`@ci-finder/ckeditor`](https://www.npmjs.com/package/@ci-finder/ckeditor) | CKEditor 5 / 4 connector |

## License

[MIT](https://github.com/alperkosay/ci-finder/blob/main/LICENSE) © Alper Koşay
