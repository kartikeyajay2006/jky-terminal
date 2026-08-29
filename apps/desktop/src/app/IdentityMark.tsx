import { useCallback, useEffect, useRef, useState } from "react";
import { clampToViewport } from "../features/terminal/TerminalMenu";
import {
  MAX_MESSAGE,
  MAX_NAME,
  initialsFor,
  loadIdentity,
  saveIdentity,
  type Identity,
} from "./identity";

/**
 * The mark at the top of the rail, and the small editor behind it.
 *
 * It was a hard-coded "J". Clicking it now lets you put your own name and a
 * line of your own there — the one place in the app that is about whose copy
 * this is rather than about what it does.
 */
export function IdentityMark() {
  const [identity, setIdentity] = useState<Identity>(loadIdentity);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Identity>(identity);

  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  /**
   * Where the panel sits, in viewport coordinates.
   *
   * It has to be `position: fixed` rather than absolute, because the rail sets
   * `overflow-y: auto` — which makes `overflow-x` compute to `auto` as well,
   * so the rail clips anything wider than itself. Absolutely positioned, the
   * panel was sliced down the middle: the heading, the inputs and the Cancel
   * button all cut off at the rail's edge. Fixed escapes that clip entirely.
   */
  const [at, setAt] = useState({ x: 0, y: 0 });

  const close = useCallback(
    (restoreFocus = true) => {
      setOpen(false);
      if (restoreFocus) trigger.current?.focus();
    },
    [],
  );

  // Measured after mount, because the panel's height depends on its content
  // and there is no way to know it before it exists.
  useEffect(() => {
    if (!open) return;
    const mark = trigger.current?.getBoundingClientRect();
    const box = pop.current?.getBoundingClientRect();
    if (!mark || !box) return;

    setAt(
      clampToViewport(
        { x: mark.left, y: mark.bottom + 10 },
        { width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    firstField.current?.focus();
    firstField.current?.select();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    function onPointer(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) close(false);
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, close]);

  function begin() {
    // The draft starts from what is saved, so opening and closing without
    // typing cannot lose anything.
    setDraft(identity);
    setOpen(true);
  }

  function save() {
    setIdentity(saveIdentity(draft));
    close();
  }

  const initials = initialsFor(identity.name);
  const label = identity.name
    ? `${identity.name}${identity.message ? ` — ${identity.message}` : ""}`
    : "Set your name";

  return (
    <div className="ident" ref={root}>
      <button
        type="button"
        ref={trigger}
        className="ident__mark"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-long={initials.length > 1 || undefined}
        onClick={begin}
      >
        {initials}
      </button>

      {identity.name && <span className="ident__name">{identity.name}</span>}
      {identity.message && <span className="ident__message">{identity.message}</span>}

      {open && (
        <div
          className="ident__pop"
          ref={pop}
          role="dialog"
          aria-label="Your name"
          style={{ left: at.x, top: at.y }}
        >
          <p className="ident__head">Who this copy belongs to</p>

          <label className="ident__field">
            <span>Name</span>
            <input
              ref={firstField}
              className="input"
              maxLength={MAX_NAME}
              placeholder="Kartikeya"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
          </label>

          <label className="ident__field">
            <span>Message</span>
            <input
              className="input"
              maxLength={MAX_MESSAGE}
              placeholder="Building something good"
              value={draft.message}
              onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
          </label>

          <p className="ident__hint">
            Shown under the mark and when you hover it.
          </p>

          <div className="ident__actions">
            <button type="button" className="btn btn--primary" onClick={save}>
              Save
            </button>
            <button type="button" className="btn" onClick={() => close()}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
