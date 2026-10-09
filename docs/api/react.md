# `@ci-finder/react`

🌐 **English** · [Türkçe](tr/react.md)

The file manager UI. Its only dependencies are `react` and `react-dom` (≥ 18, peer); styles are plain CSS.

```tsx
"use client";
import { CiFinder } from "@ci-finder/react";
import "@ci-finder/react/styles.css";

<div style={{ height: "100vh" }}>
  <CiFinder endpoint="/api/files" locale="en" />
</div>
```

Import `styles.css` once, anywhere in your app. The component fills the height of its parent (change it with the `height` prop).

## `<CiFinder />`

### Connection

| Prop | Type | Description |
|---|---|---|
| `endpoint` | `string` | Required. API URL, e.g. `"/api/files"` |
| `headers` | `Record<string, string> \| () => Record<string, string>` | Headers added to every request (e.g. `Authorization`) |
| `credentials` | `RequestCredentials` | `"include"` for cookies with a cross-origin API |
| `client` | `CiFinderClient` | A client you configured yourself. When given, it is used instead of `endpoint`/`headers`/`credentials`. |
| `onUnauthorized` | `() => void` | Called when the API returns `401`, e.g. to redirect to a login page |

### Appearance

| Prop | Type | Default | Description |
|---|---|---|---|
| `locale` | `string` | browser language (`en` or `tr`) | Built-in languages: `"en"`, `"tr"`. For another language, pass it together with `messages`. |
| `messages` | `Partial<Messages>` | — | Overrides or adds translations. Missing keys fall back to English. |
| `theme` | `"light" \| "dark" \| "auto"` | `"auto"` | `auto` follows the operating system |
| `skin` | `"classic" \| "macos"` | `"classic"` | `macos`: a Finder-like look (blue folders, traffic lights, zebra rows, frosted menus). Works in light and dark mode. |
| `density` | `"comfortable" \| "compact"` | `"comfortable"` | |
| `settings` | `boolean` | `true` | A settings menu in the header for theme, view and density. The user's choice is stored under `persistKey` and wins over the props; if a prop changes later, the prop applies. |
| `height` | `number \| string` | `"100%"` | |
| `className`, `style` | | — | Added to the root element (`.cf-root`) |
| `thumbnails` | `boolean` | `true` | Shows thumbnails for images |

### Initial state

| Prop | Type | Default | Description |
|---|---|---|---|
| `initialFolder` | `string` | root of the first volume | Id of the folder to open first |
| `defaultView` | `Partial<Prefs>` | — | Initial preferences. Whatever the user changes is stored under `persistKey` and takes precedence. |
| `persistKey` | `string \| false` | `"ci-finder"` | localStorage key for preferences. `false` stores nothing. |

`Prefs`:

| Field | Type | Default |
|---|---|---|
| `view` | `"grid" \| "list"` | `"grid"` |
| `sortKey` | `"name" \| "size" \| "mtime" \| "kind"` | `"name"` |
| `sortDir` | `1 \| -1` | `1` |
| `foldersFirst` | `boolean` | `true` |
| `detailsOpen` | `boolean` | `false` |
| `sidebarWidth` | `number` | `232` |

### Events

