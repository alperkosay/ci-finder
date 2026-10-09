import type { Entry } from "@ci-finder/core/client";
import type { CustomEditor } from "./context";
import { extOf, isBatchImage, isEditableImage, isEditableText } from "./format";
import type { MessageKey, Translate } from "./i18n";
import type { IconName } from "./icons";
import { TRASH_ID, type FinderStore } from "./store";

export interface Action {
  id: string;
  label: string;
  icon?: IconName;
  shortcut?: string;
  enabled: boolean;
  danger?: boolean;
  run: () => void;
}

export interface ActionEnv {
  store: FinderStore;
  t: Translate;
  editors: CustomEditor[];
  pickUpload: (folder: boolean) => void;
  openDetails: () => void;
}

export type ActionId =
  | "open"
  | "preview"
  | "edit"
  | "editImage"
  | "download"
  | "copyLink"
  | "rename"
  | "duplicate"
  | "cut"
  | "copy"
  | "paste"
  | "pasteInto"
  | "delete"
  | "archive"
  | "extract"
  | "newFolder"
  | "newFile"
  | "uploadFiles"
  | "uploadFolder"
  | "refresh"
  | "selectAll"
  | "info"
  | "deletePermanently"
  | "restore"
  | "emptyTrash"
  | "openTrash"
  | "versions"
  | "optimizeImages"
  | "dashboard";

