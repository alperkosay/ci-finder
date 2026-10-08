import type { Entry } from "@ci-finder/core/client";
import { cx, useFinder, useStore, useVisible } from "../context";
import { formatSize } from "../format";
import { TRASH_ID } from "../store";
import { Icon, Spinner } from "../icons";

export function StatusBar({ onToggleUploads, uploadsOpen }: { onToggleUploads: () => void; uploadsOpen: boolean }) {
  const { t, locale, pickMode, pickLabel, onPick, multiple } = useFinder();
  const ids = useVisible();
  const selection = useStore((s) => s.selection);
  const entries = useStore((s) => s.entries);
  const uploads = useStore((s) => s.uploads);
  const readOnly = useStore((s) => (s.cwd && s.cwd !== TRASH_ID ? s.entries[s.cwd]?.write === false : false));

  const selectedFiles = selection.map((id) => entries[id]).filter((e) => e?.kind === "file");
  const selectedSize = selectedFiles.reduce((n, e) => n + (e?.size ?? 0), 0);
  const active = uploads.filter((u) => u.status === "queued" || u.status === "uploading");
  const done = uploads.filter((u) => u.status === "done").length;
  const failed = uploads.filter((u) => u.status === "error").length;
  const totalBytes = active.reduce((n, u) => n + u.size, 0);
  const loadedBytes = active.reduce((n, u) => n + u.loaded, 0);
  const progress = totalBytes ? loadedBytes / totalBytes : 0;

  const picked = selection.map((id) => entries[id]).filter((e): e is Entry => e?.kind === "file");
  const canPick = pickMode && picked.length > 0 && (multiple || picked.length === 1);

  return (
    <footer className="cf-statusbar">
      <span className="cf-status-text" aria-live="polite">
        {selection.length
          ? t("selected", { n: selection.length, total: ids.length }) + (selectedSize ? ` · ${formatSize(selectedSize, locale)}` : "")
          : ids.length === 1
            ? t("item")
            : t("items", { n: ids.length })}
      </span>
      {readOnly && (
        <span className="cf-status-chip">
          <Icon name="lock" size={12} />
          {t("readOnly")}
        </span>
      )}
      <span className="cf-statusbar-spacer" />
      {uploads.length > 0 && (
        <button type="button" className={cx("cf-upload-pill", uploadsOpen && "is-on", failed > 0 && "has-error")} onClick={onToggleUploads} aria-expanded={uploadsOpen}>
          {active.length ? <Spinner size={12} /> : <Icon name={failed ? "alert" : "check"} size={12} />}
          <span>{active.length ? t("uploadsProgress", { done, total: done + active.length }) : t("uploadsComplete", { n: done })}</span>
          {active.length > 0 && (
            <span className="cf-progress" aria-hidden="true">
              <span style={{ transform: `scaleX(${progress})` }} />
            </span>
          )}
        </button>
      )}
      {pickMode && (
        <button type="button" className="cf-btn is-primary" disabled={!canPick} onClick={() => onPick?.(picked)}>
          {pickLabel ?? t("select")}
        </button>
      )}
    </footer>
  );
}
