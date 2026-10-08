import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Entry } from "@ci-finder/core/client";
import { cx, modKey, useElementSize, useFinder, useIsoLayoutEffect, useStore, useVisible } from "../context";
import { baseOf, categoryOf, formatDate, formatSize, kindLabel, locationOf } from "../format";
import { FileIcon, FolderIcon, Icon, Spinner } from "../icons";
import { TRASH_ID } from "../store";
import { useTouch } from "../touch";
import { isFileDrag, isInternalDrag, readDragIds, readDroppedFiles, startDrag } from "./dnd";

export const LAYOUT = {
  comfortable: { cellW: 112, cellH: 118, gap: 6, pad: 14, rowH: 32, headH: 30, icon: 56 },
  compact: { cellW: 96, cellH: 100, gap: 4, pad: 10, rowH: 26, headH: 28, icon: 44 },
};
export type Density = keyof typeof LAYOUT;

interface Geometry {
  view: "grid" | "list";
  cols: number;
  colW: number;
  rowH: number;
  cellH: number;
  pad: number;
  gap: number;
  headH: number;
  total: number;
  height: number;
}

/** Rectangle of item `i` in scroll-content coordinates. */
function itemRect(g: Geometry, i: number, width: number) {
  if (g.view === "list") return { x: 0, y: g.headH + i * g.rowH, w: width, h: g.rowH };
  const row = Math.floor(i / g.cols);
  const col = i % g.cols;
  return { x: g.pad + col * (g.colW + g.gap), y: g.pad + row * (g.cellH + g.gap), w: g.colW, h: g.cellH };
}

// -------------------------------------------------------------------------------------------------

function RenameInput({ entry, multiline }: { entry: Entry; multiline: boolean }) {
  const { store } = useFinder();
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = entry.kind === "dir" ? entry.name.length : baseOf(entry.name).length;
    el.setSelectionRange(0, end);
  }, [entry]);

  const commit = (value: string) => {
    if (done.current) return;
    done.current = true;
    void store.commitRename(entry.id, value.replace(/\n/g, " ").trim());
  };

  const props = {
    ref,
    className: "cf-rename",
    defaultValue: entry.name,
    spellCheck: false,
    "aria-label": entry.name,
    onClick: (e: ReactMouseEvent) => e.stopPropagation(),
    onDoubleClick: (e: ReactMouseEvent) => e.stopPropagation(),
    onPointerDown: (e: ReactPointerEvent) => e.stopPropagation(),
    onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        commit(e.currentTarget.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        done.current = true;
        store.cancelRename();
      }
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => commit(e.currentTarget.value),
  };
  return multiline ? <textarea rows={2} {...props} /> : <input {...props} />;
}

function Thumb({ entry, size, pixels }: { entry: Entry; size: number; pixels: number }) {
  const { store, thumbnails } = useFinder();
  const [failed, setFailed] = useState(false);
  const category = categoryOf(entry);
  if (entry.kind === "dir") return <FolderIcon size={size} />;
  if (thumbnails && category === "image" && !failed && entry.size > 0 && !entry.trash) {
    return (
      <span className="cf-thumb" style={{ width: size, height: size }}>
        <img src={store.previewUrl(entry, pixels)} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
      </span>
    );
  }
  return <FileIcon entry={entry} size={size} />;
}

interface ItemProps {
  entry: Entry;
  /** 1-based ARIA row index in list view (row 1 is the header); the list is virtualized. */
  rowIndex: number;
  selected: boolean;
  focused: boolean;
  cut: boolean;
  renaming: boolean;
  view: "grid" | "list";
  iconSize: number;
  showLocation: boolean;
}

