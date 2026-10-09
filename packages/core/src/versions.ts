import { TheFinderError } from "./errors";
import { sha1Hex } from "./id";
import { dirname, isInside, joinPath, normalizePath } from "./path";
import { mapLimit, readAll } from "./stream";
import type { DriverStat, FileVersion, VolumePath } from "./types";
import type { Volume } from "./volume";
import { walkAll } from "./walk";

/**
 * Version history without a database. Before a file is overwritten its content is copied to
 * `/.tf-versions/<sha1(path)>/<vid>.bin`; a `file.json` next to the copies remembers which file
 * the folder belongs to. The version id carries the time and the reason, so listing a file's history
 * is a single folder listing on local disk and S3 alike. Renames and moves carry the history along.
 */
export const VERSIONS_ROOT = "/.tf-versions";
export const VERSIONS_NAME = ".tf-versions";

const META = "file.json";
const VID = /^([a-z0-9]{6,12})-([a-z0-9]{4,10})-([a-z]{1,16})$/;
const DAY = 86_400_000;

export function isVersionsPath(path: VolumePath): boolean {
  return path === VERSIONS_ROOT || path.startsWith(VERSIONS_ROOT + "/");
}

/** All versions of one file, as found in its history folder. */
export interface VersionGroup {
  dir: VolumePath;
  /** The file this history belongs to; null when `file.json` is missing or unreadable. */
  path: VolumePath | null;
  /** Newest first. */
  versions: FileVersion[];
  size: number;
}

export interface PruneResult {
  removed: number;
  freed: number;
}

export type PruneMode = { mode: "all" } | { mode: "orphaned" } | { mode: "older"; days: number } | { mode: "keep"; keep: number };

const groupDir = async (path: VolumePath) => `${VERSIONS_ROOT}/${await sha1Hex(path)}`;
const blobPath = (dir: VolumePath, vid: string) => joinPath(dir, `${vid}.bin`);

