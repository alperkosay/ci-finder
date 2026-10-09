# `@thefinder/core`

🌐 **English** · [Türkçe](tr/core.md)

The server engine. It has no runtime dependencies and runs with the Web-standard `Request → Response` signature on Node.js (≥ 18.17), Bun, Deno and edge runtimes.

## Entry points

| Subpath | Contents | Runtime |
|---|---|---|
| `@thefinder/core` | Engine, file server, errors, helpers, types | Anywhere |
| `@thefinder/core/local` | `localDriver`, `LocalDriver` | Node.js, Bun (`node:fs`) |
| `@thefinder/core/s3` | `s3Driver`, `S3Driver` | Anywhere (Web Crypto + `fetch`) |
| `@thefinder/core/node` | `toNodeHandler`, `toExpress`, `toFastify`, `toKoa`, `toWebRequest`, `sendWebResponse` | Node.js |
| `@thefinder/core/sharp` | `sharpThumbnailer`, `sharpImages` | Node.js, Bun; requires `sharp` (≥ 0.33) |
| `@thefinder/core/client` | `createClient`, `TheFinderClient`, `ApiError`. See [client.md](client.md) | Browser and server |

---

## `createTheFinder(options)`

```ts
import { createTheFinder } from "@thefinder/core";
import { localDriver } from "@thefinder/core/local";

const finder = createTheFinder({
  volumes: [{ id: "files", name: "Files", driver: localDriver({ root: "./uploads" }), url: "/uploads" }],
});
```

Same as `new TheFinder(options)`. Throws an `Error` right away on a bad configuration (no volumes, the same volume id twice, `chunkSize` < 5 MiB while an S3 volume exists).

