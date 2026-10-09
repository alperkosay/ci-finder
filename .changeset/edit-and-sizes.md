---
"@thefinder/react": minor
"@thefinder/core": minor
---

Quicker editing and more size information:

- The context menu has "Edit" right under "Open": the image editor for pictures, the code editor for text files. "Open with" now only lists custom editors.
- The image editor shows the estimated size of the result (e.g. `21 KB → 2.6 KB −88%`) and updates it a moment after each crop, resize, format or quality change.
- The details panel works out folder sizes on its own, without a "Calculate" click: for a selected folder, for a selection with folders, and for the open folder when nothing is selected. Results are remembered until the files change.
- The bulk image optimizer shows a growth as `+12%` instead of `12%`.
- `client.size()` takes an optional `AbortSignal`.
