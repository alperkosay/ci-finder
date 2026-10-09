# @thefinder/core

## 0.4.0

### Minor Changes

- 9277aa9: Quicker editing and more size information:
  
  - The context menu has "Edit" right under "Open": the image editor for pictures, the code editor for text files. "Open with" now only lists custom editors.
  - The image editor shows the estimated size of the result (e.g. `21 KB → 2.6 KB −88%`) and updates it a moment after each crop, resize, format or quality change.
  - The details panel works out folder sizes on its own, without a "Calculate" click: for a selected folder, for a selection with folders, and for the open folder when nothing is selected. Results are remembered until the files change.
  - The bulk image optimizer shows a growth as `+12%` instead of `12%`.
  - `client.size()` takes an optional `AbortSignal`.

## 0.3.1

No changes in this release.

## 0.3.0

No changes in this release.

## 0.2.0

### Minor Changes

- ffefa5f: ciFinder is now theFinder. The packages moved from `@ci-finder/*` to `@thefinder/*`; the old packages are deprecated.
  
  | Before | After |
  |---|---|
  | `@ci-finder/core`, `/next`, `/react`, `/ckeditor` | `@thefinder/core`, `/next`, `/react`, `/ckeditor` |
  | `<CiFinder />`, `CiFinderProps` | `<TheFinder />`, `TheFinderProps` |
  | `createCiFinder`, `CiFinderOptions`, `CiFinderError`, `isCiFinderError` | `createTheFinder`, `TheFinderOptions`, `TheFinderError`, `isTheFinderError` |
  | `CiFinderClient` | `TheFinderClient` |
  | `registerCiFinder`, CKEditor toolbar button and config key `ciFinder` | `registerTheFinder`, toolbar button and config key `theFinder` |
  | CSS classes and variables `.cf-*`, `--cf-*` | `.tf-*`, `--tf-*` |
  | request header `x-ci-finder` | `x-thefinder` |
  | hidden folders `.cf-trash`, `.cf-versions`, `.cf-thumbs` | `.tf-trash`, `.tf-versions`, `.tf-thumbs` |
  | default `persistKey` `"ci-finder"` | `"thefinder"` |
  
  To keep the trash and version history of an existing volume, rename its three hidden folders (for example `mv uploads/.cf-trash uploads/.tf-trash`); `.cf-thumbs` can simply be deleted.

## 0.1.1

### Patch Changes

- d1ac763: Richer npm pages: package READMEs with badges, quick starts and links to the English and Turkish docs; better descriptions, keywords and homepage links.
