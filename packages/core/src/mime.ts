import { extname } from "./path";

export const DIRECTORY_MIME = "directory";

const TYPES: Record<string, string> = {
  // images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  psd: "image/vnd.adobe.photoshop",
  // video
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  // audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/opus",
  // documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  epub: "application/epub+zip",
  // archives
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip",
  tgz: "application/gzip",
  bz2: "application/x-bzip2",
  xz: "application/x-xz",
  // text & code
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  scss: "text/x-scss",
  less: "text/x-less",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  jsx: "text/jsx",
  ts: "text/typescript",
  mts: "text/typescript",
  cts: "text/typescript",
  tsx: "text/tsx",
  json: "application/json",
  jsonc: "application/json",
  xml: "application/xml",
  yml: "text/yaml",
  yaml: "text/yaml",
  toml: "text/toml",
  ini: "text/plain",
  env: "text/plain",
  sh: "text/x-shellscript",
  bash: "text/x-shellscript",
  zsh: "text/x-shellscript",
  ps1: "text/plain",
  bat: "text/plain",
  py: "text/x-python",
  rb: "text/x-ruby",
  php: "text/x-php",
  java: "text/x-java",
  kt: "text/x-kotlin",
  go: "text/x-go",
  rs: "text/x-rust",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c++",
  hpp: "text/x-c++",
  cs: "text/x-csharp",
  swift: "text/x-swift",
  sql: "application/sql",
  vue: "text/x-vue",
  svelte: "text/x-svelte",
  graphql: "application/graphql",
  dockerfile: "text/plain",
  // fonts
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  // misc
  wasm: "application/wasm",
  exe: "application/vnd.microsoft.portable-executable",
  dmg: "application/x-apple-diskimage",
  iso: "application/x-iso9660-image",
  apk: "application/vnd.android.package-archive",
};

/** Names without extension that are still text files. */
const TEXT_NAMES = new Set(["dockerfile", "makefile", "license", "readme", "procfile", ".gitignore", ".env", ".npmrc", ".editorconfig", ".prettierrc"]);

export function mimeOf(name: string): string {
  const ext = extname(name);
  const type = ext ? TYPES[ext] : undefined;
  if (type) return type;
  if (TEXT_NAMES.has(name.toLowerCase())) return "text/plain";
  return "application/octet-stream";
}

const ACTIVE = new Set(["text/html", "image/svg+xml", "application/xml", "text/xml", "application/xhtml+xml", "text/javascript"]);

/** Types that can execute script when opened directly in a browser tab. Served with a sandbox CSP. */
export function isActiveContent(mime: string): boolean {
  return ACTIVE.has(mime);
}
