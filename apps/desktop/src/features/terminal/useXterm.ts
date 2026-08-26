import { useEffect } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { getPlatform } from "../../platform";
import { buildBanner } from "./banner";

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

    // Greet before the shell speaks. Written into the pty stream rather than
    // overlaid, so it lives in the scrollback like a real MOTD, and coloured
    // from the live theme tokens so it follows whatever theme is active.
    const tokens = getComputedStyle(document.documentElement);
    const banner = buildBanner({
      cols: xterm.cols,
      version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.1.0",
      palette: {
        accent: tokens.getPropertyValue("--accent"),
        violet: tokens.getPropertyValue("--violet"),
        magenta: tokens.getPropertyValue("--magenta"),
      },
    });
    xterm.write(banner);

    const platform = getPlatform();

    void (async () => {
      // The same banner goes to the backend, which stores it so the
      // `jky-terminal` shell command can reprint exactly what was shown.
      const id = await platform.pty.spawn(xterm.cols, xterm.rows, banner);
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
