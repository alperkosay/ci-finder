import { useEffect, useMemo, useRef, useState } from "react";
import { encodeId, type Entry } from "@thefinder/core/client";
import { cx, useAppearance, useFinder, useStore } from "../context";
import { Icon, Spinner } from "../icons";
import { readDragIds, isInternalDrag } from "./dnd";
import { TRASH_ID, type Prefs } from "../store";
import { item, MenuButton, sep, type MenuEntry } from "./Menu";

function useCrumbs(): Entry[] {
  const cwd = useStore((s) => s.cwd);
  const entries = useStore((s) => s.entries);
  return useMemo(() => {
    const chain: Entry[] = [];
    let cur = cwd ? entries[cwd] : undefined;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parent ? entries[cur.parent] : undefined;
    }
    return chain;
  }, [cwd, entries]);
}

function Crumb({ entry, last }: { entry: Entry; last: boolean }) {
  const { store } = useFinder();
  const [over, setOver] = useState(false);
  return (
    <li className="tf-crumb">
      <button
        type="button"
        className={cx("tf-crumb-btn", last && "is-current", over && "is-drop")}
        aria-current={last ? "page" : undefined}
        onClick={() => !last && store.open(entry.id)}
        onDragOver={(e) => {
          if (last || !isInternalDrag(e) || !entry.write) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = e.altKey || e.ctrlKey ? "copy" : "move";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const ids = readDragIds(e);
          if (!ids.length) return;
          e.preventDefault();
          void store.transfer(ids, entry.id, !(e.altKey || e.ctrlKey));
        }}
      >
        {entry.parent === null && <Icon name={entry.id === TRASH_ID ? "trash" : store.volumeOf(entry)?.kind === "s3" ? "cloud" : "drive"} size={14} />}
        <span>{entry.name}</span>
      </button>
      {!last && <Icon name="chevronRight" size={12} className="tf-crumb-sep" />}
    </li>
  );
}

function PathBar() {
  const { store, t } = useFinder();
  const crumbs = useCrumbs();
  const loading = useStore((s) => s.loading);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const cwd = crumbs[crumbs.length - 1];

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // Keep the current folder visible when the path is longer than the bar.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [crumbs]);

  const submit = (value: string) => {
    setEditing(false);
    if (!cwd) return;
    const path =
      "/" +
      value
        .split("/")
        .filter((s) => s && s !== ".")
        .join("/");
    if (path !== cwd.path) void store.open(encodeId(cwd.volume, path));
  };

  if (editing) {
    return (
      <div className="tf-pathbar is-editing">
        <input
          ref={inputRef}
          className="tf-path-input"
          defaultValue={cwd?.path ?? "/"}
          aria-label={t("location")}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit(e.currentTarget.value);
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(false);
            }
          }}
          onBlur={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <nav className="tf-pathbar" aria-label={t("location")} onClick={(e) => e.target === e.currentTarget && setEditing(true)} title={t("editPath")}>
      <ol ref={listRef} className="tf-crumbs" onClick={(e) => e.target === e.currentTarget && setEditing(true)}>
        {crumbs.map((c, i) => (
          <Crumb key={c.id} entry={c} last={i === crumbs.length - 1} />
        ))}
      </ol>
      {loading && <Spinner size={14} />}
    </nav>
  );
}

function SearchBox() {
  const { store, t } = useFinder();
  const q = useStore((s) => s.searchQuery);
  const loading = useStore((s) => s.searchLoading);
  const cwdName = useStore((s) => (s.cwd ? s.entries[s.cwd]?.name : "")) ?? "";
  return (
    <div className={cx("tf-search", q && "has-value")}>
      <Icon name="search" size={14} />
      <input
        className="tf-search-input"
        type="search"
        data-tf-search
        value={q}
        placeholder={t("searchIn", { name: cwdName })}
        aria-label={t("search")}
        spellCheck={false}
        onChange={(e) => store.setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && q) {
            e.stopPropagation();
            store.clearSearch();
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            e.currentTarget.closest(".tf-root")?.querySelector<HTMLElement>("[data-tf-view]")?.focus();
          }
        }}
      />
      {loading ? (
        <Spinner size={14} />
      ) : (
        q && (
          <button type="button" className="tf-search-clear" aria-label={t("clearSearch")} onClick={() => store.clearSearch()}>
            <Icon name="close" size={12} />
          </button>
        )
      )}
    </div>
  );
}

function SettingsButton() {
  const { store, t } = useFinder();
  const current = useAppearance();
  const choice = <K extends "theme" | "skin" | "density">(key: K, value: NonNullable<Prefs[K]>, label: string): MenuEntry =>
    item({ id: `${key}-${value}`, label, enabled: true, run: () => store.set({ [key]: value }) }, current[key] === value);

  const entries: MenuEntry[] = [
    { type: "label", label: t("skin") },
    choice("skin", "classic", t("skinClassic")),
    choice("skin", "macos", t("skinMacos")),
    sep,
    { type: "label", label: t("colorScheme") },
    choice("theme", "auto", t("themeAuto")),
    choice("theme", "light", t("themeLight")),
    choice("theme", "dark", t("themeDark")),
    sep,
    { type: "label", label: t("density") },
    choice("density", "comfortable", t("densityComfortable")),
    choice("density", "compact", t("densityCompact")),
  ];
  return <MenuButton label={t("settings")} icon="sliders" entries={entries} alignRight />;
}

export function Header() {
  const { store, t, settings } = useFinder();
  const canBack = useStore((s) => s.historyIndex > 0);
  const canForward = useStore((s) => s.historyIndex < s.history.length - 1);
  const canUp = useStore((s) => !!(s.cwd && s.entries[s.cwd]?.parent));
  const sidebarOpen = useStore((s) => s.sidebarOpen);

  return (
    <div className="tf-header">
      <div className="tf-nav">
        <button
          type="button"
          className={cx("tf-btn is-icon tf-sidebar-toggle", sidebarOpen && "is-on")}
          aria-label={t("toggleSidebar")}
          title={t("toggleSidebar")}
          aria-pressed={sidebarOpen}
          onClick={() => store.set({ sidebarOpen: !sidebarOpen })}
        >
          <Icon name="panelLeft" />
        </button>
        <button type="button" className="tf-btn is-icon" aria-label={t("back")} title={t("back")} disabled={!canBack} onClick={() => store.back()}>
          <Icon name="back" />
        </button>
        <button type="button" className="tf-btn is-icon" aria-label={t("forward")} title={t("forward")} disabled={!canForward} onClick={() => store.forward()}>
          <Icon name="forward" />
        </button>
        <button type="button" className="tf-btn is-icon" aria-label={t("up")} title={t("up")} disabled={!canUp} onClick={() => store.up()}>
          <Icon name="up" />
        </button>
      </div>
      <PathBar />
      <button type="button" className="tf-btn is-icon" aria-label={t("refresh")} title={t("refresh")} onClick={() => store.refresh()}>
        <Icon name="refresh" />
      </button>
      <SearchBox />
      <button
        type="button"
        className="tf-btn is-icon tf-storage-btn"
        aria-label={t("storage")}
        title={t("storage")}
        aria-haspopup="dialog"
        onClick={() => store.set({ dashboard: true })}
      >
        <Icon name="gauge" />
      </button>
      {settings && <SettingsButton />}
    </div>
  );
}
