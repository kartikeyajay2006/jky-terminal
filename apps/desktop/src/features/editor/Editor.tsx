import { useCallback, useEffect, useState } from "react";
import { getPlatform, type FileEntry, type Folder } from "../../platform";
import { CodeMirror } from "./CodeMirror";
import { FolderPicker } from "../../components/FolderPicker";
import { UnsavedDialog, type Answer } from "./UnsavedDialog";
import "./Editor.css";

/** One file open in the editor. */
interface OpenFile {
  /** Which folder it came from. Two folders may hold the same relative path. */
  root: string;
  path: string;
  /** As it was read, so "changed" is a comparison rather than a guess. */
  saved: string;
  text: string;
}

/** A file's identity across folders. */
const keyOf = (root: string, path: string) => `${root} ${path}`;
const idOf = (file: OpenFile) => keyOf(file.root, file.path);

/**
 * Files, inside the folders you opened and nowhere else.
 *
 * Folders are opened here rather than in Settings, because choosing what to
 * work on is the work — sending someone to a settings screen and back to see
 * a file is a round trip for something that is one field.
 *
 * Several folders can be open at once and several files from any of them.
 * Closing a file with changes asks; it never discards silently, and it never
 * refuses to close either, because a file you cannot close is worse than one
 * you lost.
 */
