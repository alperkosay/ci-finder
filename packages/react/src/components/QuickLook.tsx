import { useEffect, useMemo, useState } from "react";
import type { Entry } from "@ci-finder/core/client";
import { cx, useFinder, useStore, useVisible } from "../context";
import { categoryOf, formatSize, isEditableImage, isEditableText, kindLabel } from "../format";
import { FileIcon, Icon, Spinner } from "../icons";
import { langOf, toLines, tokenize } from "../editors/highlight";
import { renderMarkdown } from "../editors/markdown";
import { Modal } from "./Dialogs";

const TEXT_PREVIEW_LIMIT = 1024 * 1024;

function TextPreview({ entry, markdown }: { entry: Entry; markdown: boolean }) {
  const { store, t } = useFinder();
  const [state, setState] = useState<{ content?: string; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    setState({});
    if (entry.size > TEXT_PREVIEW_LIMIT) {
      setState({ error: t("error.TOO_LARGE") });
      return;
    }
    store.client.getContent(entry.id).then(
      ({ content }) => !cancelled && setState({ content }),
      (e) => !cancelled && setState({ error: store.errorMessage(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [entry, store, t]);

  const html = useMemo(() => {
    if (state.content === undefined) return "";
    if (markdown) return renderMarkdown(state.content);
    return toLines(tokenize(state.content.replace(/\r\n/g, "\n"), langOf(entry.name)))
      .map((l) => `<span class="cf-ln">${l || "​"}</span>`)
      .join("");
  }, [state.content, markdown, entry.name]);

  if (state.error) return <div className="cf-ql-empty">{state.error}</div>;
  if (state.content === undefined) return <Spinner size={20} />;
  return markdown ? (
    <div className="cf-md cf-ql-md" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <pre className="cf-ql-code cf-code-hl" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function Body({ entry }: { entry: Entry }) {
  const { store, t, locale } = useFinder();
  const [zoom, setZoom] = useState(false);
  const src = store.fileUrl(entry);
  const category = categoryOf(entry);
  useEffect(() => setZoom(false), [entry.id]);

  switch (category) {
    case "image":
      return (
        <div className={cx("cf-ql-image", zoom && "is-zoomed")} onClick={() => setZoom((z) => !z)}>
          <img src={src} alt={entry.name} draggable={false} />
        </div>
      );
    case "video":
      return <video key={entry.id} className="cf-ql-video" src={src} controls autoPlay playsInline />;
    case "audio":
      return (
        <div className="cf-ql-audio">
          <FileIcon entry={entry} size={120} />
          <audio key={entry.id} src={src} controls autoPlay />
        </div>
      );
    case "pdf":
      return <iframe key={entry.id} className="cf-ql-frame" src={src} title={entry.name} />;
    case "markdown":
      return <TextPreview entry={entry} markdown />;
    case "code":
    case "text":
      return <TextPreview entry={entry} markdown={false} />;
    default:
      return (
        <div className="cf-ql-empty">
          <FileIcon entry={entry} size={120} />
          <strong>{entry.name}</strong>
          <span>
            {kindLabel(entry, t)} · {formatSize(entry.size, locale)}
          </span>
          <span className="cf-dim">{t("previewUnavailable")}</span>
          <button type="button" className="cf-btn is-primary" onClick={() => store.download([entry])}>
            <Icon name="download" />
            <span>{t("download")}</span>
          </button>
        </div>
      );
  }
}

export function QuickLook() {
  const { store, t, locale } = useFinder();
  const previewId = useStore((s) => s.preview);
  const entries = useStore((s) => s.entries);
  const visible = useVisible();
  const entry = previewId ? entries[previewId] : undefined;
  const files = useMemo(() => visible.filter((id) => entries[id]?.kind === "file"), [visible, entries]);
  const index = entry ? files.indexOf(entry.id) : -1;

  if (!entry || entry.trash) return null;
  const close = () => store.set({ preview: null });
  const go = (delta: number) => {
    if (files.length < 2) return;
    const next = files[(index + delta + files.length) % files.length]!;
    store.set({ preview: next, selection: [next], focus: next, anchor: next });
  };

  return (
    <Modal label={entry.name} onCancel={close} className="cf-quicklook" wide>
      <div
        className="cf-ql"
        tabIndex={-1}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest("video, audio, input, textarea")) return;
          const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
          if (delta) {
            e.preventDefault();
            go(delta);
          } else if (e.key === " ") {
            e.preventDefault();
            close();
          }
        }}
      >
        <header className="cf-ql-head">
          <div className="cf-editor-title">
            <strong>{entry.name}</strong>
            <span>
              {formatSize(entry.size, locale)}
              {files.length > 1 && index >= 0 && ` · ${index + 1} / ${files.length}`}
            </span>
          </div>
          <div className="cf-editor-tools">
            {files.length > 1 && (
              <>
                <button type="button" className="cf-btn is-icon" aria-label={t("back")} onClick={() => go(-1)}>
                  <Icon name="back" />
                </button>
                <button type="button" className="cf-btn is-icon" aria-label={t("forward")} onClick={() => go(1)}>
                  <Icon name="forward" />
                </button>
                <span className="cf-tool-sep" />
              </>
            )}
            {isEditableText(entry) && entry.write && (
              <button type="button" className="cf-btn" onClick={() => store.set({ preview: null, editor: { id: entry.id, type: "code" } })}>
                <Icon name="code" />
                <span>{t("edit")}</span>
              </button>
            )}
            {isEditableImage(entry) && entry.write && (
              <button type="button" className="cf-btn" onClick={() => store.set({ preview: null, editor: { id: entry.id, type: "image" } })}>
                <Icon name="image" />
                <span>{t("edit")}</span>
              </button>
            )}
            <a className="cf-btn is-icon" href={store.fileUrl(entry)} target="_blank" rel="noopener noreferrer" aria-label={t("open")} title={t("open")}>
              <Icon name="external" />
            </a>
            <button type="button" className="cf-btn is-icon" aria-label={t("download")} title={t("download")} onClick={() => store.download([entry])}>
              <Icon name="download" />
            </button>
            <button type="button" className="cf-btn is-icon" aria-label={t("close")} title={t("close")} onClick={close} autoFocus>
              <Icon name="close" />
            </button>
          </div>
        </header>
        <div className="cf-ql-body">
          <Body entry={entry} />
        </div>
      </div>
    </Modal>
  );
}
