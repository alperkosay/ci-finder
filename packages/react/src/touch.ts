import { useRef, type PointerEvent as ReactPointerEvent } from "react";

const LONG_PRESS_MS = 480;
const MOVE_TOLERANCE = 10;

/**
 * Touch helpers: a long press opens the context menu (iOS never fires `contextmenu`), and
 * `wasTouch()` tells click handlers that the last interaction came from a finger so they can use
 * tap semantics (tap = open, or toggle while something is selected) instead of mouse semantics.
 */
export function useTouch(onLongPress: (point: { x: number; y: number }) => void) {
  const state = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean; type: string }>({
    timer: null,
    x: 0,
    y: 0,
    fired: false,
    type: "mouse",
  });

  const cancel = () => {
    if (state.current.timer) clearTimeout(state.current.timer);
    state.current.timer = null;
  };

  return {
    handlers: {
      onPointerDown: (e: ReactPointerEvent) => {
        const s = state.current;
        s.type = e.pointerType;
        s.fired = false;
        if (e.pointerType !== "touch") return;
        s.x = e.clientX;
        s.y = e.clientY;
        cancel();
        s.timer = setTimeout(() => {
          s.timer = null;
          s.fired = true;
          navigator.vibrate?.(8);
          onLongPress({ x: s.x, y: s.y });
        }, LONG_PRESS_MS);
      },
      onPointerMove: (e: ReactPointerEvent) => {
        const s = state.current;
        if (s.timer && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
    },
    /** True when the current click/mousedown was produced by a finger. */
    wasTouch: () => state.current.type === "touch",
    /** True (once) right after a long press, so the click that follows can be ignored. */
    consumeLongPress: () => {
      const fired = state.current.fired;
      state.current.fired = false;
      return fired;
    },
  };
}