export function Editor() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tree, setTree] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  /** The file being closed, waiting on an answer. */
  const [asking, setAsking] = useState<OpenFile | null>(null);
  const [busy, setBusy] = useState(true);

  const loadDir = useCallback(async (root: string, path: string) => {
    try {
      const entries = await getPlatform().files.list(root, path);
      setTree((t) => ({ ...t, [keyOf(root, path)]: entries }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      const found = await getPlatform().files.folders();
      setFolders(found);
      for (const folder of found) {
        if (folder.available) await loadDir(folder.root, "");
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [loadDir]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  async function openFolder(dir: string) {
    try {
      setFolders(await getPlatform().files.openFolder(dir));
      setOpenError(null);
      await loadDir(dir, "");
    } catch (e) {
      // Refused in Rust before it is stored, so a folder that cannot be read
      // is rejected while you are still looking at the field.
      setOpenError(e instanceof Error ? e.message : String(e));
    }
  }

  async function closeFolder(root: string) {
    try {
      setFolders(await getPlatform().files.closeFolder(root));
      // Files from it go with it. They cannot be saved any more, and leaving
      // a tab that fails on save would be worse than closing it.
      setOpen((files) => {
        const rest = files.filter((f) => f.root !== root);
        if (rest.every((f) => idOf(f) !== active)) {
          setActive(rest.length > 0 ? idOf(rest[rest.length - 1]) : null);
        }
        return rest;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openFile(root: string, path: string) {
    const already = open.find((f) => f.root === root && f.path === path);
    if (already) {
      setActive(idOf(already));
      return;
    }
    try {
      const text = await getPlatform().files.read(root, path);
      setOpen((files) => [...files, { root, path, saved: text, text }]);
      setActive(keyOf(root, path));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function save(file: OpenFile): Promise<boolean> {
    try {
      await getPlatform().files.write(file.root, file.path, file.text);
      // What is on disk is now what is on screen, so the dot goes out.
      setOpen((files) =>
        files.map((f) => (idOf(f) === idOf(file) ? { ...f, saved: f.text } : f)),
      );
      setNote(`Saved ${file.path}`);
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  function drop(file: OpenFile) {
    setOpen((files) => {
      const rest = files.filter((f) => idOf(f) !== idOf(file));
      if (active === idOf(file)) {
        setActive(rest.length > 0 ? idOf(rest[rest.length - 1]) : null);
      }
      return rest;
    });
  }

  /** Close a file, asking first when there is something to lose. */
  function close(file: OpenFile) {
    if (file.text === file.saved) {
      drop(file);
      return;
    }
    setAsking(file);
  }

  async function answered(answer: Answer) {
    const file = asking;
    setAsking(null);
    if (!file || answer === "cancel") return;

    if (answer === "discard") {
      drop(file);
      return;
    }
    // Saved, then closed — and left open if the save failed, because closing
    // it anyway would be discarding under another name.
    if (await save(file)) drop(file);
  }

  const current = open.find((f) => idOf(f) === active) ?? null;
  const dirty = (file: OpenFile) => file.text !== file.saved;
  const unsaved = open.filter(dirty).length;

  if (!busy && folders.length === 0) {
    return (
      <div className="board editor--closed">
        <header className="board__head">
          <p className="board__eyebrow">
            <span>nothing open</span>
          </p>
          <h1 className="board__title">Editor</h1>
          <p className="board__lede">
            Open a folder and its files appear on the left. The editor reads
            and writes inside the folders you open and nowhere else — anything
            resolving outside one is refused, including a <code>..</code> and a
            symlink pointing out of the tree.
          </p>
        </header>

        <div className="editor__opener">
          <FolderPicker
            action="Open folder"
            onChoose={(dir) => void openFolder(dir)}
            error={openError}
            clearOnChoose
          />
        </div>
      </div>
    );
  }

  return (
    <div className="editor">
      <aside className="editor__tree" aria-label="Files">
        <div className="editor__opener editor__opener--tight">
          <FolderPicker
            action="Add"
            placeholder="Add a folder..."
            onChoose={(dir) => void openFolder(dir)}
            error={openError}
            clearOnChoose
          />
        </div>

        {folders.map((folder) => (
          <section key={folder.root} className="editor__folder">
            <header className="editor__folder-head">
              <span className="editor__folder-name" title={folder.root}>
                {folder.name}
              </span>
              {!folder.available && (
                <span className="editor__gone" title="This folder cannot be read">
                  missing
                </span>
              )}
              <button
                type="button"
                className="editor__folder-close"
                aria-label={`Close folder ${folder.name}`}
                onClick={() => void closeFolder(folder.root)}
              >
                &times;
              </button>
            </header>

            {folder.available && (
              <Tree
                root={folder.root}
                path=""
                tree={tree}
                expanded={expanded}
                active={active}
                onToggle={async (entry) => {
                  const id = keyOf(folder.root, entry.path);
                  const next = new Set(expanded);
                  if (next.has(id)) {
                    next.delete(id);
                  } else {
                    next.add(id);
                    if (!tree[id]) await loadDir(folder.root, entry.path);
                  }
                  setExpanded(next);
                }}
                onOpen={(path) => void openFile(folder.root, path)}
              />
            )}
          </section>
        ))}
      </aside>

      <div className="editor__main">
        <div className="editor__tabs" role="tablist" aria-label="Open files">
          {open.map((file) => (
            <button
              key={idOf(file)}
              type="button"
              role="tab"
              aria-selected={idOf(file) === active}
              aria-keyshortcuts="Delete"
              className="editor__tab"
              title={`${file.root}/${file.path}`}
              onClick={(e) => {
                if ((e.target as HTMLElement).dataset.close === "true") close(file);
                else setActive(idOf(file));
              }}
              onKeyDown={(e) => {
                if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  close(file);
                }
              }}
            >
              <span className="editor__tab-name">{file.path.split("/").pop()}</span>
              {/* A dot rather than a word: it has to be readable at a glance
                  across a row of tabs, and "modified" is not. */}
              {dirty(file) && (
                <span className="editor__dot" aria-label="unsaved changes">
                  &bull;
                </span>
              )}
              <span className="editor__close" data-close="true" aria-hidden="true">
                &times;
              </span>
            </button>
          ))}
          {unsaved > 0 && (
            <span className="editor__unsaved" aria-live="polite">
              {unsaved} unsaved
            </span>
          )}
        </div>

        {error && (
          <p className="editor__error" role="alert">
            {error}
          </p>
        )}
        {note && !error && (
          <p className="editor__note" role="status">
            {note}
          </p>
        )}

        {current ? (
          <CodeMirror
            key={idOf(current)}
            path={current.path}
            initial={current.saved}
            onChange={(text) => {
              setNote(null);
              setOpen((files) =>
                files.map((f) => (idOf(f) === idOf(current) ? { ...f, text } : f)),
              );
            }}
            onSave={() => void save(current)}
          />
        ) : (
          <p className="editor__empty">Choose a file on the left.</p>
        )}
      </div>

      {asking && (
        <UnsavedDialog name={asking.path} onAnswer={(answer) => void answered(answer)} />
      )}
    </div>
  );
}

function Tree({
  root,
  path,
  tree,
  expanded,
  active,
  onToggle,
  onOpen,
}: {
  root: string;
  path: string;
  tree: Record<string, FileEntry[]>;
  expanded: Set<string>;
  active: string | null;
  onToggle: (entry: FileEntry) => void;
  onOpen: (path: string) => void;
}) {
  const entries = tree[keyOf(root, path)];
  if (!entries) return null;

  return (
    <ul className="editor__list">
      {entries.map((entry) => {
        const id = keyOf(root, entry.path);
        return (
          <li key={id}>
            <button
              type="button"
              className="editor__entry"
              data-kind={entry.is_dir ? "dir" : "file"}
              data-active={id === active ? "true" : undefined}
              aria-expanded={entry.is_dir ? expanded.has(id) : undefined}
              onClick={() => (entry.is_dir ? onToggle(entry) : onOpen(entry.path))}
            >
              <span className="editor__glyph" aria-hidden="true">
                {entry.is_dir ? (expanded.has(id) ? "▾" : "▸") : "·"}
              </span>
              {entry.name}
            </button>
            {entry.is_dir && expanded.has(id) && (
              <div className="editor__nested">
                <Tree
                  root={root}
                  path={entry.path}
                  tree={tree}
                  expanded={expanded}
                  active={active}
                  onToggle={onToggle}
                  onOpen={onOpen}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
