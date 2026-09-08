import {
  buildSvg,
  canvasPatches,
  captureScale,
  inlineStyles,
  svgDataUrl,
} from "./render";

/**
 * Photograph an element, and everything inside it, as PNG bytes.
 *
 * The steps are in `render.ts`, which holds the parts worth testing on their
 * own. This is the glue that runs them in order, and the only part that needs
 * a real rendering engine — jsdom implements neither SVG image decoding nor
 * canvas drawing, so it is verified against WebKitGTK rather than in unit
 * tests.
 */
export async function captureToPng(root: HTMLElement): Promise<Uint8Array<ArrayBuffer>> {
  const view = root.ownerDocument.defaultView;
  if (!view) throw new Error("the element is not in a rendered document");

  const rect = root.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const scale = captureScale(view.devicePixelRatio);

  // Measure the canvases before cloning: the clone is detached, so its own
  // canvases have no position and no pixels to read.
  const patches = canvasPatches(root);

  const clone = root.cloneNode(true) as HTMLElement;
  inlineStyles(root, clone, view);
  // The clone is laid out at the origin at the captured size, not wherever the
  // original happens to sit in the viewport.
  clone.style.margin = "0";
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;

  const markup = new XMLSerializer().serializeToString(clone);
  const image = await loadImage(svgDataUrl(buildSvg(markup, width, height)));

  const out = root.ownerDocument.createElement("canvas");
  out.width = Math.round(width * scale);
  out.height = Math.round(height * scale);
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("no 2d context for the capture");
  ctx.scale(scale, scale);

  // The app paints its own background; without this a transparent PNG shows
  // whatever it is pasted onto through the gaps.
  ctx.fillStyle = view.getComputedStyle(root).backgroundColor || "#08080c";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  // The canvases, which the serialised markup carried as empty elements.
  for (const patch of patches) {
    try {
      ctx.drawImage(patch.canvas, patch.x, patch.y, patch.width, patch.height);
    } catch {
      /* one unreadable canvas should not lose the whole picture */
    }
  }

  return await toPngBytes(out);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("the capture could not be rendered"));
    image.src = src;
  });
}

async function toPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array<ArrayBuffer>> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!blob) throw new Error("the capture could not be encoded");
  return new Uint8Array(await blob.arrayBuffer());
}
