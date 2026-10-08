import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient, type CiFinderClient, type Entry } from "@ci-finder/core/client";
import { CiFinder, type CiFinderProps } from "./CiFinder";

/** A chosen file, with a URL ready to put in a form field, an `<img src>` or an editor. */
export interface PickedFile extends Entry {
  /** Public URL when the volume has one ("/uploads/a.png"), otherwise the API's file URL. */
  url: string;
}

export interface FilePickerOptions extends Omit<CiFinderProps, "onSelect" | "onCancel" | "height" | "style" | "persistKey"> {
  /** Return absolute URLs ("https://site/uploads/a.png") instead of server-relative ones. Default: false. */
  absoluteUrls?: boolean;
  /** localStorage key for the picker's view preferences. Default: "ci-finder-picker". */
  persistKey?: string | false;
}

/** The URL a picked entry is reachable at. */
export function pickedUrl(entry: Entry, client: CiFinderClient, absolute = false): string {
  const url = entry.url ?? client.fileUrl(entry);
  return absolute && typeof location !== "undefined" ? new URL(url, location.href).toString() : url;
}

function PickerDialog({ onDone, absoluteUrls, ...props }: FilePickerOptions & { onDone: (files: PickedFile[] | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const done = useRef(false);
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
      className="cf-picker"
      aria-label={props.selectLabel ?? "ciFinder"}
      // Escape is handled below so it can first close menus and dialogs inside the file manager.
      onCancel={(e) => e.preventDefault()}
      onClose={() => finish(null)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) finish(null);
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) finish(null); // backdrop click
      }}
    >
      <CiFinder
        persistKey="ci-finder-picker"
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
 * Opens ciFinder as a modal file picker and resolves with the chosen files, or `null` when the
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
    host.className = "cf-picker-host";
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
