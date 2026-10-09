import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { CleanupRequest, StorageStats, UsageCategory, VersionedFile } from "@thefinder/core/client";
import { cx, useFinder, useStore } from "../context";
import { formatDate, formatSize, locationOf } from "../format";
import { FileIcon, Icon, Spinner } from "../icons";
import { TRASH_ID } from "../store";
import { Modal } from "./Dialogs";

const CATEGORIES: UsageCategory[] = ["image", "video", "audio", "document", "archive", "code", "other"];
const OLDER_THAN = [7, 30, 90, 365];
const KEEP_LAST = [1, 3, 5, 10];

export function Dashboard() {
  const { store } = useFinder();
  const open = useStore((s) => s.dashboard);
  if (!open) return null;
  return <DashboardView onClose={() => store.set({ dashboard: false })} />;
}

function DashboardView({ onClose }: { onClose: () => void }) {
  const { store, t, locale } = useFinder();
  const volumes = useStore((s) => s.volumes);
  const [volumeId, setVolumeId] = useState(() => store.cwdEntry?.volume || volumes[0]!.id);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [keep, setKeep] = useState(3);
  const controller = useRef<AbortController | null>(null);
  const volume = volumes.find((v) => v.id === volumeId) ?? volumes[0]!;

  const load = useCallback(async () => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setLoading(true);
    setError(null);
    try {
      const next = await store.client.stats(volumeId, c.signal);
      if (!c.signal.aborted) setStats(next);
    } catch (e) {
      if (!c.signal.aborted && (e as Error)?.name !== "AbortError") setError(store.errorMessage(e));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, [store, volumeId]);

  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

  const size = (n: number) => formatSize(n, locale);
  const number = (n: number) => n.toLocaleString(locale);

  const cleanup = async (key: string, request: CleanupRequest, title: string, confirmLabel: string) => {
    const ok = await store.confirm({ title, body: request.target === "cache" ? t("cacheHint") : t("cleanupBody"), confirmLabel, danger: true });
    if (!ok) return;
    setBusy(key);
    try {
      const { removed, freed } = await store.client.cleanup(volumeId, request);
      if (!removed) store.toast(t("nothingToClean"));
      else if (request.target === "cache") store.toast(t("cacheCleared", { size: size(freed) }), "success");
      else store.toast(t("versionsRemoved", { n: removed, size: size(freed) }), "success");
      await load();
    } catch (e) {
      store.fail(e);
    } finally {
      setBusy(null);
    }
  };

  const removeHistory = async (item: VersionedFile) => {
    const ok = await store.confirm({
      title: t("deleteHistoryTitle", { name: item.name, n: item.count }),
      body: t("cleanupBody"),
      confirmLabel: t("deleteHistory"),
      danger: true,
    });
    if (!ok) return;
    setBusy(item.id);
    try {
      const { removed, freed } = await store.client.rmVersions(item.id);
      store.toast(t("versionsRemoved", { n: removed, size: size(freed) }), "success");
      await load();
    } catch (e) {
      store.fail(e);
    } finally {
      setBusy(null);
    }
  };

  const reveal = (entry: { id: string; parent: string | null } & Parameters<typeof store.reveal>[0]) => {
    onClose();
    void store.reveal(entry);
  };

  const scanned = stats ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(stats.scannedAt) : "";

  return (
    <Modal label={t("storage")} onCancel={onClose} className="tf-dash-dialog" wide>
      <div className="tf-editor">
        <header className="tf-editor-head">
          <Icon name="gauge" size={18} />
          <div className="tf-editor-title">
            <strong>{t("storage")}</strong>
            <span>{loading ? t("scanning") : stats ? t("scannedAt", { time: scanned }) : volume.name}</span>
          </div>
          <div className="tf-editor-tools">
            {volumes.length > 1 && (
              <div className="tf-segmented" role="radiogroup" aria-label={t("volume")}>
                {volumes.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="radio"
                    aria-checked={v.id === volumeId}
                    className={cx("tf-btn is-small", v.id === volumeId && "is-on")}
                    onClick={() => setVolumeId(v.id)}
                  >
                    <Icon name={v.kind === "s3" ? "cloud" : "drive"} size={14} />
                    <span>{v.name}</span>
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="tf-btn is-icon" aria-label={t("refresh")} title={t("refresh")} disabled={loading} onClick={() => void load()}>
              {loading ? <Spinner size={14} /> : <Icon name="refresh" />}
            </button>
            <button type="button" className="tf-btn is-icon" aria-label={t("close")} onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
        </header>

        {error ? (
          <div className="tf-editor-state is-error">
            <Icon name="alert" size={24} />
            <span>{error}</span>
            <button type="button" className="tf-btn is-outline" onClick={() => void load()}>
              {t("retry")}
            </button>
          </div>
        ) : !stats ? (
          <div className="tf-editor-state">
            <Spinner size={20} />
            <span>{t("scanning")}</span>
          </div>
        ) : (
          <div className={cx("tf-dash", loading && "is-stale")}>
            {stats.truncated && <p className="tf-dash-note">{t("truncatedNote", { n: number(stats.files + stats.dirs) })}</p>}

            <section className="tf-dash-card tf-dash-overview">
              <div className="tf-dash-hero">
                <span className="tf-dash-big">{size(stats.size + stats.versions.size + stats.trash.size + stats.cache.size)}</span>
                <span className="tf-dash-big-label">{t("used")}</span>
                <span className="tf-dim">{t("filesCount", { files: number(stats.files), dirs: number(stats.dirs) })}</span>
              </div>
              {stats.capacity && <DiskMeter stats={stats} />}
              <div className="tf-dash-tiles">
                <Tile label={t("files")} value={size(stats.size)} detail={number(stats.files)} />
                <Tile label={t("versions")} value={size(stats.versions.size)} detail={t("versionsCount", { n: number(stats.versions.count) })} />
                <Tile label={t("trash")} value={size(stats.trash.size)} detail={t("items", { n: number(stats.trash.count) })} />
                <Tile label={t("cache")} value={size(stats.cache.size)} detail={number(stats.cache.files)} />
              </div>
            </section>

            <section className="tf-dash-card">
              <h3 className="tf-dash-title">{t("fileTypes")}</h3>
              <CategoryChart stats={stats} />
            </section>

            <section className="tf-dash-card">
              <h3 className="tf-dash-title">{t("largestFiles")}</h3>
              {stats.largest.length ? (
                <ul className="tf-dash-files">
                  {stats.largest.map((e) => (
                    <li key={e.id}>
                      <button type="button" className="tf-dash-file" title={t("reveal")} onClick={() => reveal(e)}>
                        <FileIcon entry={e} size={22} />
                        <span className="tf-dash-file-name">
                          <strong>{e.name}</strong>
                          <span>{locationOf(e, volume.name)}</span>
                        </span>
                        <span className="tf-dash-file-size">{size(e.size)}</span>
                        <span className="tf-dash-file-bar" style={{ "--w": `${(e.size / stats.largest[0]!.size) * 100}%` } as React.CSSProperties} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tf-dim">{t("emptyFolder")}</p>
              )}
            </section>

            <section className="tf-dash-card tf-dash-versions">
              <div className="tf-dash-head">
                <h3 className="tf-dash-title">
                  <Icon name="history" size={15} /> {t("versions")}
                </h3>
                <span className="tf-dim">
                  {volume.versions
                    ? `${t("versionsCount", { n: number(stats.versions.count) })} · ${size(stats.versions.size)} · ${t("versionsLimit", { n: volume.versions.maxPerFile })}`
                    : t("versionsOff")}
                </span>
              </div>

              <div className="tf-dash-cleanup">
                <CleanupRow label={t("olderThan")}>
                  <select className="tf-input is-small" aria-label={t("olderThan")} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                    {OLDER_THAN.map((d) => (
                      <option key={d} value={d}>
                        {t("days", { n: d })}
                      </option>
                    ))}
                  </select>
                  <ActionButton
                    busy={busy === "older"}
                    disabled={!stats.versions.count || !!busy}
                    onClick={() => cleanup("older", { target: "versions", mode: "older", days }, t("cleanupOlderTitle", { n: days }), t("delete"))}
                  >
                    {t("delete")}
                  </ActionButton>
                </CleanupRow>
                <CleanupRow label={t("keepLast")}>
                  <select className="tf-input is-small" aria-label={t("keepLast")} value={keep} onChange={(e) => setKeep(Number(e.target.value))}>
                    {KEEP_LAST.map((n) => (
                      <option key={n} value={n}>
                        {t("lastN", { n })}
                      </option>
                    ))}
                  </select>
                  <ActionButton
                    busy={busy === "keep"}
                    disabled={!stats.versions.count || !!busy}
                    onClick={() => cleanup("keep", { target: "versions", mode: "keep", keep }, t("cleanupKeepTitle", { n: keep }), t("apply"))}
                  >
                    {t("apply")}
                  </ActionButton>
                </CleanupRow>
                <CleanupRow label={`${t("orphanedVersions")} (${number(stats.versions.orphaned)})`}>
                  <ActionButton
                    busy={busy === "orphaned"}
                    disabled={!stats.versions.orphaned || !!busy}
                    onClick={() =>
                      cleanup("orphaned", { target: "versions", mode: "orphaned" }, t("cleanupOrphanedTitle", { n: stats.versions.orphaned }), t("delete"))
                    }
                  >
                    {t("delete")}
                  </ActionButton>
                </CleanupRow>
                <CleanupRow label={t("deleteAllVersions")}>
                  <ActionButton
                    danger
                    busy={busy === "all"}
                    disabled={!stats.versions.count || !!busy}
                    onClick={() =>
                      cleanup(
                        "all",
                        { target: "versions", mode: "all" },
                        t("cleanupAllTitle", { n: number(stats.versions.count), volume: volume.name }),
                        t("deleteAllVersions"),
                      )
                    }
                  >
                    {t("deleteAllVersions")}
                  </ActionButton>
                </CleanupRow>
              </div>

              {stats.versions.items.length ? (
                <div className="tf-dash-table" role="table" aria-label={t("versions")}>
                  <div className="tf-dash-row is-head" role="row">
                    <span role="columnheader">{t("name")}</span>
                    <span role="columnheader">{t("versionsCol")}</span>
                    <span role="columnheader">{t("size")}</span>
                    <span role="columnheader">{t("latest")}</span>
                    <span role="columnheader" aria-label={t("more")} />
                  </div>
                  {stats.versions.items.map((item) => (
                    <div key={item.id} className={cx("tf-dash-row", !item.exists && "is-orphan")} role="row">
                      <span role="cell" className="tf-dash-file-name">
                        <strong>
                          {item.name}
                          {!item.exists && <em className="tf-badge">{t("fileDeleted")}</em>}
                        </strong>
                        <span>{locationOf(item, volume.name)}</span>
                      </span>
                      <span role="cell" className="tf-num">
                        {number(item.count)}
                      </span>
                      <span role="cell" className="tf-num">
                        {size(item.size)}
                      </span>
                      <span role="cell">{formatDate(item.latest, locale, t)}</span>
                      <span role="cell" className="tf-dash-row-actions">
                        <button type="button" className="tf-btn is-small" onClick={() => store.openVersions(item)}>
                          <Icon name="history" size={14} />
                          <span>{t("history")}</span>
                        </button>
                        <button
                          type="button"
                          className="tf-btn is-icon is-small is-danger-text"
                          disabled={!!busy}
                          title={t("deleteHistory")}
                          aria-label={t("deleteHistory")}
                          onClick={() => void removeHistory(item)}
                        >
                          {busy === item.id ? <Spinner size={12} /> : <Icon name="trash" size={14} />}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="tf-dim tf-dash-empty">{t("noVersionedFiles")}</p>
              )}
            </section>

            {volume.trash && (
              <section className="tf-dash-card tf-dash-side">
                <h3 className="tf-dash-title">
                  <Icon name="trash" size={15} /> {t("trash")}
                </h3>
                <p className="tf-dash-figure">
                  <b>{size(stats.trash.size)}</b> <span className="tf-dim">· {t("items", { n: number(stats.trash.count) })}</span>
                </p>
                <p className="tf-dim tf-small">{t("trashHint", { days: volume.trash.retentionDays })}</p>
                <div className="tf-dash-buttons">
                  <button
                    type="button"
                    className="tf-btn is-outline"
                    onClick={() => {
                      onClose();
                      void store.open(TRASH_ID);
                    }}
                  >
                    {t("openTrash")}
                  </button>
                  <ActionButton
                    danger
                    disabled={!stats.trash.count || !!busy}
                    busy={false}
                    onClick={async () => {
                      await store.emptyTrash();
                      await load();
                    }}
                  >
                    {t("emptyTrash")}
                  </ActionButton>
                </div>
              </section>
            )}

            <section className="tf-dash-card tf-dash-side">
              <h3 className="tf-dash-title">
                <Icon name="image" size={15} /> {t("cache")}
              </h3>
              <p className="tf-dash-figure">
                <b>{size(stats.cache.size)}</b> <span className="tf-dim">· {number(stats.cache.files)}</span>
              </p>
              <p className="tf-dim tf-small">{t("cacheHint")}</p>
              <div className="tf-dash-buttons">
                <ActionButton
                  busy={busy === "cache"}
                  disabled={!stats.cache.files || !!busy}
                  onClick={() => cleanup("cache", { target: "cache" }, t("cleanupClearCacheTitle", { size: size(stats.cache.size) }), t("clearCache"))}
                >
                  {t("clearCache")}
                </ActionButton>
              </div>
            </section>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="tf-dash-tile">
      <span className="tf-dash-tile-label">{label}</span>
      <span className="tf-dash-tile-value">{value}</span>
      <span className="tf-dim tf-small">{detail}</span>
    </div>
  );
}

function CleanupRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tf-dash-cleanup-row">
      <span>{label}</span>
      <span className="tf-dash-cleanup-controls">{children}</span>
    </div>
  );
}

function ActionButton({
  busy,
  danger,
  disabled,
  onClick,
  children,
}: {
  busy: boolean;
  danger?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={cx("tf-btn is-small is-outline", danger && "is-danger-text")} disabled={disabled} onClick={onClick}>
      {busy && <Spinner size={12} />}
      <span>{children}</span>
    </button>
  );
}

/** Disk usage: this volume, everything else on the disk, free space. */
function DiskMeter({ stats }: { stats: StorageStats }) {
  const { t, locale } = useFinder();
  const { total, free } = stats.capacity!;
  const mine = stats.size + stats.versions.size + stats.trash.size + stats.cache.size;
  const others = Math.max(0, total - free - mine);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / total) * 100))}%`;
  return (
    <div className="tf-dash-disk">
      <div className="tf-meter" role="img" aria-label={t("diskFree", { free: formatSize(free, locale), total: formatSize(total, locale) })}>
        <span className="tf-meter-mine" style={{ width: pct(mine) }} />
        <span className="tf-meter-others" style={{ width: pct(others) }} />
      </div>
      <span className="tf-dim tf-small">{t("diskFree", { free: formatSize(free, locale), total: formatSize(total, locale) })}</span>
    </div>
  );
}

/** One stacked bar (share of bytes) with a legend that doubles as the data table. */
function CategoryChart({ stats }: { stats: StorageStats }) {
  const { t, locale } = useFinder();
  const [hover, setHover] = useState<UsageCategory | null>(null);
  const total = stats.size;
  const rows = CATEGORIES.map((c) => ({ c, ...stats.categories[c] })).filter((r) => r.files > 0);
  const share = (n: number) => (total ? n / total : 0);
  const percent = (n: number) => {
    const format = (v: number, digits: number) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: digits }).format(v);
    if (n > 0 && n < 0.001) return `<${format(0.001, 1)}`;
    return format(n, n > 0 && n < 0.01 ? 1 : 0);
  };
  const active = hover ? rows.find((r) => r.c === hover) : null;

  if (!rows.length) return <p className="tf-dim">{t("emptyFolder")}</p>;
  return (
    <div className={cx("tf-cats", hover && "has-hover")}>
      <div className="tf-cats-caption" aria-live="polite">
        {active ? (
          <>
            <b>{t(`cat.${active.c}`)}</b> · {formatSize(active.size, locale)} · {percent(share(active.size))}
          </>
        ) : (
          formatSize(total, locale)
        )}
      </div>
      <div className="tf-cats-bar" aria-hidden="true">
        {rows.map((r) => (
          <span
            key={r.c}
            className={cx("tf-cats-seg", hover === r.c && "is-hover")}
            data-cat={r.c}
            style={{ flexGrow: Math.max(share(r.size), 0.004) }}
            onPointerEnter={() => setHover(r.c)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
      </div>
      <table className="tf-cats-table">
        <thead>
          <tr>
            <th scope="col">{t("kind")}</th>
            <th scope="col">{t("files")}</th>
            <th scope="col">{t("size")}</th>
            <th scope="col">{t("share")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.c} className={cx(hover === r.c && "is-hover")} onPointerEnter={() => setHover(r.c)} onPointerLeave={() => setHover(null)}>
              <th scope="row">
                <span className="tf-cats-swatch" data-cat={r.c} />
                {t(`cat.${r.c}`)}
              </th>
              <td>{r.files.toLocaleString(locale)}</td>
              <td>{formatSize(r.size, locale)}</td>
              <td>{percent(share(r.size))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
