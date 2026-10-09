import { useEffect, useState } from "react";
import type { Entry, SizeResult } from "@thefinder/core/client";
import { cx, useActions, useFinder, useStore } from "../context";
import { TRASH_ID } from "../store";
import { categoryOf, formatFullDate, formatSize, kindLabel, locationOf } from "../format";
import { FileIcon, FolderIcon, Icon, Spinner } from "../icons";

function useImageSize(src: string | null) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    setDims(null);
    if (!src) return;
    const img = new Image();
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);
  return dims;
}

type FolderSizeState = { loading: boolean; result?: SizeResult; failed?: boolean; retry: () => void };

/**
 * Total size of folders, walked on the server as soon as they are shown. Waits a moment so that
 * arrowing through a listing does not start a walk per folder.
 */
function useFolderSize(ids: string[]): FolderSizeState {
  const { store } = useFinder();
  const key = ids.join(",");
  const [state, setState] = useState<{ key: string; result?: SizeResult; failed?: boolean }>(() => ({ key, result: store.knownSize(ids) }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",");
    const known = store.knownSize(ids);
    if (known) return setState({ key, result: known });
    setState({ key });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      store.folderSize(ids, controller.signal).then(
        (result) => setState({ key, result }),
        () => {
          if (!controller.signal.aborted) setState({ key, failed: true });
        },
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, attempt, store]);

  const current = state.key === key ? state : { key };
  return { loading: !!key && !current.result && !current.failed, result: current.result, failed: current.failed, retry: () => setAttempt((n) => n + 1) };
}

/** Result of a folder size lookup: the number, a spinner while it runs, or a retry link. */
function SizeValue({ state }: { state: FolderSizeState }) {
  const { t, locale } = useFinder();
  if (state.result) {
    return (
      <>
        {formatSize(state.result.size, locale)} <span className="tf-dim">({state.result.size.toLocaleString(locale)} B)</span>
      </>
    );
  }
  if (state.failed) {
    return (
      <button type="button" className="tf-link-btn" onClick={state.retry}>
        {t("retry")}
      </button>
    );
  }
  return (
    <span className="tf-calculating">
      <Spinner size={12} /> {t("calculating")}
    </span>
  );
}

