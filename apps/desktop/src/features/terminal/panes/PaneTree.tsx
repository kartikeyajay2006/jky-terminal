import { useCallback, useEffect, useRef, useState } from "react";
import { useTabs } from "../../../app/tabStore";
import { Terminal } from "../Terminal";
import { dividers, layout, MAX_RATIO, MIN_RATIO, type Divider, type Pane } from "./tree";
import "./Panes.css";

interface PaneTreeProps {
  tabId: string;
  tree: Pane;
  focused: string;
  /** False while this tab is hidden, so a background tab does not take keys. */
  live: boolean;
}

const pct = (n: number) => `${n * 100}%`;

/**
 * Every terminal in a tab, and the lines between them.
 *
 * Both are drawn as flat, absolutely positioned lists rather than as nested
 * boxes. That is not a shortcut — it is the only arrangement in which a
 * terminal keeps its place in the React tree when the layout changes around
 * it. Nested boxes would move a `<Terminal>` on every split, React would
 * unmount it, and unmounting disposes the xterm display and kills the shell.
 */
export function PaneTree({ tabId, tree, focused, live }: PaneTreeProps) {
  const rects = layout(tree);
  const lines = dividers(tree);
  const focusPane = useTabs((s) => s.focusPane);
  const splitPane = useTabs((s) => s.splitPane);
  const closePane = useTabs((s) => s.closePane);
  const single = rects.length === 1;

  return (
    <div className="panes">
      {rects.map((rect) => (
        <div
          key={rect.id}
          className="panes__pane"
          data-pane-id={rect.id}
          data-focused={live && rect.id === focused ? "true" : undefined}
          style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
          // Focus follows the click, so the pane you typed into is the pane
          // you clicked. Capture, because xterm stops the event on its way up.
          onMouseDownCapture={() => focusPane(tabId, rect.id)}
        >
          <Terminal
            paneId={rect.id}
            focused={live && rect.id === focused}
            // A lone pane has no border to speak of and no sibling to be
            // confused with, so it goes without the focus ring the split
            // case needs.
            showFocusRing={!single}
            onSplit={(dir) => splitPane(tabId, rect.id, dir)}
            onClosePane={() => closePane(tabId, rect.id)}
          />
        </div>
      ))}

      {lines.map((line) => (
        <Splitter key={line.id} tabId={tabId} line={line} />
      ))}
    </div>
  );
}

/**
 * One draggable line.
 *
 * The drag is tracked on the window rather than the element: a pointer that
 * outruns a two-pixel target — and it will — must keep dragging rather than
 * drop the divider wherever the cursor happened to leave.
 */
function Splitter({ tabId, line }: { tabId: string; line: Divider }) {
  const resizeSplit = useTabs((s) => s.resizeSplit);
  const [dragging, setDragging] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const row = line.dir === "row";

  const ratioAt = useCallback(
    (clientX: number, clientY: number): number | null => {
      const box = surface.current?.parentElement?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return null;
      const within = row
        ? (clientX - box.left) / box.width - line.box.x
        : (clientY - box.top) / box.height - line.box.y;
      const span = row ? line.box.w : line.box.h;
      return within / span;
    },
    [row, line.box.x, line.box.y, line.box.w, line.box.h],
  );

  useEffect(() => {
    if (!dragging) return;

    function onMove(e: PointerEvent) {
      const ratio = ratioAt(e.clientX, e.clientY);
      if (ratio !== null) resizeSplit(tabId, line.id, ratio);
    }
    function onUp() {
      setDragging(false);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, ratioAt, resizeSplit, tabId, line.id]);

  const at = row
    ? line.box.x + line.box.w * line.ratio
    : line.box.y + line.box.h * line.ratio;

  const step = (delta: number) => resizeSplit(tabId, line.id, line.ratio + delta);

  return (
    <div
      ref={surface}
      className="panes__splitter"
      data-dir={line.dir}
      data-dragging={dragging ? "true" : undefined}
      // A separator is focusable and takes arrow keys, so a split can be
      // balanced without a mouse — the whole point of a keyboard-first
      // terminal is that nothing needs one.
      role="separator"
      tabIndex={0}
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-label={row ? "Resize panes left and right" : "Resize panes up and down"}
      aria-valuenow={Math.round(line.ratio * 100)}
      aria-valuemin={Math.round(MIN_RATIO * 100)}
      aria-valuemax={Math.round(MAX_RATIO * 100)}
      style={
        row
          ? { left: pct(at), top: pct(line.box.y), height: pct(line.box.h) }
          : { top: pct(at), left: pct(line.box.x), width: pct(line.box.w) }
      }
      onPointerDown={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDoubleClick={() => resizeSplit(tabId, line.id, 0.5)}
      onKeyDown={(e) => {
        const back = row ? "ArrowLeft" : "ArrowUp";
        const forward = row ? "ArrowRight" : "ArrowDown";
        if (e.key === back) {
          e.preventDefault();
          step(-0.02);
        } else if (e.key === forward) {
          e.preventDefault();
          step(0.02);
        } else if (e.key === "Home") {
          e.preventDefault();
          resizeSplit(tabId, line.id, 0.5);
        }
      }}
    />
  );
}
