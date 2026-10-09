import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Entry } from "@thefinder/core/client";
import { cx, useFinder } from "../context";
import { baseOf, extOf, formatSize } from "../format";
import { FileIcon, Icon, Spinner } from "../icons";
import { Modal } from "../components/Dialogs";

type Rect = { x: number; y: number; w: number; h: number };
type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move" | "new";

const FORMATS: Record<string, { mime: string; ext: string }> = {
  "image/jpeg": { mime: "image/jpeg", ext: "jpg" },
  "image/png": { mime: "image/png", ext: "png" },
  "image/webp": { mime: "image/webp", ext: "webp" },
};

function originalFormat(name: string): string {
  const ext = extOf(name);
  if (ext === "jpg" || ext === "jpeg" || ext === "jfif") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

const ASPECTS: { label: string; value: number | null }[] = [
  { label: "free", value: null },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
];

export function ImageEditor({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const { store, t, locale } = useFinder();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [cropping, setCropping] = useState(false);
  const [aspect, setAspect] = useState<number | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [lockRatio, setLockRatio] = useState(true);
  const [format, setFormat] = useState(() => originalFormat(entry.name));
  const [quality, setQuality] = useState(0.9);
  const [saving, setSaving] = useState<"overwrite" | "copy" | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Load with CORS so the canvas stays exportable for cross-origin (e.g. S3) images.
  useEffect(() => {
    const image = new Image();
    const src = store.fileUrl(entry);
    const abs = new URL(src, location.href);
    if (abs.origin !== location.origin) image.crossOrigin = "anonymous";
    abs.searchParams.set("v", String(entry.mtime));
    image.onload = () => setImg(image);
    image.onerror = () => setError(t("previewUnavailable"));
    image.src = abs.toString();
  }, [entry, store, t]);

  const rotated = rotation % 180 !== 0;
  const tw = img ? (rotated ? img.naturalHeight : img.naturalWidth) : 0;
  const th = img ? (rotated ? img.naturalWidth : img.naturalHeight) : 0;
  const area = crop ?? { x: 0, y: 0, w: tw, h: th };
  const out = size ?? { w: Math.round(area.w), h: Math.round(area.h) };

  /** Draws the rotated/flipped full image onto a canvas. */
  const renderTransformed = useMemo(() => {
    return (canvas: HTMLCanvasElement) => {
      if (!img) return;
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d")!;
      ctx.save();
      ctx.translate(tw / 2, th / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      ctx.restore();
    };
  }, [img, rotation, flipX, flipY, tw, th]);

  useEffect(() => {
    if (canvasRef.current) renderTransformed(canvasRef.current);
  }, [renderTransformed]);

  const rotate = (deg: number) => {
    setRotation((r) => (r + deg + 360) % 360);
    setCrop(null);
    setSize(null);
  };

  const reset = () => {
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setCrop(null);
    setSize(null);
    setCropping(false);
    setAspect(null);
  };

  const applyAspect = (value: number | null) => {
    setAspect(value);
    if (!value) return;
    // Largest centered rectangle with the requested ratio.
    let w = tw;
    let h = w / value;
    if (h > th) {
      h = th;
      w = h * value;
    }
    setCrop({ x: (tw - w) / 2, y: (th - h) / 2, w, h });
    setSize(null);
    setCropping(true);
  };

  // --- crop interaction --------------------------------------------------------------------------

  const startDrag = (handle: Handle) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = tw / rect.width;
    const toImg = (cx: number, cy: number) => ({
      x: Math.min(tw, Math.max(0, (cx - rect.left) * scale)),
      y: Math.min(th, Math.max(0, (cy - rect.top) * scale)),
    });
    const start = toImg(e.clientX, e.clientY);
    const base = crop ?? { x: 0, y: 0, w: tw, h: th };

    const move = (ev: PointerEvent) => {
      const p = toImg(ev.clientX, ev.clientY);
      let { x, y, w, h } = base;
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (handle === "move") {
        x = Math.min(tw - w, Math.max(0, base.x + dx));
        y = Math.min(th - h, Math.max(0, base.y + dy));
      } else if (handle === "new") {
        x = Math.min(start.x, p.x);
        y = Math.min(start.y, p.y);
        w = Math.abs(p.x - start.x);
        h = aspect ? w / aspect : Math.abs(p.y - start.y);
        if (aspect && p.y < start.y) y = start.y - h;
      } else {
        const right = base.x + base.w;
        const bottom = base.y + base.h;
        if (handle.includes("w")) {
          x = Math.min(right - 8, base.x + dx);
          w = right - x;
        }
        if (handle.includes("e")) w = Math.max(8, base.w + dx);
        if (handle.includes("n")) {
          y = Math.min(bottom - 8, base.y + dy);
          h = bottom - y;
        }
        if (handle.includes("s")) h = Math.max(8, base.h + dy);
        if (aspect) {
          if (handle === "n" || handle === "s") w = h * aspect;
          else h = w / aspect;
          if (handle.includes("n")) y = bottom - h;
          if (handle.includes("w")) x = right - w;
        }
      }
      // Clamp to the image.
      x = Math.max(0, x);
      y = Math.max(0, y);
      w = Math.min(w, tw - x);
      h = Math.min(h, th - y);
      if (w >= 4 && h >= 4) {
        setCrop({ x, y, w, h });
        setSize(null);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // --- export ------------------------------------------------------------------------------------

  const exportBlob = async (): Promise<Blob> => {
    const full = document.createElement("canvas");
    renderTransformed(full);
    const outCanvas = document.createElement("canvas");
    outCanvas.width = Math.max(1, out.w);
    outCanvas.height = Math.max(1, out.h);
    const ctx = outCanvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    if (format === "image/jpeg") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, outCanvas.width, outCanvas.height);
    }
    ctx.drawImage(full, area.x, area.y, area.w, area.h, 0, 0, outCanvas.width, outCanvas.height);
    return new Promise((resolve, reject) => {
      try {
        outCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), format, format === "image/png" ? undefined : quality);
      } catch (e) {
        reject(e);
      }
    });
  };

  const save = async (mode: "overwrite" | "copy") => {
    setSaving(mode);
    try {
      const blob = await exportBlob();
      if (mode === "overwrite") {
        const { entry: next } = await store.client.putBlob(entry.id, blob, "edit");
        store.updateEntry(next);
      } else {
        const name = `${baseOf(entry.name)}-${t("editedSuffix")}.${FORMATS[format]!.ext}`;
        const { entry: next } = await store.client.saveBlobAs(entry.parent!, name, blob);
        store.updateEntry(next);
        store.setSelection([next.id]);
      }
      store.toast(t("saved"), "success");
      onClose();
    } catch (e) {
      if ((e as Error)?.name === "SecurityError") setError(t("imageTainted"));
      else store.fail(e);
    } finally {
      setSaving(null);
    }
  };

  const sameFormat = format === originalFormat(entry.name) && extOf(entry.name) !== "gif" && extOf(entry.name) !== "bmp" && extOf(entry.name) !== "avif";
  const changed = rotation !== 0 || flipX || flipY || !!crop || !!size || !sameFormat || quality !== 0.9;

  // Size the saved file would have: encode the result in the background a moment after each change.
  const [estimate, setEstimate] = useState<{ bytes: number | null; pending: boolean }>({ bytes: null, pending: false });
  const exportRef = useRef(exportBlob);
  exportRef.current = exportBlob;
  useEffect(() => {
    if (!img || !changed) return setEstimate({ bytes: null, pending: false });
    setEstimate((e) => ({ ...e, pending: true }));
    let live = true;
    const timer = setTimeout(() => {
      exportRef.current().then(
        (blob) => live && setEstimate({ bytes: blob.size, pending: false }),
        // A cross-origin image without CORS cannot be encoded; saving reports that, no need here.
        () => live && setEstimate({ bytes: null, pending: false }),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [img, changed, rotation, flipX, flipY, crop, size, format, quality]);
  const change = estimate.bytes !== null && entry.size > 0 ? Math.round((1 - estimate.bytes / entry.size) * 100) : null;
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  const setWidth = (w: number) => {
    if (!Number.isFinite(w) || w < 1) return;
    setSize({ w: Math.round(w), h: lockRatio ? Math.max(1, Math.round((w * area.h) / area.w)) : out.h });
  };
  const setHeight = (h: number) => {
    if (!Number.isFinite(h) || h < 1) return;
    setSize({ h: Math.round(h), w: lockRatio ? Math.max(1, Math.round((h * area.w) / area.h)) : out.w });
  };

  return (
    <Modal label={entry.name} onCancel={onClose} className="tf-editor-dialog" wide>
      <div className="tf-editor tf-image-editor">
        <header className="tf-editor-head">
          <FileIcon entry={entry} size={20} />
          <div className="tf-editor-title">
            <strong>{entry.name}</strong>
            <span>{img ? `${img.naturalWidth} × ${img.naturalHeight}` : entry.path}</span>
          </div>
          <div className="tf-editor-tools">
            {store.hasVersions(entry) && (
              <>
                <button
                  type="button"
                  className="tf-btn is-icon"
                  title={t("versions")}
                  aria-label={t("versions")}
                  disabled={!!saving}
                  onClick={() => {
                    onClose();
                    store.openVersions(entry);
                  }}
                >
                  <Icon name="history" />
                </button>
                <span className="tf-tool-sep" />
              </>
            )}
            <button type="button" className="tf-btn" disabled={!changed || !!saving || !entry.parent} onClick={() => void save("copy")}>
              {saving === "copy" ? <Spinner size={14} /> : <Icon name="duplicate" />}
              <span>{t("saveAs")}</span>
            </button>
            <button
              type="button"
              className="tf-btn is-primary"
              disabled={!changed || !!saving || !entry.write || !sameFormat}
              onClick={() => void save("overwrite")}
            >
              {saving === "overwrite" ? <Spinner size={14} /> : <Icon name="save" />}
              <span>{t("save")}</span>
            </button>
            <button type="button" className="tf-btn is-icon" aria-label={t("close")} onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
        </header>

        <div className="tf-image-body">
          <div ref={stageRef} className="tf-image-stage">
            {error ? (
              <div className="tf-editor-state is-error">
                <Icon name="alert" size={24} />
                <span>{error}</span>
              </div>
            ) : !img ? (
              <div className="tf-editor-state">
                <Spinner size={20} />
              </div>
            ) : (
              <div className="tf-image-frame">
                <canvas ref={canvasRef} className="tf-image-canvas" />
                {cropping && (
                  <div className="tf-crop-layer" onPointerDown={startDrag("new")}>
                    <div
                      className="tf-crop-box"
                      style={{ left: pct(area.x, tw), top: pct(area.y, th), width: pct(area.w, tw), height: pct(area.h, th) }}
                      onPointerDown={startDrag("move")}
                    >
                      <span className="tf-crop-grid" />
                      {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((h) => (
                        <span key={h} className={`tf-crop-handle is-${h}`} onPointerDown={startDrag(h)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <aside className="tf-image-panel">
            <section>
              <h4>{t("edit")}</h4>
              <div className="tf-icon-row">
                <button type="button" className="tf-btn is-icon" title={t("rotateLeft")} aria-label={t("rotateLeft")} onClick={() => rotate(-90)}>
                  <Icon name="rotateLeft" />
                </button>
                <button type="button" className="tf-btn is-icon" title={t("rotateRight")} aria-label={t("rotateRight")} onClick={() => rotate(90)}>
                  <Icon name="rotateRight" />
                </button>
                <button
                  type="button"
                  className={cx("tf-btn is-icon", flipX && "is-on")}
                  title={t("flipH")}
                  aria-label={t("flipH")}
                  aria-pressed={flipX}
                  onClick={() => setFlipX((v) => !v)}
                >
                  <Icon name="flipH" />
                </button>
                <button
                  type="button"
                  className={cx("tf-btn is-icon", flipY && "is-on")}
                  title={t("flipV")}
                  aria-label={t("flipV")}
                  aria-pressed={flipY}
                  onClick={() => setFlipY((v) => !v)}
                >
                  <Icon name="flipV" />
                </button>
              </div>
            </section>

            <section>
              <h4>
                <Icon name="crop" size={14} /> {t("crop")}
              </h4>
              <div className="tf-chips">
                {ASPECTS.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    className={cx("tf-chip", cropping && aspect === a.value && "is-on")}
                    onClick={() => {
                      setCropping(true);
                      if (a.value) applyAspect(a.value);
                      else setAspect(null);
                    }}
                  >
                    {a.label === "free" ? t("cropFree") : a.label}
                  </button>
                ))}
              </div>
              {crop && (
                <p className="tf-dim tf-small">
                  {Math.round(crop.w)} × {Math.round(crop.h)} px
                </p>
              )}
            </section>

            <section>
              <h4>
                <Icon name="resize" size={14} /> {t("resize")}
              </h4>
              <div className="tf-size-row">
                <label>
                  <span>{t("width")}</span>
                  <input className="tf-input is-small" type="number" min={1} value={out.w} onChange={(e) => setWidth(Number(e.target.value))} />
                </label>
                <span className="tf-times">×</span>
                <label>
                  <span>{t("height")}</span>
                  <input className="tf-input is-small" type="number" min={1} value={out.h} onChange={(e) => setHeight(Number(e.target.value))} />
                </label>
              </div>
              <label className="tf-check">
                <input type="checkbox" checked={lockRatio} onChange={(e) => setLockRatio(e.target.checked)} />
                <span>{t("lockRatio")}</span>
              </label>
            </section>

            <section>
              <h4>{t("format")}</h4>
              <select className="tf-input is-small" aria-label={t("format")} value={format} onChange={(e) => setFormat(e.target.value)}>
                {Object.values(FORMATS).map((f) => (
                  <option key={f.mime} value={f.mime}>
                    {f.ext.toUpperCase()}
                    {f.mime === originalFormat(entry.name) ? ` (${t("keepFormat")})` : ""}
                  </option>
                ))}
              </select>
              {format !== "image/png" && (
                <label className="tf-range">
                  <span>
                    {t("quality")} <b>{Math.round(quality * 100)}</b>
                  </span>
                  <input type="range" min={0.4} max={1} step={0.01} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
                </label>
              )}
            </section>

            <button type="button" className="tf-btn tf-reset" disabled={!changed} onClick={reset}>
              <Icon name="refresh" />
              <span>{t("reset")}</span>
            </button>
            <dl className="tf-estimate" aria-live="polite">
              <div>
                <dt>{t("dimensions")}</dt>
                <dd>
                  {out.w.toLocaleString(locale)} × {out.h.toLocaleString(locale)} px
                </dd>
              </div>
              <div>
                <dt>{changed ? t("estimatedSize") : t("size")}</dt>
                <dd className={cx(estimate.pending && "is-pending")}>
                  {!changed ? (
                    formatSize(entry.size, locale)
                  ) : estimate.bytes === null ? (
                    estimate.pending ? (
                      <Spinner size={12} />
                    ) : (
                      "—"
                    )
                  ) : (
                    <>
                      <span>
                        {formatSize(entry.size, locale)} → <b>{formatSize(estimate.bytes, locale)}</b>
                      </span>
                      {change !== null && (
                        <span className={cx("tf-batch-pct", change > 0 && "is-good")}>{change > 0 ? `−${change}%` : change < 0 ? `+${-change}%` : "0%"}</span>
                      )}
                    </>
                  )}
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