/** "Size" and "Contents" rows for a folder. */
function FolderMeta({ state }: { state: FolderSizeState }) {
  const { t } = useFinder();
  return (
    <>
      <Meta label={t("size")}>
        <SizeValue state={state} />
      </Meta>
      {state.result && <Meta label={t("contents")}>{t("filesAndFolders", { files: state.result.files, dirs: state.result.dirs })}</Meta>}
    </>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tf-meta-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function TrashItem({ entry }: { entry: Entry }) {
  const { store, t, locale } = useFinder();
  const info = entry.trash!;
  const volumeName = store.state.volumes.find((v) => v.id === entry.volume)?.name ?? entry.volume;
  return (
    <>
      <div className="tf-details-preview">{entry.kind === "dir" ? <FolderIcon size={96} /> : <FileIcon entry={entry} size={96} />}</div>
      <h3 className="tf-details-name">{entry.name}</h3>
      <p className="tf-details-kind">
        {kindLabel(entry, t)}
        {entry.kind === "file" && ` · ${formatSize(entry.size, locale)}`}
      </p>
      <div className="tf-details-actions">
        <button type="button" className="tf-btn" onClick={() => store.restore([entry])}>
          <Icon name="restore" />
          <span>{t("restore")}</span>
        </button>
        <button
          type="button"
          className="tf-btn is-icon"
          title={t("deletePermanently")}
          aria-label={t("deletePermanently")}
          onClick={() => store.purge([entry])}
        >
          <Icon name="trash" />
        </button>
      </div>
      <dl className="tf-meta">
        <Meta label={t("originalLocation")}>
          <span className="tf-path">{locationOf({ path: info.originalPath }, volumeName)}</span>
        </Meta>
        <Meta label={t("deletedAt")}>{formatFullDate(info.deletedAt, locale)}</Meta>
        <Meta label={t("volume")}>{volumeName}</Meta>
      </dl>
    </>
  );
}

function Single({ entry }: { entry: Entry }) {
  if (entry.trash) return <TrashItem entry={entry} />;
  return <RegularItem entry={entry} />;
}

function RegularItem({ entry }: { entry: Entry }) {
  const { store, t, locale, thumbnails } = useFinder();
  const actions = useActions();
  const category = categoryOf(entry);
  const original = category === "image" && entry.size > 0 ? store.fileUrl(entry) : null;
  const src = original ? store.previewUrl(entry, 512) : null;
  const dims = useImageSize(original);
  const folder = useFolderSize(entry.kind === "dir" ? [entry.id] : []);
  const url = entry.kind === "file" ? new URL(store.linkUrl(entry), typeof location !== "undefined" ? location.href : "http://localhost").toString() : null;

  return (
    <>
      <div className={cx("tf-details-preview", src && "has-image")}>
        {src && thumbnails ? (
          <img src={src} alt="" draggable={false} />
        ) : category === "video" ? (
          <video src={store.fileUrl(entry)} preload="metadata" muted playsInline />
        ) : entry.kind === "dir" ? (
          <FolderIcon size={96} />
        ) : (
          <FileIcon entry={entry} size={96} />
        )}
      </div>
      <h3 className="tf-details-name">{entry.name}</h3>
      <p className="tf-details-kind">
        {kindLabel(entry, t)}
        {entry.kind === "file" && ` · ${formatSize(entry.size, locale)}`}
        {folder.result && ` · ${formatSize(folder.result.size, locale)}`}
      </p>
      <div className="tf-details-actions">
        {entry.kind === "file" && (
          <button type="button" className="tf-btn" onClick={actions.preview.run}>
            <Icon name="eye" />
            <span>{t("preview")}</span>
          </button>
        )}
        {actions.edit.enabled && (
          <button type="button" className="tf-btn" onClick={actions.edit.run}>
            <Icon name="code" />
            <span>{t("edit")}</span>
          </button>
        )}
        {actions.editImage.enabled && entry.write && (
          <button type="button" className="tf-btn" onClick={actions.editImage.run}>
            <Icon name="image" />
            <span>{t("edit")}</span>
          </button>
        )}
        {actions.versions.enabled && (
          <button type="button" className="tf-btn is-icon" onClick={actions.versions.run} title={t("versions")} aria-label={t("versions")}>
            <Icon name="history" />
          </button>
        )}
        <button type="button" className="tf-btn is-icon" onClick={actions.download.run} title={t("download")} aria-label={t("download")}>
          <Icon name="download" />
        </button>
      </div>
      <dl className="tf-meta">
        <Meta label={t("kind")}>{entry.mime === "directory" ? t("folder") : entry.mime}</Meta>
        {entry.kind === "file" ? (
          <Meta label={t("size")}>
            {formatSize(entry.size, locale)} <span className="tf-dim">({entry.size.toLocaleString(locale)} B)</span>
          </Meta>
        ) : (
          <FolderMeta state={folder} />
        )}
        {dims && (
          <Meta label={t("dimensions")}>
            {dims.w} × {dims.h}
          </Meta>
        )}
        <Meta label={t("modified")}>{formatFullDate(entry.mtime, locale)}</Meta>
        <Meta label={t("location")}>
          <span className="tf-path">{entry.path}</span>
        </Meta>
        {url && (
          <Meta label={t("url")}>
            <button type="button" className="tf-link-btn tf-url" title={url} onClick={() => store.copyText(url)}>
              <span>{entry.url ?? url}</span>
              <Icon name="copy" size={12} />
            </button>
          </Meta>
        )}
      </dl>
    </>
  );
}

function Multiple({ entries }: { entries: Entry[] }) {
  const { t, locale } = useFinder();
  const actions = useActions();
  const files = entries.filter((e) => e.kind === "file");
  const dirs = entries.filter((e) => e.kind === "dir");
  const size = files.reduce((n, e) => n + e.size, 0);
  const total = useFolderSize(dirs.length ? entries.map((e) => e.id) : []);
  return (
    <>
      <div className="tf-details-preview tf-stack">
        {entries.slice(0, 3).map((e, i) => (
          <span key={e.id} style={{ "--i": i } as React.CSSProperties}>
            {e.kind === "dir" ? <FolderIcon size={72} /> : <FileIcon entry={e} size={72} />}
          </span>
        ))}
      </div>
      <h3 className="tf-details-name">{t("multiSelection", { n: entries.length })}</h3>
      {actions.optimizeImages.enabled && (
        <div className="tf-details-actions">
          <button type="button" className="tf-btn" onClick={actions.optimizeImages.run}>
            <Icon name="sliders" />
            <span>{t("optimizeImages")}</span>
          </button>
        </div>
      )}
      <dl className="tf-meta">
        <Meta label={t("contents")}>{t("filesAndFolders", { files: files.length, dirs: dirs.length })}</Meta>
        <Meta label={t("size")}>{dirs.length ? <SizeValue state={total} /> : formatSize(size, locale)}</Meta>
        {total.result && <Meta label={t("totalContents")}>{t("filesAndFolders", { files: total.result.files, dirs: total.result.dirs })}</Meta>}
      </dl>
    </>
  );
}

/** Nothing selected: the folder being shown. */
function CurrentFolder({ folder, count }: { folder: Entry; count: number }) {
  const { t, locale } = useFinder();
  const inTrash = folder.id === TRASH_ID;
  const size = useFolderSize(inTrash ? [] : [folder.id]);
  return (
    <>
      <div className="tf-details-preview">
        <FolderIcon size={96} />
      </div>
      <h3 className="tf-details-name">{folder.name}</h3>
      <p className="tf-details-kind">
        {count === 1 ? t("item") : t("items", { n: count })}
        {size.result && ` · ${formatSize(size.result.size, locale)}`}
      </p>
      <dl className="tf-meta">
        {!inTrash && <FolderMeta state={size} />}
        <Meta label={t("modified")}>{formatFullDate(folder.mtime, locale)}</Meta>
        <Meta label={t("location")}>
          <span className="tf-path">{folder.path}</span>
        </Meta>
      </dl>
      <p className="tf-details-hint">{t("noSelection")}</p>
    </>
  );
}

export function DetailsPanel() {
  const { store, t } = useFinder();
  const selection = useStore((s) => s.selection);
  const entries = useStore((s) => s.entries);
  const cwd = useStore((s) => (s.cwd ? s.entries[s.cwd] : undefined));
  const count = useStore((s) => (s.cwd ? (s.listings[s.cwd]?.length ?? 0) : 0));
  const selected = selection.map((id) => entries[id]).filter((e): e is Entry => !!e);

  return (
    <aside className="tf-details" aria-label={t("details")}>
      <div className="tf-details-head">
        <span>{t("details")}</span>
        <button type="button" className="tf-btn is-icon is-small" aria-label={t("close")} onClick={() => store.set({ detailsOpen: false })}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="tf-details-body">
        {selected.length === 1 ? (
          <Single entry={selected[0]!} />
        ) : selected.length > 1 ? (
          <Multiple entries={selected} />
        ) : cwd ? (
          <CurrentFolder folder={cwd} count={count} />
        ) : null}
      </div>
    </aside>
  );
}
