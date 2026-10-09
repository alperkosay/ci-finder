import { useMemo, useRef, useState } from "react";
import type { Entry, ImageFormat, TransformResult } from "@thefinder/core/client";
import type { TransformOptions } from "@thefinder/core/client";
import { cx, useFinder, useStore } from "../context";
import { baseOf, extOf, formatSize } from "../format";
import { FileIcon, Icon, Spinner } from "../icons";
import type { FinderStore } from "../store";
import { Modal } from "./Dialogs";

type Format = ImageFormat | "keep";
type ItemState = { status: "waiting" | "running" | "done"; result?: TransformResult };

const SIZES = [0, 3840, 2560, 1920, 1280, 800] as const;
const FORMAT_LABEL: Record<Format, string> = { keep: "", webp: "WebP", jpeg: "JPEG", avif: "AVIF", png: "PNG", gif: "GIF" };
const FORMAT_EXT: Record<ImageFormat, string> = { jpeg: "jpg", png: "png", webp: "webp", avif: "avif", gif: "gif" };
/** Formats a browser canvas can encode, used when the server has no image processor. */
const BROWSER_FORMATS: ImageFormat[] = ["webp", "jpeg", "png"];
const PARALLEL = 2;

export function ImageBatch() {
  const { store } = useFinder();
  const ids = useStore((s) => s.imageBatch);
  if (!ids) return null;
  return <BatchView key={ids.join(",")} ids={ids} onClose={() => store.set({ imageBatch: null })} />;
}

