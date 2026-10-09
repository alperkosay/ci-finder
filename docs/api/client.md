# `@thefinder/core/client`

🌐 **English** · [Türkçe](tr/client.md)

A dependency-free API client that wraps the [HTTP protocol](protocol.md). The UI uses it, and you can use it to build your own UI in the browser, in Node.js, in Bun or in another framework (Vue, Svelte, vanilla JS). `createClient`, `TheFinderClient`, `ApiError` and `encodeId` can also be imported from `@thefinder/react`.

```ts
import { createClient, ApiError } from "@thefinder/core/client";

const client = createClient({ endpoint: "/api/files" });
const { volumes } = await client.init();
const { entries } = await client.ls(volumes[0].root.id);
```

## `createClient(options)` / `new TheFinderClient(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `endpoint` | `string` | — | Required. A relative (`"/api/files"`) or absolute URL |
| `headers` | `Record<string, string> \| () => Record<string, string>` | — | Headers added to every request. A function is called again for every request (for refreshed tokens). |
| `credentials` | `RequestCredentials` | `"same-origin"` | `"include"` to send cookies to a cross-origin API |
| `fetch` | `typeof fetch` | global `fetch` | A custom `fetch`. When given, uploads also use this `fetch` instead of XHR (no byte-level progress). |

Mutating requests are sent with `POST` and the `x-thefinder` header.

## Methods

Every method returns a `Promise` and throws an [`ApiError`](#apierror) on failure. Return types are the server's `data` field.

### Browsing

| Method | Returns |
|---|---|
| `init()` | `InitResult`. Also stores the server's `chunkSize` in the client; call it once before uploading. |
| `ls(id, signal?)` | `{ cwd, entries }` |
| `tree(id)` | `{ entries }` |
| `parents(id)` | `{ entries }` |
| `info(ids)` | `{ entries }` |
| `size(ids)` | `{ size, files, dirs }` |
| `search(id, q, signal?)` | `{ entries, truncated }` |

### Changing

| Method | Returns |
|---|---|
| `mkdir(id, name)` | `{ entry }` |
| `mkfile(id, name, content = "")` | `{ entry }` |
| `rename(id, name)` | `{ entry, removed }` |
| `duplicate(ids)` | `{ added }` |
| `paste(ids, dst, cut, conflict = "rename")` | `{ added, removed, skipped }`. `conflict`: `"rename" \| "overwrite" \| "skip"` |
| `rm(ids, permanent = false)` | `{ removed, trashed }` |
| `archive(ids, name?)` | `{ entry }` |
| `extract(id)` | `{ entry, skipped }` |

### Trash

| Method | Returns |
|---|---|
| `trash(volume?)` | `{ entries }` |
| `restore(ids)` | `{ restored, removed }` |
| `purge(ids)` | `{ removed }` |
| `emptyTrash(volume?)` | `{ all: true }` |

### Content

| Method | Returns |
|---|---|
| `getContent(id)` | `{ content, bom, entry }` |
| `putContent(id, content)` | `{ entry }`. Overwrites with text. |
| `putBlob(id, blob, reason?)` | `{ entry }`. Overwrites with binary content; the old content goes into version history. |
| `saveBlobAs(dst, name, blob)` | `{ entry }`. Saves as a new file; if the name is taken a free one is chosen. |

### Version history and storage

| Method | Returns |
|---|---|
| `versions(id)` | `{ versions, entry }` (`entry` is `null` if the file was deleted) |
| `revert(id, vid)` | `{ entry, created }` |
| `rmVersions(id, vids?)` | `{ removed, freed }` |
| `stats(volume, signal?)` | `StorageStats` |
| `cleanup(volume, request)` | `{ removed, freed }` |
| `transform(ids, options?, signal?)` | `{ results: TransformResult[] }` |

```ts
type CleanupRequest =
  | { target: "cache" }
  | { target: "versions"; mode: "all" | "orphaned" }
  | { target: "versions"; mode: "older"; days: number }
  | { target: "versions"; mode: "keep"; keep: number };

interface TransformOptions {
  format?: ImageFormat | "keep";  // default "keep"
  width?: number; height?: number;
  quality?: number;               // 1–100, default 80
  output?: "overwrite" | "copy";  // default "overwrite"
  skipLarger?: boolean;           // default true
  conflict?: "rename" | "overwrite";
  suffix?: string;                // default "optimized"
  dryRun?: boolean;               // only report the sizes, write nothing
}
```

### Uploading

```ts
const entry = await client.upload(file, folderId, {
  relativePath: "photos/2024", // for folder uploads
  conflict: "overwrite",       // default: a new name ("name (2)")
  onProgress: ({ loaded, total }) => bar.value = loaded / total,
  signal: controller.signal,
});
```

| Option | Description |
|---|---|
| `relativePath` | Relative folder to create under the target |
| `conflict` | `"rename"` or `"overwrite"` |
| `onProgress` | `{ loaded, total }`. In the browser it also updates within a chunk, thanks to XHR. |
| `signal` | On abort the partial upload is removed on the server too, and `ApiError("ABORTED")` is thrown |

The file is split into `chunkSize` chunks that are sent one after another. If `init()` hasn't been called before uploading, the default of 5 MiB is used.

### URL builders

These methods send no request; they only build URLs. Use them in `<img src>`, `<a href>` or `<video src>`.

| Method | Description |
|---|---|
| `fileUrl(entry, download = false)` | The file itself. The URL contains `v=<mtime>`, so it changes when the file changes. |
| `thumbUrl(entry, size)` | Thumbnail (the original if thumbnails are off on the server) |
| `versionUrl(id, vid, download = false)` | Content of a version |
| `downloadUrl(ids)` | A single file or a zip |

### Low level

| Method | Description |
|---|---|
| `get<T>(cmd, params?, signal?)` | Calls any command with `GET` |
| `post<T>(cmd, body, signal?)` | `POST` with a JSON object or `FormData` |
| `endpoint` | The configured URL |

## `ApiError`

```ts
try {
  await client.mkdir(id, "Reports");
} catch (e) {
  if (e instanceof ApiError && e.code === "EXISTS") { /* ... */ }
}
```

| Field | Description |
|---|---|
| `code` | A server error code ([list](protocol.md#error-codes)) or a client code: `NETWORK`, `ABORTED`, `UPLOAD`, `UNKNOWN` |
| `message` | The server's message |
| `status` | HTTP status; `0` for network errors and aborts |

## Other exports

- `encodeId(volume, path)`: builds an id, for example to open a known folder: `client.ls(encodeId("files", "/reports"))`.
- Types: `Entry`, `VolumeInfo`, `InitResult`, `EntryKind`, `FileVersion`, `ImageFormat`, `StorageStats`, `TransformResult`, `UsageCategory`, `VersionedFile`, `ConflictMode`, `ClientOptions`, `UploadOptions`, `UploadProgress`, `TransformOptions`, `CleanupRequest`, `SizeResult`.
