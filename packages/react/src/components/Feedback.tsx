import { useRef } from "react";
import { cx, useDismiss, useFinder, useStore } from "../context";
import { formatSize } from "../format";
import { FileIcon, Icon } from "../icons";

export function Toasts() {
  const { store, t } = useFinder();
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="tf-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={cx("tf-toast", `is-${toast.kind}`)}>
          {toast.kind === "error" ? <Icon name="alert" size={14} /> : toast.kind === "success" ? <Icon name="check" size={14} /> : null}
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="tf-toast-action"
              onClick={() => {
                store.dismissToast(toast.id);
                toast.action!.run();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="tf-toast-close" aria-label={t("close")} onClick={() => store.dismissToast(toast.id)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function UploadPanel({ onClose }: { onClose: () => void }) {
  const { store, t, locale } = useFinder();
  const uploads = useStore((s) => s.uploads);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose, true, ".tf-upload-pill");
  const finished = uploads.some((u) => u.status !== "queued" && u.status !== "uploading");

  return (
    <div ref={ref} className="tf-uploads" role="dialog" aria-label={t("uploads")}>
      <div className="tf-uploads-head">
        <strong>{t("uploads")}</strong>
        {finished && (
          <button type="button" className="tf-link-btn" onClick={() => store.clearFinishedUploads()}>
            {t("clearFinished")}
          </button>
        )}
      </div>
      <ul className="tf-uploads-list">
        {[...uploads].reverse().map((u) => {
          const pct = u.size ? Math.round((u.loaded / u.size) * 100) : u.status === "done" ? 100 : 0;
          return (
            <li key={u.id} className={cx("tf-upload", `is-${u.status}`)}>
              <FileIcon entry={{ kind: "file", name: u.name, mime: u.file.type || "application/octet-stream" }} size={22} />
              <div className="tf-upload-main">
                <div className="tf-upload-name" title={u.relativePath ? `${u.relativePath}/${u.name}` : u.name}>
                  {u.relativePath && <span className="tf-dim">{u.relativePath}/</span>}
                  {u.name}
                </div>
                <div className="tf-upload-meta">
                  {u.status === "error" ? (
                    <span className="tf-upload-error">{u.error ?? t("uploadFailed")}</span>
                  ) : u.status === "cancelled" ? (
                    t("uploadCancelled")
                  ) : u.status === "done" ? (
                    `${formatSize(u.size, locale)} · ${t("uploadDone")}`
                  ) : (
                    `${formatSize(u.loaded, locale)} / ${formatSize(u.size, locale)}`
                  )}
                </div>
                {(u.status === "uploading" || u.status === "queued") && (
                  <span className="tf-progress" aria-label={`${pct}%`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ transform: `scaleX(${pct / 100})` }} />
                  </span>
                )}
              </div>
              {u.status === "error" || u.status === "cancelled" ? (
                <button type="button" className="tf-btn is-icon is-small" aria-label={t("retry")} title={t("retry")} onClick={() => store.retryUpload(u.id)}>
                  <Icon name="refresh" size={14} />
                </button>
              ) : u.status !== "done" ? (
                <button type="button" className="tf-btn is-icon is-small" aria-label={t("cancel")} title={t("cancel")} onClick={() => store.cancelUpload(u.id)}>
                  <Icon name="close" size={14} />
                </button>
              ) : (
                <Icon name="check" size={14} className="tf-upload-ok" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
