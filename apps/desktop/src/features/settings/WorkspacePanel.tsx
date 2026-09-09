import { useCallback, useEffect, useRef, useState } from "react";
import { getPlatform } from "../../platform";
import { PanelHead } from "./PanelHead";

/**
 * The one folder the editor may open.
 *
 * This is the only setting in the app that widens what the window can reach,
 * which is why it is a deliberate act rather than a default: until a folder
 * is named here, the editor can touch nothing at all. Everything inside it is
 * readable and writable; nothing outside is, and that is enforced in Rust
 * after the path is resolved — so `../` and a symlink out of the tree are
 * refused by the same rule.
 */
export function WorkspacePanel() {
  const [root, setRoot] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getPlatform()
      .files.workspace()
      .then((where) => {
        setRoot(where);
        setDraft(where ?? "");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  /**
   * Folders that match what has been typed.
   *
   * Asked of the completion engine as though `cd ` had been typed at a
   * prompt, because that is exactly the question — and `cd` is the one
   * command whose arguments are directories and never files. Reusing it means
   * no second way to read the filesystem: the engine already expands `~`,
   * already refuses to run anything, and is already on the pinned command
   * surface with its reasoning written out.
   */
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

  async function apply(dir: string) {
    try {
      const where = await getPlatform().files.openWorkspace(dir);
      setRoot(where);
      setDraft(where ?? "");
      setPicking(false);
      setError(null);
    } catch (e) {
      // Refused in Rust before it is stored, so a folder that cannot be read
      // is rejected while the person is still looking at the field.
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Take a suggestion into the field without leaving it. */
  function take(folder: string) {
    setDraft(folder);
    setFolders([]);
    field.current?.focus();
    // Straight on to what is inside it, so a path is walked rather than typed.
    void look(folder);
  }

  return (
    <section className="panel" aria-labelledby="workspace-heading">
      <PanelHead
        where="Editor"
        headingId="workspace-heading"
        status={root ? "folder open" : "nothing open"}
      />

      <p className="hint">
        The editor can read and write inside one folder and nowhere else.
        Anything resolving outside it is refused — including a <code>..</code>{" "}
        and a symlink pointing out of the tree. Leave it empty and the editor
        can reach nothing at all.
      </p>

      {error && (
        <p className="hint hint--warn" role="alert">
          {error}
        </p>
      )}

      <div className="field">
        <label className="field__label" htmlFor="workspace-dir">
          Folder
        </label>

        <form
          className="field__row picker"
          onSubmit={(e) => {
            e.preventDefault();
            void apply(draft);
          }}
        >
          <input
            id="workspace-dir"
            ref={field}
            className="input"
            value={draft}
            placeholder="Start typing: ~/pro…"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={folders.length > 0}
            aria-controls="workspace-folders"
            aria-autocomplete="list"
            onFocus={() => setPicking(true)}
            // Late enough that a click on a suggestion still lands.
            onBlur={() => setTimeout(() => setFolders([]), 120)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (folders.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((at) => (at + 1) % folders.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((at) => (at - 1 + folders.length) % folders.length);
              } else if (e.key === "Tab" || (e.key === "Enter" && folders[highlight])) {
                // Tab and Enter both take the highlighted folder rather than
                // submitting: a path is usually several steps deep, and
                // opening a parent by accident is the wrong folder entirely.
                e.preventDefault();
                take(folders[highlight]);
              } else if (e.key === "Escape") {
                setFolders([]);
              }
            }}
          />

          <button type="submit" className="btn btn--primary">
            Open
          </button>
          <button
            type="button"
            className="btn"
            disabled={root === null}
            onClick={() => void apply("")}
          >
            Close
          </button>

          {folders.length > 0 && (
            <ul className="picker__list" id="workspace-folders" role="listbox">
              {folders.map((folder, at) => (
                <li
                  key={folder}
                  id={`folder-${at}`}
                  role="option"
                  aria-selected={at === highlight}
                  className="picker__row"
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
        </form>

        <p className="field__note">
          {root ? (
            <>
              Open: <code>{root}</code>
            </>
          ) : (
            "Nothing open. Type a path — suggestions appear as you go, and Tab walks into one."
          )}
        </p>
      </div>
    </section>
  );
}
