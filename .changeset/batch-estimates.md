---
"@thefinder/react": minor
"@thefinder/core": minor
---

Show how much each image would shrink before running "Optimize images". The dialog lists the estimated size and change of every image (e.g. `18 KB → ≈ 5.7 KB −68%`), marks the ones that would be skipped, and sums them up in the footer. Estimates follow the size, format and quality settings and are worked out again a moment after each change.

`transform` takes a `dryRun` option: the images are encoded and their sizes reported, but nothing is written.