function BatchView({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { store, t, locale } = useFinder();
  const server = useStore((s) => s.images);
  const entries = useMemo(() => ids.map((id) => store.entry(id)).filter((e): e is Entry => !!e), [ids, store]);
  const formats: ImageFormat[] = server ? server.formats.filter((f) => f !== "gif") : BROWSER_FORMATS;

  const [size, setSize] = useState<number | "custom">(0);
  const [custom, setCustom] = useState({ w: 1600, h: 1600 });
  const [format, setFormat] = useState<Format>("keep");
  const [quality, setQuality] = useState(80);
  const [output, setOutput] = useState<"overwrite" | "copy">("overwrite");
  const [replaceConverted, setReplaceConverted] = useState(false);
  const [skipLarger, setSkipLarger] = useState(true);
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const [running, setRunning] = useState(false);
  const stopped = useRef(false);

  const started = Object.keys(items).length > 0;
  const finished = started && !running;
  const box = size === "custom" ? custom : size ? { w: size, h: size } : null;
  const converting = format !== "keep";
  const totalBefore = entries.reduce((n, e) => n + e.size, 0);
  const lossy = format === "keep" ? entries.some((e) => extOf(e.name) !== "png") || !!server : format !== "png" || !!server;

  const done = Object.values(items).filter((i) => i.status === "done");
  const changed = done.filter((i) => i.result?.entry);
  const savedBefore = changed.reduce((n, i) => n + i.result!.before, 0);
  const savedAfter = changed.reduce((n, i) => n + (i.result!.after ?? i.result!.before), 0);

  const options: TransformOptions = {
    format,
    width: box?.w,
    height: box?.h,
    quality,
    output,
    skipLarger,
    conflict: replaceConverted ? "overwrite" : "rename",
  };

  const run = async () => {
    stopped.current = false;
    setRunning(true);
    setItems(Object.fromEntries(entries.map((e) => [e.id, { status: "waiting" }])));
    const queue = [...entries];
    const results: TransformResult[] = [];
    const worker = async () => {
      for (let entry = queue.shift(); entry && !stopped.current; entry = queue.shift()) {
        setItems((s) => ({ ...s, [entry!.id]: { status: "running" } }));
        let result: TransformResult;
        try {
          result = server ? (await store.client.transform([entry.id], options)).results[0]! : await browserTransform(store, entry, options);
        } catch (e) {
          result = { id: entry.id, name: entry.name, before: entry.size, error: store.errorMessage(e) };
        }
        if (result.entry) store.updateEntry(result.entry);
        results.push(result);
        setItems((s) => ({ ...s, [entry!.id]: { status: "done", result } }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, entries.length) }, worker));
    setRunning(false);
    const written = results.filter((r) => r.entry);
    if (written.length) {
      store.toast(t("batchDone", { n: written.length }), "success");
      store.options.onChange?.({ type: "optimize", entries: written.map((r) => r.entry!) });
    }
  };

  const status = (entry: Entry) => {
    const item = items[entry.id];
    if (!item) return <span className="tf-dim">{formatSize(entry.size, locale)}</span>;
    if (item.status === "waiting") return <span className="tf-dim">{t("batchWaiting")}</span>;
    if (item.status === "running") return <Spinner size={14} />;
    const r = item.result!;
    if (r.error) {
      const key = `error.${r.error}` as Parameters<typeof t>[0];
      const message = t(key) === key ? r.error : t(key);
      return <span className="tf-batch-error">{message}</span>;
    }
    if (r.skipped) return <span className="tf-dim">{r.skipped === "larger" ? t("batchSkippedLarger") : t("batchSkippedUnsupported")}</span>;
    const pct = r.before ? Math.round((1 - (r.after ?? r.before) / r.before) * 100) : 0;
    return (
      <span className="tf-batch-result">
        {r.entry && r.entry.id !== entry.id && <span className="tf-batch-new">{r.entry.name}</span>}
        <span>
          {formatSize(r.before, locale)} → <b>{formatSize(r.after ?? 0, locale)}</b>
        </span>
        <span className={cx("tf-batch-pct", pct > 0 && "is-good")}>{pct > 0 ? `−${pct}%` : pct < 0 ? `+${-pct}%` : "0%"}</span>
      </span>
    );
  };

  const savedPct = savedBefore ? Math.round((1 - savedAfter / savedBefore) * 100) : 0;

  return (
    <Modal label={t("batchTitle", { n: entries.length })} onCancel={running ? () => {} : onClose} className="tf-batch-dialog">
      <div className="tf-editor">
        <header className="tf-editor-head">
          <Icon name="sliders" size={18} />
          <div className="tf-editor-title">
            <strong>{t("batchTitle", { n: entries.length })}</strong>
            <span>{formatSize(totalBefore, locale)}</span>
          </div>
          <div className="tf-editor-tools">
            <button type="button" className="tf-btn is-icon" aria-label={t("close")} disabled={running} onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
        </header>

        <div className="tf-batch-body">
          <fieldset className="tf-image-panel tf-batch-options" disabled={running}>
            <section>
              <h4>
                <Icon name="resize" size={14} /> {t("batchSize")}
              </h4>
              <div className="tf-chips">
                {SIZES.map((s) => (
                  <button key={s} type="button" className={cx("tf-chip", size === s && "is-on")} aria-pressed={size === s} onClick={() => setSize(s)}>
                    {s ? s : t("sizeOriginal")}
                  </button>
                ))}
                <button
                  type="button"
                  className={cx("tf-chip", size === "custom" && "is-on")}
                  aria-pressed={size === "custom"}
                  onClick={() => setSize("custom")}
                >
                  {t("sizeCustom")}
                </button>
              </div>
              {size === "custom" && (
                <div className="tf-size-row">
                  <label>
                    <span>{t("width")}</span>
                    <input
                      className="tf-input is-small"
                      type="number"
                      min={1}
                      value={custom.w}
                      onChange={(e) => setCustom((c) => ({ ...c, w: Math.max(1, Number(e.target.value) || 1) }))}
                    />
                  </label>
                  <span className="tf-times">×</span>
                  <label>
                    <span>{t("height")}</span>
                    <input
                      className="tf-input is-small"
                      type="number"
                      min={1}
                      value={custom.h}
                      onChange={(e) => setCustom((c) => ({ ...c, h: Math.max(1, Number(e.target.value) || 1) }))}
                    />
                  </label>
                </div>
              )}
              {box && <p className="tf-dim tf-small">{t("maxBox", { w: box.w, h: box.h })}</p>}
            </section>

            <section>
              <h4>{t("format")}</h4>
              <div className="tf-chips">
                {(["keep", ...formats] as Format[]).map((f) => (
                  <button key={f} type="button" className={cx("tf-chip", format === f && "is-on")} aria-pressed={format === f} onClick={() => setFormat(f)}>
                    {f === "keep" ? t("keepSameFormat") : FORMAT_LABEL[f]}
                  </button>
                ))}
              </div>
              {lossy && (
                <label className="tf-range">
                  <span>
                    {t("quality")} <b>{quality}</b>
                  </span>
                  <input type="range" min={30} max={100} step={1} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
                </label>
              )}
              {server && (format === "png" || (format === "keep" && entries.some((e) => extOf(e.name) === "png"))) && quality < 100 && (
                <p className="tf-dim tf-small">{t("pngQualityHint")}</p>
              )}
            </section>

            <section>
              <h4>{t("batchOutput")}</h4>
              {converting ? (
                <>
                  <p className="tf-batch-note">{t("convertKeepsOriginals", { ext: FORMAT_EXT[format as ImageFormat] })}</p>
                  {server && (
                    <label className="tf-check">
                      <input type="checkbox" checked={replaceConverted} onChange={(e) => setReplaceConverted(e.target.checked)} />
                      <span>{t("replaceConverted", { ext: FORMAT_EXT[format as ImageFormat] })}</span>
                    </label>
                  )}
                </>
              ) : (
                <div className="tf-radios" role="radiogroup" aria-label={t("batchOutput")}>
                  <label className="tf-radio">
                    <input type="radio" name="tf-batch-output" checked={output === "overwrite"} onChange={() => setOutput("overwrite")} />
                    <span>
                      {t("overwriteKeepHistory")}
                      <small>{t("overwriteHint")}</small>
                    </span>
                  </label>
                  <label className="tf-radio">
                    <input type="radio" name="tf-batch-output" checked={output === "copy"} onChange={() => setOutput("copy")} />
                    <span>{t("saveCopies")}</span>
                  </label>
                </div>
              )}
              <label className="tf-check">
                <input type="checkbox" checked={skipLarger} onChange={(e) => setSkipLarger(e.target.checked)} />
                <span>{t("skipLarger")}</span>
              </label>
            </section>

            {!server && <p className="tf-dim tf-small">{t("browserProcessing")}</p>}
          </fieldset>

          <ul className="tf-batch-list">
            {entries.map((e) => (
              <li key={e.id} className={cx("tf-batch-item", items[e.id]?.status === "running" && "is-running")}>
                <span className="tf-batch-thumb">
                  <BatchThumb entry={e} />
                </span>
                <span className="tf-batch-name" title={e.name}>
                  {e.name}
                </span>
                <span className="tf-batch-status">{status(e)}</span>
              </li>
            ))}
            {!entries.length && <li className="tf-batch-item tf-dim">{t("batchNoImages")}</li>}
          </ul>
        </div>

        <footer className="tf-versions-foot">
          <span className="tf-dim">
            {changed.length > 0 &&
              `${formatSize(savedBefore, locale)} → ${formatSize(savedAfter, locale)} · ${t("batchSaved", {
                saved: formatSize(Math.max(0, savedBefore - savedAfter), locale),
                pct: `${savedPct}%`,
              })}`}
          </span>
          <span className="tf-dialog-spacer" />
          {running ? (
            <button type="button" className="tf-btn is-outline" onClick={() => (stopped.current = true)}>
              {t("stop")}
            </button>
          ) : (
            <button type="button" className="tf-btn is-outline" onClick={onClose}>
              {finished ? t("close") : t("cancel")}
            </button>
          )}
          {!finished && (
            <button type="button" className="tf-btn is-primary" disabled={running || !entries.length} onClick={() => void run()}>
              {running ? <Spinner size={14} /> : <Icon name="sliders" />}
              <span>{t("runBatch", { n: entries.length })}</span>
            </button>
          )}
        </footer>
      </div>
    </Modal>
  );
}

function BatchThumb({ entry }: { entry: Entry }) {
  const { store, thumbnails } = useFinder();
  const [failed, setFailed] = useState(false);
  if (!thumbnails || failed) return <FileIcon entry={entry} size={28} />;
  return <img src={store.previewUrl(entry, 128)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
}

const MIME: Record<string, ImageFormat> = { png: "png", jpg: "jpeg", jpeg: "jpeg", jfif: "jpeg", webp: "webp" };

/** Canvas fallback with the same semantics as the server's `transform` command. */
async function browserTransform(store: FinderStore, entry: Entry, o: TransformOptions): Promise<TransformResult> {
  const result: TransformResult = { id: entry.id, name: entry.name, before: entry.size };
  const ext = extOf(entry.name);
  const source = MIME[ext];
  const format = o.format && o.format !== "keep" ? o.format : source;
  if (!source || !format || !BROWSER_FORMATS.includes(format)) return { ...result, skipped: "unsupported" };

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const abs = new URL(store.fileUrl(entry), location.href);
    if (abs.origin !== location.origin) image.crossOrigin = "anonymous";
    abs.searchParams.set("v", String(entry.mtime));
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("load"));
    image.src = abs.toString();
  });
  const scale = Math.min(1, o.width ? o.width / img.naturalWidth : 1, o.height ? o.height / img.naturalHeight : 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  if (format === "jpeg") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const mime = `image/${format}`;
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), mime, format === "png" ? undefined : (o.quality ?? 80) / 100),
  );
  Object.assign(result, { after: blob.size, width: canvas.width, height: canvas.height });
  if (o.skipLarger !== false && blob.size >= entry.size) return { ...result, skipped: "larger" };

  if (format === source && o.output !== "copy") {
    const { entry: next } = await store.client.putBlob(entry.id, blob, "optimize");
    return { ...result, entry: next, created: false };
  }
  const name = format === source ? `${baseOf(entry.name)}-${o.suffix ?? "optimized"}.${ext}` : `${baseOf(entry.name)}.${FORMAT_EXT[format]}`;
  const { entry: next } = await store.client.saveBlobAs(entry.parent!, name, blob);
  return { ...result, entry: next, created: true };
}
