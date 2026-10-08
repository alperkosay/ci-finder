import { CiFinderError } from "./errors";
import { encodeId } from "./id";
import { DIRECTORY_MIME, mimeOf } from "./mime";
import { dirname, joinPath, normalizePath } from "./path";
import { mapLimit, readAll } from "./stream";
import type { DriverStat, Entry, EntryKind, VolumePath } from "./types";
import type { Volume } from "./volume";

/**
 * Trash without a database: every deleted item is moved to `/.cf-trash/<tid>/<name>` inside its own
 * volume, next to a `/.cf-trash/<tid>.json` sidecar describing where it came from. Works the same on
 * local disk and S3, survives restarts and needs no external state.
 */
export const TRASH_ROOT = "/.cf-trash";
export const TRASH_NAME = ".cf-trash";

const TID = /^[a-z0-9]{6,12}-[a-z0-9]{6,10}$/;
const DAY = 86_400_000;

interface TrashMeta {
  v: 1;
  name: string;
  originalPath: VolumePath;
  deletedAt: number;
  kind: EntryKind;
  size: number;
}

export function isTrashPath(path: VolumePath): boolean {
  return path === TRASH_ROOT || path.startsWith(TRASH_ROOT + "/");
}

/** Internal folders (trash, thumbnail cache, version history) that are never reachable through normal commands. */
export function isReservedPath(path: VolumePath): boolean {
  return [TRASH_ROOT, "/.cf-thumbs", "/.cf-versions"].some((root) => path === root || path.startsWith(root + "/"));
}

export const RESERVED_NAMES = new Set([".cf-trash", ".cf-thumbs", ".cf-versions"]);

const metaPath = (tid: string) => `${TRASH_ROOT}/${tid}.json`;
const itemDir = (tid: string) => `${TRASH_ROOT}/${tid}`;

function newTid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
}

/** Extracts the trash id from a trash entry path ("/.cf-trash/<tid>"). */
export function parseTrashPath(path: VolumePath): string | null {
  const tid = path.startsWith(TRASH_ROOT + "/") ? path.slice(TRASH_ROOT.length + 1) : "";
  return TID.test(tid) ? tid : null;
}

/** Where a trashed item came from; null when its sidecar is gone. */
export async function trashOrigin(vol: Volume, tid: string): Promise<{ path: VolumePath; kind: EntryKind } | null> {
  const meta = await readMeta(vol, tid);
  return meta ? { path: meta.originalPath, kind: meta.kind } : null;
}

async function readMeta(vol: Volume, tid: string): Promise<TrashMeta | null> {
  try {
    const raw = JSON.parse(new TextDecoder().decode(await readAll(await vol.driver.read(metaPath(tid)), 64 * 1024))) as Partial<TrashMeta>;
    if (typeof raw.name !== "string" || typeof raw.originalPath !== "string" || typeof raw.deletedAt !== "number") return null;
    const originalPath = normalizePath(raw.originalPath);
    if (originalPath === "/" || isTrashPath(originalPath)) return null;
    return { v: 1, name: raw.name, originalPath, deletedAt: raw.deletedAt, kind: raw.kind === "dir" ? "dir" : "file", size: Number(raw.size) || 0 };
  } catch {
    return null;
  }
}

function toEntry(vol: Volume, tid: string, meta: TrashMeta): Entry {
  return {
    id: encodeId(vol.id, itemDir(tid)),
    parent: null,
    volume: vol.id,
    name: meta.name,
    path: meta.originalPath,
    kind: meta.kind,
    size: meta.kind === "dir" ? 0 : meta.size,
    mtime: meta.deletedAt,
    mime: meta.kind === "dir" ? DIRECTORY_MIME : mimeOf(meta.name),
    read: true,
    write: vol.can("delete", meta.originalPath),
    trash: { id: tid, originalPath: meta.originalPath, deletedAt: meta.deletedAt },
  };
}