export function getActions(env: ActionEnv): Record<ActionId, Action> & { openWith: Action[] } {
  const { store, t } = env;
  const s = store.state;
  const sel: Entry[] = store.selectedEntries();
  const one = sel.length === 1 ? sel[0]! : undefined;
  const cwd = store.cwdEntry;
  const inTrash = s.cwd === TRASH_ID;
  const canWriteCwd = !!cwd?.write && !s.searchResults;
  const deletable = sel.length > 0 && sel.every((e) => e.write && !e.locked);
  const toTrash = sel.length > 0 && sel.every((e) => store.volumeOf(e)?.trash);

  const a = (
    id: ActionId,
    labelKey: MessageKey,
    icon: IconName | undefined,
    enabled: boolean,
    run: () => void,
    shortcut?: string,
    danger?: boolean,
  ): Action => ({
    id,
    label: t(labelKey),
    icon,
    enabled,
    run,
    shortcut,
    danger,
  });

  const openWith: Action[] = one
    ? env.editors
        .filter((ed) => ed.match(one))
        .map((ed) => ({ id: `editor:${ed.id}`, label: ed.label, enabled: true, run: () => store.set({ editor: { id: one.id, type: `custom:${ed.id}` } }) }))
    : [];

  if (inTrash) {
    // Only trash operations make sense here; everything else is disabled.
    const off = (id: ActionId, key: MessageKey) => a(id, key, undefined, false, () => {});
    const disabled = Object.fromEntries(
      (
        [
          "open",
          "preview",
          "edit",
          "editImage",
          "download",
          "copyLink",
          "rename",
          "duplicate",
          "cut",
          "copy",
          "paste",
          "pasteInto",
          "archive",
          "extract",
          "newFolder",
          "newFile",
          "uploadFiles",
          "uploadFolder",
          "deletePermanently",
          "openTrash",
          "versions",
          "optimizeImages",
        ] as const
      ).map((id) => [id, off(id, id === "deletePermanently" ? "deletePermanently" : id === "openTrash" ? "trash" : (id as MessageKey))]),
    ) as Record<ActionId, Action>;
    return {
      ...disabled,
      openWith: [],
      restore: a("restore", "restore", "restore", sel.length > 0, () => store.restore()),
      delete: a("delete", "deletePermanently", "trash", sel.length > 0, () => store.purge(), "Delete", true),
      emptyTrash: a("emptyTrash", "emptyTrash", "trash", (s.listings[TRASH_ID]?.length ?? 0) > 0, () => store.emptyTrash(), undefined, true),
      refresh: a("refresh", "refresh", "refresh", true, () => store.refresh(), "Ctrl+R"),
      selectAll: a("selectAll", "selectAll", undefined, true, () => store.selectAll(), "Ctrl+A"),
      info: a("info", "info", "info", true, env.openDetails, "Ctrl+I"),
      dashboard: a("dashboard", "storage", "gauge", true, () => store.set({ dashboard: true })),
    };
  }

  const images = sel.filter((e) => isBatchImage(e, s.images?.extensions));

  return {
    openWith,
    open: a("open", "open", undefined, !!one, () => one && store.openEntry(one), "Enter"),
    preview: a("preview", "preview", "eye", !!one && one.kind === "file", () => one && store.set({ preview: one.id }), "Space"),
    edit: a("edit", "edit", "code", !!one && isEditableText(one), () => one && store.set({ editor: { id: one.id, type: "code" } })),
    editImage: a("editImage", "editImage", "image", !!one && isEditableImage(one), () => one && store.set({ editor: { id: one.id, type: "image" } })),
    download: a("download", "download", "download", sel.length > 0, () => store.download(sel)),
    copyLink: a("copyLink", "copyLink", "link", !!one && one.kind === "file", () => {
      if (!one) return;
      const url = new URL(store.linkUrl(one), location.href).toString();
      void store.copyText(url);
    }),
    rename: a("rename", "rename", "rename", !!one && one.write && !one.locked, () => store.startRename(), "F2"),
    duplicate: a("duplicate", "duplicate", "duplicate", sel.length > 0 && canWriteCwd, () => store.duplicate(), "Ctrl+D"),
    cut: a("cut", "cut", "cut", deletable, () => store.copy(true), "Ctrl+X"),
    copy: a("copy", "copy", "copy", sel.length > 0, () => store.copy(false), "Ctrl+C"),
    paste: a("paste", "paste", "paste", !!s.clipboard && canWriteCwd, () => store.paste(), "Ctrl+V"),
    pasteInto: a("pasteInto", "pasteInto", "paste", !!s.clipboard && !!one && one.kind === "dir" && one.write, () => one && store.paste(one.id)),
    delete: a("delete", toTrash || !sel.length ? "moveToTrash" : "delete", "trash", deletable, () => store.remove(), "Delete", !toTrash && sel.length > 0),
    deletePermanently: a(
      "deletePermanently",
      "deletePermanently",
      undefined,
      deletable && toTrash,
      () => store.remove(undefined, { permanent: true }),
      "Shift+Delete",
      true,
    ),
    restore: a("restore", "restore", "restore", false, () => {}),
    emptyTrash: a("emptyTrash", "emptyTrash", "trash", s.trashCount > 0, () => store.emptyTrash(), undefined, true),
    openTrash: a("openTrash", "trash", "trash", store.hasTrash, () => store.open(TRASH_ID)),
    archive: a("archive", "archive", "archive", sel.length > 0 && canWriteCwd, () => store.archive()),
    extract: a("extract", "extract", "extract", !!one && extOf(one.name) === "zip" && canWriteCwd, () => one && store.extract(one)),
    newFolder: a("newFolder", "newFolder", "folderPlus", canWriteCwd, () => store.newFolder(), "Ctrl+Shift+N"),
    newFile: a("newFile", "newFile", "filePlus", canWriteCwd, () => store.newFile()),
    uploadFiles: a("uploadFiles", "uploadFiles", "upload", canWriteCwd, () => env.pickUpload(false), "Ctrl+U"),
    uploadFolder: a("uploadFolder", "uploadFolder", "folder", canWriteCwd, () => env.pickUpload(true)),
    refresh: a("refresh", "refresh", "refresh", !!cwd, () => store.refresh(), "Ctrl+R"),
    selectAll: a("selectAll", "selectAll", undefined, true, () => store.selectAll(), "Ctrl+A"),
    info: a("info", "info", "info", true, env.openDetails, "Ctrl+I"),
    versions: a("versions", "versions", "history", !!one && store.hasVersions(one), () => one && store.openVersions(one)),
    optimizeImages: a("optimizeImages", "optimizeImages", "sliders", images.length > 0 && images.every((e) => e.write), () =>
      store.set({ imageBatch: images.map((e) => e.id), menu: null }),
    ),
    dashboard: a("dashboard", "storage", "gauge", true, () => store.set({ dashboard: true })),
  };
}
