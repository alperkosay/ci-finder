# HTTP protocol

🌐 **English** · [Türkçe](tr/protocol.md)

theFinder works RPC-style over a single endpoint (for example `/api/files`). The UI speaks this protocol through [`TheFinderClient`](client.md). If you are writing your own client or calling the API from another language, this document is all you need.

## Request format

| Rule | Details |
|---|---|
| Command | Chosen with the `cmd` parameter: `GET /api/files?cmd=ls&id=...` or `{ "cmd": "mkdir", ... }` in a `POST` body. |
| Methods | `GET`, `HEAD`, `POST`. Anything else returns `405`. |
| Read-only commands | `init`, `ls`, `tree`, `parents`, `info`, `size`, `search`, `file`, `thumb`, `download`, `get`, `trash`, `versions`, `version`, `stats`. These can be called with `GET` and `POST`. |
| Mutating commands | Everything else works only with `POST`; calling them with `GET` returns `BAD_REQUEST`. |
| CSRF header | Every `POST` request must carry an `x-thefinder` header (the value doesn't matter, the client sends `1`). Otherwise `403 FORBIDDEN`. Can be turned off with `csrfProtection: false`. |
| Body | `application/json`, `multipart/form-data` or `application/x-www-form-urlencoded`. Query string parameters are read as well; if the same name is in the body, the body wins. |
| Lists (`ids`, `vids`) | A JSON array, comma-separated text (`ids=a,b`) or a repeated query parameter (`ids=a&ids=b`). At most 10,000 items. |
| Booleans | `true`, `"true"`, `"1"` and `1` count as true. |

## Response format

Commands that return JSON always use the same envelope:

```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "File not found" } }
```

Responses are sent with `Cache-Control: no-store`. The `file`, `thumb`, `download` and `version` commands return the file itself instead of JSON (errors still use the JSON envelope).

## Commands

Types such as `Entry` and `VolumeInfo` in the tables are defined in [core.md › Types](core.md#types).

### Browsing

| Command | Parameters | `data` |
|---|---|---|
| `init` | — | `InitResult`: `{ volumes, chunkSize, version, thumbnails, images }` |
| `ls` | `id` (folder) | `{ cwd: Entry, entries: Entry[] }` |
| `tree` | `id` (folder) | `{ entries: Entry[] }`: subfolders only; each has `hasDirs` if the driver supports it |
| `parents` | `id` | `{ entries: Entry[] }`: the chain from the volume root down to the item itself |
| `info` | `ids` | `{ entries: Entry[] }` |
| `size` | `ids` | `{ size, files, dirs }`: folders are summed recursively |
| `search` | `id` (folder to search), `q` | `{ entries: Entry[], truncated: boolean }`: searches subfolders too; case, accent and Turkish ı/İ insensitive. At most `searchLimit` results. |

### Creating and changing

| Command | Parameters | `data` |
|---|---|---|
| `mkdir` | `id` (parent folder), `name` | `{ entry }` |
| `mkfile` | `id` (parent folder), `name`, `content?` | `{ entry }` |
| `rename` | `id`, `name` | `{ entry, removed: [oldId] }`: `removed` is empty if the name didn't change. Names that only change case (`photo.JPG` → `photo.jpg`) work on case-insensitive disks too. |
| `duplicate` | `ids` | `{ added: Entry[] }`: copies are created in the same folder as "name (2)" |
| `paste` | `ids`, `dst` (target folder), `cut?`, `conflict?` | `{ added: Entry[], removed: string[], skipped: string[] }` |

`paste` details:

- `cut: true` moves, otherwise copies. Works across volumes too (local disk ↔ S3).
- `conflict`: `"rename"` (default, "name (2)"), `"overwrite"` (the existing item is removed; if it is a file its old content goes into version history) or `"skip"`.
- A folder cannot be moved into itself: `MOVE_INTO_ITSELF`.

### Deleting and trash

| Command | Parameters | `data` |
|---|---|---|
| `rm` | `ids`, `permanent?` | `{ removed: string[], trashed: Entry[] }`: with the trash enabled items are moved to it; with `permanent: true` or `trash: false` they are deleted for good |
| `trash` | `volume?` | `{ entries: Entry[] }`: the trash of every volume (or one), newest first. Each item has `trash: { id, originalPath, deletedAt }`; `path` is the original location. |
| `restore` | `ids` (trash item ids) | `{ restored: Entry[], removed: string[] }`: goes back to its old place; the folder is recreated if missing, and the name becomes "name (2)" if taken |
| `purge` | `ids` or `all: true` (+ `volume?`) | `{ removed: string[], all: boolean }`: deletes permanently |

Trash item ids also use the `<volume>_<base64url>` format but point inside `.tf-trash`. They can only be used with `restore` and `purge`.

### Uploading

Files are sent in chunks (`multipart/form-data`). The chunk size is `chunkSize` from the `init` response.

| Field | Description |
|---|---|
| `cmd` | `upload` |
| `dst` | Id of the target folder |
| `name` | File name |
| `size` | Total size of the file (bytes) |
| `index`, `total` | Chunk index (starting at 0) and total number of chunks |
| `offset` | Byte offset of the chunk in the file |
| `chunk` | The chunk itself (a file field), at most `chunkSize` bytes |
| `session` | Empty on the first chunk; afterwards the `session` from the previous response |
| `relativePath?` | For folder uploads, the file's relative folder (`"photos/2024"`); created under `dst` |
| `conflict?` | `"overwrite"`: overwrites a file with the same name, its old content goes into version history. If omitted, the new file becomes "name (2)". |

Response: `{ done: false, session }`, or on the last chunk `{ done: true, session, entry }`.

- `session` is a token kept by the client; the server keeps no state between uploads, so it works in serverless environments too. The target path, permissions and extension are re-validated on every chunk.
- Cancel: `POST { cmd: "abort", dst, session }` → `{ aborted: true }`. Removes an unfinished multipart upload on S3. Never fails, always succeeds.

### Content

| Command | Parameters | Response |
|---|---|---|
| `file` | `id`, `download?`, `v?` | The file itself (inline or as an attachment). Range, ETag/304 and `HEAD` are supported. On S3 this may be a `302` redirect to a presigned URL. `v` is only a cache buster. |
| `thumb` | `id`, `size?` (default 256), `v?` | WebP thumbnail. The size is rounded to the nearest allowed value. If there is no thumbnail or it can't be generated, the original file is sent. |
| `download` | `ids` | A single file downloads directly. Several items or a folder download as a zip built on the fly (`download.zip` or `<name>.zip`). |
| `get` | `id` | `{ content, bom, entry }`: UTF-8 text. At most `maxEditSize`; `UNSUPPORTED` for non-text files. |
| `put` | see below | `{ entry, created }` |

`put` can be called in three ways:

| Form | Fields | Result |
|---|---|---|
| JSON | `id`, `content` | Overwrites a text file |
| multipart | `id`, `file`, `reason?` | Overwrites with binary content (for example from the image editor) |
| multipart | `dst`, `name`, `file` | Saves as a new file; if the name is taken a free one is chosen (`created: true`) |

Before overwriting, the file's previous content is saved into version history. `reason` is a short word stored with the version (only `a-z`, at most 16 characters, default `edit`).

### Archives

| Command | Parameters | `data` |
|---|---|---|
| `archive` | `ids` (must be in the same folder), `name?` | `{ entry }`: the zip file; without a name, `<name>.zip` or `Archive.zip` |
| `extract` | `id` (`.zip`) | `{ entry, skipped }`: extracts into a new folder named after the archive. Invalid entries and entries with disallowed extensions are skipped and counted. |

Zip-slip protection is built in; if the total extracted size exceeds `maxExtractSize` the operation stops with `TOO_LARGE`.

### Version history

| Command | Parameters | Response |
|---|---|---|
| `versions` | `id` | `{ versions: FileVersion[], entry: Entry \| null }`: newest first. If the file was deleted, `entry` is `null` but the history is still listed. |
| `version` | `id`, `vid`, `download?` | The content of the version (a file response, cached for a year since it never changes) |
| `revert` | `id`, `vid` | `{ entry, created }`: replaces the file with that version; the current content becomes a version too. Recreates the file if it was deleted (`created: true`). |
| `rmVersions` | `id`, `vids?` | `{ removed, freed }`: deletes the given versions, or the whole history without `vids` |

### Storage dashboard

| Command | Parameters | `data` |
|---|---|---|
| `stats` | `volume` | `StorageStats`: scans the whole volume |
| `cleanup` | `volume`, `target`, … | `{ removed, freed }` |

`cleanup` options:

| `target` | Extra parameters | Effect |
|---|---|---|
| `"cache"` | — | Deletes the thumbnail cache (regenerated when needed) |
| `"versions"` | `mode: "all"` | All versions |
| `"versions"` | `mode: "orphaned"` | Versions whose file no longer exists |
| `"versions"` | `mode: "older"`, `days` | Versions older than `days` days |
| `"versions"` | `mode: "keep"`, `keep` | Keeps only the last `keep` versions of each file |

### Bulk image processing

`transform` only works when `images` is configured on the server; otherwise it returns `UNSUPPORTED`.

| Parameter | Description |
|---|---|
| `ids` | The images |
| `format?` | `"keep"` (default), `"jpeg"`, `"png"`, `"webp"`, `"avif"`, `"gif"` |
| `width?`, `height?` | Fitted into this box; aspect ratio kept, never upscaled. At most 20,000. |
| `quality?` | 1–100, default 80 |
| `output?` | When the format stays the same: `"overwrite"` (default) or `"copy"` (`name-<suffix>.ext`) |
| `skipLarger?` | Default `true`: the file is left alone if the result isn't smaller than the original |
| `conflict?` | When the output name is taken: `"rename"` (default) or `"overwrite"` |
| `suffix?` | Suffix for copies, default `optimized` |
| `dryRun?` | `true`: encode only and report `after`, `width`, `height` (and `skipped`) without writing anything. Needs the same permissions as a real run. |

Response: `{ results: TransformResult[] }`. Each file reports its own result; an error in one file doesn't stop the others. When the format changes the original is kept and a new file is written next to it. Overwritten files have their old content saved into version history.

## Error codes

| Code | HTTP | When |
|---|---|---|
| `BAD_REQUEST` | 400 | Missing or invalid parameter, invalid id/path, mutating command over GET |
| `UNAUTHORIZED` | 401 | The `authorize` hook threw `TheFinderError("UNAUTHORIZED")` |
| `UNKNOWN_COMMAND` | 400 | Unknown `cmd` |
| `NOT_FOUND` | 404 | No such item, volume or trash item |
| `EXISTS` | 409 | An item with the same name exists |
| `INVALID_NAME` | 400 | Invalid name (`\ / : * ? " < > \|`, a trailing dot, names reserved by Windows, longer than 255 characters, reserved internal folder names) |
| `NOT_A_DIRECTORY` | 400 | A file where a folder was expected |
| `NOT_A_FILE` | 400 | A folder where a file was expected |
| `FORBIDDEN` | 403 | `authorize` returned `false`, `permission` denied it, CSRF header missing, no file system permission |
| `READ_ONLY` | 403 | The volume or the request is read-only |
| `LOCKED` | 403 | A volume root cannot be renamed, moved or deleted |
| `EXTENSION_DENIED` | 403 | The extension is not on the allow list or is on the deny list |
| `TOO_LARGE` | 413 | Upload, chunk, edit, image or archive limit exceeded |
| `MOVE_INTO_ITSELF` | 400 | Tried to move a folder into itself |
| `UNSUPPORTED` | 400 | A non-text file was requested with `get`, a non-`.zip` file was extracted, image processing is off on the server |
| `INVALID_ARCHIVE` | 400 | Corrupt zip |
| `INVALID_IMAGE` | 400 | The image could not be decoded |
| `STORAGE` | 502 | Storage error (S3 response, disk full) |
| `INTERNAL` | 500 | Unexpected error; details go to the server log with the `[thefinder]` prefix |

File system errors are mapped to these codes as well: `ENOENT` → `NOT_FOUND`, `EEXIST`/`ENOTEMPTY` → `EXISTS`, `EACCES`/`EPERM` → `FORBIDDEN`, `ENOSPC` → `STORAGE`, `ENAMETOOLONG` → `INVALID_NAME`.

On top of these, the client ([`ApiError`](client.md#apierror)) can produce codes that don't come from the server: `NETWORK` (no connection or the response isn't JSON), `ABORTED` (upload cancelled), `UPLOAD` (upload didn't complete), `UNKNOWN`.
