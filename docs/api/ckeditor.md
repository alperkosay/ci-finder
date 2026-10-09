# `@ci-finder/ckeditor`

🌐 **English** · [Türkçe](tr/ckeditor.md)

A connector for CKEditor 5 and CKEditor 4 that does what CKFinder does:

- adds a file manager button to the toolbar. Picked images are inserted as images, other files as links;
- saves pasted and dropped images to the server with ciFinder's chunked upload.

The picker is opened with [`openFilePicker`](react.md#openfilepickeroptions), so `@ci-finder/react/styles.css` must be loaded on the page.

## CKEditor 5

```ts
import { ClassicEditor, Essentials, Paragraph, Image, ImageUpload, Link } from "ckeditor5";
import { CiFinder } from "@ci-finder/ckeditor";
import "@ci-finder/react/styles.css";

ClassicEditor.create(el, {
  licenseKey: "GPL",
  plugins: [Essentials, Paragraph, Image, ImageUpload, Link, CiFinder],
  toolbar: ["bold", "link", "|", "ciFinder"],
  ciFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
});
```

Requires `ckeditor5` ≥ 42 (the unified `ckeditor5` package). The plugin loads `FileRepository` by itself.

### `ciFinder` config (`CiFinderEditorConfig`)

| Option | Type | Default | Description |
|---|---|---|---|
| `endpoint` | `string` | `"/api/files"` | API URL |
| `headers` | `Record<string, string> \| () => Record<string, string>` | — | Extra request headers |
| `credentials` | `RequestCredentials` | — | Cookie mode for cross-origin |
| `client` | `CiFinderClient` | — | A ready client; when given it replaces the three above |
| `uploadFolder` | `string \| { volume, path } \| false` | `"/editor"` | Folder for pasted images. A string is used as a path in the first volume. Created if missing. `false` keeps CKEditor's own upload setup. |
| `absoluteUrls` | `boolean` | `false` | Writes full URLs (`https://site/uploads/a.png`) into the content |
| `picker` | `Partial<FilePickerOptions>` | — | Picker options: `accept`, `theme`, `locale`, `multiple`… |
| `openPicker` | `() => Promise<PickedFile[] \| null>` | — | Opens your own picker instead of the built-in one |

### Components

| Name | Description |
|---|---|
| `ciFinder` (toolbar item) | Opens the file manager. Disabled while the editor is read-only. The button label follows the editor's UI language (English or Turkish). |
| `editor.plugins.get("CiFinder").browse()` | Opens the picker from your own button |
| `editor.plugins.get("CiFinder").insert(files)` | Inserts `PickedFile[]`. With the `Image` plugin loaded, images become images and everything else links. When a single file is picked and text is selected, the link goes on the selected text. |
| `CiFinderUploadAdapter` | The upload adapter class; exported for use in your own `FileRepository` setup |

## CKEditor 4

CKEditor 4 works with a global `CKEDITOR` object, so the module registers a `cifinder` plugin on it:

```ts
import { registerCiFinder } from "@ci-finder/ckeditor/v4";
import "@ci-finder/react/styles.css";

registerCiFinder(window.CKEDITOR);
CKEDITOR.replace("body", {
  extraPlugins: "cifinder,uploadimage",
  ciFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
});
```

`registerCiFinder(CKEDITOR)` can be called more than once; the plugin is registered only once. The plugin needs the `filebrowser` plugin (included in the standard builds).

What the plugin does:

- Adds the `CiFinder` toolbar button (in the `insert` group) and the `cifinder` command.
- Wires the "Browse Server" buttons of the Image and Link dialogs to the ciFinder picker. In the Image dialog only images can be picked. If `filebrowserBrowseUrl` or `filebrowserImageBrowseUrl` is already set, they are left alone.
- With the `uploadimage` plugin loaded, uploads pasted and dropped images through ciFinder. An existing `uploadUrl` or `imageUploadUrl` is kept.

### `ciFinder` config (`CiFinderEditor4Config`)

Same as CKEditor 5; the only difference is the `openPicker` signature:

```ts
openPicker?: (options: { images: boolean; multiple: boolean }) => Promise<PickedFile[] | null>;
// images: an image is expected (Image dialog), multiple: true for the toolbar button
```

The last open-source release of CKEditor 4 is 4.22.1; 4.23 and later require a commercial license key. The connector works with both.

## Types

`CiFinderEditorConfig`, `CiFinderEditor4Config`, `CKEditorStatic` (the part of the CKEditor 4 global that is used) and `PickedFile`.