| Prop | Type | Description |
|---|---|---|
| `onOpen` | `(entry) => boolean \| void` | Called when a file is opened (double click, Enter). Return `true` to skip the default behavior (preview, editor, download). |
| `onChange` | `(event) => void` | Called after every change |
| `editors` | `CustomEditor[]` | Adds editors to the "Open with" menu. See [Custom editors](#custom-editors). |

The `onChange` event: `{ type, entries?, ids? }`. `entries` are new or updated items, `ids` are the ids of removed items.

| `type` | When |
|---|---|
| `upload` | A file was uploaded |
| `mkdir`, `mkfile` | A folder / file was created |
| `rename` | Renamed |
| `rm` | Deleted or moved to the trash |
| `restore` | Brought back from the trash or version history (the file was recreated) |
| `revert` | A file was reverted to an older version |
| `duplicate` | Duplicated |
| `copy`, `move` | Pasted or moved with drag & drop |
| `archive`, `extract` | A zip was created / extracted |
| `optimize` | Files were written by bulk image processing |

### Picker mode

When `onSelect` is given the component acts as a picker: a "Select" button appears in the bottom bar and double-clicking a file selects it. For a modal picker, [`useFilePicker`](#usefilepickeroptions) is more convenient.

| Prop | Type | Description |
|---|---|---|
| `onSelect` | `(entries: Entry[]) => void` | Called with the selected files |
| `selectLabel` | `string` | Button text |
| `onCancel` | `() => void` | When given, a "Cancel" button appears |
| `multiple` | `boolean` | Allow selecting several files (default `false`) |
| `accept` | `Accept` | Which files can be selected. The rest stay visible but can't be selected. |

```ts
type Accept = string | string[] | ((entry: Entry) => boolean);
// "image/*"            a MIME group
// ".pdf,.docx"         extensions
// ["image/png", ".svg"]
// (e) => e.size < 2_000_000
```

`matchesAccept(entry, accept)` is exported so you can apply the same rule in your own code. Folders never match.

---

## File picker

### `useFilePicker(options)`

```tsx
const picker = useFilePicker({ endpoint: "/api/files", accept: "image/*" });

<button disabled={picker.isOpen} onClick={async () => {
  const files = await picker.open();
  if (files) setCover(files[0].url);
}}>Choose image</button>
```

Returns `{ open(overrides?), isOpen }`.

- `open` returns a `Promise<PickedFile[] | null>`; if the user cancels it resolves `null`. `overrides` changes options for that one opening: `picker.open({ multiple: true })`.
- `isOpen` is `true` while the picker is open.
- The hook always uses the latest options on every render; you don't need to wrap the options object in `useMemo`.

### `openFilePicker(options)`

The same picker outside React (vanilla JS, Vue, rich text editors). It appends a `<dialog>` to the end of `<body>` and removes it on close. React and React DOM must be bundled on the page.

```ts
import { openFilePicker } from "@ci-finder/react";
import "@ci-finder/react/styles.css";

const files = await openFilePicker({ endpoint: "/api/files", accept: ".pdf" });
if (files) input.value = files[0].url;
```

On the server (no `document`) it resolves `null` right away.

### `FilePickerOptions`

All `<CiFinder />` props (except `onSelect`, `onCancel`, `height`, `style`), plus:

| Option | Default | Description |
|---|---|---|
| `absoluteUrls` | `false` | The `url` field contains a full URL (`https://site/uploads/a.png`) |
| `persistKey` | `"ci-finder-picker"` | The picker's view preferences are stored separately from the main file manager |

The picker closes with `Escape`, a click on the backdrop or the "Cancel" button. `Escape` first closes any open menu or dialog.

### `PickedFile`

`Entry` plus `url: string`. If the volume has a `url`, that address is used (`"/uploads/a.png"`); otherwise the API's file URL. `pickedUrl(entry, client, absolute?)` is exported to build the same URL in your own code.

---

## Custom editors

The `editors` prop adds an item to the "Open with" menu for matching files. The editor opens full-size inside the file manager.

```tsx
import type { CustomEditor } from "@ci-finder/react";

const csvViewer: CustomEditor = {
  id: "csv",
  label: "Open as table",
  match: (entry) => entry.name.toLowerCase().endsWith(".csv"),
  render: ({ entry, store, onClose }) => <CsvTable url={store.fileUrl(entry)} title={entry.name} onClose={onClose} />,
};

<CiFinder endpoint="/api/files" editors={[csvViewer]} />
```

| Field | Description |
|---|---|
| `id` | A unique id |
| `label` | Name shown in the menu |
| `match(entry)` | Whether the editor is offered for this file |
| `render({ entry, store, onClose })` | The editor content. `onClose` closes the editor. |

Useful store members inside an editor:

| Member | Description |
|---|---|
| `store.client` | The connected [`CiFinderClient`](client.md): `getContent`, `putContent`, `putBlob`… |
| `store.fileUrl(entry)` | The file's URL (the volume `url` or the API URL) |
| `store.updateEntry(entry)` | Updates the size and date in the list after saving |
| `store.toast(message, kind?)` | A notification; `kind`: `"info" \| "success" \| "error"` |
| `store.fail(error)` | Reports an error to the user in their language |
| `store.refresh()` | Reloads the current folder |

Saving example:

```tsx
const { entry: saved } = await store.client.putContent(entry.id, text);
store.updateEntry(saved);
store.toast("Saved", "success");
```

---

## Store and hooks

The component uses a small store (`FinderStore`) built on `useSyncExternalStore`. The store is reachable only from components rendered inside `<CiFinder />` (for example custom editors).

| Export | Description |
|---|---|
| `useFinder()` | The context: `{ store, t, locale, editors, pickMode, multiple, … }`. Throws if called outside `<CiFinder>`. |
| `useStore(selector)` | Subscribes to a slice of the store: `const cwd = useStore((s) => s.cwd)`. The selector must return the same value for unchanged state. |
| `FinderStore` | The store class. Read the state with `store.getState()` and watch changes with `store.subscribe(fn)`. |
| `FinderState` | The state type: `cwd`, `selection`, `entries`, `volumes`, `uploads`, `clipboard`, `searchQuery`… |
| `FinderPrefs` | The `Prefs` type |

The store methods (`open`, `select`, `upload`, `paste`, `remove`…) were written for the UI itself. You can use them, but their signatures may change during `0.x`.

## i18n

| Export | Description |
|---|---|
| `locales` | `{ en, tr }`: the built-in message bundles |
| `Messages`, `MessageKey` | The message type and its keys |
| `createTranslator(locale, overrides?)` | `(key, vars?) => string`. Fills placeholders like `{name}` from `vars`. |

To add a new language, translate every key and pass it in; anything left out shows in English:

```tsx
import { locales, type Messages } from "@ci-finder/react";

const de: Partial<Messages> = { upload: "Hochladen", newFolder: "Neuer Ordner" /* ... */ };
<CiFinder endpoint="/api/files" locale="de" messages={de} />
```

See the `locales.en` object for the full list of keys.

## Icons

The UI's hand-drawn SVG icons can be used in your own components too:

| Component | Props |
|---|---|
| `<FileIcon entry={…} size={48} />` | A colored icon based on the file type (`entry` only needs `kind`, `name`, `mime`) |
| `<FolderIcon size={48} open={false} />` | A folder |
| `<Icon name="upload" size={16} />` | UI icons; accepts other SVG props too |

## Theming

All styles live in `@layer ci-finder`. Any rule you write outside the layer wins, no `!important` needed. The root element is `.cf-root`. It carries the `data-theme` (`light`, `dark`, `auto`), `data-skin` (`classic`, `macos`) and `data-density` attributes.

```css
.cf-root {
  --cf-accent: #0f766e;
  --cf-radius: 4px;
  --cf-font: "Inter", system-ui, sans-serif;
}
.cf-root[data-theme="dark"] {
  --cf-bg: #101418;
}
```

| Variable | Description |
|---|---|
| `--cf-font`, `--cf-mono` | Fonts |
| `--cf-accent` | Accent color (selection, primary button, focus) |
| `--cf-accent-text` | Text on an accent fill |
| `--cf-accent-ink` | Accent text on a neutral background (links); kept separate for contrast |
| `--cf-accent-soft`, `--cf-accent-line` | Light fill and line tones of the accent (derived from `--cf-accent` by default) |
| `--cf-bg`, `--cf-surface`, `--cf-chrome`, `--cf-field` | Background, panels, top/bottom bars, input fields |
| `--cf-line`, `--cf-line-strong` | Lines |
| `--cf-text`, `--cf-text-2`, `--cf-text-3` | Text, secondary text, muted text |
| `--cf-hover`, `--cf-press`, `--cf-sel`, `--cf-sel-muted` | Hover, press, selection, unfocused selection |
| `--cf-danger`, `--cf-success`, `--cf-warn` | Status colors |
| `--cf-folder-back`, `--cf-folder-front`, `--cf-page`, `--cf-page-line` | Folder and file icons |
| `--cf-code-bg`, `--cf-code-active` | Code editor background and active line |
| `--cf-toast-bg`, `--cf-toast-text` | Notifications |
| `--cf-backdrop`, `--cf-shadow-pop`, `--cf-shadow-dialog` | Modal backdrop and shadows |
| `--cf-radius`, `--cf-radius-lg` | Corner radius |
| `--cf-header-h`, `--cf-toolbar-h`, `--cf-status-h`, `--cf-details-w` | Bar heights and details panel width |
| `--tk-*` | Code editor syntax colors (`--tk-kw`, `--tk-str`, `--tk-com`, `--tk-num`, `--tk-fn`, `--tk-type`, `--tk-prop`…) |

Every class is prefixed with `cf-`. Classes other than the variables are internal structure and may change in minor releases.

## Re-exports

`createClient`, `CiFinderClient`, `ApiError`, `encodeId` and the `Entry`, `VolumeInfo` types come straight from `@ci-finder/core/client`.
