import { useState } from "react";
import { getPlatform, type RemoteHost, type SavedWorkspace } from "../../platform";
import { FolderPicker } from "../../components/FolderPicker";
import { Select } from "../../components/Select";

/** The most terminals one workspace will open. Mirrors `jky-workspace`. */
const MAX_TERMINALS = 8;

/**
 * Everything a workspace holds, editable.
 *
 * Folders are added with the same picker the editor uses, so choosing one
 * here works the way choosing one there does — and neither of them can name
 * a folder the other could not.
 */
export function WorkspaceForm({
  workspace,
  hosts,
  onSave,
  onCancel,
}: {
  workspace: SavedWorkspace;
  hosts: RemoteHost[];
  onSave: (workspace: SavedWorkspace) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(workspace);
  const [dirError, setDirError] = useState<string | null>(null);
  const set = (patch: Partial<SavedWorkspace>) => setDraft((d) => ({ ...d, ...patch }));

  function addFolder(dir: string) {
    // Already there is not an error — it is what happens when you add a
    // folder you had forgotten was in the list.
    if (draft.folders.includes(dir)) return;
    set({ folders: [...draft.folders, dir] });
  }

  /**
   * Take a start directory only if it is really there.
   *
   * Checked here rather than on switching, because a directory that is not
   * there does not fail loudly later — the pty falls back to home, and every
   * terminal opens in the wrong place with nothing saying why. This is the
   * moment the person is looking at the field.
   */
  async function setStartDir(dir: string) {
    // Asked of the completion engine, which only ever offers directories that
    // are really there — so a path it does not come back with is a path that
    // is not there. A trailing slash is how it spells a directory; both
    // spellings mean the same place.
    const line = `cd ${dir}`;
    const found = await getPlatform()
      .complete.suggest(line, line.length, "/", 40)
      .catch(() => null);

    const wanted = dir.replace(/\/$/, "");
    // Null means the engine could not answer, which is not evidence of
    // absence: taking the path is better than refusing one that is fine.
    const exists = found === null || found.items.some((i) => i.value.replace(/\/$/, "") === wanted);

    if (!exists) {
      setDirError(`\`${dir}\` is not a folder — terminals would start in your home instead`);
      return;
    }
    setDirError(null);
    set({ terminal_dir: dir });
  }

  return (
    <form
      className="wsp__form"
      aria-label="Workspace details"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <div className="field">
        <label className="field__label" htmlFor="wsp-name">
          Name
        </label>
        <input
          id="wsp-name"
          className="input"
          required
          value={draft.name}
          placeholder="jky-terminal"
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="wsp-note">
          What it is for
        </label>
        <input
          id="wsp-note"
          className="input"
          value={draft.note}
          placeholder="the repo and a shell in it"
          onChange={(e) => set({ note: e.target.value })}
        />
      </div>

      <div className="field">
        <span className="field__label">Folders</span>
        {draft.folders.length > 0 && (
          <ul className="wsp__folders">
            {draft.folders.map((folder) => (
              <li key={folder} className="wsp__folder">
                <span className="wsp__folder-path">{folder}</span>
                <button
                  type="button"
                  className="wsp__folder-drop"
                  aria-label={`Remove ${folder}`}
                  onClick={() => set({ folders: draft.folders.filter((f) => f !== folder) })}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}
        <FolderPicker action="Add" placeholder="Add a folder..." onChoose={addFolder} clearOnChoose />
        <p className="field__note">
          These open in the editor when you switch. Switching replaces whatever
          was open before, so a workspace is where you were rather than where
          you were plus the last project.
        </p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="wsp-terminals">
          Terminals to open
        </label>
        <input
          id="wsp-terminals"
          className="input wsp__number"
          type="number"
          min={0}
          max={MAX_TERMINALS}
          value={draft.terminals}
          onChange={(e) =>
            // Zero is a real answer: it means leave the terminals alone.
            set({ terminals: Math.max(0, Math.min(MAX_TERMINALS, Number(e.target.value) || 0)) })
          }
        />
        <p className="field__note">Zero leaves the terminals you already have alone.</p>
      </div>

      <div className="field">
        <span className="field__label">Terminals start in</span>
        {draft.terminal_dir ? (
          <div className="wsp__folder">
            <span className="wsp__folder-path">{draft.terminal_dir}</span>
            <button
              type="button"
              className="wsp__folder-drop"
              aria-label="Clear the start directory"
              onClick={() => set({ terminal_dir: null })}
            >
              &times;
            </button>
          </div>
        ) : (
          <FolderPicker
            action="Set"
            placeholder="Leave empty for wherever they would anyway..."
            onChoose={setStartDir}
            error={dirError}
          />
        )}
        <p className="field__note">
          Applies to terminals opened after you switch. A shell already running
          keeps the directory it is in — nothing outside a process can change
          that.
        </p>
      </div>

      {hosts.length > 0 && (
        <div className="field">
          <span className="field__label" id="wsp-host-label">
            Machine
          </span>
          <Select
            label="Machine"
            value={draft.host ?? ""}
            options={[
              { value: "", label: "This one" },
              ...hosts.map((h) => ({ value: h.id, label: h.label || h.address })),
            ]}
            onChange={(id) => set({ host: id || null })}
          />
          <p className="field__note">
            A saved host opens in a terminal tab of its own alongside the rest.
          </p>
        </div>
      )}

      <div className="wsp__form-actions">
        <button type="submit" className="btn btn--primary">
          Save workspace
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
