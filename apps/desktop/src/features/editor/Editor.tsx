import { useCallback, useEffect, useState } from "react";
import { getPlatform, type FileEntry, type Folder } from "../../platform";
import { CodeMirror } from "./CodeMirror";
import { FolderPicker } from "../../components/FolderPicker";
import { UnsavedDialog, type Answer } from "./UnsavedDialog";
import { TerminalMenu, type MenuPoint } from "../terminal/TerminalMenu";
import { idOf, isDirty, keyOf, useEditor, type OpenFile } from "./editorStore";
import { FileView } from "./FileView";
import "./Editor.css";

/** What the rename prompt is asking about. */
interface Renaming {
  root: string;
  path: string;
  /** The new name, as typed. Starts as the old one. */
  draft: string;
  /** True while making something that does not exist yet. */
  creating: false | "file" | "folder";
}

/**
 * Files, inside the folders you opened and nowhere else.
 *
 * Folders are opened here rather than in Settings, because choosing what to
 * work on is the work — sending someone to a settings screen and back to see
 * a file is a round trip for something that is one field.
 *
 * Which files are open lives in `editorStore` rather than here: this
 * component is unmounted whenever you look at anything else, and when the
 * text lived here too, a trip to the terminal threw away everything unsaved.
 */
export function Editor() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tree, setTree] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openError, setOpenError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState<(MenuPoint & { root: string; entry: FileEntry }) | null>(
    null,
  );
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  /** The file being closed, waiting on an answer. */
  const [asking, setAsking] = useState<OpenFile | null>(null);
  const [busy, setBusy] = useState(true);

  const open = useEditor((s) => s.open);
  const active = useEditor((s) => s.active);
  const error = useEditor((s) => s.error);

  const loadDir = useCallback(async (root: string, path: string) => {
    try {
      const entries = await getPlatform().files.list(root, path);
      setTree((t) => ({ ...t, [keyOf(root, path)]: entries }));
      useEditor.getState().clearError();
    } catch (e) {
      useEditor.setState({ error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  /** Read one directory again, after something in it changed. */
  const refresh = useCallback(
    async (root: string, path: string) => {
      await loadDir(root, path);
    },
    [loadDir],
  );

  const loadFolders = useCallback(async () => {
    try {
      const found = await getPlatform().files.folders();
      setFolders(found);
      for (const folder of found) {
        if (folder.available) await loadDir(folder.root, "");
      }
    } catch (e) {
      useEditor.setState({ error: e instanceof Error ? e.message : String(e) });
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
      useEditor.getState().dropFolder(root);
    } catch (e) {
      useEditor.setState({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** The directory a new thing would go in, given what is selected. */
  function parentOf(entry: FileEntry | null): string {
    if (!entry) return "";
    if (entry.is_dir) return entry.path;
    const at = entry.path.lastIndexOf("/");
    return at === -1 ? "" : entry.path.slice(0, at);
  }

  async function commitName() {
    if (!renaming) return;
    const { root, path, draft, creating } = renaming;
    const name = draft.trim();
    if (!name) {
      setRenaming(null);
      return;
    }

    const target = path ? `${path}/${name}` : name;
    const files = getPlatform().files;

    try {
      if (creating) {
        await files.create(root, target, creating === "folder");
        setNote(`Made ${target}`);
        await refresh(root, path);
        if (creating === "file") await useEditor.getState().openFile(root, target);
      } else {
        const holder = parentOf({ path, name: "", is_dir: false, size: 0 });
        const to = holder ? `${holder}/${name}` : name;
        await files.rename(root, path, to);
        useEditor.getState().renamed(root, path, to);
        setNote(`Renamed to ${name}`);
        await refresh(root, holder);
      }
      setRenaming(null);
      useEditor.getState().clearError();
    } catch (e) {
      useEditor.setState({ error: e instanceof Error ? e.message : String(e) });
      setRenaming(null);
    }
  }

  async function remove(root: string, entry: FileEntry) {
    try {
      await getPlatform().files.remove(root, entry.path);
      useEditor.getState().drop(keyOf(root, entry.path));
      setNote(`Deleted ${entry.name}`);
      const at = entry.path.lastIndexOf("/");
      await refresh(root, at === -1 ? "" : entry.path.slice(0, at));
      useEditor.getState().clearError();
    } catch (e) {
      useEditor.setState({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Close a file, asking first when there is something to lose. */
  function close(file: OpenFile) {
    if (!isDirty(file)) {
      useEditor.getState().drop(idOf(file));
      return;
    }
    setAsking(file);
  }

  async function answered(answer: Answer) {
    const file = asking;
    setAsking(null);
    if (!file || answer === "cancel") return;

    if (answer === "discard") {
      useEditor.getState().drop(idOf(file));
      return;
    }
    // Saved, then closed — and left open if the save failed, because closing
    // it anyway would be discarding under another name.
    if (await useEditor.getState().save(idOf(file))) useEditor.getState().drop(idOf(file));
  }

  const current = open.find((f) => idOf(f) === active) ?? null;
  const unsaved = open.filter(isDirty).length;

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
              {folder.available && (
                <>
                  <button
                    type="button"
                    className="editor__folder-act"
                    aria-label={`New file in ${folder.name}`}
                    title="New file"
                    onClick={() =>
                      setRenaming({ root: folder.root, path: "", draft: "", creating: "file" })
                    }
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="editor__folder-act"
                    aria-label={`New folder in ${folder.name}`}
                    title="New folder"
                    onClick={() =>
                      setRenaming({ root: folder.root, path: "", draft: "", creating: "folder" })
                    }
                  >
                    &#9723;
                  </button>
                </>
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

            {/* Naming something new, at the top of the folder it goes in. An
                inline field rather than a dialog: a name is one word, and a
                box in the middle of the screen for one word is a box you
                have to dismiss. */}
            {renaming?.creating && renaming.root === folder.root && renaming.path === "" && (
              <NameField
                value={renaming.draft}
                placeholder={renaming.creating === "folder" ? "new folder" : "new file"}
                onChange={(draft) => setRenaming({ ...renaming, draft })}
                onCommit={() => void commitName()}
                onCancel={() => setRenaming(null)}
              />
            )}

            {folder.available && (
              <Tree
                root={folder.root}
                path=""
                tree={tree}
                expanded={expanded}
                active={active}
                renaming={renaming}
                onRenameChange={(draft) => renaming && setRenaming({ ...renaming, draft })}
                onRenameCommit={() => void commitName()}
                onRenameCancel={() => setRenaming(null)}
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
                onOpen={(path) => void useEditor.getState().openFile(folder.root, path)}
                onMenu={(point, entry) => setMenuAt({ ...point, root: folder.root, entry })}
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
                else useEditor.getState().focus(idOf(file));
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
              {isDirty(file) && (
                <span className="editor__dot" aria-label="unsaved changes">
                  &bull;
                </span>
              )}
              {/* A file that cannot change can never be unsaved, so the dot's
                  place carries the reason instead. */}
              {file.preview && (
                <span className="editor__ro" aria-label="read-only">
                  &#9679;
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

        {!current ? (
          <p className="editor__empty">Choose a file on the left.</p>
        ) : current.preview ? (
          // Open, and plainly not editable. Both halves matter: refusing to
          // open it left an error and an empty pane, and opening it into
          // CodeMirror would offer to edit bytes it cannot represent.
          <FileView path={current.path} preview={current.preview} />
        ) : (
          <CodeMirror
            key={idOf(current)}
            path={current.path}
            initial={current.saved}
            onChange={(text) => {
              setNote(null);
              useEditor.getState().edit(idOf(current), text);
            }}
            onSave={() => void useEditor.getState().save(idOf(current))}
          />
        )}
      </div>

      {menuAt && (
        <TerminalMenu
          at={{ x: menuAt.x, y: menuAt.y }}
          onClose={() => setMenuAt(null)}
          items={[
            {
              label: "New file",
              run: () =>
                setRenaming({
                  root: menuAt.root,
                  path: parentOf(menuAt.entry),
                  draft: "",
                  creating: "file",
                }),
            },
            {
              label: "New folder",
              run: () =>
                setRenaming({
                  root: menuAt.root,
                  path: parentOf(menuAt.entry),
                  draft: "",
                  creating: "folder",
                }),
            },
            {
              label: "Rename",
              run: () =>
                setRenaming({
                  root: menuAt.root,
                  path: menuAt.entry.path,
                  draft: menuAt.entry.name,
                  creating: false,
                }),
            },
            {
              label: "Delete",
              // A directory with anything in it is refused in Rust; saying so
              // here as well means the item is never a click that fails.
              hint: menuAt.entry.is_dir ? "if empty" : undefined,
              run: () => void remove(menuAt.root, menuAt.entry),
            },
          ]}
        />
      )}

      {asking && (
        <UnsavedDialog name={asking.path} onAnswer={(answer) => void answered(answer)} />
      )}
    </div>
  );
}

/**
 * A field for naming something, in the tree where it will appear.
 *
 * Enter takes it, Escape abandons it, and leaving it does too — an inline
 * field that stayed behind after you clicked away would be a thing to tidy up.
 */
function NameField({
  value,
  placeholder,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      className="editor__name"
      autoFocus
      aria-label={placeholder}
      placeholder={placeholder}
      value={value}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

function Tree({
  root,
  path,
  tree,
  expanded,
  active,
  renaming,
  onToggle,
  onOpen,
  onMenu,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: {
  root: string;
  path: string;
  tree: Record<string, FileEntry[]>;
  expanded: Set<string>;
  active: string | null;
  renaming: Renaming | null;
  onToggle: (entry: FileEntry) => void;
  onOpen: (path: string) => void;
  onMenu: (point: MenuPoint, entry: FileEntry) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}) {
  const entries = tree[keyOf(root, path)];
  if (!entries) return null;

  return (
    <ul className="editor__list">
      {entries.map((entry) => {
        const id = keyOf(root, entry.path);
        const isRenaming =
          renaming !== null &&
          !renaming.creating &&
          renaming.root === root &&
          renaming.path === entry.path;
        const isCreatingHere =
          renaming !== null &&
          renaming.creating !== false &&
          renaming.root === root &&
          renaming.path === entry.path;

        return (
          <li key={id}>
            {isRenaming ? (
              <NameField
                value={renaming.draft}
                placeholder="name"
                onChange={onRenameChange}
                onCommit={onRenameCommit}
                onCancel={onRenameCancel}
              />
            ) : (
              <button
                type="button"
                className="editor__entry"
                data-kind={entry.is_dir ? "dir" : "file"}
                data-active={id === active ? "true" : undefined}
                aria-expanded={entry.is_dir ? expanded.has(id) : undefined}
                onClick={() => (entry.is_dir ? onToggle(entry) : onOpen(entry.path))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onMenu({ x: e.clientX, y: e.clientY }, entry);
                }}
              >
                <span className="editor__glyph" aria-hidden="true">
                  {entry.is_dir ? (expanded.has(id) ? "▾" : "▸") : "·"}
                </span>
                {entry.name}
              </button>
            )}

            {entry.is_dir && expanded.has(id) && (
              <div className="editor__nested">
                {isCreatingHere && renaming && (
                  <NameField
                    value={renaming.draft}
                    placeholder={renaming.creating === "folder" ? "new folder" : "new file"}
                    onChange={onRenameChange}
                    onCommit={onRenameCommit}
                    onCancel={onRenameCancel}
                  />
                )}
                <Tree
                  root={root}
                  path={entry.path}
                  tree={tree}
                  expanded={expanded}
                  active={active}
                  renaming={renaming}
                  onToggle={onToggle}
                  onOpen={onOpen}
                  onMenu={onMenu}
                  onRenameChange={onRenameChange}
                  onRenameCommit={onRenameCommit}
                  onRenameCancel={onRenameCancel}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
