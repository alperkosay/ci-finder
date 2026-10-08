import type { ReactNode, SVGProps } from "react";
import type { Entry } from "@ci-finder/core/client";
import { categoryOf, extOf, type FileCategory } from "./format";

/** UI glyphs drawn on a 16px grid with a 1.5px stroke. */
const PATHS = {
  back: <path d="M10 3.5 5.5 8l4.5 4.5" />,
  forward: <path d="M6 3.5 10.5 8 6 12.5" />,
  chevronDown: <path d="M4 6.25 8 10.25l4-4" />,
  chevronUp: <path d="M4 9.75 8 5.75l4 4" />,
  chevronRight: <path d="M6.25 4 10.25 8l-4 4" />,
  up: <path d="M8 13V3.5M4 7.5l4-4 4 4" />,
  refresh: (
    <>
      <path d="M13.25 8a5.25 5.25 0 1 1-1.7-3.87" />
      <path d="M13.25 2.5v3.25H10" />
    </>
  ),
  folderPlus: (
    <>
      <path d="M1.75 4.25c0-.55.45-1 1-1h3.1l1.5 1.5h5.9c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1z" />
      <path d="M8 7.25v3.5M6.25 9h3.5" />
    </>
  ),
  filePlus: (
    <>
      <path d="M4 1.75h5l3.25 3.25v8.25c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V2.75c0-.55.45-1 1-1z" />
      <path d="M9 1.75V5h3.25M7.6 7.75v4M5.6 9.75h4" />
    </>
  ),
  upload: <path d="M8 10.25V2.5M4.75 5.75 8 2.5l3.25 3.25M2.5 10.5v2c0 .55.45 1 1 1h9c.55 0 1-.45 1-1v-2" />,
  download: <path d="M8 2.5v7.75M4.75 7 8 10.25 11.25 7M2.5 10.5v2c0 .55.45 1 1 1h9c.55 0 1-.45 1-1v-2" />,
  cut: (
    <>
      <circle cx="4" cy="4.5" r="1.9" />
      <circle cx="4" cy="11.5" r="1.9" />
      <path d="M5.6 5.6 13.5 12M5.6 10.4 13.5 4" />
    </>
  ),
  copy: (
    <>
      <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.25" />
      <path d="M10.75 5.25v-2c0-.55-.45-1-1-1h-6.5c-.55 0-1 .45-1 1v6.5c0 .55.45 1 1 1h2" />
    </>
  ),
  paste: (
    <>
      <path d="M5.5 2.75H4.25c-.55 0-1 .45-1 1v9.5c0 .55.45 1 1 1h7.5c.55 0 1-.45 1-1v-9.5c0-.55-.45-1-1-1H10.5" />
      <rect x="5.5" y="1.5" width="5" height="2.5" rx=".75" />
    </>
  ),
  rename: (
    <>
      <path d="M10.6 2.9a1.4 1.4 0 0 1 2 2L5.5 12l-2.75.75.75-2.75z" />
      <path d="M9.25 4.25l2.5 2.5" />
    </>
  ),
  trash: <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4.25 4.25l.6 8.6c.04.52.48.9 1 .9h4.3c.52 0 .96-.38 1-.9l.6-8.6M6.75 7v4.25M9.25 7v4.25" />,
  grid: (
    <>
      <rect x="2.25" y="2.25" width="4.5" height="4.5" rx="1" />
      <rect x="9.25" y="2.25" width="4.5" height="4.5" rx="1" />
      <rect x="2.25" y="9.25" width="4.5" height="4.5" rx="1" />
      <rect x="9.25" y="9.25" width="4.5" height="4.5" rx="1" />
    </>
  ),
  list: (
    <>
      <path d="M6 4h7.5M6 8h7.5M6 12h7.5" />
      <path d="M2.75 4h.01M2.75 8h.01M2.75 12h.01" strokeWidth="2" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25 13.5 13.5" />
    </>
  ),
  panelRight: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M10 2.75v10.5" />
    </>
  ),
  panelLeft: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M6 2.75v10.5" />
    </>
  ),
  more: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth="2.25" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  check: <path d="M3 8.5l3.25 3.25L13 5" />,
  archive: (
    <>
      <rect x="2" y="2.75" width="12" height="3.25" rx=".75" />
      <path d="M3.25 6v6.25c0 .55.45 1 1 1h7.5c.55 0 1-.45 1-1V6M6.5 8.75h3" />
    </>
  ),
  extract: (
    <>
      <rect x="2" y="2.75" width="12" height="3.25" rx=".75" />
      <path d="M3.25 6v6.25c0 .55.45 1 1 1h7.5c.55 0 1-.45 1-1V6M8 11.5V8M6.5 9.5 8 8l1.5 1.5" />
    </>
  ),
  eye: (
    <>
      <path d="M1.5 8s2.4-4.75 6.5-4.75S14.5 8 14.5 8s-2.4 4.75-6.5 4.75S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  code: <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />,
  image: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <circle cx="5.5" cy="6.25" r="1.25" />
      <path d="M2 11.75l3.5-3.5 3 3 2-2 3.5 3.5" />
    </>
  ),
  rotateLeft: (
    <>
      <path d="M3.25 8.75a5 5 0 1 0 1.6-4.1" />
      <path d="M2.75 2.5v3.25H6" />
    </>
  ),
  rotateRight: (
    <>
      <path d="M12.75 8.75a5 5 0 1 1-1.6-4.1" />
      <path d="M13.25 2.5v3.25H10" />
    </>
  ),
  flipH: (
    <>
      <path d="M8 1.75v12.5" strokeDasharray="1.5 1.75" />
      <path d="M5.75 4.5 2.25 11.5h3.5zM10.25 4.5l3.5 7h-3.5z" />
    </>
  ),
  flipV: (
    <>
      <path d="M1.75 8h12.5" strokeDasharray="1.5 1.75" />
      <path d="M4.5 5.75l7-3.5v3.5zM4.5 10.25l7 3.5v-3.5z" />
    </>
  ),
  crop: <path d="M4.5 1.5v9.75c0 .14.11.25.25.25h9.75M1.5 4.5h9.75c.14 0 .25.11.25.25v9.75" />,
  resize: <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />,
  link: (
    <>
      <path d="M6.75 9.25a2.75 2.75 0 0 0 3.9 0l2-2a2.75 2.75 0 0 0-3.9-3.9l-.75.75" />
      <path d="M9.25 6.75a2.75 2.75 0 0 0-3.9 0l-2 2a2.75 2.75 0 0 0 3.9 3.9l.75-.75" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4M8 4.9v.01" />
    </>
  ),
  drive: (
    <>
      <path d="M1.75 9.25 3.6 3.9c.14-.4.52-.65.94-.65h6.92c.42 0 .8.26.94.65l1.85 5.35v3c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1z" />
      <path d="M1.75 9.25h12.5M11.25 11.25h.01" />
    </>
  ),
  cloud: <path d="M4.6 12.75h7.15a2.9 2.9 0 0 0 .35-5.78A4.1 4.1 0 0 0 4.2 6.7a3.05 3.05 0 0 0 .4 6.05z" />,
  duplicate: (
    <>
      <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.25" />
      <path d="M10.75 5.25v-2c0-.55-.45-1-1-1h-6.5c-.55 0-1 .45-1 1v6.5c0 .55.45 1 1 1h2M9.5 7.75v3.5M7.75 9.5h3.5" />
    </>
  ),
  sort: <path d="M4.75 2.5v11M2.25 11l2.5 2.5L7.25 11M11.25 13.5v-11M8.75 5l2.5-2.5L13.75 5" />,
  save: (
    <>
      <path d="M3.25 2.25h7.5l3 3v7.5c0 .55-.45 1-1 1h-9.5c-.55 0-1-.45-1-1v-9.5c0-.55.45-1 1-1z" />
      <path d="M5 2.25v3.25h5V2.25M4.75 13.75v-4h6.5v4" />
    </>
  ),
  wrap: <path d="M2.5 4h11M2.5 8h9a2 2 0 0 1 0 4H8.5M10 10.5 8.5 12l1.5 1.5M2.5 12h3" />,
  plus: <path d="M8 3v10M3 8h10" />,
  minus: <path d="M3 8h10" />,
  lock: (
    <>
      <rect x="3.75" y="7.25" width="8.5" height="6.5" rx="1.25" />
      <path d="M5.75 7.25V5.5a2.25 2.25 0 0 1 4.5 0v1.75" />
    </>
  ),
  external: <path d="M9.5 2.5h4v4M13.5 2.5 8 8M11.5 9.5v3c0 .55-.45 1-1 1h-7c-.55 0-1-.45-1-1v-7c0-.55.45-1 1-1h3" />,
  folder: <path d="M1.75 4.25c0-.55.45-1 1-1h3.1l1.5 1.5h5.9c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1z" />,
  alert: (
    <>
      <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.5 9.75a1 1 0 0 1-.87 1.5H2.5a1 1 0 0 1-.87-1.5z" />
      <path d="M8 6.25v3M8 11.4v.01" />
    </>
  ),
  replace: <path d="M2.5 5.5h8.25M8.5 3l2.5 2.5L8.5 8M13.5 10.5H5.25M7.5 8 5 10.5 7.5 13" />,
  restore: <path d="M5.25 3.75 2.5 6.5l2.75 2.75M2.75 6.5h6.5a3.75 3.75 0 0 1 0 7.5H6.5" />,
  history: (
    <>
      <path d="M2.9 9.4A5.25 5.25 0 1 0 3.6 5" />
      <path d="M2.75 2.25V5.1H5.6M8 5.25V8l2 1.5" />
    </>
  ),
  gauge: (
    <>
      <path d="M2.4 12.25a6 6 0 1 1 11.2 0" />
      <path d="M8 10.25 10.6 6.4M4.6 5.6l.7.6M8 3.75v.9M11.4 5.6l-.7.6" />
      <circle cx="8" cy="10.75" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  sliders: (
    <>
      <path d="M2.5 4.75h6M11.75 4.75h1.75M2.5 11.25h1.75M7.5 11.25h6" />
      <circle cx="10.1" cy="4.75" r="1.6" />
      <circle cx="5.9" cy="11.25" r="1.6" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="cf-icon"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="cf-spinner" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// -------------------------------------------------------------------------------------------------
// File type icons
// -------------------------------------------------------------------------------------------------

const LABELS: Partial<Record<FileCategory, string>> = {
  pdf: "PDF",
  doc: "DOC",
  sheet: "XLS",
  slides: "PPT",
  archive: "ZIP",
  font: "Aa",
};

/** Small glyph drawn in the middle of the page for categories that don't use a text label. */
function Glyph({ category }: { category: FileCategory }) {
  switch (category) {
    case "image":
      return (
        <g fill="currentColor">
          <circle cx="12" cy="19" r="2" />
          <path d="M7.5 30l5.5-6.5 3.5 4 3-3.5 5 6z" />
        </g>
      );
    case "video":
      return <path d="M13 18.5v9.5l8-4.75z" fill="currentColor" />;
    case "audio":
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M14.5 28V18.5l7-1.75v9.5" />
          <circle cx="12.75" cy="28" r="1.9" fill="currentColor" stroke="none" />
          <circle cx="19.75" cy="26.25" r="1.9" fill="currentColor" stroke="none" />
        </g>
      );
    case "code":
      return (
        <path
          d="M13 19.5 9.5 23l3.5 3.5M19 19.5l3.5 3.5-3.5 3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "markdown":
      return (
        <path
          d="M8.5 27v-7.5l3.25 4 3.25-4V27M20.5 19.5V27M18 24.5l2.5 2.5 2.5-2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "text":
    case "doc":
    case "pdf":
    case "other":
      return (
        <path
          d="M9 17.5h14M9 21h14M9 24.5h9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity={category === "other" ? 0.45 : 1}
        />
      );
    case "sheet":
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="8.5" y="15.5" width="15" height="9.5" rx="1" />
          <path d="M8.5 18.75h15M8.5 21.9h15M13.5 15.5V25" />
        </g>
      );
    case "slides":
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
          <rect x="8.5" y="15.5" width="15" height="9.5" rx="1.25" />
          <path d="M14.25 18v4.5l3.75-2.25z" fill="currentColor" stroke="none" />
        </g>
      );
    case "archive":
      return (
        <path
          d="M16 3v2.5M16 7.5V10M16 12v2.5M16 16.5V19M14 19h4v4.5a2 2 0 0 1-4 0z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      );
    default:
      return null;
  }
}

export function FolderIcon({ size = 48, open = false }: { size?: number; open?: boolean }) {
  return (
    <svg className="cf-folder-icon" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <path
        className="cf-folder-back"
        d="M3 9.5A2.5 2.5 0 0 1 5.5 7h9.4a2.5 2.5 0 0 1 1.85.82L19.1 10.5H34.5A2.5 2.5 0 0 1 37 13v19.5a2.5 2.5 0 0 1-2.5 2.5h-29A2.5 2.5 0 0 1 3 32.5z"
      />
      {open ? (
        <path
          className="cf-folder-front"
          d="M5.2 16.6A2.5 2.5 0 0 1 7.6 14.75h29.1a1.6 1.6 0 0 1 1.55 2l-3.9 16.4A2.5 2.5 0 0 1 31.9 35H5.3a1.6 1.6 0 0 1-1.55-1.95z"
        />
      ) : (
        <path className="cf-folder-front" d="M3 15.75a2.5 2.5 0 0 1 2.5-2.5h29a2.5 2.5 0 0 1 2.5 2.5V32.5a2.5 2.5 0 0 1-2.5 2.5h-29A2.5 2.5 0 0 1 3 32.5z" />
      )}
      <path className="cf-folder-shine" d="M5 15.75a1 1 0 0 1 1-1h28a1 1 0 0 1 1 1" fill="none" />
    </svg>
  );
}

/**
 * Document icon: a page with a folded corner, tinted by category, labelled with the extension
 * at large sizes and reduced to a colored band at list sizes.
 */
export function FileIcon({ entry, size = 48 }: { entry: Pick<Entry, "kind" | "name" | "mime">; size?: number }) {
  const category = categoryOf(entry);
  if (category === "folder") return <FolderIcon size={size} />;
  const small = size < 28;
  const ext = extOf(entry.name);
  const label = LABELS[category] ?? ext.slice(0, 4).toUpperCase();

  return (
    <svg className="cf-file-icon" data-category={category} width={size} height={size} viewBox="0 0 32 40" aria-hidden="true" focusable="false">
      <path
        className="cf-page"
        d="M6 1.5h13.4c.4 0 .78.16 1.06.44l7.6 7.6c.28.28.44.66.44 1.06V36a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 36V4A2.5 2.5 0 0 1 6 1.5z"
      />
      <path className="cf-fold" d="M19.5 1.75V8a2 2 0 0 0 2 2h6.25" />
      {small ? (
        <rect className="cf-band" x="3.5" y="27" width="25" height="9" rx="0" />
      ) : (
        <>
          <g className="cf-glyph">
            <Glyph category={category} />
          </g>
          {label && (
            <g>
              <rect className="cf-band" x="1" y="27" width={Math.max(15, label.length * 5.4 + 6)} height="8.5" rx="1.5" />
              <text className="cf-label" x="4" y="33.4">
                {label}
              </text>
            </g>
          )}
        </>
      )}
    </svg>
  );
}
