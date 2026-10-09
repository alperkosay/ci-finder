import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Action } from "../actions";
import { cx, shortcut, useDismiss, useIsoLayoutEffect } from "../context";
import { Icon, type IconName } from "../icons";

export type MenuEntry =
  | { type: "action"; action: Action; checked?: boolean }
  | { type: "submenu"; id: string; label: string; icon?: IconName; items: MenuEntry[] }
  | { type: "separator" }
  | { type: "label"; label: string };

export const sep: MenuEntry = { type: "separator" };
export const item = (action: Action, checked?: boolean): MenuEntry => ({ type: "action", action, checked });

/** Drops disabled actions, leading/trailing/duplicate separators and empty submenus. */
export function compact(entries: MenuEntry[], keepDisabled = false): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of entries) {
    if (e.type === "action" && !e.action.enabled && !keepDisabled) continue;
    if (e.type === "submenu") {
      const items = compact(e.items, keepDisabled);
      if (!items.length) continue;
      out.push({ ...e, items });
      continue;
    }
    if (e.type === "separator" && (!out.length || out[out.length - 1]!.type === "separator")) continue;
    out.push(e);
  }
  while (out.length && out[out.length - 1]!.type === "separator") out.pop();
  return out;
}

interface MenuProps {
  entries: MenuEntry[];
  x: number;
  y: number;
  onClose: () => void;
  /** Align the menu's right edge with x (used by toolbar dropdowns opening near the right side). */
  alignRight?: boolean;
  label?: string;
  autoFocus?: boolean;
  /** Set on submenus: ← returns to the parent menu instead of closing everything. */
  onBack?: () => void;
  /** Set on submenus: when there is no room right of x, the menu ends at flipX instead (left of its parent). */
  flipX?: number;
}

/**
 * Accessible popup menu: arrow keys move, Enter/Space activate, → opens and ← closes submenus,
 * typing a letter jumps to the next item starting with it. Positions itself inside the viewport.
 */
