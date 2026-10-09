import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createClient, type TheFinderClient, type Entry } from "@thefinder/core/client";
import { getActions } from "./actions";
import { cx, FinderContext, isMac, modKey, useAppearance, useElementSize, useFinder, useStore, type CustomEditor, type FinderContextValue } from "./context";
import { matchesAccept, type Accept } from "./format";
import { createTranslator, type Messages } from "./i18n";
import { FinderStore, type Density, type Prefs, type Skin, type Theme } from "./store";
import { ContextMenu } from "./components/ContextMenu";
import { DetailsPanel } from "./components/DetailsPanel";
import { Dashboard } from "./components/Dashboard";
import { Dialogs } from "./components/Dialogs";
import { ImageBatch } from "./components/ImageBatch";
import { VersionsDialog } from "./components/Versions";
import { Toasts, UploadPanel } from "./components/Feedback";
import { FileView } from "./components/FileView";
import { Header } from "./components/Header";
import { QuickLook } from "./components/QuickLook";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { filesFromInput } from "./components/dnd";
import { CodeEditor } from "./editors/CodeEditor";
import { ImageEditor } from "./editors/ImageEditor";
import { Icon, Spinner } from "./icons";

export interface TheFinderProps {
  /** URL of theFinder's API route, e.g. "/api/files". */
  endpoint: string;
  /** Extra request headers (e.g. Authorization). */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** Fetch credentials mode for cross-origin APIs. */
  credentials?: RequestCredentials;
  /** Bring your own configured client instead of `endpoint`/`headers`. */
  client?: TheFinderClient;

  /** "tr" | "en" or any locale with `messages`. Default: browser language when supported, else "en". */
  locale?: string;
  /** Override or add translations. */
  messages?: Partial<Messages>;
  /** Color scheme. Default: "auto" (follows the OS). */
  theme?: Theme;
  /** Look of the file manager: "classic" or "macos" (Finder-like). Default: "classic". */
  skin?: Skin;
  /** Default: "comfortable". */
  density?: Density;
  /**
   * Show the settings menu (theme, color scheme, density) in the header. The user's choice is
   * remembered under `persistKey` and wins over the props until a prop changes. Default: true.
   */
  settings?: boolean;
  /** Height of the file manager. Default: 100% of the parent. */
  height?: number | string;
  className?: string;
  style?: CSSProperties;

  /** Id of the folder to open first (defaults to the first volume's root). */
  initialFolder?: string;
  /** Initial view preferences (user changes are remembered under `persistKey`). */
  defaultView?: Partial<Prefs>;
  /** localStorage key for remembering view/sort/panels. `false` disables. Default: "thefinder". */
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
  /** Picker mode: shows a "Cancel" button next to "Select" and calls this. */
  onCancel?: () => void;
  /** Allow choosing several files in picker mode. Default: false. */
  multiple?: boolean;
  /**
   * Picker mode: which files can be chosen, like `<input type="file" accept>` ("image/*", ".pdf",
   * a list) or a predicate. Other files stay visible but cannot be selected for the pick.
   */
  accept?: Accept;

