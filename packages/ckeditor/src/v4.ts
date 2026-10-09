import { ApiError, createClient, type TheFinderClient } from "@thefinder/core/client";
import { openFilePicker, pickedUrl, type FilePickerOptions, type PickedFile } from "@thefinder/react";
import { ensureFolder } from "./folder";

/**
 * CKEditor 4 connector. CKEditor 4 is configured through a global `CKEDITOR` object, so instead
 * of importing it this module registers a `thefinder` plugin on the instance you pass in:
 *
 * ```ts
 * import { registerTheFinder } from "@thefinder/ckeditor/v4";
 *
 * registerTheFinder(window.CKEDITOR);
 * CKEDITOR.replace("body", {
 *   extraPlugins: "thefinder,uploadimage",
 *   theFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
 * });
 * ```
 *
 * What it does:
 * - adds a `TheFinder` toolbar button (images are inserted as images, other files as links);
 * - turns the "Browse Server" buttons of the image and link dialogs into theFinder's picker;
 * - uploads pasted and dropped images (the `uploadimage` plugin) through theFinder.
 */

export interface TheFinderEditor4Config {
  /** URL of theFinder's API route. Default: "/api/files". */
  endpoint?: string;
  headers?: Record<string, string> | (() => Record<string, string>);
  credentials?: RequestCredentials;
  client?: TheFinderClient;
  /** Folder for pasted / dropped images: a path in the first volume, or `{ volume, path }`. `false` disables. Default: "/editor". */
  uploadFolder?: string | { volume: string; path: string } | false;
  /** Insert absolute URLs. Default: false. */
  absoluteUrls?: boolean;
  /** Options for the picker (accept, theme, locale...). */
  picker?: Partial<FilePickerOptions>;
  /** Replace the built-in picker. `images` is true when an image is expected (image dialog). */
  openPicker?: (options: { images: boolean; multiple: boolean }) => Promise<PickedFile[] | null>;
}

/* Minimal structural types for the parts of the CKEditor 4 API that are used (no dependency on its typings). */
interface CKEventInfo<T> {
  data: T;
  stop(): void;
}
interface CKFileLoader {
  file: Blob & { name?: string };
  fileName: string;
  url?: string;
  message?: string;
  uploaded: number;
  uploadTotal: number | null;
  responseData?: Record<string, unknown>;
  changeStatus(status: "uploading" | "uploaded" | "error" | "abort"): void;
  update(): void;
  on(event: "abort", listener: () => void): void;
}
interface CKEditor4 {
  config: Record<string, unknown> & { theFinder?: TheFinderEditor4Config; language?: string; defaultLanguage?: string };
  langCode: string;
  readOnly: boolean;
  popup?: (url: string, width?: number | string, height?: number | string, features?: string) => unknown;
  addCommand(name: string, definition: { exec(editor: CKEditor4): boolean | void; readOnly?: 0 | 1; canUndo?: boolean }): unknown;
  ui: { addButton?(name: string, definition: { label: string; command: string; toolbar?: string; icon?: string }): void };
  on(event: string, listener: (evt: CKEventInfo<{ fileLoader: CKFileLoader }>) => void, scope?: unknown, data?: unknown, priority?: number): void;
  insertHtml(html: string): void;
  focus(): void;
  lockSelection?(): boolean;
  unlockSelection?(restore?: boolean): void;
  getSelection(): { getSelectedText(): string } | null;
  fire(event: string): unknown;
}
export interface CKEditorStatic {
  plugins: {
    add(name: string, definition: { requires?: string; beforeInit?(editor: CKEditor4): void; init?(editor: CKEditor4): void }): void;
    registered: Record<string, unknown>;
  };
  tools: { callFunction(ref: number | string, ...args: unknown[]): unknown; htmlEncodeAttr(text: string): string; htmlEncode(text: string): string };
}

const MARKER = "#thefinder";
const IMAGE_MARKER = "#thefinder-image";

const LABELS: Record<string, { browse: string; insert: string; uploadFailed: string }> = {
  en: { browse: "Browse files", insert: "Insert", uploadFailed: "Upload failed" },
  tr: { browse: "Dosya yöneticisi", insert: "Ekle", uploadFailed: "Yükleme başarısız" },
};

/**
 * Folder with a magnifier, 16px. CKEditor 4 prefixes button icon paths with its `basePath`, which
 * breaks data URLs, so the icon is applied with a stylesheet instead (see `injectIconStyle`).
 */
const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#333" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"><path d="M1.75 4.3c0-.6.5-1.05 1.05-1.05h3l1.3 1.3h6.1c.6 0 1.05.45 1.05 1.05v6.1c0 .6-.45 1.05-1.05 1.05H2.8c-.6 0-1.05-.45-1.05-1.05z"/><circle cx="7.7" cy="8.6" r="1.9"/><path d="m9.1 10 1.5 1.5"/></svg>',
  );

function injectIconStyle(): void {
  if (typeof document === "undefined" || document.getElementById("thefinder-cke4")) return;
  const style = document.createElement("style");
  style.id = "thefinder-cke4";
  style.textContent = `.cke_button__thefinder_icon{background:url("${ICON}") center/16px 16px no-repeat !important}`;
  document.head.appendChild(style);
}

