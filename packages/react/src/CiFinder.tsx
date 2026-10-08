import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createClient, type CiFinderClient, type Entry } from "@ci-finder/core/client";
import { getActions } from "./actions";
import { cx, FinderContext, isMac, modKey, useElementSize, useFinder, useStore, type CustomEditor, type FinderContextValue } from "./context";
import { createTranslator, type Messages } from "./i18n";
import { FinderStore, type Prefs } from "./store";
import { ContextMenu } from "./components/ContextMenu";
import { DetailsPanel } from "./components/DetailsPanel";
import { Dialogs } from "./components/Dialogs";
import { Toasts, UploadPanel } from "./components/Feedback";
import { FileView, type Density } from "./components/FileView";
import { Header } from "./components/Header";
import { QuickLook } from "./components/QuickLook";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { filesFromInput } from "./components/dnd";
import { CodeEditor } from "./editors/CodeEditor";
import { ImageEditor } from "./editors/ImageEditor";
import { Icon, Spinner } from "./icons";

export interface CiFinderProps {
  /** URL of the ciFinder API route, e.g. "/api/files". */
  endpoint: string;
  /** Extra request headers (e.g. Authorization). */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** Fetch credentials mode for cross-origin APIs. */
  credentials?: RequestCredentials;
  /** Bring your own configured client instead of `endpoint`/`headers`. */
  client?: CiFinderClient;

  /** "tr" | "en" or any locale with `messages`. Default: browser language when supported, else "en". */
  locale?: string;
  /** Override or add translations. */
  messages?: Partial<Messages>;
  /** Default: "auto" (follows the OS). */
  theme?: "light" | "dark" | "auto";
  /** Default: "comfortable". */
  density?: Density;
  /** Height of the file manager. Default: 100% of the parent. */
  height?: number | string;
  className?: string;
  style?: CSSProperties;

  /** Id of the folder to open first (defaults to the first volume's root). */
  initialFolder?: string;
  /** Initial view preferences (user changes are remembered under `persistKey`). */
  defaultView?: Partial<Prefs>;
  /** localStorage key for remembering view/sort/panels. `false` disables. Default: "ci-finder". */
  persistKey?: string | false;
  /** Show image thumbnails. Default: true. */
  thumbnails?: boolean;

  /**
   * Picker mode: shows a "Select" button and calls this with the chosen files (also on double click).
   * Ideal for "choose an image" fields in a CMS.
   */
  onSelect?: (entries: Entry[]) => void;
  /** Label of the picker button. */
  selectLabel?: string;
  /** Allow choosing several files in picker mode. Default: false. */
  multiple?: boolean;

  /** Intercept opening a file. Return true to prevent the default (preview / editor / download). */
  onOpen?: (entry: Entry) => boolean | void;
  /** Called after any change (upload, rename, delete, move...). */
  onChange?: (event: { type: string; entries?: Entry[]; ids?: string[] }) => void;
  /** Extra editors offered under "Open with". */
  editors?: CustomEditor[];
}

