import { useCallback, useEffect, useRef, useState } from "react";
import { getPlatform } from "../../platform";
import { captureToPng } from "./capture";
import "./Camera.css";

/**
 * The camera, beside the bell.
 *
 * The shot is taken when the button is pressed, *before* the choice appears.
 * Offering the choice first would mean photographing the app with a popover
 * open over it, which is never the picture anybody wanted.
 *
 * What is captured is the whole window — rail, status bar, tabs and content —
 * so it reads as a picture of JKY Terminal rather than a crop of one panel.
 */
type Phase =
  | { at: "idle" }
  | { at: "taking" }
  | { at: "ready"; png: Uint8Array<ArrayBuffer> }
  | { at: "done"; message: string }
  | { at: "failed"; message: string };

export function Camera() {
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const open = phase.at === "ready" || phase.at === "done" || phase.at === "failed";

  const close = useCallback((restoreFocus = true) => {
    setPhase({ at: "idle" });
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, close]);

  // A result is worth reading and then getting out of the way on its own.
  useEffect(() => {
    if (phase.at !== "done") return;
    const id = setTimeout(() => close(false), 4000);
    return () => clearTimeout(id);
  }, [phase, close]);

  async function take() {
    setPhase({ at: "taking" });
    // Let the button's pressed state paint before the main thread is busy
    // encoding, or the app looks frozen for the quarter second it takes.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    try {
      const shell = document.querySelector<HTMLElement>(".shell");
      if (!shell) throw new Error("there is nothing on screen to capture");
      setPhase({ at: "ready", png: await captureToPng(shell) });
    } catch (e) {
      setPhase({ at: "failed", message: reason(e) });
    }
  }

  async function keep(how: "save" | "copy") {
    if (phase.at !== "ready") return;
    const png = phase.png;
    try {
      if (how === "copy") {
        await getPlatform().capture.copy(png);
        setPhase({ at: "done", message: "Copied — paste it anywhere" });
      } else {
        const where = await getPlatform().capture.save(png);
        setPhase({ at: "done", message: `Saved to ${where}` });
      }
    } catch (e) {
      setPhase({ at: "failed", message: reason(e) });
    }
  }

  return (
    <div className="shot" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="shot__button"
        aria-label="Take a picture of this window"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-busy={phase.at === "taking" || undefined}
        disabled={phase.at === "taking"}
        onClick={() => void take()}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M4 8.5h3l1.4-2.1a1 1 0 0 1 .84-.45h5.52a1 1 0 0 1 .83.45L17 8.5h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="13.2" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>

      {open && (
        <div className="shot__pop" role="dialog" aria-label="What to do with this picture">
          {phase.at === "ready" && (
            <>
              <p className="shot__head">Picture taken</p>
              <div className="shot__actions">
                <button type="button" className="btn" onClick={() => void keep("save")}>
                  Save
                </button>
                <button type="button" className="btn" onClick={() => void keep("copy")}>
                  Copy
                </button>
              </div>
              <p className="shot__hint">Copying leaves no file behind.</p>
            </>
          )}
          {phase.at === "done" && <p className="shot__result">{phase.message}</p>}
          {phase.at === "failed" && (
            <p className="shot__result shot__result--bad">{phase.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** The message from a thrown value, whatever shape it arrived in. */
function reason(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "the capture did not work";
}