const Item = memo(function Item({ entry, rowIndex, selected, focused, cut, renaming, view, iconSize, showLocation }: ItemProps) {
  const { store, t, locale, rootRef } = useFinder();
  const [dropOver, setDropOver] = useState(false);
  const isDir = entry.kind === "dir" && !entry.trash;
  const touch = useTouch(({ x, y }) => {
    const s = store.state;
    if (!s.selection.includes(entry.id)) store.select(entry.id, s.touchSelecting ? "toggle" : "single");
    store.set({ touchSelecting: true, menu: { x, y, context: "item", targetId: entry.id } });
  });

  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0 || renaming || touch.wasTouch()) return;
    e.stopPropagation();
    if (e.shiftKey) store.select(entry.id, "range");
    else if (modKey(e)) store.select(entry.id, "toggle");
    else if (!selected) store.select(entry.id, "single");
    else store.set({ focus: entry.id });
  };

  const onClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    if (touch.wasTouch()) {
      // Tap: open, or toggle while a selection is being built (after a long press).
      if (touch.consumeLongPress() || renaming) return;
      if (store.state.touchSelecting) {
        store.select(entry.id, "toggle");
        if (!store.state.selection.length) store.set({ touchSelecting: false });
      } else store.openEntry(entry);
      return;
    }
    if (!e.shiftKey && !modKey(e) && store.state.selection.length > 1) store.select(entry.id, "single");
  };

  const onDragOver = (e: ReactDragEvent) => {
    if (!isDir || !entry.write) return;
    const internal = isInternalDrag(e);
    if (!internal && !isFileDrag(e)) return;
    if (internal && store.state.selection.includes(entry.id)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = !internal || e.altKey || e.ctrlKey ? "copy" : "move";
    if (!dropOver) setDropOver(true);
  };

  const onDrop = async (e: ReactDragEvent) => {
    setDropOver(false);
    if (!isDir || !entry.write) return;
    e.preventDefault();
    e.stopPropagation();
    if (isFileDrag(e)) {
      store.upload(await readDroppedFiles(e.dataTransfer), entry.id);
      return;
    }
    const ids = readDragIds(e).filter((id) => id !== entry.id);
    if (ids.length) void store.transfer(ids, entry.id, !(e.altKey || e.ctrlKey));
  };

  const common = {
    id: `cf-item-${entry.id}`,
    role: view === "list" ? "row" : "option",
    "aria-rowindex": view === "list" ? rowIndex : undefined,
    "aria-selected": selected,
    "data-id": entry.id,
    draggable: !renaming && !entry.locked && !entry.trash,
    className: cx("cf-item", selected && "is-selected", focused && "is-focused", cut && "is-cut", dropOver && "is-drop"),
    ...touch.handlers,
    onMouseDown,
    onClick,
    onDoubleClick: () => !renaming && store.openEntry(entry),
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (touch.wasTouch()) return; // the long press already handled it (Android fires both)
      if (!selected) store.select(entry.id, "single");
      store.set({ menu: { x: e.clientX, y: e.clientY, context: "item", targetId: entry.id } });
    },
    onDragStart: (e: ReactDragEvent) => {
      const sel = store.state.selection.includes(entry.id) ? store.state.selection : [entry.id];
      if (!store.state.selection.includes(entry.id)) store.select(entry.id, "single");
      startDrag(e, sel, sel.length > 1 ? `${entry.name} +${sel.length - 1}` : entry.name, rootRef.current);
    },
    onDragOver,
    onDragLeave: () => setDropOver(false),
    onDrop,
  } as const;

  if (view === "grid") {
    return (
      <div {...common} title={entry.name}>
        <div className="cf-item-icon">
          <Thumb entry={entry} size={iconSize} pixels={256} />
        </div>
        {renaming ? <RenameInput entry={entry} multiline /> : <div className="cf-item-name">{entry.name}</div>}
      </div>
    );
  }

  const location = showLocation ? locationOf(entry, store.volumeOf(entry)?.name ?? entry.volume) : "";
  return (
    <div {...common}>
      <div className="cf-col cf-col-name" role="gridcell">
        <Thumb entry={entry} size={18} pixels={128} />
        {renaming ? <RenameInput entry={entry} multiline={false} /> : <span className="cf-item-name">{entry.name}</span>}
      </div>
      <div className="cf-col cf-col-date" role="gridcell">
        {formatDate(entry.mtime, locale, t)}
      </div>
      <div className="cf-col cf-col-size" role="gridcell">
        {entry.kind === "dir" ? "—" : formatSize(entry.size, locale)}
      </div>
      <div className="cf-col cf-col-kind" role="gridcell" title={location || undefined}>
        {showLocation ? location : kindLabel(entry, t)}
      </div>
    </div>
  );
});

