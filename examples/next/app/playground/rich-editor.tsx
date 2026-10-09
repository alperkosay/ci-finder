"use client";

import { useEffect, useRef } from "react";
import type { ClassicEditor } from "ckeditor5";
import "ckeditor5/ckeditor5.css";

/**
 * CKEditor 5 wired to theFinder through `@thefinder/ckeditor`: the folder button in the toolbar
 * opens the file manager, pasted / dropped images are uploaded to `/editor`.
 * The editor is loaded on the client only (it needs `window`).
 */
export function RichEditor({ initialData, onChange }: { initialData: string; onChange: (html: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    let cancelled = false;
    const created = (async (): Promise<ClassicEditor | null> => {
      const ck = await import("ckeditor5");
      const { TheFinder } = await import("@thefinder/ckeditor");
      const tr = (await import("ckeditor5/translations/tr.js")).default;
      if (cancelled || !host.current) return null;
      const editor = await ck.ClassicEditor.create(host.current, {
        licenseKey: "GPL",
        language: "tr",
        translations: [tr],
        plugins: [
          ck.Essentials,
          ck.Paragraph,
          ck.Heading,
          ck.Bold,
          ck.Italic,
          ck.Link,
          ck.AutoLink,
          ck.List,
          ck.BlockQuote,
          ck.Image,
          ck.ImageCaption,
          ck.ImageStyle,
          ck.ImageToolbar,
          ck.ImageResize,
          ck.ImageUpload,
          ck.ImageInsertViaUrl,
          ck.PasteFromOffice,
          TheFinder,
        ],
        toolbar: ["heading", "|", "bold", "italic", "link", "bulletedList", "numberedList", "blockQuote", "|", "theFinder", "|", "undo", "redo"],
        image: {
          toolbar: ["imageStyle:inline", "imageStyle:block", "imageStyle:side", "|", "toggleImageCaption", "imageTextAlternative"],
        },
        link: { defaultProtocol: "https://" },
        theFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
        initialData,
      });
      editor.model.document.on("change:data", () => latest.current(editor.getData()));
      latest.current(editor.getData());
      return editor;
    })();
    return () => {
      cancelled = true;
      void created.then((editor) => editor?.destroy());
    };
    // The editor is created once; `initialData` is only read on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rich-editor">
      <div ref={host} />
    </div>
  );
}
