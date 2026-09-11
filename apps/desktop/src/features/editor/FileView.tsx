import type { FilePreview } from "../../platform";
import "./FileView.css";

/** Bytes, in the roughest unit that is still true. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["kB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const WHAT: Record<FilePreview["kind"], string> = {
  image: "Image",
  pdf: "PDF",
  binary: "Binary file",
};

/**
 * A file the editor can show but not change.
 *
 * It opens the way a source file opens — a tab, a name, the main pane — and
 * says plainly that nothing about it can be edited. Refusing to open it at
 * all left somebody who clicked a `.jpeg` looking at an error and an empty
 * pane, which is the worst of both: no picture, and no explanation either.
 */
export function FileView({ path, preview }: { path: string; preview: FilePreview }) {
  const name = path.split("/").pop() ?? path;

  return (
    <div className="fileview">
      <header className="fileview__bar">
        <span className="fileview__what">{WHAT[preview.kind]}</span>
        <span className="fileview__name" title={path}>
          {name}
        </span>
        {preview.size > 0 && <span className="fileview__size">{sizeText(preview.size)}</span>}
        {/* The whole point of the pane. Said once, near the name, rather than
            left for somebody to discover by typing into it. */}
        <span className="fileview__ro">read-only — this cannot be edited here</span>
      </header>

      <div className="fileview__body">
        {preview.data ? (
          <img
            className="fileview__image"
            src={`data:${preview.mime};base64,${preview.data}`}
            alt={name}
          />
        ) : (
          <div className="fileview__card">
            <p className="fileview__glyph" aria-hidden="true">
              {preview.kind === "pdf" ? "▤" : preview.kind === "image" ? "▨" : "▦"}
            </p>
            <p className="fileview__title">{name}</p>
            <p className="fileview__note">
              {preview.note ?? "There is no useful way to show this."}
            </p>
            <p className="fileview__meta">
              {WHAT[preview.kind]}
              {preview.size > 0 && ` · ${sizeText(preview.size)}`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