function ListHeader({ showLocation, inTrash }: { showLocation: boolean; inTrash: boolean }) {
  const { store, t } = useFinder();
  const sortKey = useStore((s) => s.sortKey);
  const sortDir = useStore((s) => s.sortDir);
  const col = (key: "name" | "mtime" | "size" | "kind", label: string, cls: string) => (
    <div role="columnheader" aria-sort={sortKey === key ? (sortDir === 1 ? "ascending" : "descending") : "none"} className={cx("cf-col-head", cls)}>
      <button type="button" className={cx("cf-col", sortKey === key && "is-sorted")} onClick={() => store.setSort(key)}>
        <span>{label}</span>
        {sortKey === key && <Icon name={sortDir === 1 ? "chevronUp" : "chevronDown"} size={12} />}
      </button>
    </div>
  );
  return (
    <div className="cf-list-head" role="row" aria-rowindex={1} onMouseDown={(e) => e.stopPropagation()}>
      {col("name", t("name"), "cf-col-name")}
      {col("mtime", inTrash ? t("deletedAt") : t("modified"), "cf-col-date")}
      {col("size", t("size"), "cf-col-size")}
      {showLocation ? (
        <div role="columnheader" className="cf-col-head cf-col-kind">
          <span className="cf-col">{inTrash ? t("originalLocation") : t("location")}</span>
        </div>
      ) : (
        col("kind", t("kind"), "cf-col-kind")
      )}
    </div>
  );
}

