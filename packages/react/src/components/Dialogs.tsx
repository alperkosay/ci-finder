import { useEffect, useRef, type ReactNode } from "react";
import { cx, useFinder, useStore } from "../context";
import { baseOf } from "../format";
import { Icon } from "../icons";

/** Native <dialog> (focus trap, top layer, Esc) with theFinder styling. */
export function Modal({
  children,
  onCancel,
  className,
  label,
  wide,
}: {
  children: ReactNode;
  onCancel: () => void;
  className?: string;
  label: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const onCancelEvent = (e: Event) => {
      e.preventDefault();
      cancel.current();
    };
    el.addEventListener("cancel", onCancelEvent);
    return () => {
      el.removeEventListener("cancel", onCancelEvent);
      if (el.open) el.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={cx("tf-dialog", wide && "is-wide", className)}
      aria-label={label}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        // Click on the backdrop (the dialog element itself, outside its content box) cancels.
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) cancel.current();
        }
      }}
    >
      {children}
    </dialog>
  );
}

export function Dialogs() {
  const { t } = useFinder();
  const dialog = useStore((s) => s.dialog);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dialog?.type !== "prompt") return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, baseOf(el.value).length);
  }, [dialog]);

  if (!dialog) return null;

  if (dialog.type === "confirm") {
    return (
      <Modal label={dialog.title} onCancel={() => dialog.resolve(false)}>
        <div className="tf-dialog-body">
          {dialog.danger && (
            <span className="tf-dialog-icon is-danger">
              <Icon name="trash" size={18} />
            </span>
          )}
          <div>
            <h2 className="tf-dialog-title">{dialog.title}</h2>
            {dialog.body && <p className="tf-dialog-text">{dialog.body}</p>}
          </div>
        </div>
        <div className="tf-dialog-actions">
          <button type="button" className="tf-btn" onClick={() => dialog.resolve(false)}>
            {t("cancel")}
          </button>
          <button type="button" className={cx("tf-btn", dialog.danger ? "is-danger" : "is-primary")} autoFocus onClick={() => dialog.resolve(true)}>
            {dialog.confirmLabel}
          </button>
        </div>
      </Modal>
    );
  }

  if (dialog.type === "prompt") {
    return (
      <Modal label={dialog.title} onCancel={() => dialog.resolve(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = inputRef.current?.value.trim() ?? "";
            dialog.resolve(value || null);
          }}
        >
          <div className="tf-dialog-body is-stacked">
            <h2 className="tf-dialog-title">{dialog.title}</h2>
            <input ref={inputRef} className="tf-input" defaultValue={dialog.value} spellCheck={false} aria-label={dialog.title} />
          </div>
          <div className="tf-dialog-actions">
            <button type="button" className="tf-btn" onClick={() => dialog.resolve(null)}>
              {t("cancel")}
            </button>
            <button type="submit" className="tf-btn is-primary">
              {dialog.confirmLabel}
            </button>
          </div>
        </form>
      </Modal>
    );
  }

  const one = dialog.names.length === 1;
  const title = one ? t("conflictTitleOne", { name: dialog.names[0]! }) : t("conflictTitle", { n: dialog.names.length });
  return (
    <Modal label={title} onCancel={() => dialog.resolve(null)}>
      <div className="tf-dialog-body">
        <span className="tf-dialog-icon">
          <Icon name="copy" size={18} />
        </span>
        <div>
          <h2 className="tf-dialog-title">{title}</h2>
          <p className="tf-dialog-text">{t("conflictBody")}</p>
          {!one && (
            <ul className="tf-dialog-list">
              {dialog.names.slice(0, 5).map((n) => (
                <li key={n}>{n}</li>
              ))}
              {dialog.names.length > 5 && <li>…</li>}
            </ul>
          )}
        </div>
      </div>
      <div className="tf-dialog-actions">
        <button type="button" className="tf-btn" onClick={() => dialog.resolve("skip")}>
          {t("skip")}
        </button>
        <span className="tf-dialog-spacer" />
        <button type="button" className="tf-btn" onClick={() => dialog.resolve("rename")}>
          {t("keepBoth")}
        </button>
        <button type="button" className="tf-btn is-primary" autoFocus onClick={() => dialog.resolve("overwrite")}>
          {t("replace")}
        </button>
      </div>
    </Modal>
  );
}
