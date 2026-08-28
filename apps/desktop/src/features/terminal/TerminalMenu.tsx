import { useCallback, useEffect, useRef } from "react";

export interface MenuPoint {
  x: number;
  y: number;
}

export interface MenuItem {
  label: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

/**
 * Keep a menu on screen.
 *
 * A right-click near the bottom right corner would otherwise open a menu that
 * runs off the edge, with its last item — usually the destructive one —
 * unreachable.
 */
export function clampToViewport(
  point: MenuPoint,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): MenuPoint {
  const x = Math.max(
    margin,
    Math.min(point.x, viewport.width - size.width - margin),
  );
  const y = Math.max(
    margin,
    Math.min(point.y, viewport.height - size.height - margin),
  );
  return { x, y };
}

/**
 * The right-click menu on a terminal.
 *
 * Copy, paste, clear, search — the four things anyone actually reaches for,
 * and the four the ROADMAP names. Everything else belongs in the palette.
 */
export function TerminalMenu({
  at,
  items,
  onClose,
}: {
  at: MenuPoint;
  items: MenuItem[];
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    function onPointer(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) close();
    }
    // Capture, so a click that opens something else still closes this first.
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("blur", close);
    };
  }, [close]);

  // Measured after mount, because the menu's size depends on its items and
  // there is no way to know it before it exists.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    const { x, y } = clampToViewport(
      at,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
  }, [at]);

  return (
    <div
      ref={root}
      className="tmenu"
      role="menu"
      aria-label="Terminal actions"
      style={{ left: at.x, top: at.y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="tmenu__item"
          disabled={item.disabled}
          onClick={() => {
            item.run();
            close();
          }}
        >
          <span>{item.label}</span>
          {item.hint && <span className="tmenu__hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}
