---
"@ci-finder/react": patch
---

Show the new image right after saving it in the image editor. On volumes with a public `url`, previews, Quick Look and the details panel used the bare file URL, so the browser kept showing the copy it had already loaded. Display URLs now carry the modification time; "Copy link" and the details panel still give the clean public URL.
