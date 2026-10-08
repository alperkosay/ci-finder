import { useActions, useFinder, useStore } from "../context";
import type { Action } from "../actions";
import { TRASH_ID } from "../store";
import { compact, item, Menu, sep, type MenuEntry } from "./Menu";

export function ContextMenu() {
  const { store, t } = useFinder();
  const menu = useStore((s) => s.menu);
  const view = useStore((s) => s.view);
  const sortKey = useStore((s) => s.sortKey);
  const actions = useActions();
  if (!menu) return null;
  const close = () => store.set({ menu: null });

  let entries: MenuEntry[];
  const inTrash = store.state.cwd === TRASH_ID;
  if (inTrash && menu.context === "item") {
    entries = [item(actions.restore), sep, item(actions.info), sep, item(actions.delete)];
  } else if (inTrash && menu.context === "background") {
    entries = [item(actions.refresh), item(actions.selectAll), sep, item(actions.emptyTrash)];
  } else if (menu.context === "item") {
    const openWith: MenuEntry[] = [item(actions.edit), item(actions.editImage), ...actions.openWith.map((a) => item(a))];
    entries = [
      item(actions.open),
      { type: "submenu", id: "open-with", label: t("openWith"), items: openWith },
      item(actions.preview),
      sep,
      item(actions.download),
      item(actions.copyLink),
      sep,
      item(actions.cut),
      item(actions.copy),
      item(actions.pasteInto),
      sep,
      item(actions.rename),
      item(actions.duplicate),
      item(actions.archive),
      item(actions.extract),
      sep,
      item(actions.info),
      sep,
      item(actions.delete),
      item(actions.deletePermanently),
    ];
  } else if (menu.context === "tree" && menu.targetId === TRASH_ID) {
    entries = [item(actions.openTrash), sep, item(actions.emptyTrash)];
  } else if (menu.context === "tree") {
    const target = store.entry(menu.targetId);
    const on = (id: string, label: string, enabled: boolean, run: () => void, icon?: Action["icon"]): Action => ({ id, label, enabled, run, icon });
    entries = target
      ? [
          item(on("tree-open", t("open"), true, () => store.open(target.id))),
          sep,
          item(on("tree-paste", t("pasteInto"), !!store.state.clipboard && target.write, () => store.paste(target.id), "paste")),
          item(on("tree-download", t("download"), true, () => store.download([target]), "download")),
          item(on("tree-path", t("copyPath"), true, () => store.copyText(target.path), "link")),
        ]
      : [];
  } else {
    const viewItem = (v: "grid" | "list", label: string) => item({ id: `view-${v}`, label, enabled: true, run: () => store.set({ view: v }) }, view === v);
    const sortItem = (k: "name" | "mtime" | "size" | "kind", label: string) =>
      item({ id: `sort-${k}`, label, enabled: true, run: () => store.set({ sortKey: k }) }, sortKey === k);
    entries = [
      item(actions.newFolder),
      item(actions.newFile),
      sep,
      item(actions.uploadFiles),
      item(actions.uploadFolder),
      sep,
      item(actions.paste),
      sep,
      {
        type: "submenu",
        id: "view",
        label: t("view"),
        icon: view === "grid" ? "grid" : "list",
        items: [viewItem("grid", t("viewGrid")), viewItem("list", t("viewList"))],
      },
      {
        type: "submenu",
        id: "sort",
        label: t("sortBy"),
        icon: "sort",
        items: [sortItem("name", t("sortName")), sortItem("mtime", t("sortDate")), sortItem("size", t("sortSize")), sortItem("kind", t("sortKind"))],
      },
      sep,
      item(actions.refresh),
      item(actions.selectAll),
      item(actions.info),
    ];
  }

  const items = compact(entries);
  if (!items.length) return null;
  return <Menu entries={items} x={menu.x} y={menu.y} onClose={close} />;
}