### `TheFinderOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `volumes` | `VolumeOptions[]` | — | Required, at least one volume |
| `chunkSize` | `number` | 5 MiB | Upload chunk size. Must be at least 5 MiB if there is an S3 volume. |
| `authorize` | `(ctx) => AuthorizeResult \| Promise<…>` | — | Runs before every command. See [Authorization](#authorization). |
| `onBeforeCommand` | `(ctx) => void \| Promise<void>` | — | After authorization, before the command. If it throws, the command doesn't run. |
| `onAfterCommand` | `(ctx & { result }) => void \| Promise<void>` | — | After the command succeeds. For file responses `result` is a `Response`. |
| `maxEditSize` | `number` | 5 MiB | Upper limit for `get` / `put` (text) |
| `searchLimit` | `number` | 500 | Result limit for `search` |
| `thumbnails` | `ThumbnailOptions` | — | Server-side thumbnails. See [Thumbnails](#thumbnails). |
| `images` | `ImageProcessor` | — | Bulk image processing. See [Image processing](#image-processing). |
| `maxImageSize` | `number` | 60 MiB | Largest input for `transform` |
| `maxExtractSize` | `number` | 4 GiB | Total size `extract` may unpack (zip-bomb protection) |
| `csrfProtection` | `boolean` | `true` | Requires the `x-thefinder` header on `POST` requests |

### `VolumeOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | — | Required. Letters, digits and dashes, at most 32 characters; becomes the prefix of ids. |
| `name` | `string` | `id` | Display name of the root folder |
| `driver` | `StorageDriver` | — | Required |
| `url` | `string` | — | Public base URL of the files (`"/uploads"`, `"https://cdn.example.com"`). When set, every file gets a `url` field; the UI uses it for previews and in the picker. |
| `readOnly` | `boolean` | `false` | Rejects every write with `READ_ONLY`. Trash and version history are off too. |
| `showHidden` | `boolean` | `false` | Shows files starting with a dot. When off, names starting with a dot (`.htaccess`, `.env`...) cannot be created, uploaded or extracted from zips. The internal folders (`.tf-*`) stay hidden in every case. |
| `allowExtensions` | `string[]` | — | Only these extensions (lower case, no dot). Empty or missing means all. |
| `denyExtensions` | `string[]` | — | Extensions rejected on upload, create, rename, paste and extract |
| `maxUploadSize` | `number` | — | Byte limit for a single file (upload and binary `put`) |
| `permission` | `(action, path) => boolean` | — | `action`: `"read" \| "write" \| "delete"`. Returning `false` rejects the operation on that path with `FORBIDDEN` and sets the `read`/`write` flags in the UI. Folder operations apply to the contents too: a folder containing an item that can't be deleted can't be deleted, and unreadable subfolders are left out of search, size, zip download and archiving. |
| `trash` | `boolean \| { retentionDays? }` | `true`, 30 days | `false`: deleted items are removed right away |
| `versions` | `boolean \| { maxPerFile?, retentionDays? }` | `true`, 20 versions, forever | `retentionDays: 0` keeps forever. `false`: no versions are taken. |

### The `TheFinder` instance

| Member | Description |
|---|---|
| `handler(request): Promise<Response>` | Web-standard request handler. Use it directly in Bun, Deno, Hono, Next.js routes and Cloudflare Workers; for Node frameworks see the [adapters](#node-adapters). It is defined as an arrow function to keep its binding: `Bun.serve({ fetch: finder.handler })` is safe. |
| `execute<T>(cmd, params?, request?)` | Runs a command without HTTP; hooks and `authorize` still run. Throws `TheFinderError` on failure. Without `request` an empty `Request` is used. |
| `getVolume(id)` | Returns the `Volume` instance (advanced use) |
| `options` | The options with defaults applied |

```ts
// Example: removing versions older than 90 days in a cron job
await finder.execute("cleanup", { volume: "files", target: "versions", mode: "older", days: 90 });
```

### Authorization

```ts
type AuthorizeResult = boolean | void | { readOnly?: boolean };

interface CommandContext {
  cmd: string;                       // "ls", "upload"...
  request: Request;                  // the incoming request (cookies and headers can be read)
  params: Record<string, unknown>;   // merged query + body parameters
}
```

| `authorize` result | Effect |
|---|---|
| `true` or `undefined` | The request goes through |
| `false` | `403 FORBIDDEN` |
| `{ readOnly: true }` | The request goes through, but every volume is read-only for it. The `init` response carries `readOnly: true`, so the UI hides write actions by itself. |
| `throw new TheFinderError("UNAUTHORIZED")` | `401`; the UI calls `onUnauthorized` |

---

## Drivers

### `localDriver(options)`, `@thefinder/core/local`

| Option | Type | Default | Description |
|---|---|---|---|
| `root` | `string` | — | Required. The volume root; a relative path is resolved against the working directory. |
| `create` | `boolean` | `true` | Creates the root folder if missing |
| `followSymlinks` | `boolean` | `true` | Follows symlinks. Links pointing outside the root are always hidden and give `FORBIDDEN` on access. |

- Files are first written to a temporary file and then moved into place, so an interrupted write never corrupts the real file. On Windows it retries if the target file is open in another program.
- `capacity()` reports the disk size (for the storage dashboard).
- `driver.root`: the resolved absolute root path. `driver.abs(path)`: converts a volume path to an OS path.

### `s3Driver(options)`, `@thefinder/core/s3`

| Option | Type | Default | Description |
|---|---|---|---|
| `bucket` | `string` | — | Required |
| `accessKeyId`, `secretAccessKey` | `string` | — | Required |
| `sessionToken` | `string` | — | For temporary credentials |
| `region` | `string` | `"us-east-1"` | `"auto"` for Cloudflare R2 |
| `endpoint` | `string` | AWS | S3-compatible services: R2, MinIO, DigitalOcean Spaces, Backblaze B2… |
| `prefix` | `string` | bucket root | Key prefix used as the volume root, e.g. `"uploads/"` |
| `forcePathStyle` | `boolean` | `true` with a custom endpoint, `false` on AWS | `endpoint/bucket/key` style URLs |
| `delivery` | `"presigned" \| "proxy"` | `"presigned"` | How files reach the browser when the volume has no `url`: a redirect to a short-lived presigned URL, or streaming through the server |
| `presignExpiresIn` | `number` | 3600 | Presigned URL lifetime (seconds) |
| `partSize` | `number` | 8 MiB | Multipart part size for streamed writes (archives, cross-volume copies); at least 5 MiB |
| `fetch` | `typeof fetch` | global `fetch` | A custom `fetch` (tests, proxies) |

- Signing (SigV4) uses Web Crypto; no AWS SDK needed.
- Folders are modeled as prefixes; empty folders are kept with a `folder/` marker object.
- Move and rename are copy + delete; for folders every object under the prefix is processed.
- Uploads are multipart and the server keeps no state.
- For the image editor to read images on S3, allow `GET` from your app's origin in the bucket's CORS settings.

### The `StorageDriver` interface

To add a new storage (FTP, Azure Blob, Google Drive…) all you need is to implement this interface. The engine always hands the driver normalized paths (`/`, `/a/b.txt`); the driver never sees `..`.

| Method | Required | Description |
|---|---|---|
| `kind` | ✔ | A short name (`"local"`, `"s3"`, `"ftp"`); the UI uses it to pick an icon |
| `stat(path)` | ✔ | A `DriverStat`, or `null` if it doesn't exist |
| `list(path)` | ✔ | Direct children of the folder |
| `mkdir(path)` | ✔ | Creates a single folder (the parent exists) |
| `read(path, range?)` | ✔ | `ReadableStream<Uint8Array>`; `range` is an inclusive byte range |
| `write(path, data)` | ✔ | `data`: `ReadableStream`, `Uint8Array`, `ArrayBuffer` or `string`. Overwrites if it exists. |
| `remove(path)` | ✔ | Deletes a file, or a folder recursively |
| `copy(from, to)` | ✔ | Recursive copy; the target doesn't exist |
| `move(from, to)` | ✔ | Move / rename; the target doesn't exist (except for a case-only change) |
| `uploadChunk(chunk)` | ✔ | Writes one upload chunk; returns `{ session, done }`. `session` is driver-specific state that travels to the client and comes back with the next chunk. |
| `abortUpload(path, session)` | | Cleans up an unfinished upload |
| `hasSubdirs(path)` | | Whether the tree should show an expand arrow |
| `search(path, match, limit)` | | Fast recursive search; without it the engine walks the tree itself |
| `signedUrl(path, { download?, filename?, expiresIn? })` | | A direct (presigned) URL. If it returns a URL, the engine redirects with `302` instead of streaming the file. |
| `capacity()` | | `{ total, free }` or `null` |

```ts
interface DriverStat { name: string; path: VolumePath; kind: "file" | "dir"; size: number; mtime: number /* ms */ }

interface UploadChunk {
  path: VolumePath;   // validated, conflict-free target on the first chunk
  session?: string;   // state returned by the previous chunk; undefined on the first chunk
  index: number; total: number;
  size: number;       // total size of the file
  offset: number;     // byte offset of the chunk
  data: Uint8Array;
}
```

---

## Thumbnails

```ts
import { sharpThumbnailer } from "@thefinder/core/sharp";

createTheFinder({ volumes, thumbnails: { generator: sharpThumbnailer(), sizes: [128, 256, 512] } });
```

### `ThumbnailOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `generator` | `Thumbnailer` | — | Required |
| `sizes` | `number[]` | `[128, 256, 512]` | Allowed sizes; requests are rounded to the nearest one |
| `maxInputSize` | `number` | 40 MiB | Larger files are not thumbnailed; the original is sent |
| `concurrency` | `number` | 2 | Maximum number of generations at the same time |

Thumbnails are kept in the volume's `.tf-thumbs/` folder. They are regenerated when the source changes and cleaned up when the file is deleted, moved or renamed.

### `sharpThumbnailer(options?)`

| Option | Default | Description |
|---|---|---|
| `quality` | 78 | WebP quality |
| `maxPixels` | 120,000,000 | Larger images are rejected (decompression bomb protection) |

Reads: jpg, jpeg, jfif, png, webp, gif, avif, tif, tiff, heic, heif. Applies EXIF orientation, keeps the aspect ratio, never upscales. If `sharp` can't be loaded the API keeps working, a warning is logged once and original images are sent.

### The `Thumbnailer` interface

```ts
interface Thumbnailer {
  extensions: string[];      // extensions it can read (lower case)
  extension?: string;        // extension of generated files, default "webp"
  generate(input: Uint8Array, size: number): Promise<Uint8Array>; // fit into a size×size box
}
```

## Image processing

```ts
import { sharpImages } from "@thefinder/core/sharp";

createTheFinder({ volumes, images: sharpImages() });
```

### `sharpImages(options?)`

| Option | Default | Description |
|---|---|---|
| `maxPixels` | 120,000,000 | Decompression bomb protection |
| `effort` | 4 | WebP/AVIF encoding effort (speed ↔ size) |

Writes: jpeg (mozjpeg), png (palette when quality < 100), webp, avif, gif. Applies EXIF orientation, strips metadata, never upscales. Animation is kept when both the source and target formats support it. Throws `INVALID_IMAGE` on corrupt input and `TOO_LARGE` at the pixel limit. At most two images are processed at once; the rest wait in a queue.

### The `ImageProcessor` interface

```ts
interface ImageProcessor {
  extensions: string[];   // extensions it can read
  formats: ImageFormat[]; // formats it can write: "jpeg" | "png" | "webp" | "avif" | "gif"
  transform(input: Uint8Array, options: ImageTransformOptions): Promise<{ data: Uint8Array; width: number; height: number }>;
}

interface ImageTransformOptions { format: ImageFormat; width?: number; height?: number; quality?: number /* 1–100, default 80 */ }
```

---

## Serving files

### `createFileServer(options)`

A Web-standard handler that serves the files of a driver under a URL prefix.

```ts
Bun.serve({ routes: { "/uploads/*": createFileServer({ driver, prefix: "/uploads" }) } });
```

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `StorageDriver` | — | Required |
| `prefix` | `string` | `""` | URL prefix |
| `showHidden` | `boolean` | `false` | Serves dotfiles (`.tf-*` is never served) |
| `authorize` | `(request, path) => boolean \| Promise<boolean>` | — | `false` → `404` (private files don't even reveal that they exist) |
| `cacheControl` | `string` | `"public, max-age=0, must-revalidate"` | |

Range, ETag/`304`, `HEAD`, the right `Content-Type` and `?download` are supported. Active content such as HTML and SVG is served with `Content-Security-Policy: sandbox`. Methods other than `GET`/`HEAD` return `405`.

### `serveFile(options)`

A low-level helper for building a file response in your own route.

| Option | Type | Description |
|---|---|---|
| `request` | `Request` | Range and conditional GET headers are read from it |
| `stat` | `DriverStat` | For size, date and ETag |
| `open` | `(range?) => Promise<ReadableStream>` | Opens the content |
| `download` | `boolean` | Sends it as an `attachment` |
| `filename` | `string` | `Content-Disposition` name (default `stat.name`) |
| `cacheControl` | `string` | Default `"private, max-age=0, must-revalidate"` |
| `mime` | `string` | Guessed from the file name by default |

Other helpers: `contentDisposition(type, filename)` (RFC 6266/5987, UTF-8 names), `parseRange(header, size)` (`ByteRange`, `"invalid"` or `null`), `etagOf(stat)`.

---

## Node adapters

`@thefinder/core/node`. If a parser such as `express.json()` or `koa-bodyparser` has already read the body, the adapter rebuilds it.

| Function | Usage |
|---|---|
| `toNodeHandler(handler)` | `http.createServer(toNodeHandler(finder.handler))`. Also works as Express / Connect middleware; on errors it calls `next(err)`. |
| `toExpress(handler)` | Same as `toNodeHandler`: `app.all("/api/files", toExpress(finder.handler))` |
| `toKoa(handler)` | `router.all("/api/files", toKoa(finder.handler))` |
| `toFastify(handler, { path? })` | A Fastify plugin: `fastify.register(toFastify(finder.handler), { prefix: "/api/files" })`. Turns off body parsing in its own scope; `path` defaults to `"/"`. |
| `toWebRequest(req)` | `IncomingMessage` → `Request`. Honors `x-forwarded-proto` / `x-forwarded-host`. |
| `sendWebResponse(res, response)` | Streams a `Response` into a `ServerResponse` |

A file server can be mounted the same way: `app.get("/uploads/*", toExpress(createFileServer({ driver, prefix: "/uploads" })))`.

---

## Errors

```ts
import { TheFinderError, isTheFinderError } from "@thefinder/core";

throw new TheFinderError("UNAUTHORIZED");           // the message defaults to the code
throw new TheFinderError("FORBIDDEN", "This folder is off limits");
```

| Member | Description |
|---|---|
| `code: ErrorCode` | The full list of codes and their HTTP statuses: [protocol.md › Error codes](protocol.md#error-codes) |
| `status: number` | HTTP status derived from the code |
| `isTheFinderError(e)` | Type guard |

A `TheFinderError` thrown in a hook or a driver reaches the client with its own code and message. Any other error becomes `INTERNAL` and its details are written only to the server log.

## Helpers

| Export | Description |
|---|---|
| `encodeId(volume, path)` / `decodeId(id)` | Build and decode ids. `decodeId` throws `BAD_REQUEST` on invalid input. |
| `normalizePath(input)` | `"a//b/./c"` → `"/a/b/c"`. Doesn't try to resolve paths with `..`, backslashes or NUL; throws `BAD_REQUEST`. |
| `joinPath(dir, name)`, `dirname(path)`, `basename(path)` | POSIX volume path operations |
| `extname(name)` | Lower-case extension without the dot; `""` for dotfiles |
| `isInside(parent, child)` | Whether `child` is `parent` itself or below it |
| `mimeOf(name)` | MIME type from the extension (built-in table); `application/octet-stream` when unknown |
| `isActiveContent(mime)` | Types that can run scripts in the browser (HTML, SVG, XML, JS) |
| `createZipStream(sources)` | A dependency-free streaming zip writer (zip64 included). Already compressed formats are stored without compression. |
| `readZipEntries(read, size)` / `openZipEntry(read, entry)` | A random-access zip reader; the archive is never loaded into memory |
| `CSRF_HEADER` | `"x-thefinder"` |
| `VERSION` | Package version |
| `TRASH_ROOT`, `THUMBS_ROOT`, `VERSIONS_ROOT` | `"/.tf-trash"`, `"/.tf-thumbs"`, `"/.tf-versions"` |
| `isTrashPath(path)`, `isVersionsPath(path)`, `isReservedPath(path)` | Whether the path is inside one of the internal folders |
| `Volume`, `ThumbnailService` | Internal engine classes; for advanced use, their APIs may change in minor releases |

```ts
interface ZipSource {
  name: string;          // path inside the archive; folders end with "/"
  mtime: number;
  size?: number;         // used to decide on zip64 for very large files
  open?: () => Promise<ReadableStream<Uint8Array>>;
}
```

---

## Types

Every type can be imported with `import type { … } from "@thefinder/core"`. In browser code the same types are available from `@thefinder/core/client`.

### `Entry`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Id |
| `parent` | `string \| null` | Id of the parent folder; `null` at the volume root |
| `volume` | `string` | Volume id |
| `name` | `string` | Name; at the volume root, the volume's `name` |
| `path` | `string` | Volume path |
| `kind` | `"file" \| "dir"` | |
| `size` | `number` | Bytes; 0 for folders (use the `size` command for the real size) |
| `mtime` | `number` | Last modified (ms) |
| `mime` | `string` | `"directory"` for folders |
| `read`, `write` | `boolean` | Permissions from `readOnly` and `permission` |
| `locked?` | `true` | Volume root |
| `hasDirs?` | `boolean` | Only in `tree` responses |
| `url?` | `string` | Direct URL of the file when the volume has a `url` |
| `trash?` | `{ id, originalPath, deletedAt }` | Only in trash responses; `path` is the original location |

### `VolumeInfo`

`{ id, name, kind, root: Entry, readOnly, maxUploadSize: number | null, allowExtensions: string[] | null, denyExtensions: string[], trash: { retentionDays, count } | null, versions: { maxPerFile, retentionDays } | null }`

`trash` and `versions` are `null` when that feature is off.

### `InitResult`

`{ volumes: VolumeInfo[], chunkSize, version, thumbnails: { sizes, extensions } | null, images: { extensions, formats } | null }`

### `FileVersion`

`{ id, size, createdAt, reason }`. `reason` tells what replaced the version: `edit`, `upload`, `replace`, `optimize`, `revert`…

### `StorageStats`

| Field | Description |
|---|---|
| `volume` | Volume id |
| `files`, `dirs`, `size` | User files only (trash, versions and cache excluded) |
| `categories` | `Record<"image" \| "video" \| "audio" \| "document" \| "archive" \| "code" \| "other", { files, size }>` |
| `largest` | The largest files (`Entry[]`), biggest first |
| `versions` | `{ files, count, size, orphaned, items: VersionedFile[] }` (`items` at most 200) |
| `trash` | `{ count, size }` |
| `cache` | `{ files, size }`: thumbnail cache |
| `capacity` | `{ total, free } \| null`: the disk, if the driver can report it |
| `truncated` | `true` if the volume is too large to scan completely |
| `scannedAt` | Scan time (ms) |

`VersionedFile`: `{ id, path, name, exists, count, size, latest }`. `exists: false` means the file was deleted or moved outside theFinder, so its versions are orphaned.

### `TransformResult`

| Field | Description |
|---|---|
| `id`, `name` | Source file |
| `before`, `after?` | Source and result size (bytes) |
| `width?`, `height?` | Result dimensions |
| `entry?` | The written file (the source itself if written in place) |
| `created?` | `true` if a new file was created next to the source |
| `skipped?` | `"larger"` (the result didn't get smaller) or `"unsupported"` (the format can't be processed) |
| `error?` | Error code if this file failed |
