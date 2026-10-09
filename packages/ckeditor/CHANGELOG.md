# @thefinder/ckeditor

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

### Patch Changes

- Updated dependencies [416329c]
- Updated dependencies [ffefa5f]
- Updated dependencies [d325b48]
  - @thefinder/react@0.2.0
  - @thefinder/core@0.2.0

## 0.1.1

### Patch Changes

- d1ac763: Richer npm pages: package READMEs with badges, quick starts and links to the English and Turkish docs; better descriptions, keywords and homepage links.
- Updated dependencies [d1ac763]
  - @ci-finder/core@0.1.1
  - @ci-finder/react@0.1.1
