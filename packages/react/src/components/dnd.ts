import type { DragEvent } from "react";

export const DND_TYPE = "application/x-ci-finder";

type AnyDrag = DragEvent | globalThis.DragEvent;

export function isInternalDrag(e: AnyDrag): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(DND_TYPE);
}

export function isFileDrag(e: AnyDrag): boolean {
  return !!e.dataTransfer && !isInternalDrag(e) && Array.from(e.dataTransfer.types).includes("Files");
}

export function readDragIds(e: AnyDrag): string[] {
  try {
    const raw = e.dataTransfer?.getData(DND_TYPE);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Starts an internal drag with a compact "stack" preview showing the item count. */
export function startDrag(e: DragEvent, ids: string[], label: string, root: HTMLElement | null) {
  e.dataTransfer.setData(DND_TYPE, JSON.stringify(ids));
  e.dataTransfer.setData("text/plain", label);
  e.dataTransfer.effectAllowed = "copyMove";
  if (!root) return;
  const ghost = document.createElement("div");
  ghost.className = "cf-drag-ghost";
  const name = document.createElement("span");
  name.textContent = label;
  ghost.appendChild(name);
  if (ids.length > 1) {
    const badge = document.createElement("b");
    badge.textContent = String(ids.length);
    ghost.appendChild(badge);
  }
  root.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 12, 12);
  setTimeout(() => ghost.remove(), 0);
}

export interface DroppedFile {
  file: File;
  /** Folder path relative to the drop target ("photos/2024"), empty for loose files. */
  relativePath?: string;
}

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: FsEntry[]) => void, err: (e: unknown) => void) => void };
}

async function walk(entry: FsEntry, dir: string, out: DroppedFile[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((ok, err) => entry.file!(ok, err));
    out.push({ file, relativePath: dir });
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    // readEntries returns results in batches (100 in Chrome) until an empty batch.
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok, err) => reader.readEntries(ok, err));
      if (!batch.length) break;
      for (const child of batch) await walk(child, path, out);
    }
  }
}

/** Reads dropped files, recursing into dropped folders when the browser supports it. */
export async function readDroppedFiles(dt: DataTransfer): Promise<DroppedFile[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .filter((i) => i.kind === "file")
    .map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.() ?? null);
  if (entries.length && entries.every(Boolean)) {
    const out: DroppedFile[] = [];
    for (const entry of entries) await walk(entry!, "", out);
    return out;
  }
  return Array.from(dt.files).map((file) => ({ file }));
}

/** Files picked with <input webkitdirectory> carry their folder in webkitRelativePath. */
export function filesFromInput(list: FileList): DroppedFile[] {
  return Array.from(list).map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    return { file, relativePath: dir };
  });
}
