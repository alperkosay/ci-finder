import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Entry } from "@ci-finder/core/client";
import { cx, useFinder, useStore } from "../context";
import { FolderIcon, Icon, Spinner } from "../icons";
import { TRASH_ID } from "../store";
import { isFileDrag, isInternalDrag, readDragIds, readDroppedFiles } from "./dnd";

interface Row {
  entry: Entry;
  depth: number;
  isRoot: boolean;
}

/** Flattens the expanded part of the tree into rows (used for rendering and keyboard navigation). */
function useRows(): Row[] {
  const volumes = useStore((s) => s.volumes);
  const tree = useStore((s) => s.tree);
  const expanded = useStore((s) => s.expanded);
  const entries = useStore((s) => s.entries);
  return useMemo(() => {
    const rows: Row[] = [];
    const visit = (id: string, depth: number, isRoot: boolean) => {
      const entry = entries[id];
      if (!entry) return;
      rows.push({ entry, depth, isRoot });
      if (!expanded[id]) return;
      const children = (tree[id] ?? []).map((c) => entries[c]).filter((e): e is Entry => !!e);
      children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
      for (const c of children) visit(c.id, depth + 1, false);
    };
    for (const v of volumes) visit(v.root.id, 0, true);
    return rows;
  }, [volumes, tree, expanded, entries]);
}

function TreeRow({ row, focused, onFocusRow }: { row: Row; focused: boolean; onFocusRow: (id: string) => void }) {
  const { store, t } = useFinder();
  const { entry, depth, isRoot } = row;
  const isCwd = useStore((s) => s.cwd === entry.id);
  const expanded = useStore((s) => !!s.expanded[entry.id]);
  const loading = useStore((s) => !!s.treeLoading[entry.id]);
  const [over, setOver] = useState(false);
  const volume = store.volumeOf(entry);
  const expandable = entry.hasDirs !== false;

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={isCwd}
      data-tree-id={entry.id}
      tabIndex={focused ? 0 : -1}
      className={cx("cf-tree-row", isCwd && "is-current", over && "is-drop", isRoot && "is-root")}
      style={{ "--depth": depth } as React.CSSProperties}
      onClick={() => {
        onFocusRow(entry.id);
        void store.open(entry.id);
        // Clicking a folder in the tree also reveals its sub-folders.
        if (expandable && !expanded) store.toggleExpanded(entry.id, true);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onFocusRow(entry.id);
        store.set({ menu: { x: e.clientX, y: e.clientY, context: "tree", targetId: entry.id } });
      }}
      onDragOver={(e) => {
        if (!entry.write || (!isInternalDrag(e) && !isFileDrag(e))) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = isFileDrag(e) || e.altKey || e.ctrlKey ? "copy" : "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        setOver(false);
        if (!entry.write) return;
        e.preventDefault();
        e.stopPropagation();
        if (isFileDrag(e)) {
          store.upload(await readDroppedFiles(e.dataTransfer), entry.id);
          return;
        }
        const ids = readDragIds(e).filter((id) => id !== entry.id);
        if (ids.length) void store.transfer(ids, entry.id, !(e.altKey || e.ctrlKey));
      }}
    >
      <span
        className={cx("cf-tree-toggle", !expandable && "is-leaf")}
        onClick={(e) => {
          e.stopPropagation();
          if (expandable) store.toggleExpanded(entry.id);
        }}
        aria-hidden="true"
      >
        {loading ? <Spinner size={12} /> : expandable && <Icon name={expanded ? "chevronDown" : "chevronRight"} size={12} />}
      </span>
      {isRoot ? <Icon name={volume?.kind === "s3" ? "cloud" : "drive"} className="cf-tree-volume" /> : <FolderIcon size={18} open={isCwd} />}
      <span className="cf-tree-name">{entry.name}</span>
      {isRoot && volume?.readOnly && <Icon name="lock" size={12} className="cf-tree-badge" aria-label={t("readOnly")} />}
    </div>
  );
}

