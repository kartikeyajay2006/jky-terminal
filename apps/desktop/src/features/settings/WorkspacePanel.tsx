import { useEffect, useState } from "react";
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

  useEffect(() => {
    void getPlatform()
      .files.workspace()
      .then((where) => {
        setRoot(where);
        setDraft(where ?? "");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function apply(dir: string) {
    try {
      const where = await getPlatform().files.openWorkspace(dir);
      setRoot(where);
      setDraft(where ?? "");
      setError(null);
    } catch (e) {
      // Refused in Rust before it is stored, so a folder that cannot be read
      // is rejected while the person is still looking at the field.
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section aria-labelledby="workspace-heading">
      <PanelHead
        where="Editor"
        headingId="workspace-heading"
        status={root ? "open" : "nothing open"}
      />

      <p className="settings__blurb">
        The editor can read and write inside this one folder and nowhere else.
        Anything that resolves outside it is refused — including a{" "}
        <code>..</code> and a symlink pointing out of the tree. Leave it empty
        and the editor can reach nothing at all.
      </p>

      {error && (
        <p className="settings__note" role="alert">
          {error}
        </p>
      )}

      <form
        className="settings__row"
        onSubmit={(e) => {
          e.preventDefault();
          void apply(draft);
        }}
      >
        <label className="settings__label" htmlFor="workspace-dir">
          Folder
        </label>
        <input
          id="workspace-dir"
          className="settings__input"
          value={draft}
          placeholder="~/projects/thing"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="keys__reset">
          Open
        </button>
        <button
          type="button"
          className="keys__reset"
          disabled={root === null}
          onClick={() => void apply("")}
        >
          Close
        </button>
      </form>
    </section>
  );
}
