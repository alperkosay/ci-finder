# theFinder API reference

🌐 **English** · [Türkçe](tr/README.md)

This folder documents the public API of every package, one by one. For installation and general usage, see the root [README](../../README.md).

| Document | Contents |
|---|---|
| [protocol.md](protocol.md) | The HTTP protocol: request format, every command, parameters, responses, error codes |
| [core.md](core.md) | `@thefinder/core`: engine, options, drivers, adapters, file server, sharp, helpers, types |
| [client.md](client.md) | `@thefinder/core/client`: API client for the browser and the server |
| [next.md](next.md) | `@thefinder/next`: routes and project root detection |
| [react.md](react.md) | `@thefinder/react`: `<TheFinder />`, file picker, custom editors, store, i18n, theme variables |
| [ckeditor.md](ckeditor.md) | `@thefinder/ckeditor`: CKEditor 5 plugin and CKEditor 4 connector |

## Core concepts

- **Volume:** A storage root. Each volume is backed by a driver (`localDriver`, `s3Driver` or your own). Several volumes can be used at once.
- **Volume path:** A normalized POSIX path inside the volume that starts with `/`: `/`, `/documents/report.pdf`. Paths containing `..` are not resolved, they are rejected.
- **Id:** `<volume>_<base64url(path)>`, for example `files_L2RvY3MvYS50eHQ` (`/docs/a.txt` in the `files` volume). Ids are stable, safe to use in URLs and reversible: `encodeId` / `decodeId`.
- **Entry:** How a file or folder is represented in the API. See [core.md › Entry](core.md#entry) for its fields.
- **Hidden internal folders:** `.tf-trash` (trash), `.tf-versions` (version history) and `.tf-thumbs` (thumbnail cache). They cannot be reached by any command, search or the file server, and no item can be created with these names.

## Versions

The four packages are always released with the same version number. During `0.x`, minor releases (`0.1` → `0.2`) may contain breaking changes; changes are listed in each package's `CHANGELOG.md`.
