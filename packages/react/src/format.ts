import type { Entry } from "@ci-finder/core/client";
import type { Translate } from "./i18n";

export function formatSize(bytes: number, locale: string): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1000 && unit < units.length - 1);
  const digits = value < 10 ? 1 : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value)} ${units[unit]}`;
}

const dayMs = 86_400_000;

export function formatDate(ms: number, locale: string, t: Translate): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
  if (ms >= startOfToday) return `${t("today")} ${time}`;
  if (ms >= startOfToday - dayMs) return `${t("yesterday")} ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d) + (sameYear ? ` ${time}` : "");
}

export function formatFullDate(ms: number, locale: string): string {
  if (!ms) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(new Date(ms));
}

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function baseOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

export type FileCategory =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "doc"
  | "sheet"
  | "slides"
  | "archive"
  | "code"
  | "text"
  | "markdown"
  | "font"
  | "other";

const CODE = new Set(["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "json", "jsonc", "html", "htm", "css", "scss", "less", "xml", "yml", "yaml", "toml", "sh", "bash", "zsh", "ps1", "bat", "py", "rb", "php", "java", "kt", "go", "rs", "c", "h", "cpp", "hpp", "cs", "swift", "sql", "vue", "svelte", "graphql", "ini", "env", "dockerfile"]);
const TEXT = new Set(["txt", "log", "csv", "tsv", "rtf"]);

export function categoryOf(entry: Pick<Entry, "kind" | "name" | "mime">): FileCategory {
  if (entry.kind === "dir") return "folder";
  const ext = extOf(entry.name);
  const mime = entry.mime;
  if (ext === "svg") return "image";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (["doc", "docx", "odt", "pages"].includes(ext)) return "doc";
  if (["xls", "xlsx", "ods", "numbers"].includes(ext)) return "sheet";
  if (["ppt", "pptx", "odp", "key"].includes(ext)) return "slides";
  if (["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"].includes(ext)) return "archive";
  if (["woff", "woff2", "ttf", "otf"].includes(ext)) return "font";
  if (CODE.has(ext)) return "code";
  if (TEXT.has(ext) || mime.startsWith("text/")) return "text";
  return "other";
}

/** Files the built-in code editor can open. */
export function isEditableText(entry: Pick<Entry, "kind" | "name" | "mime">): boolean {
  const c = categoryOf(entry);
  return c === "code" || c === "text" || c === "markdown" || extOf(entry.name) === "svg";
}

/** Raster images the canvas editor can save back. */
export function isEditableImage(entry: Pick<Entry, "kind" | "name">): boolean {
  return entry.kind === "file" && ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"].includes(extOf(entry.name));
}

export function kindLabel(entry: Pick<Entry, "kind" | "name">, t: Translate): string {
  if (entry.kind === "dir") return t("folder");
  const ext = extOf(entry.name);
  return ext ? t("file", { ext: ext.toUpperCase() }) : t("fileNoExt");
}

/** "Uploads/Belgeler" style location of the folder an item lives (or lived) in. */
export function locationOf(entry: Pick<Entry, "path">, volumeName: string): string {
  const folder = entry.path.slice(0, entry.path.lastIndexOf("/"));
  return folder ? `${volumeName}${folder}` : volumeName;
}

/** Natural, locale-aware name comparison ("file 2" before "file 10"). */
export function createCollator(locale: string) {
  return new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
}