function TrashRow({ focused, onFocusRow }: { focused: boolean; onFocusRow: (id: string) => void }) {
  const { store, t } = useFinder();
  const count = useStore((s) => s.trashCount);
  const isCwd = useStore((s) => s.cwd === TRASH_ID);
  const [over, setOver] = useState(false);
  return (
    <div
      role="treeitem"
      aria-level={1}
      aria-selected={isCwd}
      data-tree-id={TRASH_ID}
      tabIndex={focused ? 0 : -1}
      className={cx("cf-tree-row is-root is-trash", isCwd && "is-current", over && "is-drop")}
      style={{ "--depth": 0 } as React.CSSProperties}
      onClick={() => {
        onFocusRow(TRASH_ID);
        void store.open(TRASH_ID);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        store.set({ menu: { x: e.clientX, y: e.clientY, context: "tree", targetId: TRASH_ID } });
      }}
      onDragOver={(e) => {
        if (!isInternalDrag(e) || isCwd) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const ids = readDragIds(e);
        if (!ids.length) return;
        e.preventDefault();
        void store.remove(ids.map((id) => store.entry(id)).filter((x): x is Entry => !!x));
      }}
    >
      <span className="cf-tree-toggle is-leaf" aria-hidden="true" />
      <Icon name="trash" className="cf-tree-volume" />
      <span className="cf-tree-name">{t("trash")}</span>
      {count > 0 && <span className="cf-tree-count">{count}</span>}
    </div>
  );
}

export function Sidebar() {
  const { store, t } = useFinder();
  const rows = useRows();
  const cwd = useStore((s) => s.cwd);
  const width = useStore((s) => s.sidebarWidth);
  const hasTrash = useStore((s) => s.volumes.some((v) => v.trash));
  const [focusId, setFocusId] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const activeId = focusId && rows.some((r) => r.entry.id === focusId) ? focusId : (cwd ?? rows[0]?.entry.id ?? null);

  const focusRow = (id: string) => {
    setFocusId(id);
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus());
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (activeId === TRASH_ID) {
      if (e.key === "ArrowUp" && rows.length) {
        e.preventDefault();
        focusRow(rows[rows.length - 1]!.entry.id);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void store.open(TRASH_ID);
      }
      return;
    }
    const i = rows.findIndex((r) => r.entry.id === activeId);
    const row = rows[i];
    if (!row) return;
    const { entry } = row;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (rows[i + 1]) focusRow(rows[i + 1]!.entry.id);
        else if (hasTrash) focusRow(TRASH_ID);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (rows[i - 1]) focusRow(rows[i - 1]!.entry.id);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (entry.hasDirs !== false && !store.state.expanded[entry.id]) store.toggleExpanded(entry.id, true);
        else if (rows[i + 1]?.depth === row.depth + 1) focusRow(rows[i + 1]!.entry.id);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (store.state.expanded[entry.id] && entry.hasDirs !== false) store.toggleExpanded(entry.id, false);
        else if (entry.parent) focusRow(entry.parent);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        void store.open(entry.id);
        break;
      case "Home":
        e.preventDefault();
        if (rows[0]) focusRow(rows[0].entry.id);
        break;
      case "End":
        e.preventDefault();
        if (rows.length) focusRow(rows[rows.length - 1]!.entry.id);
        break;
    }
  };

  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => store.set({ sidebarWidth: Math.min(420, Math.max(160, startW + ev.clientX - startX)) });
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  return (
    <aside className="cf-sidebar" style={{ "--cf-sidebar-w": `${width}px` } as React.CSSProperties}>
      <div ref={treeRef} className="cf-tree" role="tree" aria-label={t("location")} onKeyDown={onKeyDown}>
        {rows.map((row) => (
          <TreeRow key={row.entry.id} row={row} focused={row.entry.id === activeId} onFocusRow={setFocusId} />
        ))}
        {hasTrash && <TrashRow focused={activeId === TRASH_ID} onFocusRow={setFocusId} />}
      </div>
      <div
        className="cf-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={160}
        aria-valuemax={420}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") store.set({ sidebarWidth: Math.max(160, width - 16) });
          if (e.key === "ArrowRight") store.set({ sidebarWidth: Math.min(420, width + 16) });
        }}
      />
    </aside>
  );
}
