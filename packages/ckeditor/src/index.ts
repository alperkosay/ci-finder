import { ButtonView, FileRepository, Plugin, type FileLoader, type UploadAdapter, type UploadResponse } from "ckeditor5";
import { ApiError, createClient, type CiFinderClient } from "@ci-finder/core/client";
import { openFilePicker, pickedUrl, type FilePickerOptions, type PickedFile } from "@ci-finder/react";
import { ensureFolder } from "./folder";

export interface CiFinderEditorConfig {
  /** URL of the ciFinder API route. Default: "/api/files". */
  endpoint?: string;
  headers?: Record<string, string> | (() => Record<string, string>);
  credentials?: RequestCredentials;
  /** Bring your own configured client instead of `endpoint` / `headers`. */
  client?: CiFinderClient;
  /**
   * Where pasted and dropped images are uploaded: a folder path in the first volume ("/editor"), or
   * `{ volume, path }`. Missing folders are created. `false` keeps CKEditor's own upload handling.
   * Default: "/editor".
   */
  uploadFolder?: string | { volume: string; path: string } | false;
  /** Insert absolute URLs ("https://site/uploads/a.png"). Default: false (server-relative). */
  absoluteUrls?: boolean;
  /** Options for the picker opened by the toolbar button (accept, theme, locale...). */
  picker?: Partial<FilePickerOptions>;
  /** Replace the built-in picker, e.g. to open ciFinder inside your own modal. */
  openPicker?: () => Promise<PickedFile[] | null>;
}

declare module "@ckeditor/ckeditor5-core" {
  interface EditorConfig {
    /** ciFinder connector settings. See `CiFinderEditorConfig`. */
    ciFinder?: CiFinderEditorConfig;
  }
  interface PluginsMap {
    [CiFinder.pluginName]: CiFinder;
  }
}

/** Folder with a magnifier, drawn like CKEditor's own 20px icons. */
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="M2.25 5.6c0-.75.6-1.35 1.35-1.35h3.7l1.6 1.6h7.5c.75 0 1.35.6 1.35 1.35v7.2c0 .75-.6 1.35-1.35 1.35H3.6c-.75 0-1.35-.6-1.35-1.35z"/><circle cx="9.6" cy="10.9" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="m11.35 12.65 1.9 1.9"/></svg>';

const LABELS: Record<string, { browse: string; insert: string; uploadFailed: string }> = {
  en: { browse: "Browse files", insert: "Insert", uploadFailed: "Upload failed" },
  tr: { browse: "Dosya yöneticisi", insert: "Ekle", uploadFailed: "Yükleme başarısız" },
};

/**
 * CKEditor 5 connector for ciFinder (the CKFinder role):
 * - a `ciFinder` toolbar button that opens the file manager; chosen images are inserted as images,
 *   other files as links (on the selected text when there is one);
 * - an upload adapter, so pasted and dropped images are stored through ciFinder.
 *
 * ```ts
 * ClassicEditor.create(el, {
 *   licenseKey: "GPL",
 *   plugins: [Essentials, Paragraph, Image, ImageUpload, Link, CiFinder],
 *   toolbar: ["bold", "link", "|", "ciFinder"],
 *   ciFinder: { endpoint: "/api/files", uploadFolder: "/editor" },
 * });
 * ```
 */
export class CiFinder extends Plugin {
  static get pluginName() {
    return "CiFinder" as const;
  }

  static get requires() {
    return [FileRepository] as const;
  }

  private client!: CiFinderClient;
  private settings!: CiFinderEditorConfig;
  private folder: Promise<string> | null = null;

