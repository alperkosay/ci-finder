import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Entry } from "@ci-finder/core/client";
import { cx, modKey, shortcut, useFinder } from "../context";
import { FileIcon, Icon, Spinner } from "../icons";
import { Modal } from "../components/Dialogs";
import { escapeHtml, LANG_LABEL, langOf, toLines, tokenize, type Lang } from "./highlight";
import { renderMarkdown } from "./markdown";

const HIGHLIGHT_LIMIT = 400_000;
const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
const LINE_COMMENT: Partial<Record<Lang, string>> = { js: "//", clike: "//", php: "//", py: "#", sh: "#", ruby: "#", yaml: "#", sql: "--", ini: ";" };

interface Prefs {
  wrap: boolean;
  fontSize: number;
}

function loadPrefs(): Prefs {
  try {
    return { wrap: false, fontSize: 13, ...JSON.parse(localStorage.getItem("ci-finder:editor") ?? "{}") };
  } catch {
    return { wrap: false, fontSize: 13 };
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem("ci-finder:editor", JSON.stringify(p));
  } catch {
    // ignore: preferences just won't persist
  }
}

/** Guesses the indentation unit used by the file. */
function detectIndent(text: string): string {
  let tabs = 0;
  const widths: Record<number, number> = {};
  for (const line of text.split("\n").slice(0, 500)) {
    if (line.startsWith("\t")) tabs++;
    const m = /^( +)\S/.exec(line);
    if (m) widths[m[1]!.length] = (widths[m[1]!.length] ?? 0) + 1;
  }
  const spaced = Object.values(widths).reduce((a, b) => a + b, 0);
  if (tabs > spaced) return "\t";
  return (widths[4] ?? 0) > (widths[2] ?? 0) * 1.5 && !widths[2] ? "    " : widths[2] || !spaced ? "  " : "    ";
}

