import { ApiError, type CiFinderClient, type ConflictMode, type Entry, type InitResult, type VolumeInfo } from "@ci-finder/core/client";
import { baseOf, categoryOf, createCollator, extOf, isEditableText } from "./format";
import type { MessageKey, Translate } from "./i18n";

export type ViewMode = "grid" | "list";
export type SortKey = "name" | "size" | "mtime" | "kind";

export interface UploadItem {
  id: number;
  name: string;
  relativePath?: string;
  dst: string;
  size: number;
  loaded: number;
  status: "queued" | "uploading" | "done" | "error" | "cancelled";
  error?: string;
  file: File;
  controller?: AbortController;
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
  action?: { label: string; run: () => void };
}

/** Pseudo folder id of the trash view (aggregates the trash of every volume). */
export const TRASH_ID = "cf:trash";

export type Dialog =
  | { type: "confirm"; title: string; body?: string; confirmLabel: string; danger?: boolean; resolve: (ok: boolean) => void }
  | { type: "prompt"; title: string; value: string; confirmLabel: string; resolve: (value: string | null) => void }
  | { type: "conflict"; names: string[]; resolve: (mode: ConflictMode | null) => void };

export interface MenuState {
  x: number;
  y: number;
  context: "item" | "background" | "tree";
  targetId?: string;
}

export interface Prefs {
  view: ViewMode;
  sortKey: SortKey;
  sortDir: 1 | -1;
  foldersFirst: boolean;
  detailsOpen: boolean;
  sidebarWidth: number;
}

export interface State extends Prefs {
  ready: boolean;
  initError: string | null;
  volumes: VolumeInfo[];
  entries: Record<string, Entry>;
  /** Folder id → ids of its children (from `ls`). */
  listings: Record<string, string[]>;
  /** Folder id → ids of its sub-folders (from `tree`). */
  tree: Record<string, string[]>;
  treeLoading: Record<string, boolean>;
  expanded: Record<string, boolean>;
  cwd: string | null;
  loading: boolean;
  listError: string | null;
  history: string[];
  historyIndex: number;
  selection: string[];
  anchor: string | null;
  focus: string | null;
  searchQuery: string;
  searchResults: string[] | null;
  searchLoading: boolean;
  clipboard: { ids: string[]; cut: boolean } | null;
  uploads: UploadItem[];
  toasts: Toast[];
  dialog: Dialog | null;
  menu: MenuState | null;
  renaming: string | null;
  preview: string | null;
  editor: { id: string; type: string } | null;
  sidebarOpen: boolean;
  /** Number of items in the trash across volumes. */
  trashCount: number;
  /** Server-side thumbnail support announced by `init`. */
  thumbs: InitResult["thumbnails"];
  /** Server-side image processing announced by `init` (null: the browser does it). */
  images: InitResult["images"];
  /** Storage dashboard is open. */
  dashboard: boolean;
  /** File whose version history is open. */
  versionsOf: { id: string; name: string } | null;
  /** Images selected for the bulk optimize dialog. */
  imageBatch: string[] | null;
  /** Touch: a long press started a multi-selection; taps toggle until it ends. */
  touchSelecting: boolean;
}

export interface StoreOptions {
  client: CiFinderClient;
  t: Translate;
  locale: string;
  persistKey?: string | false;
  initialPrefs?: Partial<Prefs>;
  onOpen?: (entry: Entry) => boolean | void;
  onChange?: (event: { type: string; entries?: Entry[]; ids?: string[] }) => void;
  pickMode?: boolean;
  /** Picker mode: whether a file may be chosen; others open normally on double click. */
  canPick?: (entry: Entry) => boolean;
  onPick?: (entries: Entry[]) => void;
  /** Called when the API answers 401 (session expired / not signed in). */
  onUnauthorized?: () => void;
}

const PREF_KEYS: (keyof Prefs)[] = ["view", "sortKey", "sortDir", "foldersFirst", "detailsOpen", "sidebarWidth"];
const MAX_PARALLEL_UPLOADS = 3;

const EMPTY: string[] = [];

let seq = 0;
const nextId = () => ++seq;

function loadPrefs(key: string | false | undefined): Partial<Prefs> {
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
  } catch {
    return {};
  }
}

/** Is `child` (an entry) located inside folder `dir` or deeper? */
function isWithin(child: Entry, dir: Entry): boolean {
  return child.volume === dir.volume && (dir.path === "/" || child.path.startsWith(dir.path + "/"));
}

export class FinderStore {
  state: State;
  private listeners = new Set<() => void>();
  private lsController: AbortController | null = null;
  private searchController: AbortController | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private visibleCache: { deps: unknown[]; value: string[] } | null = null;
  private collator: Intl.Collator;

