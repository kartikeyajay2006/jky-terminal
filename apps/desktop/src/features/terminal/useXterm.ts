import { useEffect } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { getPlatform } from "../../platform";

/**
 * Owns one xterm instance bound to one pty session.
 *
 * Everything here is lifecycle: create the terminal, attach it to the DOM,
 * spawn a pty, pipe both directions, and tear all of it down exactly once.
 */
export function useXterm(container: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const node = container.current;
    if (!node) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let ptyId: string | null = null;

    const xterm = new Xterm({
      fontFamily:
        getComputedStyle(document.documentElement).getPropertyValue("--font-mono") ||
        "monospace",
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(node);

    // WebGL is the fast path but is unavailable on some drivers and in every
    // headless environment. Falling back to the DOM renderer is correct;
    // failing to start a terminal over it is not.
    try {
      xterm.loadAddon(new WebglAddon());
    } catch {
      /* DOM renderer remains in use */
    }

    try {
      fit.fit();
    } catch {
      /* container not measurable yet; the resize observer will retry */
    }

    const platform = getPlatform();

    void (async () => {
      const id = await platform.pty.spawn(xterm.cols, xterm.rows);
      if (cancelled) {
        // StrictMode unmounted us mid-spawn. Kill it rather than leaking a
        // shell process for the lifetime of the app.
        void platform.pty.kill(id);
        return;
      }
      ptyId = id;
      unlisten = await platform.pty.onData(id, (chunk) => xterm.write(chunk));
      xterm.onData((data) => void platform.pty.write(id, data));
    })();

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        return;
      }
      if (ptyId) void platform.pty.resize(ptyId, xterm.cols, xterm.rows);
    });
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
      unlisten?.();
      if (ptyId) void platform.pty.kill(ptyId);
      xterm.dispose();
    };
  }, [container]);
}