  init(): void {
    const editor = this.editor;
    const settings: CiFinderEditorConfig = editor.config.get("ciFinder") ?? {};
    this.settings = settings;
    this.client =
      settings.client ?? createClient({ endpoint: settings.endpoint ?? "/api/files", headers: settings.headers, credentials: settings.credentials });
    const labels = LABELS[editor.locale.uiLanguage.split("-")[0]!] ?? LABELS.en!;

    if (settings.uploadFolder !== false) {
      editor.plugins.get(FileRepository).createUploadAdapter = (loader) =>
        new CiFinderUploadAdapter(loader, this.client, () => this.uploadTarget(), !!settings.absoluteUrls, labels.uploadFailed);
    }

    editor.ui.componentFactory.add("ciFinder", (locale) => {
      const button = new ButtonView(locale);
      button.set({ label: labels.browse, icon: ICON, tooltip: true });
      button.bind("isEnabled").to(editor, "isReadOnly", (readOnly: boolean) => !readOnly);
      button.on("execute", () => void this.browse());
      return button;
    });
  }

  /** Opens the file manager and inserts what was chosen. Also callable from your own UI. */
  async browse(): Promise<void> {
    const editor = this.editor;
    const labels = LABELS[editor.locale.uiLanguage.split("-")[0]!] ?? LABELS.en!;
    const files = this.settings.openPicker
      ? await this.settings.openPicker()
      : await openFilePicker({
          endpoint: this.settings.endpoint ?? "/api/files",
          client: this.client,
          multiple: true,
          locale: editor.locale.uiLanguage,
          selectLabel: labels.insert,
          absoluteUrls: this.settings.absoluteUrls,
          ...this.settings.picker,
        });
    editor.editing.view.focus();
    if (files?.length) this.insert(files);
  }

  /** Images become images (when the Image plugin is loaded), everything else becomes a link. */
  insert(files: PickedFile[]): void {
    const editor = this.editor;
    const canInsertImage = !!editor.commands.get("insertImage")?.isEnabled;
    const images = canInsertImage ? files.filter((f) => f.mime.startsWith("image/")) : [];
    const links = files.filter((f) => !images.includes(f));

    if (images.length) editor.execute("insertImage", { source: images.map((f) => f.url) });
    if (!links.length) return;

    const link = editor.commands.get("link");
    const selection = editor.model.document.selection;
    if (links.length === 1 && link?.isEnabled && !selection.isCollapsed) {
      editor.execute("link", links[0]!.url);
      return;
    }
    editor.model.change((writer) => {
      links.forEach((file, i) => {
        if (i) editor.model.insertContent(writer.createText(" "));
        editor.model.insertContent(writer.createText(file.name, link ? { linkHref: file.url } : {}));
      });
    });
  }

  /** Resolves (and creates once) the folder uploads go to. */
  private uploadTarget(): Promise<string> {
    this.folder ??= ensureFolder(this.client, this.settings.uploadFolder || "/editor").catch((e) => {
      this.folder = null;
      throw e;
    });
    return this.folder;
  }
}

/** CKEditor upload adapter that stores files through ciFinder's chunked upload. */
export class CiFinderUploadAdapter implements UploadAdapter {
  private readonly controller = new AbortController();

  constructor(
    private readonly loader: FileLoader,
    private readonly client: CiFinderClient,
    private readonly target: () => Promise<string>,
    private readonly absolute = false,
    private readonly failedMessage = "Upload failed",
  ) {}

  async upload(): Promise<UploadResponse> {
    try {
      const file = await this.loader.file;
      if (!file) throw new Error("No file");
      const entry = await this.client.upload(file, await this.target(), {
        signal: this.controller.signal,
        onProgress: ({ loaded, total }) => {
          this.loader.uploadTotal = total;
          this.loader.uploaded = loaded;
        },
      });
      return { default: pickedUrl(entry, this.client, this.absolute) };
    } catch (e) {
      // CKEditor shows a rejected string to the user.
      return Promise.reject(e instanceof ApiError ? `${this.failedMessage}: ${e.message}` : this.failedMessage);
    }
  }

  abort(): void {
    this.controller.abort();
  }
}

export type { PickedFile } from "@ci-finder/react";
