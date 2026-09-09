import { useCallback, useEffect, useState } from "react";
import { getPlatform, type FileEntry } from "../../platform";
import { CodeMirror } from "./CodeMirror";
import { useNav } from "../../app/navStore";
import "./Editor.css";

/** One file open in the editor. */
interface OpenFile {
  path: string;
  /** As it was read, so "changed" is a comparison rather than a guess. */
  saved: string;
  text: string;
}

/**
 * A file editor, inside one folder and nowhere else.
 *
 * The folder is opened in Settings and refused in Rust if it cannot be read.
 * Nothing here names an absolute path: every call is workspace-relative, and
 * anything that resolves outside is refused there rather than here — a check
 * in a window is a check that can be skipped.
 */
export function Editor() {
  const [root, setRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const loadDir = useCallback(async (path: string) => {
    try {
      const entries = await getPlatform().files.list(path);
      setTree((t) => ({ ...t, [path]: entries }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const where = await getPlatform().files.workspace();
        setRoot(where);
        if (where !== null) await loadDir("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [loadDir]);

  async function openFile(path: string) {
    const already = open.find((f) => f.path === path);
    if (already) {
      setActive(path);
      return;
    }
    try {
      const text = await getPlatform().files.read(path);
      setOpen((files) => [...files, { path, saved: text, text }]);
      setActive(path);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function save(path: string) {
    const file = open.find((f) => f.path === path);
    if (!file) return;
    try {
      await getPlatform().files.write(path, file.text);
      // What is on disk is now what is on screen, so the dot goes out.
      setOpen((files) =>
        files.map((f) => (f.path === path ? { ...f, saved: f.text } : f)),
      );
      setNote(`Saved ${path}`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function close(path: string) {
    setOpen((files) => {
      const rest = files.filter((f) => f.path !== path);
      if (active === path) setActive(rest[rest.length - 1]?.path ?? null);
      return rest;
    });
  }

  async function toggle(entry: FileEntry) {
    const next = new Set(expanded);
    if (next.has(entry.path)) {
      next.delete(entry.path);
    } else {
      next.add(entry.path);
      if (!tree[entry.path]) await loadDir(entry.path);
    }
    setExpanded(next);
  }

  const current = open.find((f) => f.path === active) ?? null;
  const dirty = (file: OpenFile) => file.text !== file.saved;

  if (root === null) {
    return (
      <div className="editor editor--closed">
        <h1 className="editor__title">Editor</h1>
        <p className="editor__blurb">
          No folder is open. Choose one in <b>Settings → Editor</b>.
        </p>
        <p className="editor__blurb editor__blurb--quiet">
          The editor can read and write inside that one folder and nowhere
          else. Until you open one it can reach nothing at all.
        </p>
        <button
          type="button"
          className="editor__open"
          onClick={() => useNav.getState().go("settings", "editor")}
        >
          Open Settings
        </button>
      </div>
    );
  }

  return (
    <div className="editor">
      <aside className="editor__tree" aria-label="Files">
        <p className="editor__root" title={root}>
          {root}
        </p>
        <Tree
          path=""
          tree={tree}
          expanded={expanded}
          active={active}
          onToggle={toggle}
          onOpen={openFile}
        />
      </aside>

      <div className="editor__main">
        <div className="editor__tabs" role="tablist" aria-label="Open files">
          {open.map((file) => (
            <button
              key={file.path}
              type="button"
              role="tab"
              aria-selected={file.path === active}
              className="editor__tab"
              onClick={(e) => {
                if ((e.target as HTMLElement).dataset.close === "true") close(file.path);
                else setActive(file.path);
              }}
            >
              <span className="editor__tab-name">{file.path.split("/").pop()}</span>
              {/* A dot rather than a word: it has to be readable at a glance
                  across a row of tabs, and "modified" is not. */}
              {dirty(file) && (
                <span className="editor__dot" aria-label="unsaved changes">
                  ●
                </span>
              )}
              <span className="editor__close" data-close="true" aria-hidden="true">
                ×
              </span>
            </button>
          ))}
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
            key={current.path}
            path={current.path}
            initial={current.saved}
            onChange={(text) => {
              setNote(null);
              setOpen((files) =>
                files.map((f) => (f.path === current.path ? { ...f, text } : f)),
              );
            }}
            onSave={() => void save(current.path)}
          />
        ) : (
          <p className="editor__empty">Choose a file on the left.</p>
        )}
      </div>
    </div>
  );
}

function Tree({
  path,
  tree,
  expanded,
  active,
  onToggle,
  onOpen,
}: {
  path: string;
  tree: Record<string, FileEntry[]>;
  expanded: Set<string>;
  active: string | null;
  onToggle: (entry: FileEntry) => void;
  onOpen: (path: string) => void;
}) {
  const entries = tree[path];
  if (!entries) return null;

  return (
    <ul className="editor__list">
      {entries.map((entry) => (
        <li key={entry.path}>
          <button
            type="button"
            className="editor__entry"
            data-kind={entry.is_dir ? "dir" : "file"}
            data-active={entry.path === active ? "true" : undefined}
            aria-expanded={entry.is_dir ? expanded.has(entry.path) : undefined}
            onClick={() => (entry.is_dir ? onToggle(entry) : onOpen(entry.path))}
          >
            <span className="editor__glyph" aria-hidden="true">
              {entry.is_dir ? (expanded.has(entry.path) ? "▾" : "▸") : "·"}
            </span>
            {entry.name}
          </button>
          {entry.is_dir && expanded.has(entry.path) && (
            <div className="editor__nested">
              <Tree
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
      ))}
    </ul>
  );
}
