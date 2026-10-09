<p align="center">
  <a href="https://alperkosay.github.io/thefinder/"><img src="https://alperkosay.github.io/thefinder/icon.svg" width="72" height="72" alt="theFinder logo" /></a>
</p>

<h1 align="center">@thefinder/ckeditor</h1>

<p align="center">
  A drop-in replacement for CKFinder, built on <a href="https://github.com/alperkosay/thefinder">theFinder</a>.<br />
  Browse files from the toolbar and upload pasted images, in CKEditor 5 and CKEditor 4.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@thefinder/ckeditor"><img alt="npm version" src="https://img.shields.io/npm/v/@thefinder/ckeditor?style=flat-square&label=npm&color=d6a03d&labelColor=33302b" /></a>
  <a href="https://github.com/alperkosay/thefinder/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/alperkosay/thefinder/ci.yml?branch=main&style=flat-square&label=CI&labelColor=33302b" /></a>
  <img alt="CKEditor 5 (42+)" src="https://img.shields.io/badge/CKEditor%205-%E2%89%A542-0287d0?style=flat-square" />
  <img alt="CKEditor 4" src="https://img.shields.io/badge/CKEditor%204-4.x-0287d0?style=flat-square" />
  <img alt="Types included" src="https://img.shields.io/badge/types-included-3178c6?style=flat-square&logo=typescript&logoColor=white&labelColor=33302b" />
  <a href="https://github.com/alperkosay/thefinder/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/@thefinder/ckeditor?style=flat-square&color=4c9a6a&labelColor=33302b" /></a>
</p>

<p align="center">
  <a href="https://alperkosay.github.io/thefinder/demo/"><b>Live demo</b></a> ·
  <a href="https://alperkosay.github.io/thefinder/docs/"><b>Docs</b></a> ·
  <a href="https://alperkosay.github.io/thefinder/docs/ckeditor.html"><b>API reference</b></a> ·
  <a href="https://alperkosay.github.io/thefinder/docs/tr/ckeditor.html">Türkçe</a>
</p>

---

## Install

```bash
npm i @thefinder/ckeditor @thefinder/react
```

Import `@thefinder/react/styles.css` once in your app; the picker uses it. On the server you need a theFinder endpoint, see [`@thefinder/core`](https://www.npmjs.com/package/@thefinder/core) or [`@thefinder/next`](https://www.npmjs.com/package/@thefinder/next).

## CKEditor 5

```ts
import { ClassicEditor, Essentials, Paragraph, Image, ImageUpload, Link } from "ckeditor5";
import { TheFinder } from "@thefinder/ckeditor";
import "@thefinder/react/styles.css";

ClassicEditor.create(element, {
  licenseKey: "GPL",
  plugins: [Essentials, Paragraph, Image, ImageUpload, Link, TheFinder],
  toolbar: ["bold", "link", "|", "theFinder"],
  theFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
});
```

## CKEditor 4

CKEditor 4 lives on a global `CKEDITOR`, so the plugin is registered on it:

```ts
import { registerTheFinder } from "@thefinder/ckeditor/v4";
import "@thefinder/react/styles.css";

registerTheFinder(window.CKEDITOR);
CKEDITOR.replace("body", {
  extraPlugins: "thefinder,uploadimage",
  theFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
});
```

The "Browse Server" buttons of the Image and Link dialogs open theFinder's picker as well.

## What you get

- A toolbar button that opens the file manager. Images are inserted as images, other files as links (on the selected text, if any).
- Pasted and dropped images are uploaded through theFinder's chunked upload into `uploadFolder`, which is created when missing.
- The button label follows the editor's UI language (English or Turkish).

## Options (`theFinder`)

| Option | Description |
|---|---|
| `endpoint`, `headers`, `credentials`, `client` | How to reach theFinder's API. Default endpoint: `/api/files` |
| `uploadFolder` | Folder for pasted / dropped images: `"/editor"` (first volume) or `{ volume, path }`. `false` keeps the editor's own upload setup |
| `absoluteUrls` | Insert `https://site/uploads/a.png` instead of `/uploads/a.png` |
| `picker` | Options for the picker: `accept`, `theme`, `locale`, ... |
| `openPicker` | Replace the built-in picker with your own |

## All theFinder packages

| Package | |
|---|---|
| [`@thefinder/core`](https://www.npmjs.com/package/@thefinder/core) | Server engine, drivers, adapters, client |
| [`@thefinder/react`](https://www.npmjs.com/package/@thefinder/react) | The file manager UI and file picker |
| [`@thefinder/next`](https://www.npmjs.com/package/@thefinder/next) | Next.js routes, standalone-ready |
| [`@thefinder/ckeditor`](https://www.npmjs.com/package/@thefinder/ckeditor) | CKEditor 5 / 4 connector (this package) |

## License

[MIT](https://github.com/alperkosay/thefinder/blob/main/LICENSE) © Alper Koşay
