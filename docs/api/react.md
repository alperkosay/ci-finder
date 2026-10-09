# `@thefinder/react`

🌐 **English** · [Türkçe](tr/react.md)

The file manager UI. Its only dependencies are `react` and `react-dom` (≥ 18, peer); styles are plain CSS.

```tsx
"use client";
import { TheFinder } from "@thefinder/react";
import "@thefinder/react/styles.css";

<div style={{ height: "100vh" }}>
  <TheFinder endpoint="/api/files" locale="en" />
</div>
```

Import `styles.css` once, anywhere in your app. The component fills the height of its parent (change it with the `height` prop).

## `<TheFinder />`

### Connection

| Prop | Type | Description |
|---|---|---|
| `endpoint` | `string` | Required. API URL, e.g. `"/api/files"` |
| `headers` | `Record<string, string> \| () => Record<string, string>` | Headers added to every request (e.g. `Authorization`) |
| `credentials` | `RequestCredentials` | `"include"` for cookies with a cross-origin API |
| `client` | `TheFinderClient` | A client you configured yourself. When given, it is used instead of `endpoint`/`headers`/`credentials`. |
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
| `className`, `style` | | — | Added to the root element (`.tf-root`) |
| `thumbnails` | `boolean` | `true` | Shows thumbnails for images |

### Initial state

| Prop | Type | Default | Description |
|---|---|---|---|
| `initialFolder` | `string` | last folder, else root of the first volume | Id of the folder to open first |
| `rememberFolder` | `boolean` | `true` | Reopen the folder the user was last in (stored under `persistKey`) |
| `defaultView` | `Partial<Prefs>` | — | Initial preferences. Whatever the user changes is stored under `persistKey` and takes precedence. |
| `persistKey` | `string \| false` | `"thefinder"` | localStorage key for preferences. `false` stores nothing. |

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
import { openFilePicker } from "@thefinder/react";
import "@thefinder/react/styles.css";

const files = await openFilePicker({ endpoint: "/api/files", accept: ".pdf" });
if (files) input.value = files[0].url;
```

On the server (no `document`) it resolves `null` right away.

### `FilePickerOptions`

All `<TheFinder />` props (except `onSelect`, `onCancel`, `height`, `style`), plus:

| Option | Default | Description |
|---|---|---|
| `absoluteUrls` | `false` | The `url` field contains a full URL (`https://site/uploads/a.png`) |
| `persistKey` | `"thefinder-picker"` | The picker's view preferences are stored separately from the main file manager |

The picker closes with `Escape`, a click on the backdrop or the "Cancel" button. `Escape` first closes any open menu or dialog.

### `PickedFile`

`Entry` plus `url: string`. If the volume has a `url`, that address is used (`"/uploads/a.png"`); otherwise the API's file URL. `pickedUrl(entry, client, absolute?)` is exported to build the same URL in your own code.

---

## Custom editors

The `editors` prop adds an item to the "Open with" menu for matching files. The editor opens full-size inside the file manager.

```tsx
import type { CustomEditor } from "@thefinder/react";

const csvViewer: CustomEditor = {
  id: "csv",
  label: "Open as table",
  match: (entry) => entry.name.toLowerCase().endsWith(".csv"),
  render: ({ entry, store, onClose }) => <CsvTable url={store.fileUrl(entry)} title={entry.name} onClose={onClose} />,
};

<TheFinder endpoint="/api/files" editors={[csvViewer]} />
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
| `store.client` | The connected [`TheFinderClient`](client.md): `getContent`, `putContent`, `putBlob`… |
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

The component uses a small store (`FinderStore`) built on `useSyncExternalStore`. The store is reachable only from components rendered inside `<TheFinder />` (for example custom editors).

| Export | Description |
|---|---|
| `useFinder()` | The context: `{ store, t, locale, editors, pickMode, multiple, … }`. Throws if called outside `<TheFinder>`. |
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
import { locales, type Messages } from "@thefinder/react";

const de: Partial<Messages> = { upload: "Hochladen", newFolder: "Neuer Ordner" /* ... */ };
<TheFinder endpoint="/api/files" locale="de" messages={de} />
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

All styles live in `@layer thefinder`. Any rule you write outside the layer wins, no `!important` needed. The root element is `.tf-root`. It carries the `data-theme` (`light`, `dark`, `auto`), `data-skin` (`classic`, `macos`) and `data-density` attributes.

```css
.tf-root {
  --tf-accent: #0f766e;
  --tf-radius: 4px;
  --tf-font: "Inter", system-ui, sans-serif;
}
.tf-root[data-theme="dark"] {
  --tf-bg: #101418;
}
```

| Variable | Description |
|---|---|
| `--tf-font`, `--tf-mono` | Fonts |
| `--tf-accent` | Accent color (selection, primary button, focus) |
| `--tf-accent-text` | Text on an accent fill |
| `--tf-accent-ink` | Accent text on a neutral background (links); kept separate for contrast |
| `--tf-accent-soft`, `--tf-accent-line` | Light fill and line tones of the accent (derived from `--tf-accent` by default) |
| `--tf-bg`, `--tf-surface`, `--tf-chrome`, `--tf-field` | Background, panels, top/bottom bars, input fields |
| `--tf-line`, `--tf-line-strong` | Lines |
| `--tf-text`, `--tf-text-2`, `--tf-text-3` | Text, secondary text, muted text |
| `--tf-hover`, `--tf-press`, `--tf-sel`, `--tf-sel-muted` | Hover, press, selection, unfocused selection |
| `--tf-danger`, `--tf-success`, `--tf-warn` | Status colors |
| `--tf-folder-back`, `--tf-folder-front`, `--tf-page`, `--tf-page-line` | Folder and file icons |
| `--tf-code-bg`, `--tf-code-active` | Code editor background and active line |
| `--tf-toast-bg`, `--tf-toast-text` | Notifications |
| `--tf-backdrop`, `--tf-shadow-pop`, `--tf-shadow-dialog` | Modal backdrop and shadows |
| `--tf-radius`, `--tf-radius-lg` | Corner radius |
| `--tf-header-h`, `--tf-toolbar-h`, `--tf-status-h`, `--tf-details-w` | Bar heights and details panel width |
| `--tk-*` | Code editor syntax colors (`--tk-kw`, `--tk-str`, `--tk-com`, `--tk-num`, `--tk-fn`, `--tk-type`, `--tk-prop`…) |

Every class is prefixed with `tf-`. Classes other than the variables are internal structure and may change in minor releases.

## Re-exports

`createClient`, `TheFinderClient`, `ApiError`, `encodeId` and the `Entry`, `VolumeInfo` types come straight from `@thefinder/core/client`.