/** Replaces a range and keeps the browser's native undo stack working. */
function insertText(ta: HTMLTextAreaElement, text: string, start: number, end: number, selectInserted = false) {
  ta.focus();
  ta.setSelectionRange(start, end);
  const ok = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
  if (!ok) {
    ta.setRangeText(text, start, end, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (selectInserted) ta.setSelectionRange(start, start + text.length);
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function CodeEditor({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const { store, t } = useFinder();
  const uid = useId().replace(/:/g, "");
  const [state, setState] = useState<{ loading: boolean; error?: string }>({ loading: true });
  const [value, setValue] = useState("");
  const [original, setOriginal] = useState("");
  const [meta, setMeta] = useState({ bom: false, crlf: false });
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [find, setFind] = useState<{ open: boolean; replace: boolean; q: string; r: string; matchCase: boolean; index: number }>({
    open: false,
    replace: false,
    q: "",
    r: "",
    matchCase: false,
    index: 0,
  });
  const [gotoOpen, setGotoOpen] = useState(false);
  const lang = langOf(entry.name);
  const isMarkdown = lang === "md";
  const [preview, setPreview] = useState(isMarkdown);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const hlRef = useRef<HTMLPreElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const gotoRef = useRef<HTMLInputElement>(null);

  const dirty = value !== original;
  const deferred = useDeferredValue(value);
  const indent = useMemo(() => detectIndent(original), [original]);

  useEffect(() => {
    let cancelled = false;
    store.client
      .getContent(entry.id)
      .then(({ content, bom }) => {
        if (cancelled) return;
        const crlf = content.includes("\r\n");
        const text = content.replace(/\r\n/g, "\n");
        setValue(text);
        setOriginal(text);
        setMeta({ bom, crlf });
        setState({ loading: false });
        requestAnimationFrame(() => {
          taRef.current?.focus();
          taRef.current?.setSelectionRange(0, 0);
        });
      })
      .catch((e) => !cancelled && setState({ loading: false, error: store.errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [entry.id, store]);

  useEffect(() => savePrefs(prefs), [prefs]);

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const html = useMemo(() => {
    const tokens = tokenize(deferred, deferred.length > HIGHLIGHT_LIMIT ? "plain" : lang);
    return toLines(tokens)
      .map((l) => `<span class="cf-ln">${l || "​"}</span>`)
      .join("");
  }, [deferred, lang]);

  // --- find --------------------------------------------------------------------------------------

  const matches = useMemo(() => {
    if (!find.open || !find.q) return [] as [number, number][];
    const re = new RegExp(escapeRegExp(find.q), find.matchCase ? "g" : "gi");
    const out: [number, number][] = [];
    for (let m = re.exec(deferred); m && out.length < 5000; m = re.exec(deferred)) out.push([m.index, m.index + m[0].length]);
    return out;
  }, [find.open, find.q, find.matchCase, deferred]);
  const current = matches.length ? Math.min(find.index, matches.length - 1) : -1;

  const marksHtml = useMemo(() => {
    if (!matches.length) return "";
    let out = "";
    let last = 0;
    matches.forEach(([a, b], i) => {
      out += escapeHtml(deferred.slice(last, a)) + `<mark class="${i === current ? "is-current" : ""}">${escapeHtml(deferred.slice(a, b))}</mark>`;
      last = b;
    });
    out += escapeHtml(deferred.slice(last));
    return out
      .split("\n")
      .map((l) => `<span class="cf-ln">${l || "​"}</span>`)
      .join("");
  }, [matches, current, deferred]);

  const lineTop = (line: number) => (hlRef.current?.children[line - 1] as HTMLElement | undefined)?.offsetTop ?? 0;

  const revealOffset = useCallback(
    (offset: number) => {
      const line = value.slice(0, offset).split("\n").length;
      const el = scrollRef.current;
      if (!el) return;
      const top = lineTop(line);
      const lh = Math.round(prefs.fontSize * 1.6);
      if (top < el.scrollTop + 8 || top + lh > el.scrollTop + el.clientHeight - 8) el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    },
    [value, prefs.fontSize],
  );

  const goToMatch = (i: number) => {
    if (!matches.length) return;
    const idx = (i + matches.length) % matches.length;
    setFind((f) => ({ ...f, index: idx }));
    const [a, b] = matches[idx]!;
    taRef.current?.setSelectionRange(a, b);
    revealOffset(a);
  };

  const openFind = (replace: boolean) => {
    const ta = taRef.current;
    const selected = ta ? value.slice(ta.selectionStart, ta.selectionEnd) : "";
    setFind((f) => ({ ...f, open: true, replace: replace || f.replace, q: selected && !selected.includes("\n") ? selected : f.q }));
    requestAnimationFrame(() => findRef.current?.select());
  };

  const replaceOne = () => {
    const ta = taRef.current;
    if (!ta || current < 0) return;
    const [a, b] = matches[current]!;
    insertText(ta, find.r, a, b);
    findRef.current?.focus();
  };

  const replaceAll = () => {
    const ta = taRef.current;
    if (!ta || !matches.length) return;
    const re = new RegExp(escapeRegExp(find.q), find.matchCase ? "g" : "gi");
    insertText(
      ta,
      value.replace(re, () => find.r),
      0,
      value.length,
    );
    findRef.current?.focus();
  };

  // --- save / close ------------------------------------------------------------------------------

  const save = async () => {
    if (saving || !entry.write) return;
    setSaving(true);
    try {
      let content = meta.crlf ? value.replace(/\n/g, "\r\n") : value;
      if (meta.bom) content = "﻿" + content;
      const { entry: next } = await store.client.putContent(entry.id, content);
      store.updateEntry(next);
      setOriginal(value);
      store.toast(t("saved"), "success");
    } catch (e) {
      store.fail(e);
    } finally {
      setSaving(false);
    }
  };

  const requestClose = async () => {
    if (find.open) return setFind((f) => ({ ...f, open: false }));
    if (dirty) {
      const ok = await store.confirm({ title: t("unsavedTitle"), body: t("unsavedBody", { name: entry.name }), confirmLabel: t("discard"), danger: true });
      if (!ok) return;
    }
    onClose();
  };

  // --- editing keys ------------------------------------------------------------------------------

  const updateCursor = () => {
    const ta = taRef.current;
    if (!ta) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const line = before.split("\n").length;
    setCursor({ line, col: ta.selectionStart - before.lastIndexOf("\n") });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const { selectionStart: s, selectionEnd: en, value: v } = ta;
    const mod = modKey(e);

    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
      return;
    }
    if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openFind(false);
      return;
    }
    if (mod && e.key.toLowerCase() === "h") {
      e.preventDefault();
      openFind(true);
      return;
    }
    if (mod && e.key.toLowerCase() === "g") {
      e.preventDefault();
      setGotoOpen(true);
      requestAnimationFrame(() => gotoRef.current?.focus());
      return;
    }
    if (mod && e.key === "/") {
      const marker = LINE_COMMENT[lang];
      if (!marker) return;
      e.preventDefault();
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const lineEnd = v.indexOf("\n", en - (en > s && v[en - 1] === "\n" ? 1 : 0));
      const end = lineEnd < 0 ? v.length : lineEnd;
      const lines = v.slice(lineStart, end).split("\n");
      const allCommented = lines.every((l) => !l.trim() || l.trimStart().startsWith(marker));
      const next = lines
        .map((l) => {
          if (!l.trim()) return l;
          if (allCommented) return l.replace(new RegExp(`^(\\s*)${escapeRegExp(marker)} ?`), "$1");
          const ws = /^\s*/.exec(l)![0];
          return `${ws}${marker} ${l.slice(ws.length)}`;
        })
        .join("\n");
      insertText(ta, next, lineStart, end, true);
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const multi = v.slice(s, en).includes("\n");
      if (!multi && !e.shiftKey) {
        insertText(ta, indent, s, en);
        return;
      }
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const block = v.slice(lineStart, en);
      const lines = block.split("\n");
      const next = lines
        .map((l) => {
          if (!e.shiftKey) return l ? indent + l : l;
          if (l.startsWith("\t")) return l.slice(1);
          const spaces = /^ */.exec(l)![0].length;
          return l.slice(Math.min(spaces, indent === "\t" ? 4 : indent.length));
        })
        .join("\n");
      insertText(ta, next, lineStart, en, true);
      return;
    }

    if (e.key === "Enter" && !mod && !e.altKey) {
      e.preventDefault();
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const ws = /^[ \t]*/.exec(v.slice(lineStart, s))![0];
      const prev = v[s - 1];
      const next = v[s];
      // Continue markdown lists.
      if (isMarkdown) {
        const li = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/.exec(v.slice(lineStart, s));
        if (li) {
          if (v.slice(lineStart, s).trim() === li[0].trim()) {
            insertText(ta, "\n", lineStart, s);
            return;
          }
          const n = /\d+/.exec(li[2]!);
          const marker = n ? `${Number(n[0]) + 1}${li[2]!.slice(-1)}` : li[2]!;
          insertText(ta, `\n${li[1]}${marker}${li[3]}${li[4] ? "[ ] " : ""}`, s, en);
          return;
        }
      }
      if (prev && PAIRS[prev] && PAIRS[prev] === next && "([{".includes(prev)) {
        const text = `\n${ws}${indent}\n${ws}`;
        insertText(ta, text, s, en);
        ta.setSelectionRange(s + 1 + ws.length + indent.length, s + 1 + ws.length + indent.length);
        return;
      }
      const extra = prev && "([{:".includes(prev) && (prev !== ":" || lang === "py" || lang === "yaml") ? indent : "";
      insertText(ta, `\n${ws}${extra}`, s, en);
      return;
    }

    if (e.key === "Backspace" && s === en && s > 0) {
      const prev = v[s - 1]!;
      if (PAIRS[prev] && v[s] === PAIRS[prev]) {
        e.preventDefault();
        insertText(ta, "", s - 1, s + 1);
      }
      return;
    }

    if (!mod && !e.altKey && e.key.length === 1) {
      const close = PAIRS[e.key];
      if (close && s !== en) {
        e.preventDefault();
        insertText(ta, e.key + v.slice(s, en) + close, s, en);
        ta.setSelectionRange(s + 1, en + 1);
        return;
      }
      if (")]}\"'`".includes(e.key) && v[s] === e.key && s === en) {
        e.preventDefault();
        ta.setSelectionRange(s + 1, s + 1);
        return;
      }
      if (close && s === en) {
        const next = v[s] ?? "";
        const prev = v[s - 1] ?? "";
        const quote = e.key === close;
        if ((!next || /[\s)\]},;:]/.test(next)) && !(quote && /\w/.test(prev))) {
          e.preventDefault();
          insertText(ta, e.key + close, s, en);
          ta.setSelectionRange(s + 1, s + 1);
        }
      }
    }
  };

  const onScroll = () => {
    const el = scrollRef.current;
    const pv = previewRef.current;
    if (!el || !pv) return;
    const ratio = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
    pv.scrollTop = ratio * (pv.scrollHeight - pv.clientHeight);
  };

  const lineHeight = Math.round(prefs.fontSize * 1.6);
  const lineCount = useMemo(() => deferred.split("\n").length, [deferred]);
  const gutter = `${Math.max(2, String(lineCount).length) + 1.5}ch`;

  return (
    <Modal label={entry.name} onCancel={() => void requestClose()} className="cf-editor-dialog" wide>
      <div className="cf-editor">
        <header className="cf-editor-head">
          <FileIcon entry={entry} size={20} />
          <div className="cf-editor-title">
            <strong>
              {entry.name}
              {dirty && <span className="cf-dirty" aria-label="modified" />}
            </strong>
            <span>{entry.path}</span>
          </div>
          <div className="cf-editor-tools">
            <button
              type="button"
              className={cx("cf-btn is-icon", find.open && "is-on")}
              title={`${t("find")} (${shortcut("Ctrl+F")})`}
              aria-label={t("find")}
              onClick={() => (find.open ? setFind((f) => ({ ...f, open: false })) : openFind(false))}
            >
              <Icon name="search" />
            </button>
            <button
              type="button"
              className={cx("cf-btn is-icon", prefs.wrap && "is-on")}
              title={t("wrap")}
              aria-label={t("wrap")}
              aria-pressed={prefs.wrap}
              onClick={() => setPrefs((p) => ({ ...p, wrap: !p.wrap }))}
            >
              <Icon name="wrap" />
            </button>
            {isMarkdown && (
              <button
                type="button"
                className={cx("cf-btn is-icon", preview && "is-on")}
                title={t("previewPane")}
                aria-label={t("previewPane")}
                aria-pressed={preview}
                onClick={() => setPreview((p) => !p)}
              >
                <Icon name="panelRight" />
              </button>
            )}
            <span className="cf-tool-sep" />
            <button
              type="button"
              className="cf-btn is-primary"
              disabled={!dirty || saving || !entry.write}
              onClick={() => void save()}
              title={shortcut("Ctrl+S")}
            >
              {saving ? <Spinner size={14} /> : <Icon name="save" />}
              <span>{saving ? t("saving") : t("save")}</span>
            </button>
            <button type="button" className="cf-btn is-icon" aria-label={t("close")} title={t("close")} onClick={() => void requestClose()}>
              <Icon name="close" />
            </button>
          </div>
        </header>

        {find.open && (
          <div
            className="cf-findbar"
            onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), setFind((f) => ({ ...f, open: false })), taRef.current?.focus())}
          >
            <div className="cf-findbar-row">
              <button
                type="button"
                className="cf-btn is-icon is-small"
                aria-label={t("replaceWith")}
                aria-expanded={find.replace}
                onClick={() => setFind((f) => ({ ...f, replace: !f.replace }))}
              >
                <Icon name={find.replace ? "chevronDown" : "chevronRight"} size={14} />
              </button>
              <input
                ref={findRef}
                className="cf-input is-small"
                placeholder={t("find")}
                value={find.q}
                spellCheck={false}
                onChange={(e) => setFind((f) => ({ ...f, q: e.target.value, index: 0 }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    goToMatch(current + (e.shiftKey ? -1 : 1));
                  }
                }}
              />
              <button
                type="button"
                className={cx("cf-btn is-small cf-case", find.matchCase && "is-on")}
                title={t("matchCase")}
                aria-pressed={find.matchCase}
                onClick={() => setFind((f) => ({ ...f, matchCase: !f.matchCase }))}
              >
                Aa
              </button>
              <span className="cf-find-count">{find.q ? (matches.length ? t("matchCount", { i: current + 1, n: matches.length }) : t("noMatches")) : ""}</span>
              <button type="button" className="cf-btn is-icon is-small" aria-label="Previous" disabled={!matches.length} onClick={() => goToMatch(current - 1)}>
                <Icon name="chevronUp" size={14} />
              </button>
              <button type="button" className="cf-btn is-icon is-small" aria-label="Next" disabled={!matches.length} onClick={() => goToMatch(current + 1)}>
                <Icon name="chevronDown" size={14} />
              </button>
            </div>
            {find.replace && (
              <div className="cf-findbar-row is-replace">
                <input
                  className="cf-input is-small"
                  placeholder={t("replaceWith")}
                  value={find.r}
                  spellCheck={false}
                  onChange={(e) => setFind((f) => ({ ...f, r: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      replaceOne();
                    }
                  }}
                />
                <button type="button" className="cf-btn is-small" disabled={current < 0 || !entry.write} onClick={replaceOne}>
                  {t("replaceWith")}
                </button>
                <button type="button" className="cf-btn is-small" disabled={!matches.length || !entry.write} onClick={replaceAll}>
                  {t("replaceAll")}
                </button>
              </div>
            )}
          </div>
        )}

        <div className={cx("cf-editor-body", preview && isMarkdown && "is-split")}>
          {state.loading ? (
            <div className="cf-editor-state">
              <Spinner size={20} />
            </div>
          ) : state.error ? (
            <div className="cf-editor-state is-error">
              <Icon name="alert" size={24} />
              <span>{state.error}</span>
            </div>
          ) : (
            <>
              <div
                ref={scrollRef}
                className={cx("cf-code", prefs.wrap ? "is-wrap" : "is-nowrap")}
                onScroll={onScroll}
                style={{ "--cf-code-fs": `${prefs.fontSize}px`, "--cf-code-lh": `${lineHeight}px`, "--cf-gutter": gutter } as React.CSSProperties}
              >
                <style>{`#cf-code-${uid} > .cf-ln:nth-child(${cursor.line}){background:var(--cf-code-active)}#cf-code-${uid} > .cf-ln:nth-child(${cursor.line})::before{color:var(--cf-text)}`}</style>
                <div className="cf-code-grid">
                  {marksHtml && <pre className="cf-code-layer cf-code-marks" aria-hidden="true" dangerouslySetInnerHTML={{ __html: marksHtml }} />}
                  <pre ref={hlRef} id={`cf-code-${uid}`} className="cf-code-layer cf-code-hl" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
                  <textarea
                    ref={taRef}
                    className="cf-code-input"
                    value={value}
                    readOnly={!entry.write}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    wrap={prefs.wrap ? "soft" : "off"}
                    aria-label={entry.name}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={onKeyDown}
                    onKeyUp={updateCursor}
                    onClick={updateCursor}
                    onSelect={updateCursor}
                    onInput={() => requestAnimationFrame(() => taRef.current && revealOffset(taRef.current.selectionStart))}
                  />
                </div>
              </div>
              {preview && isMarkdown && <div ref={previewRef} className="cf-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(deferred) }} />}
            </>
          )}
        </div>

        <footer className="cf-editor-status">
          {gotoOpen ? (
            <form
              className="cf-goto"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(gotoRef.current?.value);
                setGotoOpen(false);
                const ta = taRef.current;
                if (!ta || !Number.isFinite(n) || n < 1) return;
                const lines = value.split("\n");
                const target = Math.min(n, lines.length);
                const offset = lines.slice(0, target - 1).reduce((a, l) => a + l.length + 1, 0);
                ta.focus();
                ta.setSelectionRange(offset, offset);
                revealOffset(offset);
                updateCursor();
              }}
            >
              <label>
                {t("goToLine")}
                <input
                  ref={gotoRef}
                  className="cf-input is-small"
                  type="number"
                  min={1}
                  max={lineCount}
                  onBlur={() => setGotoOpen(false)}
                  onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setGotoOpen(false), taRef.current?.focus())}
                />
              </label>
            </form>
          ) : (
            <button
              type="button"
              className="cf-status-btn"
              onClick={() => (setGotoOpen(true), requestAnimationFrame(() => gotoRef.current?.focus()))}
              title={`${t("goToLine")} (${shortcut("Ctrl+G")})`}
            >
              {t("line", { line: cursor.line, col: cursor.col })}
            </button>
          )}
          <span className="cf-statusbar-spacer" />
          {!entry.write && (
            <span className="cf-status-chip">
              <Icon name="lock" size={12} />
              {t("readOnly")}
            </span>
          )}
          <span>{indent === "\t" ? "Tab" : `Spaces: ${indent.length}`}</span>
          <span>UTF-8{meta.bom ? " BOM" : ""}</span>
          <span>{meta.crlf ? "CRLF" : "LF"}</span>
          <span>{LANG_LABEL[lang]}</span>
          <span className="cf-font-size">
            <button
              type="button"
              className="cf-btn is-icon is-small"
              aria-label={`${t("fontSize")} −`}
              onClick={() => setPrefs((p) => ({ ...p, fontSize: Math.max(10, p.fontSize - 1) }))}
            >
              <Icon name="minus" size={12} />
            </button>
            <span>{prefs.fontSize}px</span>
            <button
              type="button"
              className="cf-btn is-icon is-small"
              aria-label={`${t("fontSize")} +`}
              onClick={() => setPrefs((p) => ({ ...p, fontSize: Math.min(24, p.fontSize + 1) }))}
            >
              <Icon name="plus" size={12} />
            </button>
          </span>
        </footer>
      </div>
    </Modal>
  );
}
