import { CiFinderError } from "./errors";
import type { VolumePath } from "./types";

/**
 * Normalizes a user supplied path to "/a/b". Rejects "..", NUL bytes and backslashes instead of
 * resolving them, so a crafted path can never point outside the volume.
 */
export function normalizePath(input: string): VolumePath {
  if (typeof input !== "string") throw new CiFinderError("BAD_REQUEST", "Path must be a string");
  if (input.includes("\0")) throw new CiFinderError("BAD_REQUEST", "Invalid path");
  const parts: string[] = [];
  for (const part of input.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." || part.includes("\\")) throw new CiFinderError("BAD_REQUEST", "Invalid path");
    parts.push(part);
  }
  return "/" + parts.join("/");
}

export function joinPath(dir: VolumePath, name: string): VolumePath {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

export function dirname(path: VolumePath): VolumePath {
  if (path === "/") return "/";
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

export function basename(path: VolumePath): string {
  if (path === "/") return "";
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Lowercase extension without the dot, "" when there is none. Dot files have no extension. */
export function extname(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function isInside(parent: VolumePath, child: VolumePath): boolean {
  if (parent === "/") return true;
  return child === parent || child.startsWith(parent + "/");
}

const INVALID_CHARS = /[\\/:*?"<>|\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Validates a single file/folder name. Strict enough to be portable across Windows, macOS, Linux and S3. */
export function assertValidName(name: unknown): asserts name is string {
  if (typeof name !== "string") throw new CiFinderError("INVALID_NAME", "Name is required");
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..")
    throw new CiFinderError("INVALID_NAME", "Name is required");
  if (trimmed !== name) throw new CiFinderError("INVALID_NAME", "Name cannot start or end with spaces");
  if (name.length > 255) throw new CiFinderError("INVALID_NAME", "Name is too long");
  if (INVALID_CHARS.test(name)) throw new CiFinderError("INVALID_NAME", 'Name cannot contain \\ / : * ? " < > |');
  if (name.endsWith(".")) throw new CiFinderError("INVALID_NAME", "Name cannot end with a dot");
  if (RESERVED.test(name)) throw new CiFinderError("INVALID_NAME", "This name is reserved by the system");
}

/** "report.pdf" -> "report (2).pdf"; "archive.tar.gz" -> "archive (2).tar.gz". */
export function numberedName(name: string, n: number, isDir: boolean): string {
  if (isDir) return `${name} (${n})`;
  const m = /^(.+?)((?:\.tar)?\.[^.]+)$/i.exec(name);
  if (!m || name.startsWith(".")) return `${name} (${n})`;
  return `${m[1]} (${n})${m[2]}`;
}