/** Moves an item into the trash. The sidecar is written first, so a crash never loses track of an item. */
export async function moveToTrash(vol: Volume, stat: DriverStat): Promise<Entry> {
  const tid = newTid();
  const meta: TrashMeta = { v: 1, name: stat.name, originalPath: stat.path, deletedAt: Date.now(), kind: stat.kind, size: stat.size };
  await vol.mkdirp(TRASH_ROOT);
  await vol.driver.write(metaPath(tid), JSON.stringify(meta));
  try {
    await vol.driver.mkdir(itemDir(tid));
    await vol.driver.move(stat.path, joinPath(itemDir(tid), stat.name));
  } catch (e) {
    await vol.driver.remove(itemDir(tid)).catch(() => {});
    await vol.driver.remove(metaPath(tid)).catch(() => {});
    throw e;
  }
  return toEntry(vol, tid, meta);
}

/** Lists trashed items, permanently removing the ones older than the retention period. */
export async function listTrash(vol: Volume): Promise<Entry[]> {
  if (!(await vol.driver.stat(TRASH_ROOT))) return [];
  const children = await vol.driver.list(TRASH_ROOT);
  const dirs = new Set(children.filter((c) => c.kind === "dir").map((c) => c.name));
  const tids = children
    .filter((c) => c.kind === "file" && c.name.endsWith(".json"))
    .map((c) => c.name.slice(0, -5))
    .filter((t) => TID.test(t));
  const expiry = vol.trash.retentionDays > 0 ? Date.now() - vol.trash.retentionDays * DAY : -Infinity;

  const entries = await mapLimit(tids, 8, async (tid) => {
    const meta = await readMeta(vol, tid);
    if (!meta || !dirs.has(tid)) {
      // Orphaned sidecar (e.g. the item was removed by hand): forget it.
      if (!dirs.has(tid)) await vol.driver.remove(metaPath(tid)).catch(() => {});
      return null;
    }
    if (meta.deletedAt < expiry) {
      await purgeOne(vol, tid);
      return null;
    }
    return toEntry(vol, tid, meta);
  });
  return entries.filter((e): e is Entry => e !== null).sort((a, b) => b.mtime - a.mtime);
}

export async function countTrash(vol: Volume): Promise<number> {
  if (!(await vol.driver.stat(TRASH_ROOT))) return 0;
  return (await vol.driver.list(TRASH_ROOT)).filter((c) => c.kind === "file" && c.name.endsWith(".json")).length;
}

/** Puts an item back where it was. Missing folders are recreated; name clashes get a numbered name. */
export async function restoreFromTrash(vol: Volume, tid: string): Promise<Entry> {
  const meta = await readMeta(vol, tid);
  const source = joinPath(itemDir(tid), meta?.name ?? "");
  if (!meta || !(await vol.driver.stat(source))) throw new CiFinderError("NOT_FOUND", "Item is no longer in the trash");
  const dir = dirname(meta.originalPath);
  vol.assertCan("write", dir);
  await vol.mkdirp(dir);
  const name = await vol.uniqueName(dir, meta.name, meta.kind === "dir");
  const target = joinPath(dir, name);
  await vol.driver.move(source, target);
  await purgeOne(vol, tid);
  const stat = await vol.driver.stat(target);
  if (!stat) throw new CiFinderError("STORAGE", "Restored item could not be found");
  return vol.entry(stat);
}

export async function purgeOne(vol: Volume, tid: string): Promise<void> {
  await vol.driver.remove(itemDir(tid)).catch((e) => {
    if ((e as { code?: string })?.code !== "ENOENT") throw e;
  });
  await vol.driver.remove(metaPath(tid)).catch(() => {});
}

export async function emptyTrash(vol: Volume): Promise<void> {
  if (await vol.driver.stat(TRASH_ROOT)) await vol.driver.remove(TRASH_ROOT);
}
