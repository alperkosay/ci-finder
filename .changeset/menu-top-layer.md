---
"@thefinder/react": patch
---

Open context menus at the pointer on pages that style `<dialog>` themselves. A host rule such as `dialog { transform: translate(-50%, -50%) }` made the picker the containing block of its menus, so they opened shifted, e.g. in the picker launched from CKEditor. Menus now render in the top layer (popover) and are placed against the viewport whatever their ancestors do, and moving the picker no longer jumps when the page centers dialogs with a transform.