function defaultLocale(): string {
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language?.toLowerCase() ?? "en";
  return lang.startsWith("tr") ? "tr" : "en";
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

function EditorHost() {
  const { store, editors } = useFinder();
  const editor = useStore((s) => s.editor);
  const entry = useStore((s) => (s.editor ? s.entries[s.editor.id] : undefined));
  if (!editor || !entry) return null;
  const close = () => store.set({ editor: null });
  if (editor.type === "code") return <CodeEditor key={entry.id} entry={entry} onClose={close} />;
  if (editor.type === "image") return <ImageEditor key={entry.id} entry={entry} onClose={close} />;
  const custom = editors.find((e) => `custom:${e.id}` === editor.type);
  return custom ? <>{custom.render({ entry, store, onClose: close })}</> : null;
}

function Shell({ density, theme, height, className, style }: Pick<CiFinderProps, "theme" | "height" | "className" | "style"> & { density: Density }) {
  const ctx = useFinder();
  const { store, t, rootRef } = ctx;
  const ready = useStore((s) => s.ready);
  const initError = useStore((s) => s.initError);
  const detailsOpen = useStore((s) => s.detailsOpen);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const [uploadsOpen, setUploadsOpen] = useState(false);
  const [sizeRef, size] = useElementSize<HTMLDivElement>();
  const narrow = size.width > 0 && size.width < 720;
  const wasNarrow = useRef<boolean | null>(null);

  // Collapse panels once when the component first renders in a narrow container.
  useEffect(() => {
    if (!size.width) return;
    if (wasNarrow.current === null && narrow) store.set({ sidebarOpen: false, detailsOpen: false });
    wasNarrow.current = narrow;
  }, [narrow, size.width, store]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.defaultPrevented) return;
    const mod = modKey(e);
    const key = e.key.toLowerCase();
    const actions = getActions({
      store,
      t,
      editors: ctx.editors,
      pickUpload: ctx.pickUpload,
      openDetails: () => store.set({ detailsOpen: !store.state.detailsOpen }),
    });
    const run = (action: { enabled: boolean; run: () => void }) => {
      e.preventDefault();
      if (action.enabled) action.run();
    };

    if (mod && !e.shiftKey && key === "c") return run(actions.copy);
    if (mod && !e.shiftKey && key === "x") return run(actions.cut);
    if (mod && !e.shiftKey && key === "v") return run(actions.paste);
    if (mod && !e.shiftKey && key === "a") return run(actions.selectAll);
    if (mod && !e.shiftKey && key === "d") return run(actions.duplicate);
    if (mod && e.shiftKey && key === "n") return run(actions.newFolder);
    if (mod && key === "u") return run(actions.uploadFiles);
    if (mod && key === "i") return run(actions.info);
    if ((mod && key === "r") || e.key === "F5") return run(actions.refresh);
    if (mod && key === "f") {
      e.preventDefault();
      rootRef.current?.querySelector<HTMLInputElement>("[data-cf-search]")?.focus();
      return;
    }
    if (e.key === "/" && !mod) {
      e.preventDefault();
      rootRef.current?.querySelector<HTMLInputElement>("[data-cf-search]")?.focus();
      return;
    }
    if (e.key === "F2") return run(actions.rename);
    if (e.shiftKey && (e.key === "Delete" || (isMac && mod && e.key === "Backspace"))) return run(store.inTrash ? actions.delete : actions.deletePermanently);
    if (e.key === "Delete" || (isMac && mod && e.key === "Backspace")) return run(actions.delete);
    if (e.altKey && e.key === "ArrowLeft") return (e.preventDefault(), store.back());
    if (e.altKey && e.key === "ArrowRight") return (e.preventDefault(), store.forward());
    if ((e.altKey && e.key === "ArrowUp") || (!isMac && e.key === "Backspace") || (isMac && mod && e.key === "ArrowUp"))
      return (e.preventDefault(), store.up());
    if (e.key === "Escape") {
      if (store.state.searchQuery) store.clearSearch();
      else if (store.state.clipboard) store.set({ clipboard: null });
    }
  };

  const rootStyle = { ...style, height: height ?? style?.height ?? "100%", "--cf-sidebar-w": `${sidebarWidth}px` } as CSSProperties;

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        (sizeRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      className={cx("cf-root", narrow && "is-narrow", className)}
      data-theme={theme ?? "auto"}
      data-density={density}
      style={rootStyle}
      onKeyDown={onKeyDown}
    >
      {initError ? (
        <div className="cf-fatal">
          <Icon name="alert" size={28} />
          <strong>{t("errorGeneric")}</strong>
          <span>{initError}</span>
          <button type="button" className="cf-btn" onClick={() => store.init()}>
            {t("retry")}
          </button>
        </div>
      ) : !ready ? (
        <div className="cf-fatal">
          <Spinner size={22} />
        </div>
      ) : (
        <>
          <Header />
          <Toolbar />
          <div className={cx("cf-body", sidebarOpen && "has-sidebar", detailsOpen && "has-details")}>
            {sidebarOpen && (
              <>
                {narrow && <div className="cf-scrim" onClick={() => store.set({ sidebarOpen: false })} />}
                <Sidebar />
              </>
            )}
            <main className="cf-main">
              <FileView density={density} />
            </main>
            {detailsOpen && (
              <>
                {narrow && <div className="cf-scrim" onClick={() => store.set({ detailsOpen: false })} />}
                <DetailsPanel />
              </>
            )}
          </div>
          <StatusBar uploadsOpen={uploadsOpen} onToggleUploads={() => setUploadsOpen((o) => !o)} />
          {uploadsOpen && <UploadPanel onClose={() => setUploadsOpen(false)} />}
          <ContextMenu />
          <QuickLook />
          <EditorHost />
          <Dialogs />
          <Toasts />
        </>
      )}
    </div>
  );
}

/**
 * ciFinder file manager.
 *
 * ```tsx
 * import { CiFinder } from "@ci-finder/react";
 * import "@ci-finder/react/styles.css";
 *
 * <CiFinder endpoint="/api/files" locale="tr" />
 * ```
 */
export function CiFinder(props: CiFinderProps) {
  const { endpoint, headers, credentials, locale: localeProp, messages, persistKey = "ci-finder", initialFolder } = props;
  const locale = localeProp ?? defaultLocale();
  const t = useMemo(() => createTranslator(locale, messages), [locale, messages]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  // Callbacks change every render; route them through a ref so the store never goes stale.
  const latest = useRef(props);
  latest.current = props;

  const [store] = useState(() => {
    const client = props.client ?? createClient({ endpoint, headers, credentials });
    return new FinderStore({
      client,
      t,
      locale,
      persistKey,
      initialPrefs: props.defaultView,
      pickMode: !!props.onSelect,
      onOpen: (entry) => latest.current.onOpen?.(entry),
      onChange: (event) => latest.current.onChange?.(event),
      onPick: (entries) => latest.current.onSelect?.(entries),
    });
  });
  store.options.t = t;

  useEffect(() => {
    void store.init(initialFolder);
    // Only once per mounted store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const value: FinderContextValue = useMemo(
    () => ({
      store,
      t,
      locale,
      thumbnails: props.thumbnails ?? true,
      editors: props.editors ?? [],
      pickMode: !!props.onSelect,
      pickLabel: props.selectLabel,
      multiple: !!props.multiple,
      onPick: (entries) => latest.current.onSelect?.(entries),
      pickUpload: (folder) => (folder ? folderInput : fileInput).current?.click(),
      rootRef,
    }),
    [store, t, locale, props.thumbnails, props.editors, props.onSelect, props.selectLabel, props.multiple],
  );

  const onFiles = (list: FileList | null) => {
    if (list?.length) store.upload(filesFromInput(list));
  };

  return (
    <FinderContext.Provider value={value}>
      <Shell density={props.density ?? "comfortable"} theme={props.theme} height={props.height} className={props.className} style={props.style} />
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ""))} />
      <input
        ref={folderInput}
        type="file"
        hidden
        // @ts-expect-error non-standard but universally supported folder picker
        webkitdirectory=""
        onChange={(e) => (onFiles(e.target.files), (e.target.value = ""))}
      />
    </FinderContext.Provider>
  );
}
