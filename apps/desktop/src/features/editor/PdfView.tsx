import { useEffect, useRef, useState } from "react";

/** How many pages to draw. Beyond this is a document, not a preview. */
const MAX_PAGES = 30;

/**
 * How wide each page is drawn, in CSS pixels.
 *
 * Fixed rather than measured: the pane can be any width and re-rendering
 * every page on every drag of a splitter is a lot of work for a picture that
 * is already legible. The page is scaled down by CSS when the pane is
 * narrower, which costs nothing.
 */
const PAGE_WIDTH = 900;

/** Base64 to bytes, which is the form a PDF renderer wants. */
function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * A PDF, drawn.
 *
 * Its pages are turned into pictures rather than handed to the webview. That
 * is not the obvious way round, and it is the only one that works here: the
 * CSP names no host for `frame-src` and widening it to accept `data:` would
 * be a hole in the one rule this app rests on — bought, on Linux, for a
 * webview that does not render PDFs inline anyway.
 *
 * The renderer is fetched the first time somebody opens a PDF. It is far too
 * large to sit in the bundle of everyone who never does.
 */
export function PdfView({ name, data }: { name: string; data: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [pages, setPages] = useState(0);
  const [why, setWhy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const canvases: HTMLCanvasElement[] = [];

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Vite turns this into a same-origin asset, which `worker-src 'self'`
        // already permits — no CSP change, and the main thread stays free
        // while pages are decoded.
        pdfjs.GlobalWorkerOptions.workerSrc = (
          await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
        ).default;

        const doc = await pdfjs.getDocument({
          data: bytesOf(data),
          // pdf.js keeps neither of these in its bundle and fetches them by
          // path while rendering. Without the fonts, a page using any of the
          // fourteen standard ones draws with its text missing — which looks
          // like a broken renderer rather than a missing asset. Copied into
          // `public/` by scripts/pdf-assets.mjs, so they come from this app's
          // own origin: the only one `connect-src 'self'` permits.
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
        }).promise;
        if (!live) return;

        const count = Math.min(doc.numPages, MAX_PAGES);
        setPages(doc.numPages);

        for (let n = 1; n <= count; n += 1) {
          const page = await doc.getPage(n);
          if (!live) return;

          const unscaled = page.getViewport({ scale: 1 });
          // Drawn at the device's own resolution, or the text is soft on
          // every screen that is not exactly 96dpi.
          const scale = (PAGE_WIDTH / unscaled.width) * (window.devicePixelRatio || 1);
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.className = "pdfview__page";
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${PAGE_WIDTH}px`;
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `${name}, page ${n}`);

          const context = canvas.getContext("2d");
          if (!context) continue;

          host.current?.append(canvas);
          canvases.push(canvas);
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          if (!live) return;
        }

        setState("ready");
      } catch (e) {
        if (!live) return;
        setWhy(e instanceof Error ? e.message : String(e));
        setState("failed");
      }
    })();

    return () => {
      live = false;
      // The canvases were appended by hand, so they are removed by hand:
      // React never knew about them and will not tidy them up.
      for (const canvas of canvases) canvas.remove();
    };
  }, [data, name]);

  return (
    <div className="pdfview">
      {state === "loading" && <p className="pdfview__say">Drawing {name}…</p>}
      {state === "failed" && (
        <p className="pdfview__say pdfview__say--bad" role="alert">
          {name} could not be drawn. {why}
        </p>
      )}
      <div className="pdfview__pages" ref={host} />
      {state === "ready" && pages > MAX_PAGES && (
        <p className="pdfview__say">
          Showing the first {MAX_PAGES} of {pages} pages.
        </p>
      )}
    </div>
  );
}