  constructor(readonly options: StoreOptions) {
    this.collator = createCollator(options.locale);
    const prefs: Prefs = {
      view: "grid",
      sortKey: "name",
      sortDir: 1,
      foldersFirst: true,
      detailsOpen: false,
      sidebarWidth: 232,
      ...options.initialPrefs,
      ...loadPrefs(options.persistKey),
    };
    this.state = {
      ...prefs,
      ready: false,
      initError: null,
      volumes: [],
      entries: {},
      listings: {},
      tree: {},
      treeLoading: {},
      expanded: {},
      cwd: null,
      loading: false,
      listError: null,
      history: [],
      historyIndex: -1,
      selection: [],
      anchor: null,
      focus: null,
      searchQuery: "",
      searchResults: null,
      searchLoading: false,
      clipboard: null,
      uploads: [],
      toasts: [],
      dialog: null,
      menu: null,
      renaming: null,
      preview: null,
      editor: null,
      sidebarOpen: true,
      trashCount: 0,
      thumbs: null,
      images: null,
      dashboard: false,
      versionsOf: null,
      imageBatch: null,
      touchSelecting: false,
    };
  }

  get client() {
    return this.options.client;
  }
  get t() {
    return this.options.t;
  }

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(patch: Partial<State> | ((s: State) => Partial<State>)) {
    const next = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    if (PREF_KEYS.some((k) => k in next)) this.savePrefs();
    this.listeners.forEach((l) => l());
  }

  private savePrefs() {
    if (!this.options.persistKey) return;
    try {
      const prefs = Object.fromEntries(PREF_KEYS.map((k) => [k, this.state[k]]));
      localStorage.setItem(this.options.persistKey, JSON.stringify(prefs));
    } catch {
      // storage unavailable (private mode, blocked cookies): preferences just won't persist
    }
  }

  // --- derived data ------------------------------------------------------------------------------

  entry(id: string | null | undefined): Entry | undefined {
    return id ? this.state.entries[id] : undefined;
  }

  get cwdEntry(): Entry | undefined {
    return this.entry(this.state.cwd);
  }

  volumeOf(entry: Entry | undefined): VolumeInfo | undefined {
    return entry ? this.state.volumes.find((v) => v.id === entry.volume) : undefined;
  }

