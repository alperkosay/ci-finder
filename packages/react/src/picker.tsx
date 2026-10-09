import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { createRoot } from "react-dom/client";
import { createClient, type TheFinderClient, type Entry } from "@thefinder/core/client";
import { TheFinder, type TheFinderProps } from "./TheFinder";

/** A chosen file, with a URL ready to put in a form field, an `<img src>` or an editor. */
export interface PickedFile extends Entry {
  /** Public URL when the volume has one ("/uploads/a.png"), otherwise the API's file URL. */
  url: string;
}

export interface FilePickerOptions extends Omit<TheFinderProps, "onSelect" | "onCancel" | "height" | "style" | "persistKey"> {
  /** Return absolute URLs ("https://site/uploads/a.png") instead of server-relative ones. Default: false. */
  absoluteUrls?: boolean;
  /** localStorage key for the picker's view preferences. Default: "thefinder-picker". */
  persistKey?: string | false;
}

/** The URL a picked entry is reachable at. */
export function pickedUrl(entry: Entry, client: TheFinderClient, absolute = false): string {
  const url = entry.url ?? client.fileUrl(entry);
  return absolute && typeof location !== "undefined" ? new URL(url, location.href).toString() : url;
}

/** Parts of the header that keep their own pointer handling (typing, search). */
const NOT_A_HANDLE = "input, textarea, select, [contenteditable], .tf-search";
/** How much of the dialog stays on screen when it is dragged towards an edge. */
const KEEP_VISIBLE = 96;

function isHandle(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return !!el?.closest?.(".tf-header") && !el.closest(NOT_A_HANDLE);
}

/** Below this width the picker is full screen and stays put. */
const SMALL_SCREEN = "(max-width: 640px)";

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/**
 * Lets the user move the picker by its header, like a window. The position lives only as long as
 * the dialog, so every picker opens centered.
 */
function useMovable(ref: RefObject<HTMLDialogElement | null>) {
  // Where the user put the dialog; null while it sits centered.
  const at = useRef<{ left: number; top: number } | null>(null);

  const place = useCallback(
    (to: { left: number; top: number } | null) => {
      const el = ref.current;
      if (!el) return;
      if (!to) {
        at.current = null;
        for (const prop of ["margin", "inset", "transform", "translate"]) el.style.removeProperty(prop);
        return;
      }
      // Keep the header reachable.
      const left = clamp(to.left, KEEP_VISIBLE - el.offsetWidth, window.innerWidth - KEEP_VISIBLE);
      const top = clamp(to.top, 0, window.innerHeight - KEEP_VISIBLE / 2);
      at.current = { left, top };
      // Moved with inset, not a transform: a transform would make the dialog the containing block of
      // the context menus and overlays inside it, which are positioned against the viewport.
      el.style.margin = "0";
      el.style.inset = `${top}px auto auto ${left}px`;
      // A host page may center its dialogs with a transform; here the position alone counts.
      el.style.transform = "none";
      el.style.translate = "none";
    },
    [ref],
  );

  useEffect(() => {
    const onResize = () => {
      if (at.current) place(window.matchMedia(SMALL_SCREEN).matches ? null : at.current);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [place]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDialogElement>) => {
    const el = ref.current;
    if (!el || e.button !== 0 || !e.isPrimary || !isHandle(e.target)) return;
    if (window.matchMedia(SMALL_SCREEN).matches) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = el.getBoundingClientRect();
    const from = at.current ?? { left: rect.left, top: rect.top };
    let moving = false;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moving) {
        // Below this it is a click on the path bar or a button, not a drag.
        if (Math.hypot(dx, dy) < 4) return;
        moving = true;
        el.classList.add("is-moving");
        window.getSelection()?.removeAllRanges();
        try {
          el.setPointerCapture(ev.pointerId);
        } catch {
          // the pointer is already gone; the window listeners still end the drag
        }
      }
      place({ left: from.left + dx, top: from.top + dy });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!moving) return;
      el.classList.remove("is-moving");
      // The drag may have started on a button or the path bar: swallow the click that ends it.
      const swallow = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  /** Double click on the header puts the dialog back in the middle. */
  const onDoubleClick = (e: ReactMouseEvent) => {
    if (isHandle(e.target) && !(e.target as Element).closest("button, .tf-pathbar")) place(null);
  };

  return { onPointerDown, onDoubleClick };
}

function PickerDialog({ onDone, absoluteUrls, ...props }: FilePickerOptions & { onDone: (files: PickedFile[] | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const done = useRef(false);
  const movable = useMovable(ref);
  // One client for the dialog's lifetime (props are fixed while it is open).
  const client = useMemo(
    () => props.client ?? createClient({ endpoint: props.endpoint, headers: props.headers, credentials: props.credentials }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const finish = useCallback(
    (files: PickedFile[] | null) => {
      if (done.current) return;
      done.current = true;
      onDone(files);
    },
    [onDone],
  );

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="tf-picker"
      aria-label={props.selectLabel ?? "theFinder"}
      // Escape is handled below so it can first close menus and dialogs inside the file manager.
      onCancel={(e) => e.preventDefault()}
      onClose={() => finish(null)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) finish(null);
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) finish(null); // backdrop click
      }}
      onPointerDown={movable.onPointerDown}
      onDoubleClick={movable.onDoubleClick}
    >
      <TheFinder
        persistKey="thefinder-picker"
        {...props}
        client={client}
        height="100%"
        onSelect={(entries) => finish(entries.map((e) => ({ ...e, url: pickedUrl(e, client, absoluteUrls) })))}
        onCancel={() => finish(null)}
      />
    </dialog>
  );
}

/**
 * Opens theFinder as a modal file picker and resolves with the chosen files, or `null` when the
 * user cancels. Works outside React too (vanilla JS, Vue, rich text editors):
 *
 * ```ts
 * const files = await openFilePicker({ endpoint: "/api/files", accept: "image/*" });
 * if (files) input.value = files[0].url;
 * ```
 */
export function openFilePicker(options: FilePickerOptions): Promise<PickedFile[] | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.className = "tf-picker-host";
    document.body.appendChild(host);
    const root = createRoot(host);
    const onDone = (files: PickedFile[] | null) => {
      resolve(files);
      // Unmount after the current event finishes; React must not unmount a root mid-render.
      setTimeout(() => {
        root.unmount();
        host.remove();
      });
    };
    root.render(<PickerDialog {...options} onDone={onDone} />);
  });
}

/**
 * React hook around `openFilePicker`.
 *
 * ```tsx
 * const picker = useFilePicker({ endpoint: "/api/files", accept: "image/*" });
 * <button onClick={async () => { const [file] = (await picker.open()) ?? []; if (file) setValue(file.url); }}>
 *   Choose
 * </button>
 * ```
 */
export function useFilePicker(options: FilePickerOptions) {
  const latest = useRef(options);
  latest.current = options;
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(async (overrides?: Partial<FilePickerOptions>) => {
    setOpen(true);
    try {
      return await openFilePicker({ ...latest.current, ...overrides });
    } finally {
      setOpen(false);
    }
  }, []);
  return { open, isOpen };
}
