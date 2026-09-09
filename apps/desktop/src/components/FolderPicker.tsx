import { useCallback, useEffect, useRef, useState } from "react";
import { getPlatform } from "../platform";
import "./FolderPicker.css";

interface FolderPickerProps {
  /** What the button says. */
  action: string;
  placeholder?: string;
  /** Called with the folder, when one is chosen. */
  onChoose: (dir: string) => void;
  /** Shown under the field when the last attempt was refused. */
  error?: string | null;
  /** Cleared after a successful choose, so the field is ready for the next. */
  clearOnChoose?: boolean;
}

/**
 * A field for naming a folder, that suggests folders as you type.
 *
 * The suggestions come from the completion engine, asked `cd <what was
 * typed>` — `cd` being the one command whose arguments are directories and
 * never files. Reusing it means there is no second way to read the
 * filesystem: `~` expansion, the refusal to run anything, and the reasoning
 * already pinned for `complete_suggest` all come along.
 *
 * Tab walks into a folder rather than submitting it. A path is usually
 * several steps deep, and opening a parent by accident is the wrong folder
 * entirely.
 */
export function FolderPicker({
  action,
  placeholder = "Start typing: ~/pro…",
  onChoose,
  error,
  clearOnChoose = false,
}: FolderPickerProps) {
  const [draft, setDraft] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const field = useRef<HTMLInputElement>(null);

  const look = useCallback(async (typed: string) => {
    const line = `cd ${typed}`;
    try {
      const found = await getPlatform().complete.suggest(line, line.length, "/", 12);
      setFolders(found.items.map((item) => item.value));
      setHighlight(0);
    } catch {
      // A folder field that cannot suggest is still a folder field.
      setFolders([]);
    }
  }, []);

  useEffect(() => {
    if (!picking) return;
    const timer = setTimeout(() => void look(draft), 90);
    return () => clearTimeout(timer);
  }, [draft, picking, look]);

  /** Take a suggestion into the field, and go straight on to what is inside. */
  function take(folder: string) {
    setDraft(folder);
    setFolders([]);
    field.current?.focus();
    void look(folder);
  }

  function choose() {
    if (!draft.trim()) return;
    onChoose(draft.trim());
    if (clearOnChoose) setDraft("");
    setFolders([]);
  }

  return (
    <div className="picker">
      {/*
       * Not a form, deliberately.
       *
       * This is used inside other forms — the workspace editor has three of
       * them — and a form inside a form is invalid HTML that behaves however
       * the browser feels. It made "Add" submit the workspace instead of
       * adding a folder, which a test caught. Enter is handled on the field
       * instead, which is the only thing the form was buying.
       */}
      <div className="picker__row">
        <input
          ref={field}
          className="input"
          value={draft}
          placeholder={placeholder}
          aria-label="Folder"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={folders.length > 0}
          aria-autocomplete="list"
          onFocus={() => setPicking(true)}
          // Late enough that a click on a suggestion still lands.
          onBlur={() => setTimeout(() => setFolders([]), 120)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter with nothing to walk into means "this one".
            if (folders.length === 0) {
              if (e.key === "Enter") {
                e.preventDefault();
                choose();
              }
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((at) => (at + 1) % folders.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((at) => (at - 1 + folders.length) % folders.length);
            } else if (e.key === "Tab" || (e.key === "Enter" && folders[highlight])) {
              e.preventDefault();
              take(folders[highlight]);
            } else if (e.key === "Escape") {
              setFolders([]);
            }
          }}
        />

        <button
          type="button"
          className="btn btn--primary"
          disabled={!draft.trim()}
          onClick={choose}
        >
          {action}
        </button>

        {folders.length > 0 && (
          <ul className="picker__list" role="listbox" aria-label="Folders">
            {folders.map((folder, at) => (
              <li
                key={folder}
                role="option"
                aria-selected={at === highlight}
                className="picker__option"
                data-selected={at === highlight ? "true" : undefined}
                onMouseEnter={() => setHighlight(at)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  take(folder);
                }}
              >
                <span className="picker__glyph" aria-hidden="true">
                  ▸
                </span>
                {folder}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="hint hint--warn" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
