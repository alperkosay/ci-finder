import { useCallback, useEffect, useState } from "react";
import type { Entry, FileVersion } from "@ci-finder/core/client";
import { cx, useFinder, useStore } from "../context";
import { categoryOf, formatDate, formatFullDate, formatSize, isEditableText } from "../format";
import type { MessageKey } from "../i18n";
import { FileIcon, Icon, Spinner } from "../icons";
import { Modal } from "./Dialogs";

const CURRENT = "current";

/** Text versions are previewed up to this many bytes. */
const TEXT_PREVIEW = 200 * 1024;

export function VersionsDialog() {
  const { store } = useFinder();
  const target = useStore((s) => s.versionsOf);
  if (!target) return null;
  return <VersionsView key={target.id} id={target.id} name={target.name} onClose={() => store.set({ versionsOf: null })} />;
}

function VersionsView({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const { store, t, locale } = useFinder();
  const [versions, setVersions] = useState<FileVersion[] | null>(null);
  const [current, setCurrent] = useState<Entry | null>(null);
  const [selected, setSelected] = useState<string>(CURRENT);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await store.client.versions(id);
      setVersions(result.versions);
      setCurrent(result.entry);
      setSelected((sel) => (sel === CURRENT && !result.entry ? (result.versions[0]?.id ?? CURRENT) : sel));
    } catch (e) {
      setError(store.errorMessage(e));
    }
  }, [id, store]);

  useEffect(() => {
    void load();
  }, [load]);

  const version = versions?.find((v) => v.id === selected) ?? null;
  const reasonLabel = (reason: string) => {
    const key = `reason.${reason}` as MessageKey;
    const label = t(key);
    return label === key ? reason : label;
  };

  const restore = async (v: FileVersion) => {
    setBusy(v.id);
    try {
      const { entry, created } = await store.client.revert(id, v.id);
      store.updateEntry(entry);
      store.options.onChange?.({ type: created ? "restore" : "revert", entries: [entry] });
      store.toast(t("versionRestored"), "success");
      setSelected(CURRENT);
      await load();
    } catch (e) {
      store.fail(e);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (vids?: string[]) => {
    const all = !vids;
    const ok = await store.confirm({
      title: all ? t("deleteHistoryTitle", { name, n: versions?.length ?? 0 }) : t("deleteVersionTitle"),
      body: t("cleanupBody"),
      confirmLabel: all ? t("deleteHistory") : t("deleteVersion"),
      danger: true,
    });
    if (!ok) return;
    setBusy(all ? "all" : vids![0]!);
    try {
      const { removed, freed } = await store.client.rmVersions(id, vids);
      store.toast(t("versionsRemoved", { n: removed, size: formatSize(freed, locale) }), "success");
      setSelected(current ? CURRENT : "");
      await load();
    } catch (e) {
      store.fail(e);
    } finally {
      setBusy(null);
    }
  };

  const total = versions?.reduce((n, v) => n + v.size, 0) ?? 0;
  const probe = { kind: "file" as const, name, mime: current?.mime ?? "" };

  return (
    <Modal label={t("versions")} onCancel={onClose} className="cf-versions-dialog">
      <div className="cf-editor">
        <header className="cf-editor-head">
          <Icon name="history" size={18} />
          <div className="cf-editor-title">
            <strong>{t("versions")}</strong>
            <span>{name}</span>
          </div>
          <div className="cf-editor-tools">
            <button type="button" className="cf-btn is-icon" aria-label={t("close")} onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
        </header>

        {error ? (
          <div className="cf-editor-state is-error">
            <Icon name="alert" size={24} />
            <span>{error}</span>
          </div>
        ) : !versions ? (
          <div className="cf-editor-state">
            <Spinner size={20} />
          </div>
        ) : (
          <div className="cf-versions-body">
            <div className="cf-versions-list" role="listbox" aria-label={t("versions")}>
              {current && (
                <VersionRow
                  active={selected === CURRENT}
                  onSelect={() => setSelected(CURRENT)}
                  title={t("currentVersion")}
                  when={formatDate(current.mtime, locale, t)}
                  size={formatSize(current.size, locale)}
                  isCurrent
                />
              )}
              {!current && <p className="cf-versions-note">{t("versionDeletedFile")}</p>}
              {versions.map((v) => (
                <VersionRow
                  key={v.id}
                  active={selected === v.id}
                  onSelect={() => setSelected(v.id)}
                  title={formatDate(v.createdAt, locale, t)}
                  when={reasonLabel(v.reason)}
                  size={formatSize(v.size, locale)}
                />
              ))}
              {!versions.length && (
                <div className="cf-versions-empty">
                  <strong>{t("noVersions")}</strong>
                  <span>{t("noVersionsHint")}</span>
                </div>
              )}
            </div>

            <div className="cf-versions-preview">
              <div className="cf-versions-stage">
                {selected === CURRENT && current ? (
                  <Preview probe={probe} src={store.fileUrl(current)} />
                ) : version ? (
                  <Preview key={version.id} probe={probe} src={store.client.versionUrl(id, version.id)} />
                ) : null}
              </div>
              {version && (
                <div className="cf-versions-actions">
                  <div className="cf-versions-meta">
                    <strong>{formatFullDate(version.createdAt, locale)}</strong>
                    <span>
                      {reasonLabel(version.reason)} · {formatSize(version.size, locale)}
                    </span>
                  </div>
                  <a className="cf-btn is-icon" href={store.client.versionUrl(id, version.id, true)} download title={t("download")} aria-label={t("download")}>
                    <Icon name="download" />
                  </a>
                  <button
                    type="button"
                    className="cf-btn is-icon is-danger-text"
                    disabled={!!busy}
                    title={t("deleteVersion")}
                    aria-label={t("deleteVersion")}
                    onClick={() => void remove([version.id])}
                  >
                    {busy === version.id ? <Spinner size={14} /> : <Icon name="trash" />}
                  </button>
                  <button type="button" className="cf-btn is-primary" disabled={!!busy} onClick={() => void restore(version)}>
                    {busy === version.id ? <Spinner size={14} /> : <Icon name="restore" />}
                    <span>{t("restoreVersion")}</span>
                  </button>
                </div>
              )}
              {selected === CURRENT && current && (
                <div className="cf-versions-actions">
                  <div className="cf-versions-meta">
                    <strong>{t("currentVersion")}</strong>
                    <span>
                      {formatFullDate(current.mtime, locale)} · {formatSize(current.size, locale)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {versions && versions.length > 0 && (
          <footer className="cf-versions-foot">
            <span className="cf-dim">
              {t("versionsCount", { n: versions.length })} · {formatSize(total, locale)}
            </span>
            <button type="button" className="cf-btn is-danger-text" disabled={!!busy} onClick={() => void remove()}>
              {busy === "all" ? <Spinner size={14} /> : <Icon name="trash" />}
              <span>{t("deleteHistory")}</span>
            </button>
          </footer>
        )}
      </div>
    </Modal>
  );
}

function VersionRow(props: { active: boolean; onSelect: () => void; title: string; when: string; size: string; isCurrent?: boolean }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.active}
      className={cx("cf-version-row", props.active && "is-active", props.isCurrent && "is-current")}
      onClick={props.onSelect}
    >
      <span className="cf-version-dot" aria-hidden="true" />
      <span className="cf-version-text">
        <strong>{props.title}</strong>
        <span>{props.when}</span>
      </span>
      <span className="cf-version-size">{props.size}</span>
    </button>
  );
}

/** Image, text or a plain icon, depending on what the file is. */
function Preview({ probe, src }: { probe: { kind: "file"; name: string; mime: string }; src: string }) {
  const { t } = useFinder();
  const category = categoryOf(probe);
  const text = isEditableText(probe) && category !== "image";
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!text) return;
    const controller = new AbortController();
    fetch(src, { signal: controller.signal, credentials: "same-origin", headers: { Range: `bytes=0-${TEXT_PREVIEW - 1}` } })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setContent, (e) => (e as Error)?.name !== "AbortError" && setFailed(true));
    return () => controller.abort();
  }, [src, text]);

  if (category === "image" && !failed) {
    return (
      <div className="cf-versions-image">
        <img src={src} alt="" draggable={false} onError={() => setFailed(true)} />
      </div>
    );
  }
  if (text && !failed) {
    return content === null ? <Spinner size={18} /> : <pre className="cf-versions-text">{content}</pre>;
  }
  return (
    <div className="cf-ql-empty">
      <FileIcon entry={probe} size={72} />
      <span>{t("previewUnavailable")}</span>
    </div>
  );
}
