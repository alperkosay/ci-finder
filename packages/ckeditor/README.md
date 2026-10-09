<p align="center">
  <a href="https://alperkosay.github.io/ci-finder/"><img src="https://alperkosay.github.io/ci-finder/icon.svg" width="72" height="72" alt="ciFinder logo" /></a>
</p>

<h1 align="center">@ci-finder/ckeditor</h1>

<p align="center">
  A drop-in replacement for CKFinder, built on <a href="https://github.com/alperkosay/ci-finder">ciFinder</a>.<br />
  Browse files from the toolbar and upload pasted images, in CKEditor 5 and CKEditor 4.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@ci-finder/ckeditor"><img alt="npm version" src="https://img.shields.io/npm/v/@ci-finder/ckeditor?style=flat-square&label=npm&color=d6a03d&labelColor=33302b" /></a>
  <a href="https://github.com/alperkosay/ci-finder/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/alperkosay/ci-finder/ci.yml?branch=main&style=flat-square&label=CI&labelColor=33302b" /></a>
  <img alt="CKEditor 5 (42+)" src="https://img.shields.io/badge/CKEditor%205-%E2%89%A542-0287d0?style=flat-square" />
  <img alt="CKEditor 4" src="https://img.shields.io/badge/CKEditor%204-4.x-0287d0?style=flat-square" />
  <img alt="Types included" src="https://img.shields.io/badge/types-included-3178c6?style=flat-square&logo=typescript&logoColor=white&labelColor=33302b" />
  <a href="https://github.com/alperkosay/ci-finder/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/@ci-finder/ckeditor?style=flat-square&color=4c9a6a&labelColor=33302b" /></a>
</p>

<p align="center">
  <a href="https://alperkosay.github.io/ci-finder/demo/"><b>Live demo</b></a> ·
  <a href="https://alperkosay.github.io/ci-finder/docs/"><b>Docs</b></a> ·
  <a href="https://alperkosay.github.io/ci-finder/docs/ckeditor.html"><b>API reference</b></a> ·
  <a href="https://alperkosay.github.io/ci-finder/docs/tr/ckeditor.html">Türkçe</a>
</p>

---

## Install

```bash
npm i @ci-finder/ckeditor @ci-finder/react
```

Import `@ci-finder/react/styles.css` once in your app; the picker uses it. On the server you need a ciFinder endpoint, see [`@ci-finder/core`](https://www.npmjs.com/package/@ci-finder/core) or [`@ci-finder/next`](https://www.npmjs.com/package/@ci-finder/next).

## CKEditor 5

```ts
import { ClassicEditor, Essentials, Paragraph, Image, ImageUpload, Link } from "ckeditor5";
import { CiFinder } from "@ci-finder/ckeditor";
import "@ci-finder/react/styles.css";

ClassicEditor.create(element, {
  licenseKey: "GPL",
  plugins: [Essentials, Paragraph, Image, ImageUpload, Link, CiFinder],
  toolbar: ["bold", "link", "|", "ciFinder"],
  ciFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
});
```

## CKEditor 4

CKEditor 4 lives on a global `CKEDITOR`, so the plugin is registered on it:

```ts
import { registerCiFinder } from "@ci-finder/ckeditor/v4";
import "@ci-finder/react/styles.css";

registerCiFinder(window.CKEDITOR);
CKEDITOR.replace("body", {
  extraPlugins: "cifinder,uploadimage",
  ciFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
});
```

The "Browse Server" buttons of the Image and Link dialogs open the ciFinder picker as well.

## What you get

- A toolbar button that opens the file manager. Images are inserted as images, other files as links (on the selected text, if any).
- Pasted and dropped images are uploaded through ciFinder's chunked upload into `uploadFolder`, which is created when missing.
- The button label follows the editor's UI language (English or Turkish).

## Options (`ciFinder`)

| Option | Description |
|---|---|
| `endpoint`, `headers`, `credentials`, `client` | How to reach the ciFinder API. Default endpoint: `/api/files` |
| `uploadFolder` | Folder for pasted / dropped images: `"/editor"` (first volume) or `{ volume, path }`. `false` keeps the editor's own upload setup |
| `absoluteUrls` | Insert `https://site/uploads/a.png` instead of `/uploads/a.png` |
| `picker` | Options for the picker: `accept`, `theme`, `locale`, ... |
| `openPicker` | Replace the built-in picker with your own |

## The ciFinder family

| Package | |
|---|---|
| [`@ci-finder/core`](https://www.npmjs.com/package/@ci-finder/core) | Server engine, drivers, adapters, client |
| [`@ci-finder/react`](https://www.npmjs.com/package/@ci-finder/react) | The file manager UI and file picker |
| [`@ci-finder/next`](https://www.npmjs.com/package/@ci-finder/next) | Next.js routes, standalone-ready |
| [`@ci-finder/ckeditor`](https://www.npmjs.com/package/@ci-finder/ckeditor) | CKEditor 5 / 4 connector (this package) |

## License

[MIT](https://github.com/alperkosay/ci-finder/blob/main/LICENSE) © Alper Koşay
