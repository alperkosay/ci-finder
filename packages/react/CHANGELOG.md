# @thefinder/react

## 0.3.0

### Minor Changes

- 0d26513: Move the picker by dragging its header, like a window, from `openFilePicker`, `useFilePicker` and the CKEditor plugins alike. It always opens centered, cannot be dragged off screen, and a double click on the header puts it back in the middle. Full-screen pickers on small screens stay put.
- 0d26513: Reopen the folder the user was last in. The folder is kept in localStorage next to the view preferences (`persistKey`), so the file manager and the picker (CKEditor included) each come back where they were left. A deleted or no longer allowed folder falls back to the root. `initialFolder` still wins; `rememberFolder={false}` turns it off.

### Patch Changes

- @thefinder/core@0.3.0

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

- 416329c: Show the new image right after saving it in the image editor. On volumes with a public `url`, previews, Quick Look and the details panel used the bare file URL, so the browser kept showing the copy it had already loaded. Display URLs now carry the modification time; "Copy link" and the details panel still give the clean public URL.
- d325b48: Fix submenus ("Open with", "View", "Sort by") opening in the wrong place, clipped and blanking their parent menu in the macOS skin. Submenus now render next to their parent menu and open to the left when there is no room on the right.
- Updated dependencies [ffefa5f]
  - @thefinder/core@0.2.0

## 0.1.1

### Patch Changes

- d1ac763: Richer npm pages: package READMEs with badges, quick starts and links to the English and Turkish docs; better descriptions, keywords and homepage links.
- Updated dependencies [d1ac763]
  - @ci-finder/core@0.1.1