/** Registers the `thefinder` plugin on a CKEditor 4 global. Safe to call more than once. */
export function registerTheFinder(CKEDITOR: CKEditorStatic): void {
  if (CKEDITOR.plugins.registered.thefinder) return;
  injectIconStyle();

  CKEDITOR.plugins.add("thefinder", {
    requires: "filebrowser",

    // Runs before every plugin's `init`: turn on the browse buttons and the upload path the
    // filebrowser / uploadimage plugins look for, unless the app set its own.
    beforeInit(editor) {
      const c = editor.config;
      const settings = c.theFinder ?? {};
      c.filebrowserBrowseUrl ??= MARKER;
      c.filebrowserImageBrowseUrl ??= IMAGE_MARKER;
      if (settings.uploadFolder !== false) {
        c.uploadUrl ??= MARKER;
        c.imageUploadUrl ??= MARKER;
      }
    },

    init(editor) {
      const settings: TheFinderEditor4Config = editor.config.theFinder ?? {};
      const endpoint = settings.endpoint ?? "/api/files";
      const client = settings.client ?? createClient({ endpoint, headers: settings.headers, credentials: settings.credentials });
      const lang = LABELS[(editor.langCode || "en").split("-")[0]!] ?? LABELS.en!;
      let folder: Promise<string> | null = null;

      const pick = async (images: boolean, multiple: boolean): Promise<PickedFile[] | null> => {
        editor.lockSelection?.();
        try {
          return settings.openPicker
            ? await settings.openPicker({ images, multiple })
            : await openFilePicker({
                endpoint,
                client,
                multiple,
                accept: images ? "image/*" : undefined,
                locale: editor.langCode,
                selectLabel: lang.insert,
                absoluteUrls: settings.absoluteUrls,
                ...settings.picker,
              });
        } finally {
          editor.focus();
          editor.unlockSelection?.(true);
        }
      };

      // Toolbar button: insert straight into the content.
      editor.addCommand("thefinder", {
        canUndo: true,
        exec(ed) {
          void pick(false, true).then((files) => {
            if (!files?.length) return;
            const { htmlEncodeAttr, htmlEncode } = CKEDITOR.tools;
            const selected = ed.getSelection()?.getSelectedText() ?? "";
            const html = files.map((f, i) => {
              if (f.mime.startsWith("image/")) return `<img src="${htmlEncodeAttr(f.url)}" alt="" />`;
              const text = files.length === 1 && i === 0 && selected ? selected : f.name;
              return `<a href="${htmlEncodeAttr(f.url)}">${htmlEncode(text)}</a>`;
            });
            ed.insertHtml(html.join(" "));
            ed.fire("change");
          });
        },
      });
      editor.ui.addButton?.("TheFinder", { label: lang.browse, command: "thefinder", toolbar: "insert,5" });

      // "Browse Server" in dialogs: the filebrowser plugin opens `editor.popup(url)` with the
      // callback number in the URL; answer it with the picked file instead of a popup window.
      const popup = editor.popup;
      editor.popup = function (url, width, height, features) {
        if (!url.startsWith(MARKER)) return popup?.call(this, url, width, height, features);
        const fn = /[?&]CKEditorFuncNum=(\d+)/.exec(url)?.[1];
        void pick(url.startsWith(IMAGE_MARKER), false).then((files) => {
          if (fn && files?.[0]) CKEDITOR.tools.callFunction(Number(fn), files[0].url);
        });
        return true;
      };

      if (settings.uploadFolder === false) return;
      const uploadTarget = () => {
        folder ??= ensureFolder(client, settings.uploadFolder || "/editor").catch((e) => {
          folder = null;
          throw e;
        });
        return folder;
      };

      // Pasted / dropped images: take the request over before the default XHR is sent.
      editor.on(
        "fileUploadRequest",
        (evt) => {
          const loader = evt.data.fileLoader;
          evt.stop();
          const controller = new AbortController();
          loader.on("abort", () => controller.abort());
          loader.changeStatus("uploading");
          void (async () => {
            try {
              const file = loader.file.name ? loader.file : new File([loader.file], loader.fileName || "image.png", { type: loader.file.type });
              const entry = await client.upload(file, await uploadTarget(), {
                signal: controller.signal,
                onProgress: ({ loaded, total }) => {
                  loader.uploadTotal = total;
                  loader.uploaded = loaded;
                  loader.update();
                },
              });
              loader.url = pickedUrl(entry, client, settings.absoluteUrls);
              loader.fileName = entry.name;
              // What a CKFinder-style JSON response would have carried; uploadimage reads it.
              loader.responseData = { ...loader.responseData, uploaded: 1, url: loader.url, fileName: entry.name };
              loader.changeStatus("uploaded");
            } catch (e) {
              if (e instanceof ApiError && e.code === "ABORTED") return;
              loader.message = e instanceof ApiError ? `${lang.uploadFailed}: ${e.message}` : lang.uploadFailed;
              loader.changeStatus("error");
            }
          })();
        },
        null,
        null,
        4,
      );
    },
  });
}

export type { PickedFile } from "@thefinder/react";
