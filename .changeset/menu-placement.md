---
"@thefinder/react": patch
---

Fix context menus near the bottom and in a moved picker. A menu with no room below the pointer now opens above it, or ends at the bottom edge when it does not fit there either, instead of jumping to the top of the screen. The picker is now moved with its position instead of a transform, so context menus, Quick Look and the editors inside a dragged picker stay where they belong.