function newVid(reason: string): string {
  const safeReason =
    reason
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .slice(0, 16) || "edit";
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}-${safeReason}`;
}

export function isVersionId(vid: unknown): vid is string {
  return typeof vid === "string" && VID.test(vid);
}

function toVersion(stat: DriverStat): FileVersion | null {
  if (stat.kind !== "file" || !stat.name.endsWith(".bin")) return null;
  const id = stat.name.slice(0, -4);
  const m = VID.exec(id);
  return m ? { id, size: stat.size, createdAt: parseInt(m[1]!, 36), reason: m[3]! } : null;
}

const newestFirst = (a: FileVersion, b: FileVersion) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1);

const ignoreMissing = (e: unknown) => {
  if ((e as { code?: string })?.code !== "ENOENT") throw e;
};

async function readGroupPath(vol: Volume, dir: VolumePath): Promise<VolumePath | null> {
  try {
    const raw = JSON.parse(new TextDecoder().decode(await readAll(await vol.driver.read(joinPath(dir, META)), 64 * 1024))) as { path?: unknown };
    return typeof raw.path === "string" ? normalizePath(raw.path) : null;
  } catch {
    return null;
  }
}

async function writeGroupPath(vol: Volume, dir: VolumePath, path: VolumePath): Promise<void> {
  await vol.driver.write(joinPath(dir, META), JSON.stringify({ v: 1, path }));
}

async function hasVersions(vol: Volume): Promise<boolean> {
  return !!(await vol.driver.stat(VERSIONS_ROOT));
}

/** Versions of the file at `path`, newest first. Works for files that no longer exist too. */
export async function listVersions(vol: Volume, path: VolumePath): Promise<FileVersion[]> {
  const dir = await groupDir(path);
  if (!(await vol.driver.stat(dir))) return [];
  return (await vol.driver.list(dir))
    .map(toVersion)
    .filter((v): v is FileVersion => v !== null)
    .sort(newestFirst);
}

/** Stat of one stored version, or NOT_FOUND. */
export async function versionStat(vol: Volume, path: VolumePath, vid: unknown): Promise<DriverStat> {
  if (!isVersionId(vid)) throw new TheFinderError("BAD_REQUEST", "Invalid version id");
  const stat = await vol.driver.stat(blobPath(await groupDir(path), vid));
  if (!stat || stat.kind !== "file") throw new TheFinderError("NOT_FOUND", "This version no longer exists");
  return stat;
}

/**
 * Keeps the current content of a file as a new version. Empty files are not worth a version.
 * `trim: false` postpones enforcing the limits (used while a version is being restored, so the
 * version being read cannot be trimmed away).
 */
export async function snapshot(vol: Volume, stat: DriverStat, reason: string, options: { trim?: boolean } = {}): Promise<FileVersion | null> {
  if (!vol.versions.enabled || stat.kind !== "file" || stat.size === 0) return null;
  const dir = await groupDir(stat.path);
  await vol.mkdirp(dir);
  if (!(await vol.driver.stat(joinPath(dir, META)))) await writeGroupPath(vol, dir, stat.path);
  const vid = newVid(reason);
  await vol.driver.copy(stat.path, blobPath(dir, vid));
  if (options.trim !== false) await trim(vol, stat.path);
  return toVersion({ ...stat, name: `${vid}.bin` });
}

/** Applies `maxPerFile` and `retentionDays` to one file's history. */
export async function trim(vol: Volume, path: VolumePath): Promise<void> {
  const versions = await listVersions(vol, path);
  const { maxPerFile, retentionDays } = vol.versions;
  const cutoff = retentionDays > 0 ? Date.now() - retentionDays * DAY : -Infinity;
  const drop = versions.filter((v, i) => i >= maxPerFile || v.createdAt < cutoff);
  if (drop.length) await removeVersions(vol, await groupDir(path), drop, drop.length === versions.length);
}

async function removeVersions(vol: Volume, dir: VolumePath, versions: FileVersion[], all: boolean): Promise<PruneResult> {
  if (all) {
    await vol.driver.remove(dir).catch(ignoreMissing);
  } else {
    await mapLimit(versions, 8, (v) => vol.driver.remove(blobPath(dir, v.id)).catch(ignoreMissing));
  }
  return { removed: versions.length, freed: versions.reduce((n, v) => n + v.size, 0) };
}

/**
 * Replaces the file with one of its versions. The content being replaced becomes a version itself,
 * so a restore can always be undone. Recreates the file (and its folder) when it was deleted.
 */
export async function restoreVersion(vol: Volume, path: VolumePath, vid: unknown): Promise<void> {
  const blob = await versionStat(vol, path, vid);
  const current = await vol.driver.stat(path);
  if (current?.kind === "dir") throw new TheFinderError("NOT_A_FILE", "A folder now exists at this location");
  if (current) await snapshot(vol, current, "revert", { trim: false });
  else await vol.mkdirp(dirname(path));
  await vol.driver.write(path, await vol.driver.read(blob.path));
  await trim(vol, path);
}

/** Deletes the given versions of a file, or its whole history when `ids` is omitted. */
export async function deleteVersions(vol: Volume, path: VolumePath, ids?: string[]): Promise<PruneResult> {
  const versions = await listVersions(vol, path);
  const dir = await groupDir(path);
  if (!ids) {
    if (!(await vol.driver.stat(dir))) return { removed: 0, freed: 0 };
    return removeVersions(vol, dir, versions, true);
  }
  const wanted = new Set(ids);
  const drop = versions.filter((v) => wanted.has(v.id));
  return removeVersions(vol, dir, drop, drop.length === versions.length);
}

/** Moves one file's history to its new path, merging with a history already kept there. */
async function moveGroup(vol: Volume, from: VolumePath, to: VolumePath): Promise<void> {
  const src = await groupDir(from);
  const dst = await groupDir(to);
  if (src === dst || !(await vol.driver.stat(src))) return;
  if (await vol.driver.stat(dst)) {
    for (const s of await vol.driver.list(src)) {
      if (toVersion(s)) await vol.driver.move(s.path, joinPath(dst, s.name)).catch(() => {});
    }
    await vol.driver.remove(src).catch(ignoreMissing);
  } else {
    await vol.driver.move(src, dst);
  }
  await writeGroupPath(vol, dst, to);
  await trim(vol, to);
}

/** Keeps histories attached after a rename or move inside the same volume. Best effort. */
export async function relocateVersions(vol: Volume, from: VolumePath, to: VolumePath, kind: DriverStat["kind"]): Promise<void> {
  if (!(await hasVersions(vol))) return;
  try {
    if (kind === "file") return await moveGroup(vol, from, to);
    for (const g of await scanGroups(vol)) {
      if (g.path && g.path !== from && isInside(from, g.path)) await moveGroup(vol, g.path, to + g.path.slice(from.length));
    }
  } catch (e) {
    console.warn("[thefinder] could not move version history:", from, "→", to, (e as Error)?.message ?? e);
  }
}

/** Drops the history of a file (or of every file below a folder) that was deleted for good. */
export async function forgetVersions(vol: Volume, path: VolumePath, kind: DriverStat["kind"]): Promise<void> {
  if (!(await hasVersions(vol))) return;
  try {
    if (kind === "file") {
      await vol.driver.remove(await groupDir(path)).catch(ignoreMissing);
      return;
    }
    for (const g of await scanGroups(vol)) {
      if (g.path && isInside(path, g.path)) await vol.driver.remove(g.dir).catch(ignoreMissing);
    }
  } catch (e) {
    console.warn("[thefinder] could not remove version history:", path, (e as Error)?.message ?? e);
  }
}

/** Groups the stored versions by file. Pass the files of an earlier walk to avoid listing again. */
export async function scanGroups(vol: Volume, walked?: DriverStat[]): Promise<VersionGroup[]> {
  const items = walked ?? (await walkAll(vol.driver, VERSIONS_ROOT)).items;
  const groups = new Map<VolumePath, VersionGroup>();
  for (const s of items) {
    if (s.kind === "dir" && dirname(s.path) === VERSIONS_ROOT && !groups.has(s.path)) {
      groups.set(s.path, { dir: s.path, path: null, versions: [], size: 0 });
      continue;
    }
    const dir = dirname(s.path);
    if (dirname(dir) !== VERSIONS_ROOT) continue;
    let group = groups.get(dir);
    if (!group) groups.set(dir, (group = { dir, path: null, versions: [], size: 0 }));
    const v = toVersion(s);
    if (v) {
      group.versions.push(v);
      group.size += v.size;
    }
  }
  const list = [...groups.values()];
  await mapLimit(list, 8, async (g) => {
    g.versions.sort(newestFirst);
    g.path = await readGroupPath(vol, g.dir);
  });
  return list;
}

/** Whether the file a history belongs to still exists. */
export async function groupExists(vol: Volume, group: VersionGroup): Promise<boolean> {
  if (!group.path) return false;
  const stat = await vol.driver.stat(group.path).catch(() => null);
  return stat?.kind === "file";
}

/** Storage-wide cleanup used by the dashboard. */
export async function pruneVersions(vol: Volume, prune: PruneMode): Promise<PruneResult> {
  if (!(await hasVersions(vol))) return { removed: 0, freed: 0 };
  const groups = await scanGroups(vol);
  if (prune.mode === "all") {
    const result = groups.reduce((r, g) => ({ removed: r.removed + g.versions.length, freed: r.freed + g.size }), { removed: 0, freed: 0 });
    await vol.driver.remove(VERSIONS_ROOT).catch(ignoreMissing);
    return result;
  }
  const results = await mapLimit(groups, 4, async (g): Promise<PruneResult> => {
    if (prune.mode === "orphaned") {
      return (await groupExists(vol, g)) ? { removed: 0, freed: 0 } : removeVersions(vol, g.dir, g.versions, true);
    }
    const drop = prune.mode === "older" ? g.versions.filter((v) => v.createdAt < Date.now() - prune.days * DAY) : g.versions.slice(Math.max(0, prune.keep));
    if (!g.versions.length) return removeVersions(vol, g.dir, [], true); // leftover folder without versions
    return drop.length ? removeVersions(vol, g.dir, drop, drop.length === g.versions.length) : { removed: 0, freed: 0 };
  });
  return results.reduce((r, x) => ({ removed: r.removed + x.removed, freed: r.freed + x.freed }), { removed: 0, freed: 0 });
}
