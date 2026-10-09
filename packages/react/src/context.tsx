import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Entry } from "@thefinder/core/client";
import { getActions } from "./actions";
import type { Translate } from "./i18n";
import type { Density, FinderStore, Skin, State, Theme } from "./store";

export interface EditorProps {
  entry: Entry;
  store: FinderStore;
  onClose: () => void;
}

/** A custom editor registered through the `editors` prop. */
export interface CustomEditor {
  id: string;
  label: string;
  match: (entry: Entry) => boolean;
  render: (props: EditorProps) => ReactNode;
}

export interface FinderContextValue {
  store: FinderStore;
  t: Translate;
  locale: string;
  thumbnails: boolean;
  editors: CustomEditor[];
  pickMode: boolean;
  pickLabel?: string;
  /** In picker mode: whether a file may be chosen (the `accept` prop). */
  canPick: (entry: Entry) => boolean;
  multiple: boolean;
  onPick?: (entries: Entry[]) => void;
  /** Picker mode: dismisses the picker without a choice. */
  onPickCancel?: () => void;
  /** Opens the hidden file input (files or a whole folder). */
  pickUpload: (folder: boolean) => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
  /** Appearance from the props; a choice made in the settings menu (store prefs) wins over it. */
  appearance: { theme: Theme; skin: Skin; density: Density };
  /** Show the settings menu in the header. */
  settings: boolean;
}

/** The appearance in effect: the user's choice from the settings menu, else the props. */
export function useAppearance(): { theme: Theme; skin: Skin; density: Density } {
  const { appearance } = useFinder();
  // The server cannot read the saved choice, and React keeps mismatched attributes after hydration,
  // so the saved choice is applied only once hydration is over (immediately on client-only renders).
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const theme = useStore((s) => s.theme);
  const skin = useStore((s) => s.skin);
  const density = useStore((s) => s.density);
  if (!hydrated) return appearance;
  return { theme: theme ?? appearance.theme, skin: skin ?? appearance.skin, density: density ?? appearance.density };
}

const noopSubscribe = () => () => {};

export const FinderContext = createContext<FinderContextValue | null>(null);

export function useFinder(): FinderContextValue {
  const ctx = useContext(FinderContext);
  if (!ctx) throw new Error("theFinder components must be rendered inside <TheFinder>");
  return ctx;
}

/** Subscribes to a slice of the store. The selector must return a stable value for unchanged state. */
export function useStore<T>(selector: (s: State) => T): T {
  const { store } = useFinder();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

/** All actions, re-evaluated whenever selection, clipboard or the current folder change. */
export function useActions() {
  const ctx = useFinder();
  useStore((s) => s.selection);
  useStore((s) => s.clipboard);
  useStore((s) => s.cwd);
  useStore((s) => s.entries);
  useStore((s) => s.searchResults);
  return getActions({
    store: ctx.store,
    t: ctx.t,
    editors: ctx.editors,
    pickUpload: ctx.pickUpload,
    openDetails: () => ctx.store.set({ detailsOpen: true }),
  });
}

export function useVisible(): string[] {
  const { store } = useFinder();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getVisible(),
    () => store.getVisible(),
  );
}

export const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setSize((prev) => (prev.width === el.clientWidth && prev.height === el.clientHeight ? prev : { width: el.clientWidth, height: el.clientHeight }));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Closes something when clicking outside of `ref` or pressing Escape. */
export function useDismiss(ref: React.RefObject<HTMLElement | null>, onDismiss: () => void, active = true, ignore?: string) {
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  useEffect(() => {
    if (!active) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element;
      if (ignore && target.closest?.(ignore)) return;
      if (ref.current && !ref.current.contains(target)) latest.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        latest.current();
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [ref, active, ignore]);
}

export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Platform-aware modifier: ⌘ on Apple devices, Ctrl elsewhere. */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey);
export const shortcut = (s: string) => (isMac ? s.replace("Ctrl+", "⌘").replace("Shift+", "⇧").replace("Alt+", "⌥") : s);
