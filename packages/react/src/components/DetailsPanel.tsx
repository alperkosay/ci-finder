import { useEffect, useState } from "react";
import type { Entry } from "@ci-finder/core/client";
import { cx, useActions, useFinder, useStore } from "../context";
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

function FolderSize({ ids }: { ids: string[] }) {
  const { store, t, locale } = useFinder();
  const [state, setState] = useState<{ loading: boolean; result?: { size: number; files: number; dirs: number } }>({ loading: false });
  const key = ids.join(",");
  useEffect(() => setState({ loading: false }), [key]);
  if (state.result) {
    return (
      <span>
        {formatSize(state.result.size, locale)} · {t("filesAndFolders", { files: state.result.files, dirs: state.result.dirs })}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="cf-link-btn"
      disabled={state.loading}
      onClick={async () => {
        setState({ loading: true });
        try {
          setState({ loading: false, result: await store.client.size(ids) });
        } catch (e) {
          setState({ loading: false });
          store.fail(e);
        }
      }}
    >
      {state.loading ? <Spinner size={12} /> : t("calculate")}
    </button>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cf-meta-row">
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
      <div className="cf-details-preview">{entry.kind === "dir" ? <FolderIcon size={96} /> : <FileIcon entry={entry} size={96} />}</div>
      <h3 className="cf-details-name">{entry.name}</h3>
      <p className="cf-details-kind">
        {kindLabel(entry, t)}
        {entry.kind === "file" && ` · ${formatSize(entry.size, locale)}`}
      </p>
      <div className="cf-details-actions">
        <button type="button" className="cf-btn" onClick={() => store.restore([entry])}>
          <Icon name="restore" />
          <span>{t("restore")}</span>
        </button>
        <button
          type="button"
          className="cf-btn is-icon"
          title={t("deletePermanently")}
          aria-label={t("deletePermanently")}
          onClick={() => store.purge([entry])}
        >
          <Icon name="trash" />
        </button>
      </div>
      <dl className="cf-meta">
        <Meta label={t("originalLocation")}>
          <span className="cf-path">{locationOf({ path: info.originalPath }, volumeName)}</span>
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
  const url = entry.kind === "file" ? new URL(store.fileUrl(entry), typeof location !== "undefined" ? location.href : "http://localhost").toString() : null;

  return (
    <>
      <div className={cx("cf-details-preview", src && "has-image")}>
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
      <h3 className="cf-details-name">{entry.name}</h3>
      <p className="cf-details-kind">
        {kindLabel(entry, t)}
        {entry.kind === "file" && ` · ${formatSize(entry.size, locale)}`}
      </p>
      <div className="cf-details-actions">
        {entry.kind === "file" && (
          <button type="button" className="cf-btn" onClick={actions.preview.run}>
            <Icon name="eye" />
            <span>{t("preview")}</span>
          </button>
        )}
        {actions.edit.enabled && (
          <button type="button" className="cf-btn" onClick={actions.edit.run}>
            <Icon name="code" />
            <span>{t("edit")}</span>
          </button>
        )}
        {actions.editImage.enabled && entry.write && (
          <button type="button" className="cf-btn" onClick={actions.editImage.run}>
            <Icon name="image" />
            <span>{t("edit")}</span>
          </button>
        )}
        {actions.versions.enabled && (
          <button type="button" className="cf-btn is-icon" onClick={actions.versions.run} title={t("versions")} aria-label={t("versions")}>
            <Icon name="history" />
          </button>
        )}
        <button type="button" className="cf-btn is-icon" onClick={actions.download.run} title={t("download")} aria-label={t("download")}>
          <Icon name="download" />
        </button>
      </div>
      <dl className="cf-meta">
        <Meta label={t("kind")}>{entry.mime === "directory" ? t("folder") : entry.mime}</Meta>
        {entry.kind === "file" ? (
          <Meta label={t("size")}>
            {formatSize(entry.size, locale)} <span className="cf-dim">({entry.size.toLocaleString(locale)} B)</span>
          </Meta>
        ) : (
          <Meta label={t("contents")}>
            <FolderSize ids={[entry.id]} />
          </Meta>
        )}
        {dims && (
          <Meta label={t("dimensions")}>
            {dims.w} × {dims.h}
          </Meta>
        )}
        <Meta label={t("modified")}>{formatFullDate(entry.mtime, locale)}</Meta>
        <Meta label={t("location")}>
          <span className="cf-path">{entry.path}</span>
        </Meta>
        {url && (
          <Meta label={t("url")}>
            <button type="button" className="cf-link-btn cf-url" title={url} onClick={() => store.copyText(url)}>
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
  return (
    <>
      <div className="cf-details-preview cf-stack">
        {entries.slice(0, 3).map((e, i) => (
          <span key={e.id} style={{ "--i": i } as React.CSSProperties}>
            {e.kind === "dir" ? <FolderIcon size={72} /> : <FileIcon entry={e} size={72} />}
          </span>
        ))}
      </div>
      <h3 className="cf-details-name">{t("multiSelection", { n: entries.length })}</h3>
      {actions.optimizeImages.enabled && (
        <div className="cf-details-actions">
          <button type="button" className="cf-btn" onClick={actions.optimizeImages.run}>
            <Icon name="sliders" />
            <span>{t("optimizeImages")}</span>
          </button>
        </div>
      )}
      <dl className="cf-meta">
        <Meta label={t("contents")}>{t("filesAndFolders", { files: files.length, dirs: dirs.length })}</Meta>
        <Meta label={t("size")}>{dirs.length ? <FolderSize ids={entries.map((e) => e.id)} /> : formatSize(size, locale)}</Meta>
      </dl>
    </>
  );
}

export function DetailsPanel() {
  const { store, t, locale } = useFinder();
  const selection = useStore((s) => s.selection);
  const entries = useStore((s) => s.entries);
  const cwd = useStore((s) => (s.cwd ? s.entries[s.cwd] : undefined));
  const count = useStore((s) => (s.cwd ? (s.listings[s.cwd]?.length ?? 0) : 0));
  const selected = selection.map((id) => entries[id]).filter((e): e is Entry => !!e);

  return (
    <aside className="cf-details" aria-label={t("details")}>
      <div className="cf-details-head">
        <span>{t("details")}</span>
        <button type="button" className="cf-btn is-icon is-small" aria-label={t("close")} onClick={() => store.set({ detailsOpen: false })}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="cf-details-body">
        {selected.length === 1 ? (
          <Single entry={selected[0]!} />
        ) : selected.length > 1 ? (
          <Multiple entries={selected} />
        ) : cwd ? (
          <>
            <div className="cf-details-preview">
              <FolderIcon size={96} />
            </div>
            <h3 className="cf-details-name">{cwd.name}</h3>
            <p className="cf-details-kind">{count === 1 ? t("item") : t("items", { n: count })}</p>
            <dl className="cf-meta">
              <Meta label={t("modified")}>{formatFullDate(cwd.mtime, locale)}</Meta>
              <Meta label={t("location")}>
                <span className="cf-path">{cwd.path}</span>
              </Meta>
            </dl>
            <p className="cf-details-hint">{t("noSelection")}</p>
          </>
        ) : null}
      </div>
    </aside>
  );
}