function EmptyState() {
  const { store, t } = useFinder();
  const searching = useStore((s) => s.searchResults !== null);
  const inTrash = useStore((s) => s.cwd === TRASH_ID);
  const retention = useStore((s) => s.volumes.find((v) => v.trash)?.trash?.retentionDays ?? 30);
  const error = useStore((s) => s.listError);
  const loading = useStore((s) => s.loading || s.searchLoading);
  if (loading) return null;
  if (error) {
    return (
      <div className="cf-empty is-error">
        <Icon name="alert" size={28} />
        <strong>{t("errorLoad")}</strong>
        <span>{error}</span>
        <button type="button" className="cf-btn" onClick={() => store.refresh()}>
          {t("retry")}
        </button>
      </div>
    );
  }
  if (inTrash && !searching) {
    return (
      <div className="cf-empty">
        <Icon name="trash" size={32} />
        <strong>{t("trashEmpty")}</strong>
        <span>{t("trashEmptyHint", { days: retention })}</span>
      </div>
    );
  }
  return (
    <div className="cf-empty">
      {searching ? <Icon name="search" size={28} /> : <FolderIcon size={64} open />}
      <strong>{searching ? t("noResults") : t("emptyFolder")}</strong>
      <span>{searching ? t("noResultsHint") : t("emptyFolderHint")}</span>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------

export function FileView({ density }: { density: Density }) {
  const { store, t } = useFinder();
  const ids = useVisible();
  const entries = useStore((s) => s.entries);
  const view = useStore((s) => s.view);
  const selection = useStore((s) => s.selection);
  const focus = useStore((s) => s.focus);
  const clipboard = useStore((s) => s.clipboard);
  const renaming = useStore((s) => s.renaming);
  const cwd = useStore((s) => s.cwd);
  const searching = useStore((s) => s.searchResults !== null);
  const inTrash = useStore((s) => s.cwd === TRASH_ID);
  const cwdEntry = useStore((s) => (s.cwd ? s.entries[s.cwd] : undefined));

  const [scrollRef, size] = useElementSize<HTMLDivElement>();
  const [scrollTop, setScrollTop] = useState(0);
  const [lasso, setLasso] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [fileDrag, setFileDrag] = useState(false);
  const bgTouch = useTouch(({ x, y }) => {
    store.clearSelection();
    store.set({ menu: { x, y, context: "background" } });
  });
  const dragDepth = useRef(0);
  const typeahead = useRef({ text: "", at: 0 });

  const L = LAYOUT[density];
  const selected = useMemo(() => new Set(selection), [selection]);
  const cutSet = useMemo(() => new Set(clipboard?.cut ? clipboard.ids : []), [clipboard]);

  const geometry: Geometry = useMemo(() => {
    const width = size.width;
    if (view === "list") {
      return {
        view,
        cols: 1,
        colW: width,
        rowH: L.rowH,
        cellH: L.rowH,
        pad: 0,
        gap: 0,
        headH: L.headH,
        total: ids.length,
        height: L.headH + ids.length * L.rowH + 8,
      };
    }
    const cols = Math.max(1, Math.floor((width - L.pad * 2 + L.gap) / (L.cellW + L.gap)));
    const colW = (width - L.pad * 2 - (cols - 1) * L.gap) / cols;
    const rows = Math.ceil(ids.length / cols);
    return {
      view,
      cols,
      colW,
      rowH: L.cellH + L.gap,
      cellH: L.cellH,
      pad: L.pad,
      gap: L.gap,
      headH: 0,
      total: ids.length,
      height: L.pad * 2 + Math.max(0, rows * (L.cellH + L.gap) - L.gap),
    };
  }, [view, size.width, ids.length, L]);

  // Reset scroll when the folder changes.
  useIsoLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [cwd, searching, scrollRef]);

  // Visible window (+ overscan) of rows.
  const overscan = 4;
  const rowSpan = view === "list" ? geometry.rowH : geometry.cellH + geometry.gap;
  const firstRow = Math.max(0, Math.floor((scrollTop - geometry.pad - geometry.headH) / rowSpan) - overscan);
  const lastRow = Math.ceil((scrollTop + size.height) / rowSpan) + overscan;
  const start = firstRow * geometry.cols;
  const end = Math.min(ids.length, (lastRow + 1) * geometry.cols);
  const slice = ids.slice(start, end);

  const scrollIntoView = (id: string) => {
    const el = scrollRef.current;
    const i = ids.indexOf(id);
    if (!el || i < 0) return;
    const r = itemRect(geometry, i, size.width);
    const top = view === "list" ? r.y - geometry.headH : r.y - geometry.pad;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (r.y + r.h > el.scrollTop + el.clientHeight) el.scrollTop = r.y + r.h - el.clientHeight + (view === "grid" ? geometry.pad : 0);
  };

  useEffect(() => {
    if (focus) scrollIntoView(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // --- keyboard ----------------------------------------------------------------------------------

  const onKeyDown = (e: KeyboardEvent) => {
    if (renaming || e.target !== e.currentTarget) return;
    const cur = focus ? ids.indexOf(focus) : -1;
    const pageRows = Math.max(1, Math.floor(size.height / rowSpan) - 1);
    let next = -1;
    switch (e.key) {
      case "ArrowRight":
        if (view === "grid") next = cur < 0 ? 0 : Math.min(ids.length - 1, cur + 1);
        break;
      case "ArrowLeft":
        if (view === "grid") next = cur < 0 ? 0 : Math.max(0, cur - 1);
        break;
      case "ArrowDown":
        if (e.altKey) {
          const entry = store.entry(focus);
          if (entry) store.openEntry(entry);
          e.preventDefault();
          return;
        }
        next = cur < 0 ? 0 : Math.min(ids.length - 1, cur + geometry.cols);
        break;
      case "ArrowUp":
        if (e.altKey) return;
        next = cur < 0 ? 0 : Math.max(0, cur - geometry.cols);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = ids.length - 1;
        break;
      case "PageDown":
        next = Math.min(ids.length - 1, Math.max(0, cur) + pageRows * geometry.cols);
        break;
      case "PageUp":
        next = Math.max(0, cur - pageRows * geometry.cols);
        break;
      case "Enter": {
        const sel = store.selectedEntries();
        const target = sel.length === 1 ? sel[0] : store.entry(focus);
        if (target) store.openEntry(target);
        e.preventDefault();
        return;
      }
      case " ": {
        e.preventDefault();
        const target = store.entry(focus) ?? store.selectedEntries()[0];
        if (target?.kind === "file" && !target.trash) store.set({ preview: store.state.preview ? null : target.id });
        else if (target && modKey(e)) store.select(target.id, "toggle");
        return;
      }
      case "Escape":
        if (store.state.selection.length) {
          e.stopPropagation();
          store.clearSelection();
        }
        return;
      default:
        // Type-ahead: jump to the next item whose name starts with what was typed.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const now = Date.now();
          const ta = typeahead.current;
          ta.text = now - ta.at > 700 ? e.key.toLocaleLowerCase() : ta.text + e.key.toLocaleLowerCase();
          ta.at = now;
          const startAt = ta.text.length === 1 ? cur + 1 : Math.max(0, cur);
          for (let k = 0; k < ids.length; k++) {
            const id = ids[(startAt + k) % ids.length]!;
            if (entries[id]?.name.toLocaleLowerCase().startsWith(ta.text)) {
              store.select(id, "single");
              break;
            }
          }
        }
        return;
    }
    if (next < 0 || !ids[next]) return;
    e.preventDefault();
    const id = ids[next]!;
    if (e.shiftKey) store.select(id, "range");
    else if (modKey(e)) store.set({ focus: id });
    else store.select(id, "single");
  };

  // --- lasso selection ---------------------------------------------------------------------------

  const onPointerDown = (e: ReactPointerEvent) => {
    // Track every pointer type so a later mouse click is never mistaken for a tap.
    if (!(e.target as HTMLElement).closest(".cf-item, .cf-list-head")) bgTouch.handlers.onPointerDown(e);
    if (e.pointerType === "touch" || e.button !== 0) return;
    const el = scrollRef.current!;
    if ((e.target as HTMLElement).closest(".cf-item, .cf-list-head")) return;
    if (e.clientX > el.getBoundingClientRect().left + el.clientWidth) return; // scrollbar
    el.focus({ preventScroll: true });
    const additive = e.shiftKey || modKey(e);
    const base = additive ? store.state.selection : [];
    if (!additive) store.clearSelection();

    const rect = el.getBoundingClientRect();
    const origin = { x: e.clientX - rect.left + el.scrollLeft, y: e.clientY - rect.top + el.scrollTop };
    let pointer = { x: e.clientX, y: e.clientY };
    let moved = false;
    let raf = 0;

    const update = () => {
      const r = el.getBoundingClientRect();
      const x = pointer.x - r.left + el.scrollLeft;
      const y = pointer.y - r.top + el.scrollTop;
      const box = { x: Math.min(origin.x, x), y: Math.min(origin.y, y), w: Math.abs(x - origin.x), h: Math.abs(y - origin.y) };
      if (!moved && box.w < 4 && box.h < 4) return;
      moved = true;
      setLasso(box);
      // Hit-test only the rows the box spans.
      const g = geometry;
      const span = g.view === "list" ? g.rowH : g.cellH + g.gap;
      const r0 = Math.max(0, Math.floor((box.y - g.pad - g.headH) / span));
      const r1 = Math.floor((box.y + box.h - g.pad - g.headH) / span);
      const hits: string[] = [];
      for (let row = r0; row <= r1; row++) {
        for (let c = 0; c < g.cols; c++) {
          const i = row * g.cols + c;
          if (i >= ids.length) break;
          const ir = itemRect(g, i, size.width);
          const hit = ir.x < box.x + box.w && ir.x + ir.w > box.x && ir.y < box.y + box.h && ir.y + ir.h > box.y;
          if (hit) hits.push(ids[i]!);
        }
      }
      const merged = additive ? [...new Set([...base, ...hits])] : hits;
      store.setSelection(merged, hits[hits.length - 1] ?? null);
    };

    // Auto-scroll while dragging near the top/bottom edge.
    const tick = () => {
      const r = el.getBoundingClientRect();
      const edge = 28;
      if (pointer.y < r.top + edge) el.scrollTop -= Math.ceil((r.top + edge - pointer.y) / 3);
      else if (pointer.y > r.bottom - edge) el.scrollTop += Math.ceil((pointer.y - (r.bottom - edge)) / 3);
      update();
      raf = requestAnimationFrame(tick);
    };

    const move = (ev: PointerEvent) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const up = () => {
      cancelAnimationFrame(raf);
      setLasso(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // --- external file drops -----------------------------------------------------------------------

  const canDrop = !!cwdEntry?.write && !searching;
  const dropHandlers = {
    onDragEnter: (e: ReactDragEvent) => {
      if (!isFileDrag(e) || !canDrop) return;
      dragDepth.current++;
      setFileDrag(true);
    },
    onDragLeave: (e: ReactDragEvent) => {
      if (!isFileDrag(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setFileDrag(false);
    },
    onDragOver: (e: ReactDragEvent) => {
      if (!canDrop) return;
      if (isFileDrag(e)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      } else if (isInternalDrag(e) && cwd) {
        // Dropping onto the background moves into the current folder (e.g. from search results).
        e.preventDefault();
        e.dataTransfer.dropEffect = e.altKey || e.ctrlKey ? "copy" : "move";
      }
    },
    onDrop: async (e: ReactDragEvent) => {
      dragDepth.current = 0;
      setFileDrag(false);
      if (!canDrop || !cwd) return;
      e.preventDefault();
      if (isFileDrag(e)) {
        store.upload(await readDroppedFiles(e.dataTransfer), cwd);
        return;
      }
      const ids = readDragIds(e);
      if (ids.length) void store.transfer(ids, cwd, !(e.altKey || e.ctrlKey));
    },
  };

  const loading = useStore((s) => s.loading && !s.listings[s.cwd ?? ""]);
  const blockTop = view === "list" ? geometry.headH + firstRow * geometry.rowH : geometry.pad + firstRow * (geometry.cellH + geometry.gap);

  return (
    <div className="cf-view-wrap" {...dropHandlers}>
      <div
        ref={scrollRef}
        className={cx("cf-view", `is-${view}`)}
        data-cf-view
        tabIndex={0}
        role={view === "list" ? "grid" : "listbox"}
        aria-multiselectable="true"
        aria-rowcount={view === "list" ? ids.length + 1 : undefined}
        aria-label={searching ? t("search") : (cwdEntry?.name ?? "")}
        aria-activedescendant={focus && ids.includes(focus) ? `cf-item-${focus}` : undefined}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onPointerMove={bgTouch.handlers.onPointerMove}
        onPointerUp={bgTouch.handlers.onPointerUp}
        onPointerCancel={bgTouch.handlers.onPointerCancel}
        onClick={(e) => {
          // Tapping empty space ends a touch selection.
          if (bgTouch.wasTouch() && !bgTouch.consumeLongPress() && !(e.target as HTMLElement).closest(".cf-item")) store.clearSelection();
        }}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest(".cf-item")) return;
          if (bgTouch.wasTouch()) return e.preventDefault();
          e.preventDefault();
          store.clearSelection();
          store.set({ menu: { x: e.clientX, y: e.clientY, context: "background" } });
        }}
        style={
          {
            "--cf-cols": geometry.cols,
            "--cf-cell-h": `${L.cellH}px`,
            "--cf-row-h": `${L.rowH}px`,
            "--cf-gap": `${L.gap}px`,
            "--cf-pad": `${L.pad}px`,
          } as React.CSSProperties
        }
      >
        <div className="cf-view-canvas" style={{ height: geometry.height }}>
          {view === "list" && ids.length > 0 && <ListHeader showLocation={searching || inTrash} inTrash={inTrash} />}
          <div className={cx("cf-view-block", `is-${view}`)} style={{ transform: `translateY(${blockTop}px)` }}>
            {slice.map((id, k) => {
              const entry = entries[id];
              if (!entry) return null;
              return (
                <Item
                  key={id}
                  entry={entry}
                  rowIndex={start + k + 2}
                  selected={selected.has(id)}
                  focused={focus === id}
                  cut={cutSet.has(id)}
                  renaming={renaming === id}
                  view={view}
                  iconSize={L.icon}
                  showLocation={searching || inTrash}
                />
              );
            })}
          </div>
          {lasso && <div className="cf-lasso" style={{ left: lasso.x, top: lasso.y, width: lasso.w, height: lasso.h }} />}
        </div>
        {!ids.length && !loading && <EmptyState />}
        {loading && (
          <div className="cf-view-loading">
            <Spinner size={20} />
          </div>
        )}
      </div>
      {fileDrag && (
        <div className="cf-drop-overlay" aria-hidden="true">
          <div className="cf-drop-card">
            <Icon name="upload" size={22} />
            <span>{t("dropInto", { name: cwdEntry?.name ?? "" })}</span>
          </div>
        </div>
      )}
    </div>
  );
}
