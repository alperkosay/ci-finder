import { useRef, useState } from "react";
import type { Action } from "../actions";
import { cx, shortcut, useActions, useFinder, useStore } from "../context";
import { Icon } from "../icons";
import { TRASH_ID, type SortKey } from "../store";
import { compact, item, Menu, sep, type MenuEntry } from "./Menu";

function ToolButton({ action, label }: { action: Action; label?: boolean }) {
  const title = action.shortcut ? `${action.label} (${shortcut(action.shortcut)})` : action.label;
  return (
    <button type="button" className={cx("cf-btn", !label && "is-icon")} disabled={!action.enabled} onClick={action.run} title={title} aria-label={action.label}>
      {action.icon && <Icon name={action.icon} />}
      {label && <span>{action.label}</span>}
    </button>
  );
}

/** A button that opens a dropdown menu below itself. */
function MenuButton({
  label,
  icon,
  entries,
  showLabel,
  className,
  alignRight,
}: {
  label: string;
  icon?: Parameters<typeof Icon>[0]["name"];
  entries: MenuEntry[];
  showLabel?: boolean;
  className?: string;
  alignRight?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const open = () => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ x: alignRight ? r.right : r.left, y: r.bottom + 4 });
  };
  const items = compact(entries, true);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={cx("cf-btn", !showLabel && "is-icon", pos && "is-on", className)}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        aria-label={label}
        title={label}
        disabled={!items.some((e) => (e.type === "action" ? e.action.enabled : e.type === "submenu"))}
        onClick={() => (pos ? setPos(null) : open())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            open();
          }
        }}
      >
        {icon && <Icon name={icon} />}
        {showLabel && <span>{label}</span>}
        {showLabel && <Icon name="chevronDown" size={12} className="cf-caret" />}
      </button>
      {pos && (
        <Menu
          entries={items}
          x={pos.x}
          y={pos.y}
          alignRight={alignRight}
          label={label}
          onClose={() => {
            setPos(null);
            ref.current?.focus();
          }}
        />
      )}
    </>
  );
}

export function Toolbar() {
  const { store, t } = useFinder();
  const actions = useActions();
  const view = useStore((s) => s.view);
  const sortKey = useStore((s) => s.sortKey);
  const sortDir = useStore((s) => s.sortDir);
  const foldersFirst = useStore((s) => s.foldersFirst);
  const detailsOpen = useStore((s) => s.detailsOpen);
  const inTrash = useStore((s) => s.cwd === TRASH_ID);

  const sortAction = (key: SortKey, label: string): MenuEntry =>
    item({ id: `sort-${key}`, label, enabled: true, run: () => store.set({ sortKey: key }) }, sortKey === key);

  const sortMenu: MenuEntry[] = [
    sortAction("name", t("sortName")),
    sortAction("mtime", t("sortDate")),
    sortAction("size", t("sortSize")),
    sortAction("kind", t("sortKind")),
    sep,
    item({ id: "asc", label: t("ascending"), enabled: true, run: () => store.set({ sortDir: 1 }) }, sortDir === 1),
    item({ id: "desc", label: t("descending"), enabled: true, run: () => store.set({ sortDir: -1 }) }, sortDir === -1),
    sep,
    item({ id: "folders-first", label: t("foldersFirst"), enabled: true, run: () => store.set({ foldersFirst: !foldersFirst }) }, foldersFirst),
  ];

  const moreMenu: MenuEntry[] = [
    item(actions.newFile),
    item(actions.duplicate),
    sep,
    item(actions.archive),
    item(actions.extract),
    sep,
    item(actions.edit),
    item(actions.editImage),
    item(actions.optimizeImages),
    item(actions.versions),
    item(actions.copyLink),
    sep,
    item(actions.selectAll),
    item(actions.dashboard),
    sep,
    item(actions.deletePermanently),
  ];

  return (
    <div className="cf-toolbar" role="toolbar" aria-label="ciFinder">
      {inTrash ? (
        <>
          <div className="cf-toolgroup">
            <ToolButton action={actions.restore} label />
            <ToolButton action={actions.delete} />
          </div>
          <div className="cf-toolgroup">
            <button type="button" className="cf-btn is-danger-text" disabled={!actions.emptyTrash.enabled} onClick={actions.emptyTrash.run}>
              <span>{actions.emptyTrash.label}</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="cf-toolgroup">
            <MenuButton label={t("upload")} icon="upload" showLabel className="is-primary" entries={[item(actions.uploadFiles), item(actions.uploadFolder)]} />
            <ToolButton action={actions.newFolder} />
          </div>
          <div className="cf-toolgroup is-clipboard">
            <ToolButton action={actions.cut} />
            <ToolButton action={actions.copy} />
            <ToolButton action={actions.paste} />
          </div>
          <div className="cf-toolgroup">
            <ToolButton action={actions.rename} />
            <ToolButton action={actions.download} />
            <ToolButton action={actions.delete} />
            <MenuButton label={t("more")} icon="more" entries={moreMenu} />
          </div>
        </>
      )}
      <div className="cf-toolbar-spacer" />
      <div className="cf-toolgroup">
        <MenuButton label={t("sortBy")} icon="sort" entries={sortMenu} alignRight />
        <div className="cf-segmented" role="radiogroup" aria-label={t("view")}>
          <button
            type="button"
            role="radio"
            aria-checked={view === "grid"}
            className={cx("cf-btn is-icon", view === "grid" && "is-on")}
            title={t("viewGrid")}
            aria-label={t("viewGrid")}
            onClick={() => store.set({ view: "grid" })}
          >
            <Icon name="grid" />
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={view === "list"}
            className={cx("cf-btn is-icon", view === "list" && "is-on")}
            title={t("viewList")}
            aria-label={t("viewList")}
            onClick={() => store.set({ view: "list" })}
          >
            <Icon name="list" />
          </button>
        </div>
        <button
          type="button"
          className={cx("cf-btn is-icon", detailsOpen && "is-on")}
          aria-pressed={detailsOpen}
          title={t("details")}
          aria-label={t("details")}
          onClick={() => store.set({ detailsOpen: !detailsOpen })}
        >
          <Icon name="panelRight" />
        </button>
      </div>
    </div>
  );
}
