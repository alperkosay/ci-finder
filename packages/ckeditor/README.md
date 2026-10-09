# @ci-finder/ckeditor

ciFinder connector for CKEditor 5 and CKEditor 4. It does what CKFinder does: a toolbar button opens the file manager (images are inserted as images, other files as links), and pasted or dropped images are uploaded through ciFinder.

```bash
npm i @ci-finder/ckeditor @ci-finder/react
```

Import `@ci-finder/react/styles.css` once in your app; the picker uses it.

## CKEditor 5

```ts
import { ClassicEditor, Essentials, Paragraph, Image, ImageUpload, Link } from "ckeditor5";
import { CiFinder } from "@ci-finder/ckeditor";

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

registerCiFinder(window.CKEDITOR);
CKEDITOR.replace("body", {
  extraPlugins: "cifinder,uploadimage",
  ciFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
});
```

The "Browse Server" buttons of the image and link dialogs open the ciFinder picker as well.

## Options (`ciFinder`)

| Option | Description |
|---|---|
| `endpoint`, `headers`, `credentials`, `client` | How to reach the ciFinder API. Default endpoint: `/api/files` |
| `uploadFolder` | Folder for pasted / dropped images: `"/editor"` (first volume) or `{ volume, path }`. Created when missing. `false` keeps the editor's own upload setup |
| `absoluteUrls` | Insert `https://site/uploads/a.png` instead of `/uploads/a.png` |
| `picker` | Options for the picker: `accept`, `theme`, `locale`, ... |
| `openPicker` | Replace the built-in picker with your own |

Documentation: https://github.com/alperkosay/ci-finder#readme · API reference: https://github.com/alperkosay/ci-finder/blob/main/docs/api/ckeditor.md

License: MIT
