---
"@thefinder/react": minor
---

Reopen the folder the user was last in. The folder is kept in localStorage next to the view preferences (`persistKey`), so the file manager and the picker (CKEditor included) each come back where they were left. A deleted or no longer allowed folder falls back to the root. `initialFolder` still wins; `rememberFolder={false}` turns it off.