  /** Intercept opening a file. Return true to prevent the default (preview / editor / download). */
  onOpen?: (entry: Entry) => boolean | void;
  /** Called after any change (upload, rename, delete, move...). */
  onChange?: (event: { type: string; entries?: Entry[]; ids?: string[] }) => void;
  /** Extra editors offered under "Open with". */
  editors?: CustomEditor[];
  /** Called when the API answers 401, e.g. to redirect to your login page. */
  onUnauthorized?: () => void;
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

function Shell({ height, className, style }: Pick<TheFinderProps, "height" | "className" | "style">) {
  const ctx = useFinder();
  const { store, t, rootRef } = ctx;
  const { theme, skin, density } = useAppearance();
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
      rootRef.current?.querySelector<HTMLInputElement>("[data-tf-search]")?.focus();
      return;
    }
    if (e.key === "/" && !mod) {
      e.preventDefault();
      rootRef.current?.querySelector<HTMLInputElement>("[data-tf-search]")?.focus();
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

  const rootStyle = { ...style, height: height ?? style?.height ?? "100%", "--tf-sidebar-w": `${sidebarWidth}px` } as CSSProperties;

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        (sizeRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      className={cx("tf-root", narrow && "is-narrow", className)}
      data-theme={theme}
      data-skin={skin}
      data-density={density}
      style={rootStyle}
      onKeyDown={onKeyDown}
    >
      {initError ? (
        <div className="tf-fatal">
          <Icon name="alert" size={28} />
          <strong>{t("errorGeneric")}</strong>
          <span>{initError}</span>
          <button type="button" className="tf-btn" onClick={() => store.init()}>
            {t("retry")}
          </button>
        </div>
      ) : !ready ? (
        <div className="tf-fatal">
          <Spinner size={22} />
        </div>
      ) : (
        <>
          <Header />
          <Toolbar />
          <div className={cx("tf-body", sidebarOpen && "has-sidebar", detailsOpen && "has-details")}>
            {sidebarOpen && (
              <>
                {narrow && <div className="tf-scrim" onClick={() => store.set({ sidebarOpen: false })} />}
                <Sidebar />
              </>
            )}
            <div className="tf-main">
              <FileView density={density} />
            </div>
            {detailsOpen && (
              <>
                {narrow && <div className="tf-scrim" onClick={() => store.set({ detailsOpen: false })} />}
                <DetailsPanel />
              </>
            )}
          </div>
          <StatusBar uploadsOpen={uploadsOpen} onToggleUploads={() => setUploadsOpen((o) => !o)} />
          {uploadsOpen && <UploadPanel onClose={() => setUploadsOpen(false)} />}
          <ContextMenu />
          <QuickLook />
          <EditorHost />
          <Dashboard />
          <VersionsDialog />
          <ImageBatch />
          <Dialogs />
          <Toasts />
        </>
      )}
    </div>
  );
}

/**
 * theFinder file manager.
 *
 * ```tsx
 * import { TheFinder } from "@thefinder/react";
 * import "@thefinder/react/styles.css";
 *
 * <TheFinder endpoint="/api/files" locale="tr" />
 * ```
 */
export function TheFinder(props: TheFinderProps) {
  const { endpoint, headers, credentials, locale: localeProp, messages, persistKey = "thefinder", initialFolder } = props;
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
      canPick: (entry) => matchesAccept(entry, latest.current.accept),
      onOpen: (entry) => latest.current.onOpen?.(entry),
      onChange: (event) => latest.current.onChange?.(event),
      onPick: (entries) => latest.current.onSelect?.(entries),
      onUnauthorized: () => latest.current.onUnauthorized?.(),
    });
  });
  store.options.t = t;

  // A prop that changes after mount is a new decision by the host page: it replaces the user's choice.
  const appearance = useMemo(
    () => ({ theme: props.theme ?? "auto", skin: props.skin ?? "classic", density: props.density ?? "comfortable" }) as const,
    [props.theme, props.skin, props.density],
  );
  const firstAppearance = useRef(appearance);
  useEffect(() => {
    const prev = firstAppearance.current;
    if (prev === appearance) return;
    const patch: Partial<Prefs> = {};
    if (prev.theme !== appearance.theme) patch.theme = null;
    if (prev.skin !== appearance.skin) patch.skin = null;
    if (prev.density !== appearance.density) patch.density = null;
    firstAppearance.current = appearance;
    store.set(patch);
  }, [appearance, store]);

  useEffect(() => {
    void store.init(initialFolder);
    // Only once per mounted store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const cancellable = !!props.onCancel;
  const value: FinderContextValue = useMemo(
    () => ({
      store,
      t,
      locale,
      thumbnails: props.thumbnails ?? true,
      editors: props.editors ?? [],
      pickMode: !!props.onSelect,
      pickLabel: props.selectLabel,
      canPick: (entry) => matchesAccept(entry, props.accept),
      multiple: !!props.multiple,
      onPick: (entries) => latest.current.onSelect?.(entries),
      onPickCancel: cancellable ? () => latest.current.onCancel?.() : undefined,
      pickUpload: (folder) => (folder ? folderInput : fileInput).current?.click(),
      rootRef,
      appearance,
      settings: props.settings ?? true,
    }),
    [
      store,
      t,
      locale,
      props.thumbnails,
      props.editors,
      props.onSelect,
      props.selectLabel,
      props.multiple,
      props.accept,
      cancellable,
      appearance,
      props.settings,
    ],
  );

  const onFiles = (list: FileList | null) => {
    if (list?.length) store.upload(filesFromInput(list));
  };

  return (
    <FinderContext.Provider value={value}>
      <Shell height={props.height} className={props.className} style={props.style} />
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