export function Menu({ entries, x, y, onClose, alignRight, label, autoFocus = true, onBack, flipX }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const [active, setActive] = useState(-1);
  const [openSub, setOpenSub] = useState<number | null>(null);
  // A submenu is rendered next to its parent, not inside it: `backdrop-filter` (macOS skin) and the
  // pop-in transform make the parent the containing block of fixed children, which would offset and
  // clip it. Both share one layer, so the parent's outside-click handling still covers the submenu.
  useDismiss(layer, onClose, !onBack);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { innerWidth: vw, innerHeight: vh } = window;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = alignRight ? x - w : x;
    let top = y;
    if (left + w > vw - 8) left = flipX !== undefined && flipX - w >= 8 ? flipX - w : Math.max(8, vw - w - 8);
    if (left < 8) left = 8;
    // No room below: a menu flips above its anchor when it fits there, otherwise (and always for a
    // submenu) it slides up just enough to end at the bottom edge, staying next to the pointer.
    if (top + h > vh - 8) top = Math.max(8, flipX === undefined && y - h >= 8 ? y - h : vh - h - 8);
    setPos({ left, top, ready: true });
  }, [x, y, alignRight, flipX]);

  useEffect(() => {
    if (autoFocus && pos.ready) ref.current?.focus();
  }, [autoFocus, pos.ready]);

  const focusable = entries.map((e, i) => ((e.type === "action" && e.action.enabled) || e.type === "submenu" ? i : -1)).filter((i) => i >= 0);

  const move = (delta: number) => {
    if (!focusable.length) return;
    const cur = focusable.indexOf(active);
    const next = cur < 0 ? (delta > 0 ? 0 : focusable.length - 1) : (cur + delta + focusable.length) % focusable.length;
    setActive(focusable[next]!);
    setOpenSub(null);
  };

  // A long press opens the menu under the finger; the click produced when that finger lifts
  // must not trigger the item underneath. Only clicks whose press started inside the open menu count.
  const armed = useRef(false);

  const activate = (i: number) => {
    const e = entries[i];
    if (!e) return;
    if (e.type === "submenu") return setOpenSub(i);
    if (e.type === "action" && e.action.enabled) {
      onClose();
      e.action.run();
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Home":
        e.preventDefault();
        setActive(focusable[0] ?? -1);
        break;
      case "End":
        e.preventDefault();
        setActive(focusable[focusable.length - 1] ?? -1);
        break;
      case "ArrowRight":
        if (entries[active]?.type === "submenu") {
          e.preventDefault();
          setOpenSub(active);
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        e.stopPropagation();
        if (onBack) onBack();
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (active >= 0) activate(active);
        break;
      case "Tab":
        e.preventDefault();
        onClose();
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          const ch = e.key.toLocaleLowerCase();
          const start = focusable.indexOf(active);
          for (let k = 1; k <= focusable.length; k++) {
            const idx = focusable[(start + k) % focusable.length]!;
            const en = entries[idx]!;
            const text = en.type === "action" ? en.action.label : en.type === "submenu" ? en.label : "";
            if (text.toLocaleLowerCase().startsWith(ch)) {
              setActive(idx);
              break;
            }
          }
        }
    }
  };

  const sub = openSub !== null ? entries[openSub] : undefined;
  return (
    <div ref={layer} className="tf-menu-layer">
      <div
        ref={ref}
        className="tf-menu"
        role="menu"
        aria-label={label}
        tabIndex={-1}
        style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
        onKeyDown={onKeyDown}
        onPointerDown={() => {
          armed.current = true;
        }}
        onContextMenu={(e) => e.preventDefault()}
        aria-activedescendant={active >= 0 ? `tf-mi-${active}` : undefined}
      >
        {entries.map((e, i) => {
          if (e.type === "separator") return <div key={`s${i}`} className="tf-menu-sep" role="separator" />;
          if (e.type === "label")
            return (
              <div key={`l${i}`} className="tf-menu-label">
                {e.label}
              </div>
            );
          if (e.type === "submenu") {
            return (
              <div
                key={e.id}
                id={`tf-mi-${i}`}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSub === i}
                className={cx("tf-menu-item", active === i && "is-active")}
                onPointerEnter={() => {
                  setActive(i);
                  setOpenSub(i);
                }}
                onClick={() => setOpenSub(i)}
              >
                <span className="tf-menu-icon">{e.icon && <Icon name={e.icon} />}</span>
                <span className="tf-menu-text">{e.label}</span>
                <Icon name="chevronRight" size={14} />
              </div>
            );
          }
          const { action, checked } = e;
          return (
            <div
              key={action.id}
              id={`tf-mi-${i}`}
              role={checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={checked}
              aria-disabled={!action.enabled || undefined}
              className={cx("tf-menu-item", active === i && "is-active", action.danger && "is-danger", !action.enabled && "is-disabled")}
              onPointerEnter={() => {
                setActive(action.enabled ? i : -1);
                setOpenSub(null);
              }}
              onClick={() => armed.current && activate(i)}
            >
              <span className="tf-menu-icon">{checked ? <Icon name="check" /> : action.icon && <Icon name={action.icon} />}</span>
              <span className="tf-menu-text">{action.label}</span>
              {action.shortcut && <kbd className="tf-menu-kbd">{shortcut(action.shortcut)}</kbd>}
            </div>
          );
        })}
      </div>
      {sub?.type === "submenu" && (
        <SubMenu
          key={openSub}
          parent={ref}
          index={openSub!}
          entries={sub.items}
          onClose={onClose}
          onBack={() => {
            setOpenSub(null);
            ref.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function SubMenu({
  parent,
  index,
  entries,
  onClose,
  onBack,
}: {
  parent: React.RefObject<HTMLDivElement | null>;
  index: number;
  entries: MenuEntry[];
  onClose: () => void;
  onBack: () => void;
}) {
  const [pos, setPos] = useState<{ x: number; y: number; flipX: number } | null>(null);
  useIsoLayoutEffect(() => {
    const row = parent.current?.querySelector<HTMLElement>(`#tf-mi-${index}`);
    if (!row) return;
    const r = row.getBoundingClientRect();
    setPos({ x: r.right - 4, y: r.top - 5, flipX: r.left + 4 });
  }, [parent, index]);
  if (!pos) return null;
  return <Menu entries={entries} x={pos.x} y={pos.y} flipX={pos.flipX} onClose={onClose} onBack={onBack} />;
}

/** A button that opens a dropdown menu below itself. */
export function MenuButton({
  label,
  icon,
  entries,
  showLabel,
  className,
  alignRight,
}: {
  label: string;
  icon?: IconName;
  entries: MenuEntry[];
  showLabel?: boolean;
  className?: string;
  alignRight?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const open = () => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ x: alignRight ? r.right : r.left, y: r.bottom + 4 });
  };
  const items = compact(entries, true);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={cx("tf-btn", !showLabel && "is-icon", pos && "is-on", className)}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        aria-label={label}
        title={label}
        disabled={!items.some((e) => (e.type === "action" ? e.action.enabled : e.type === "submenu"))}
        onClick={() => (pos ? setPos(null) : open())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            open();
          }
        }}
      >
        {icon && <Icon name={icon} />}
        {showLabel && <span>{label}</span>}
        {showLabel && <Icon name="chevronDown" size={12} className="tf-caret" />}
      </button>
      {pos && (
        <Menu
          entries={items}
          x={pos.x}
          y={pos.y}
          alignRight={alignRight}
          label={label}
          onClose={() => {
            setPos(null);
            ref.current?.focus();
          }}
        />
      )}
    </>
  );
}