  /** Ids currently shown in the main view: search results or the folder listing, sorted. */
  getVisible(): string[] {
    const s = this.state;
    // A shared empty array keeps the snapshot stable for useSyncExternalStore.
    const source = s.searchResults ?? (s.cwd ? s.listings[s.cwd] : undefined) ?? EMPTY;
    const deps = [source, s.entries, s.sortKey, s.sortDir, s.foldersFirst];
    if (this.visibleCache && this.visibleCache.deps.every((d, i) => d === deps[i])) return this.visibleCache.value;

    const items = source.map((id) => s.entries[id]).filter((e): e is Entry => !!e);
    const dir = s.sortDir;
    const byName = (a: Entry, b: Entry) => this.collator.compare(a.name, b.name);
    const cmp: Record<SortKey, (a: Entry, b: Entry) => number> = {
      name: byName,
      size: (a, b) => a.size - b.size || byName(a, b),
      mtime: (a, b) => a.mtime - b.mtime || byName(a, b),
      kind: (a, b) => this.collator.compare(extOf(a.name), extOf(b.name)) || byName(a, b),
    };
    items.sort((a, b) => {
      if (s.foldersFirst && a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return cmp[s.sortKey](a, b) * dir;
    });
    const value = items.map((e) => e.id);
    this.visibleCache = { deps, value };
    return value;
  }

  selectedEntries(): Entry[] {
    return this.state.selection.map((id) => this.state.entries[id]).filter((e): e is Entry => !!e);
  }

  canWrite(entry: Entry | undefined = this.cwdEntry): boolean {
    return !!entry?.write;
  }

  // --- feedback ----------------------------------------------------------------------------------

  toast(message: string, kind: Toast["kind"] = "info", action?: Toast["action"]) {
    const toast: Toast = { id: nextId(), kind, message, action };
    this.set((s) => ({ toasts: [...s.toasts.slice(-3), toast] }));
    setTimeout(() => this.dismissToast(toast.id), kind === "error" || action ? 6500 : 3200);
  }

  dismissToast(id: number) {
    this.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  }

  errorMessage(e: unknown): string {
    if (e instanceof ApiError && e.status === 401) this.options.onUnauthorized?.();
    if (e instanceof ApiError) {
      const key = `error.${e.code}` as MessageKey;
      const translated = this.t(key);
      return translated === key ? e.message : translated;
    }
    if (e instanceof TypeError) return this.t("error.NETWORK");
    return this.t("errorGeneric");
  }

  fail(e: unknown) {
    if (e instanceof ApiError && e.code === "ABORTED") return;
    this.toast(this.errorMessage(e), "error");
  }

  confirm(options: { title: string; body?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
    return new Promise((resolve) => {
      this.set({
        dialog: {
          type: "confirm",
          title: options.title,
          body: options.body,
          confirmLabel: options.confirmLabel ?? this.t("confirm"),
          danger: options.danger,
          resolve: (ok) => {
            this.set({ dialog: null });
            resolve(ok);
          },
        },
      });
    });
  }

  prompt(title: string, value: string, confirmLabel = this.t("create")): Promise<string | null> {
    return new Promise((resolve) => {
      this.set({
        dialog: {
          type: "prompt",
          title,
          value,
          confirmLabel,
          resolve: (v) => {
            this.set({ dialog: null });
            resolve(v);
          },
        },
      });
    });
  }

  private askConflict(names: string[]): Promise<ConflictMode | null> {
    return new Promise((resolve) => {
      this.set({
        dialog: {
          type: "conflict",
          names,
          resolve: (mode) => {
            this.set({ dialog: null });
            resolve(mode);
          },
        },
      });
    });
  }

  // --- cache updates -----------------------------------------------------------------------------

  private merge(list: Entry[]): Record<string, Entry> {
    const entries = { ...this.state.entries };
    for (const e of list) {
      const old = entries[e.id];
      entries[e.id] = old && e.hasDirs === undefined && old.hasDirs !== undefined ? { ...e, hasDirs: old.hasDirs } : e;
    }
    return entries;
  }

  /** Inserts new entries into their parent's cached listing and tree. */
  private addLocal(list: Entry[]) {
    if (!list.length) return;
    this.set((s) => {
      const listings = { ...s.listings };
      const tree = { ...s.tree };
      const entries = this.merge(list);
      for (const e of list) {
        if (!e.parent) continue;
        if (listings[e.parent] && !listings[e.parent]!.includes(e.id)) listings[e.parent] = [...listings[e.parent]!, e.id];
        if (e.kind === "dir" && tree[e.parent] && !tree[e.parent]!.includes(e.id)) tree[e.parent] = [...tree[e.parent]!, e.id];
        if (e.kind === "dir" && entries[e.parent]) entries[e.parent] = { ...entries[e.parent]!, hasDirs: true };
      }
      return { entries, listings, tree };
    });
  }

  private removeLocal(ids: string[]) {
    if (!ids.length) return;
    const gone = new Set(ids);
    this.set((s) => {
      const strip = (map: Record<string, string[]>) => {
        const out: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(map)) if (!gone.has(k)) out[k] = v.some((x) => gone.has(x)) ? v.filter((x) => !gone.has(x)) : v;
        return out;
      };
      return {
        listings: strip(s.listings),
        tree: strip(s.tree),
        selection: s.selection.filter((x) => !gone.has(x)),
        searchResults: s.searchResults?.filter((x) => !gone.has(x)) ?? null,
        focus: s.focus && gone.has(s.focus) ? null : s.focus,
        anchor: s.anchor && gone.has(s.anchor) ? null : s.anchor,
        preview: s.preview && gone.has(s.preview) ? null : s.preview,
      };
    });
  }

  /** Quietly reloads a cached folder listing (and its tree node) after a change. */
  private async revalidate(dirIds: (string | null | undefined)[]) {
    const unique = [...new Set(dirIds.filter((x): x is string => !!x))];
    await Promise.all(
      unique.map(async (id) => {
        try {
          if (this.state.listings[id]) {
            const { cwd, entries } = await this.client.ls(id);
            this.set((s) => ({ entries: this.merge([cwd, ...entries]), listings: { ...s.listings, [id]: entries.map((e) => e.id) } }));
          }
          if (this.state.tree[id]) await this.loadTree(id);
        } catch (e) {
          if (e instanceof ApiError && e.code === "NOT_FOUND") this.removeLocal([id]);
          else if (e instanceof ApiError && e.status === 401) this.options.onUnauthorized?.();
        }
      }),
    );
  }

  // --- navigation --------------------------------------------------------------------------------

  async init(initialId?: string) {
    try {
      const { volumes, thumbnails, images } = await this.client.init();
      const roots = volumes.map((v) => v.root);
      const trashCount = volumes.reduce((n, v) => n + (v.trash?.count ?? 0), 0);
      this.set({
        volumes,
        trashCount,
        thumbs: thumbnails ?? null,
        images: images ?? null,
        entries: this.merge(roots),
        expanded: Object.fromEntries(roots.map((r) => [r.id, true])),
        ready: true,
        initError: null,
      });
      roots.forEach((r) => this.loadTree(r.id));
      await this.open(initialId ?? roots[0]!.id);
    } catch (e) {
      this.set({ initError: this.errorMessage(e), ready: false });
    }
  }

  async open(id: string, opts: { history?: "push" | "keep"; select?: string[] } = {}) {
    if (id === TRASH_ID) return this.openTrash(opts);
    this.lsController?.abort();
    const controller = new AbortController();
    this.lsController = controller;
    this.clearSearchState();
    this.set({ loading: true, listError: null, renaming: null, menu: null });
    try {
      const { cwd, entries } = await this.client.ls(id, controller.signal);
      if (controller.signal.aborted) return;
      this.set((s) => {
        let { history, historyIndex } = s;
        if (opts.history !== "keep" && history[historyIndex] !== cwd.id) {
          history = [...history.slice(0, historyIndex + 1), cwd.id].slice(-100);
          historyIndex = history.length - 1;
        }
        const select = opts.select ?? [];
        return {
          entries: this.merge([cwd, ...entries]),
          listings: { ...s.listings, [cwd.id]: entries.map((e) => e.id) },
          cwd: cwd.id,
          loading: false,
          history,
          historyIndex,
          selection: select,
          anchor: select[0] ?? null,
          focus: select[0] ?? null,
          touchSelecting: false,
        };
      });
      void this.revealInTree(cwd);
    } catch (e) {
      if (controller.signal.aborted || (e as Error)?.name === "AbortError") return;
      this.set({ loading: false, listError: this.errorMessage(e), cwd: this.state.cwd ?? id });
    }
  }

  refresh() {
    const { cwd, searchQuery } = this.state;
    if (!cwd) return;
    if (cwd === TRASH_ID) return void this.openTrash({ history: "keep" });
    if (searchQuery) return this.runSearch(searchQuery);
    void this.revalidate([cwd]);
  }

  back() {
    const { history, historyIndex } = this.state;
    if (historyIndex <= 0) return;
    this.set({ historyIndex: historyIndex - 1 });
    void this.open(history[historyIndex - 1]!, { history: "keep" });
  }

  forward() {
    const { history, historyIndex } = this.state;
    if (historyIndex >= history.length - 1) return;
    this.set({ historyIndex: historyIndex + 1 });
    void this.open(history[historyIndex + 1]!, { history: "keep" });
  }

  up() {
    const cwd = this.cwdEntry;
    if (cwd?.parent) void this.open(cwd.parent, { select: [cwd.id] });
  }

  async loadTree(id: string) {
    this.set((s) => ({ treeLoading: { ...s.treeLoading, [id]: true } }));
    try {
      const { entries } = await this.client.tree(id);
      this.set((s) => {
        const merged = this.merge(entries);
        const parent = merged[id];
        if (parent) merged[id] = { ...parent, hasDirs: entries.length > 0 };
        return { entries: merged, tree: { ...s.tree, [id]: entries.map((e) => e.id) }, treeLoading: { ...s.treeLoading, [id]: false } };
      });
    } catch {
      this.set((s) => ({ treeLoading: { ...s.treeLoading, [id]: false } }));
    }
  }

  toggleExpanded(id: string, value?: boolean) {
    const open = value ?? !this.state.expanded[id];
    this.set((s) => ({ expanded: { ...s.expanded, [id]: open } }));
    if (open && !this.state.tree[id]) void this.loadTree(id);
  }

  /** Expands every ancestor of `entry` in the sidebar tree. */
  private async revealInTree(entry: Entry) {
    const chain: string[] = [];
    let cur: Entry | undefined = entry;
    while (cur?.parent) {
      chain.unshift(cur.parent);
      cur = this.state.entries[cur.parent];
    }
    if (cur && cur.parent === null) {
      // all ancestors are cached
    } else {
      try {
        const { entries } = await this.client.parents(entry.id);
        this.set({ entries: this.merge(entries) });
        chain.splice(0, chain.length, ...entries.slice(0, -1).map((e) => e.id));
      } catch {
        return;
      }
    }
    this.set((s) => ({ expanded: { ...s.expanded, ...Object.fromEntries(chain.map((id) => [id, true])) } }));
    await Promise.all(chain.filter((id) => !this.state.tree[id]).map((id) => this.loadTree(id)));
  }

  // --- selection ---------------------------------------------------------------------------------

  select(id: string, mode: "single" | "toggle" | "range" = "single") {
    const s = this.state;
    if (mode === "single") return this.set({ selection: [id], anchor: id, focus: id });
    if (mode === "toggle") {
      const has = s.selection.includes(id);
      return this.set({ selection: has ? s.selection.filter((x) => x !== id) : [...s.selection, id], anchor: id, focus: id });
    }
    const visible = this.getVisible();
    const from = visible.indexOf(s.anchor ?? id);
    const to = visible.indexOf(id);
    if (from < 0 || to < 0) return this.set({ selection: [id], anchor: id, focus: id });
    const [a, b] = from < to ? [from, to] : [to, from];
    this.set({ selection: visible.slice(a, b + 1), focus: id });
  }

  setSelection(ids: string[], focus?: string | null) {
    this.set({ selection: ids, focus: focus === undefined ? (ids[ids.length - 1] ?? null) : focus });
  }

  selectAll() {
    const visible = this.getVisible();
    this.set({ selection: visible, anchor: visible[0] ?? null });
  }

  clearSelection() {
    if (this.state.selection.length || this.state.touchSelecting) this.set({ selection: [], touchSelecting: false });
  }

  // --- opening files -----------------------------------------------------------------------------

  openEntry(entry: Entry) {
    if (entry.trash) return this.set({ detailsOpen: true, selection: [entry.id], focus: entry.id });
    if (entry.kind === "dir") return void this.open(entry.id);
    if (this.options.onOpen?.(entry) === true) return;
    if (this.options.pickMode && this.options.onPick && (this.options.canPick?.(entry) ?? true)) return this.options.onPick([entry]);
    const category = categoryOf(entry);
    if (["image", "video", "audio", "pdf"].includes(category)) return this.set({ preview: entry.id });
    if (isEditableText(entry)) return this.set({ editor: { id: entry.id, type: "code" } });
    this.download([entry]);
  }

  fileUrl(entry: Entry): string {
    return entry.url ?? this.client.fileUrl(entry);
  }

  /** Server thumbnail URL for images when the server generates them; otherwise the original file. */
  previewUrl(entry: Entry, size: number): string {
    const thumbs = this.state.thumbs;
    const ext = extOf(entry.name);
    if (thumbs && thumbs.extensions.includes(ext)) return this.client.thumbUrl(entry, size);
    return this.fileUrl(entry);
  }

  download(entries: Entry[] = this.selectedEntries()) {
    if (!entries.length) return;
    const href =
      entries.length === 1 && entries[0]!.kind === "file" ? this.client.fileUrl(entries[0]!, true) : this.client.downloadUrl(entries.map((e) => e.id));
    const a = document.createElement("a");
    a.href = href;
    a.download = "";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // --- mutations ---------------------------------------------------------------------------------

  private uniqueName(base: string, isDir: boolean): string {
    const taken = new Set(this.getVisible().map((id) => this.state.entries[id]?.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    const ext = isDir ? "" : extOf(base);
    const stem = isDir ? base : baseOf(base);
    for (let n = 2; ; n++) {
      const candidate = ext ? `${stem} ${n}.${ext}` : `${stem} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  async newFolder() {
    const cwd = this.state.cwd;
    if (!cwd) return;
    try {
      const { entry } = await this.client.mkdir(cwd, this.uniqueName(this.t("newFolderName"), true));
      this.addLocal([entry]);
      this.set({ selection: [entry.id], anchor: entry.id, focus: entry.id, renaming: entry.id });
      this.options.onChange?.({ type: "mkdir", entries: [entry] });
    } catch (e) {
      this.fail(e);
    }
  }

  async newFile() {
    const cwd = this.state.cwd;
    if (!cwd) return;
    try {
      const { entry } = await this.client.mkfile(cwd, this.uniqueName(this.t("newFileName"), false));
      this.addLocal([entry]);
      this.set({ selection: [entry.id], anchor: entry.id, focus: entry.id, renaming: entry.id });
      this.options.onChange?.({ type: "mkfile", entries: [entry] });
    } catch (e) {
      this.fail(e);
    }
  }

  startRename(id?: string) {
    const target = id ?? this.state.focus ?? this.state.selection[0];
    const entry = this.entry(target);
    if (!entry || entry.locked || !entry.write) return;
    this.set({ renaming: entry.id, selection: [entry.id], focus: entry.id });
  }

  cancelRename() {
    this.set({ renaming: null });
  }

  async commitRename(id: string, name: string) {
    const entry = this.entry(id);
    this.set({ renaming: null });
    if (!entry || !name.trim() || name === entry.name) return;
    try {
      const { entry: next } = await this.client.rename(id, name);
      this.set((s) => {
        const swap = (list: string[] | undefined) => list?.map((x) => (x === id ? next.id : x));
        const listings = { ...s.listings };
        const tree = { ...s.tree };
        if (entry.parent && listings[entry.parent]) listings[entry.parent] = swap(listings[entry.parent])!;
        if (entry.parent && tree[entry.parent]) tree[entry.parent] = swap(tree[entry.parent])!;
        delete tree[id];
        return {
          entries: this.merge([next]),
          listings,
          tree,
          selection: swap(s.selection)!,
          focus: s.focus === id ? next.id : s.focus,
          anchor: s.anchor === id ? next.id : s.anchor,
          searchResults: swap(s.searchResults ?? undefined) ?? null,
          cwd: s.cwd === id ? next.id : s.cwd,
        };
      });
      this.options.onChange?.({ type: "rename", entries: [next], ids: [id] });
      // Children of a renamed folder have new ids; drop stale cache below it.
      if (entry.kind === "dir") void this.revalidate([entry.parent]);
    } catch (e) {
      this.fail(e);
    }
  }

  get hasTrash(): boolean {
    return this.state.volumes.some((v) => v.trash);
  }

  get inTrash(): boolean {
    return this.state.cwd === TRASH_ID;
  }

  /**
   * Deletes items. With a trash this needs no confirmation (it can be undone from the toast);
   * `permanent` (Shift+Delete) or volumes without a trash ask first.
   */
  async remove(entries: Entry[] = this.selectedEntries(), opts: { permanent?: boolean } = {}) {
    if (this.inTrash) return this.purge(entries);
    const targets = entries.filter((e) => !e.locked);
    if (!targets.length) return;
    const toTrash = !opts.permanent && targets.every((e) => this.volumeOf(e)?.trash);
    if (!toTrash) {
      const ok = await this.confirm({
        title: targets.length === 1 ? this.t("deleteTitleOne", { name: targets[0]!.name }) : this.t("deleteTitle", { n: targets.length }),
        body: this.t("deleteBody"),
        confirmLabel: this.t("deletePermanently"),
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const { removed, trashed } = await this.client.rm(
        targets.map((e) => e.id),
        !toTrash,
      );
      this.removeLocal(removed);
      this.options.onChange?.({ type: "rm", ids: removed });
      if (trashed.length) {
        this.set((s) => ({ trashCount: s.trashCount + trashed.length }));
        this.toast(this.t("trashed", { n: trashed.length }), "success", { label: this.t("undo"), run: () => void this.restore(trashed) });
      } else {
        this.toast(this.t("deleted", { n: removed.length }), "success");
      }
      const cwd = this.cwdEntry;
      if (cwd && targets.some((t) => t.id === cwd.id || isWithin(cwd, t))) void this.open(targets[0]!.parent ?? this.state.volumes[0]!.root.id);
    } catch (e) {
      this.fail(e);
      void this.revalidate([this.state.cwd]);
    }
  }

  // --- trash -------------------------------------------------------------------------------------

  private trashRoot(): Entry {
    return {
      id: TRASH_ID,
      parent: null,
      volume: "",
      name: this.t("trash"),
      path: "/",
      kind: "dir",
      size: 0,
      mtime: 0,
      mime: "directory",
      read: true,
      write: false,
      locked: true,
    };
  }

  async openTrash(opts: { history?: "push" | "keep" } = {}) {
    this.lsController?.abort();
    this.clearSearchState();
    this.set({ loading: true, listError: null, renaming: null, menu: null });
    try {
      const { entries } = await this.client.trash();
      this.set((s) => {
        let { history, historyIndex } = s;
        if (opts.history !== "keep" && history[historyIndex] !== TRASH_ID) {
          history = [...history.slice(0, historyIndex + 1), TRASH_ID].slice(-100);
          historyIndex = history.length - 1;
        }
        return {
          entries: this.merge([this.trashRoot(), ...entries]),
          listings: { ...s.listings, [TRASH_ID]: entries.map((e) => e.id) },
          cwd: TRASH_ID,
          loading: false,
          history,
          historyIndex,
          selection: [],
          anchor: null,
          focus: null,
          trashCount: entries.length,
        };
      });
    } catch (e) {
      this.set({ loading: false, listError: this.errorMessage(e) });
    }
  }

  /** Puts trashed items back where they were (also used by the "Undo" toast). */
  async restore(entries: Entry[] = this.selectedEntries()) {
    const items = entries.filter((e) => e.trash);
    if (!items.length) return;
    try {
      const { restored, removed } = await this.client.restore(items.map((e) => e.id));
      this.removeLocal(removed);
      this.addLocal(restored);
      this.set((s) => ({ trashCount: Math.max(0, s.trashCount - removed.length) }));
      this.toast(this.t("restored", { n: restored.length }), "success");
      this.options.onChange?.({ type: "restore", entries: restored });
      void this.revalidate([...new Set(restored.map((e) => e.parent))]);
    } catch (e) {
      this.fail(e);
      if (this.inTrash) void this.openTrash({ history: "keep" });
    }
  }

  async purge(entries: Entry[] = this.selectedEntries()) {
    const items = entries.filter((e) => e.trash);
    if (!items.length) return;
    const ok = await this.confirm({
      title: items.length === 1 ? this.t("purgeTitleOne", { name: items[0]!.name }) : this.t("purgeTitle", { n: items.length }),
      body: this.t("deleteBody"),
      confirmLabel: this.t("deletePermanently"),
      danger: true,
    });
    if (!ok) return;
    try {
      const { removed } = await this.client.purge(items.map((e) => e.id));
      this.removeLocal(removed);
      this.set((s) => ({ trashCount: Math.max(0, s.trashCount - removed.length) }));
      this.toast(this.t("deleted", { n: removed.length }), "success");
    } catch (e) {
      this.fail(e);
    }
  }

  async emptyTrash() {
    const count = this.inTrash ? (this.state.listings[TRASH_ID]?.length ?? 0) : this.state.trashCount;
    const ok = await this.confirm({
      title: this.t("emptyTrashTitle", { n: count }),
      body: this.t("deleteBody"),
      confirmLabel: this.t("emptyTrash"),
      danger: true,
    });
    if (!ok) return;
    try {
      await this.client.emptyTrash();
      this.set((s) => ({ trashCount: 0, listings: { ...s.listings, [TRASH_ID]: [] }, selection: s.cwd === TRASH_ID ? [] : s.selection }));
    } catch (e) {
      this.fail(e);
    }
  }

  async duplicate(entries: Entry[] = this.selectedEntries()) {
    if (!entries.length) return;
    try {
      const { added } = await this.client.duplicate(entries.map((e) => e.id));
      this.addLocal(added);
      this.setSelection(added.map((e) => e.id));
      this.options.onChange?.({ type: "duplicate", entries: added });
    } catch (e) {
      this.fail(e);
    }
  }

  copy(cut = false) {
    const ids = this.state.selection.filter((id) => !this.entry(id)?.locked);
    if (ids.length) this.set({ clipboard: { ids, cut } });
  }

  async paste(dstId = this.state.cwd) {
    const clip = this.state.clipboard;
    if (!clip || !dstId) return;
    const moved = await this.transfer(clip.ids, dstId, clip.cut);
    if (moved && clip.cut) this.set({ clipboard: null });
  }

  /** Copies or moves items into a folder, asking how to resolve name clashes. */
  async transfer(ids: string[], dstId: string, cut: boolean): Promise<boolean> {
    const dst = this.entry(dstId);
    const items = ids.map((id) => this.entry(id)).filter((e): e is Entry => !!e);
    if (!dst || !items.length) return false;
    if (cut && items.every((e) => e.parent === dstId)) return false;

    let conflict: ConflictMode = "rename";
    const existing = this.state.listings[dstId];
    if (existing) {
      const names = new Set(existing.map((id) => this.state.entries[id]?.name.toLowerCase()));
      const clashes = items.filter((e) => e.parent !== dstId && names.has(e.name.toLowerCase()));
      if (clashes.length) {
        const answer = await this.askConflict(clashes.map((e) => e.name));
        if (!answer) return false;
        conflict = answer;
      }
    }

    try {
      const result = await this.client.paste(
        items.map((e) => e.id),
        dstId,
        cut,
        conflict,
      );
      this.removeLocal(result.removed);
      this.addLocal(result.added);
      if (dstId === this.state.cwd) this.setSelection(result.added.map((e) => e.id));
      const n = result.added.length;
      if (n) this.toast(this.t(cut ? "moved" : "pasted", { n }), "success");
      this.options.onChange?.({ type: cut ? "move" : "copy", entries: result.added, ids: result.removed });
      void this.revalidate([dstId, ...items.map((e) => e.parent)]);
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  async archive(entries: Entry[] = this.selectedEntries()) {
    if (!entries.length) return;
    const suggested = entries.length === 1 ? `${entries[0]!.name}.zip` : "Archive.zip";
    const name = await this.prompt(this.t("archiveName"), suggested, this.t("archive"));
    if (!name) return;
    try {
      const { entry } = await this.client.archive(
        entries.map((e) => e.id),
        name,
      );
      this.addLocal([entry]);
      this.setSelection([entry.id]);
      this.toast(this.t("archived", { name: entry.name }), "success");
      this.options.onChange?.({ type: "archive", entries: [entry] });
    } catch (e) {
      this.fail(e);
    }
  }

  async extract(entry: Entry) {
    try {
      const { entry: folder, skipped } = await this.client.extract(entry.id);
      this.addLocal([folder]);
      this.setSelection([folder.id]);
      this.toast(skipped ? this.t("extractedSkipped", { name: folder.name, n: skipped }) : this.t("extracted", { name: folder.name }), "success");
      this.options.onChange?.({ type: "extract", entries: [folder] });
    } catch (e) {
      this.fail(e);
    }
  }

  /** Opens the folder containing `entry` and selects it. */
  async reveal(entry: Entry) {
    if (!entry.parent) return this.open(entry.id);
    await this.open(entry.parent, { select: [entry.id] });
  }

  /** Whether the volume of `entry` keeps a version history. */
  hasVersions(entry: Entry | undefined): boolean {
    return !!entry && entry.kind === "file" && !entry.trash && !!this.volumeOf(entry)?.versions;
  }

  openVersions(entry: Pick<Entry, "id" | "name">) {
    this.set({ versionsOf: { id: entry.id, name: entry.name }, menu: null });
  }

  /** Called by editors after saving so listings show the new size / date. */
  updateEntry(entry: Entry) {
    this.addLocal([entry]);
    this.set({ entries: this.merge([entry]) });
  }

  async copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast(this.t("copied"));
    } catch {
      this.fail(new Error("clipboard"));
    }
  }

  // --- search ------------------------------------------------------------------------------------

  private clearSearchState() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchController?.abort();
    if (this.state.searchQuery || this.state.searchResults) this.set({ searchQuery: "", searchResults: null, searchLoading: false });
  }

  setSearch(q: string) {
    this.set({ searchQuery: q });
    if (this.inTrash) {
      // The trash is already in memory: filter locally.
      const needle = q.trim().toLocaleLowerCase();
      const ids = this.state.listings[TRASH_ID] ?? [];
      this.set({ searchResults: needle ? ids.filter((id) => this.state.entries[id]?.name.toLocaleLowerCase().includes(needle)) : null, selection: [] });
      return;
    }
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (!q.trim()) {
      this.searchController?.abort();
      this.set({ searchResults: null, searchLoading: false, selection: [] });
      return;
    }
    this.set({ searchLoading: true });
    this.searchTimer = setTimeout(() => this.runSearch(q), 220);
  }

  private async runSearch(q: string) {
    const cwd = this.state.cwd;
    if (!cwd) return;
    this.searchController?.abort();
    const controller = new AbortController();
    this.searchController = controller;
    try {
      const { entries } = await this.client.search(cwd, q.trim(), controller.signal);
      if (controller.signal.aborted) return;
      this.set({ entries: this.merge(entries), searchResults: entries.map((e) => e.id), searchLoading: false, selection: [] });
    } catch (e) {
      if (controller.signal.aborted || (e as Error)?.name === "AbortError") return;
      this.set({ searchLoading: false });
      this.fail(e);
    }
  }

  clearSearch() {
    this.clearSearchState();
  }

  // --- uploads -----------------------------------------------------------------------------------

  upload(files: { file: File; relativePath?: string }[], dstId = this.state.cwd) {
    if (!dstId || !files.length) return;
    const items: UploadItem[] = files.map(({ file, relativePath }) => ({
      id: nextId(),
      name: file.name,
      relativePath: relativePath || undefined,
      dst: dstId,
      size: file.size,
      loaded: 0,
      status: "queued",
      file,
    }));
    this.set((s) => ({ uploads: [...s.uploads, ...items] }));
    this.pump();
  }

  private patchUpload(id: number, patch: Partial<UploadItem>) {
    this.set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
  }

  private pump() {
    const active = this.state.uploads.filter((u) => u.status === "uploading").length;
    const queued = this.state.uploads.filter((u) => u.status === "queued").slice(0, MAX_PARALLEL_UPLOADS - active);
    for (const item of queued) void this.runUpload(item);
  }

  private async runUpload(item: UploadItem) {
    const controller = new AbortController();
    this.patchUpload(item.id, { status: "uploading", controller });
    let lastPaint = 0;
    try {
      const entry = await this.client.upload(item.file, item.dst, {
        relativePath: item.relativePath,
        signal: controller.signal,
        onProgress: ({ loaded }) => {
          const now = performance.now();
          if (now - lastPaint > 80 || loaded === item.size) {
            lastPaint = now;
            this.patchUpload(item.id, { loaded });
          }
        },
      });
      this.patchUpload(item.id, { status: "done", loaded: item.size, controller: undefined });
      if (!item.relativePath) this.addLocal([entry]);
      this.options.onChange?.({ type: "upload", entries: [entry] });
    } catch (e) {
      const cancelled = e instanceof ApiError && e.code === "ABORTED";
      this.patchUpload(item.id, { status: cancelled ? "cancelled" : "error", error: cancelled ? undefined : this.errorMessage(e), controller: undefined });
    }
    this.pump();
    const busy = this.state.uploads.some((u) => u.status === "queued" || u.status === "uploading");
    if (!busy) {
      // Folder uploads create intermediate folders: refresh what's on screen once everything landed.
      void this.revalidate([this.state.cwd, ...new Set(this.state.uploads.map((u) => u.dst))]);
    }
  }

  cancelUpload(id: number) {
    const item = this.state.uploads.find((u) => u.id === id);
    if (!item) return;
    if (item.status === "uploading") item.controller?.abort();
    else if (item.status === "queued") this.patchUpload(id, { status: "cancelled" });
  }

  retryUpload(id: number) {
    this.patchUpload(id, { status: "queued", loaded: 0, error: undefined });
    this.pump();
  }

  clearFinishedUploads() {
    this.set((s) => ({ uploads: s.uploads.filter((u) => u.status === "queued" || u.status === "uploading") }));
  }

  // --- preferences -------------------------------------------------------------------------------

  setSort(key: SortKey) {
    const s = this.state;
    this.set(s.sortKey === key ? { sortDir: (s.sortDir * -1) as 1 | -1 } : { sortKey: key, sortDir: 1 });
  }
}
