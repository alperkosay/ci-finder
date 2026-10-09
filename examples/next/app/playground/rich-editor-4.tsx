"use client";

import { useEffect, useRef } from "react";
import { registerTheFinder, type CKEditorStatic } from "@thefinder/ckeditor/v4";

/** 4.22.1 is the last open-source CKEditor 4 release; 4.23+ (LTS) needs a commercial license key. */
const SRC = "https://cdn.ckeditor.com/4.22.1/standard-all/ckeditor.js";

interface CKEditor4Instance {
  getData(): string;
  on(event: string, listener: () => void): void;
  destroy(): void;
}
type CKEditor4Global = CKEditorStatic & { replace(el: HTMLElement, config: Record<string, unknown>): CKEditor4Instance };

let loading: Promise<CKEditor4Global> | null = null;

/** CKEditor 4 is a classic script that defines `window.CKEDITOR`; load it once. */
function loadCKEditor4(): Promise<CKEditor4Global> {
  loading ??= new Promise((resolve, reject) => {
    const w = window as unknown as { CKEDITOR?: CKEditor4Global };
    if (w.CKEDITOR) return resolve(w.CKEDITOR);
    const script = document.createElement("script");
    script.src = SRC;
    script.onload = () => resolve(w.CKEDITOR!);
    script.onerror = () => {
      loading = null;
      reject(new Error("CKEditor 4 could not be loaded"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * CKEditor 4 with the `@thefinder/ckeditor/v4` connector: the folder button in the toolbar, the
 * "Browse Server" buttons of the image and link dialogs and pasted images all go through theFinder.
 */
export function RichEditor4({ initialData, onChange }: { initialData: string; onChange: (html: string) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    let cancelled = false;
    let editor: CKEditor4Instance | null = null;
    loadCKEditor4().then(
      (CKEDITOR) => {
        if (cancelled || !area.current) return;
        registerTheFinder(CKEDITOR);
        editor = CKEDITOR.replace(area.current, {
          language: "tr",
          height: 240,
          versionCheck: false,
          extraPlugins: "thefinder,uploadimage",
          removePlugins: "exportpdf",
          removeButtons: "Subscript,Superscript,Anchor,SpecialChar,HorizontalRule,Scayt",
          theFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
        });
        const emit = () => latest.current(editor!.getData());
        editor.on("change", emit);
        editor.on("instanceReady", emit);
      },
      (e) => console.error(e),
    );
    return () => {
      cancelled = true;
      editor?.destroy();
    };
  }, []);

  return (
    <div className="rich-editor-4">
      <textarea ref={area} defaultValue={initialData} aria-label="CKEditor 4" />
    </div>
  );
}
