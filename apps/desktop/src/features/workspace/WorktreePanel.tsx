import { useCallback, useEffect, useMemo, useState } from "react";
import { getPlatform, type GitWorktree } from "../../platform";

function folderName(path: string): string {
  return path.replace(/[\\/]$/, "").split(/[\\/]/).pop() || path;
}

/**
 * A Git-native worktree launcher.
 *
 * It only accepts roots the editor already has open. Creation receives a
 * branch and a simple sibling-folder name; the backend builds the Git argv,
 * so this is a project action rather than a shell-command generator.
 */
export function WorktreePanel({
  roots,
  onOpen,
}: {
  roots: string[];
  onOpen: (root: string, worktree: GitWorktree) => void;
}) {
  const [root, setRoot] = useState(roots[0] ?? "");
  const [entries, setEntries] = useState<GitWorktree[]>([]);
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("HEAD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rootsKey = roots.join("\u0000");
  useEffect(() => {
    if (!roots.includes(root)) setRoot(roots[0] ?? "");
  }, [roots, rootsKey, root]);

  const refresh = useCallback(async () => {
    if (!root) {
      setEntries([]);
      return;
    }
    try {
      setEntries(await getPlatform().worktrees.list(root));
      setError(null);
    } catch (cause) {
      setEntries([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const main = useMemo(() => entries.find((entry) => entry.path === root), [entries, root]);

  async function create() {
    try {
      setBusy(true);
      const created = await getPlatform().worktrees.create(root, name, branch, base);
      setName("");
      setBranch("");
      setBase("HEAD");
      setNotice(`Created ${created.branch ?? folderName(created.path)}. It is ready to open.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: GitWorktree) {
    const named = entry.branch ?? folderName(entry.path);
    if (!window.confirm(`Remove worktree ${named}? Uncommitted files can be lost.`)) return;
    try {
      setBusy(true);
      await getPlatform().worktrees.remove(root, entry.path);
      setNotice(`Removed ${named}.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wt" aria-labelledby="worktrees-heading">
      <header className="wt__head">
        <div>
          <h2 id="worktrees-heading">Git worktrees</h2>
          <p>One isolated checkout per issue or branch. Open one to make it a durable JKY workspace.</p>
        </div>
        <button type="button" className="btn" onClick={() => void refresh()} disabled={busy || !root}>
          Refresh
        </button>
      </header>

      {roots.length === 0 ? (
        <p className="field__note">Open a project folder in the editor to manage its worktrees.</p>
      ) : (
        <>
          {roots.length > 1 && (
            <label className="field wt__root">
              <span className="field__label">Repository</span>
              <select className="input" aria-label="Worktree repository" value={root} onChange={(e) => setRoot(e.target.value)}>
                {roots.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          )}

          {error && <p className="hint hint--warn" role="alert">{error}</p>}
          {notice && !error && <p className="hint" role="status">{notice}</p>}

          <form className="wt__create" aria-label="Create Git worktree" onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}>
            <label>
              <span>Folder</span>
              <input className="input" required value={name} placeholder="issue-142" onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              <span>New branch</span>
              <input className="input" required value={branch} placeholder="feature/issue-142" onChange={(e) => setBranch(e.target.value)} />
            </label>
            <label>
              <span>Base</span>
              <input className="input" value={base} placeholder="HEAD" onChange={(e) => setBase(e.target.value)} />
            </label>
            <button type="submit" className="btn btn--primary" disabled={busy || !root || !name.trim() || !branch.trim()}>
              Create worktree
            </button>
          </form>

          <ul className="wt__list" aria-label="Git worktrees">
            {entries.map((entry) => {
              const isMain = entry.path === (main?.path ?? root);
              const label = entry.branch ?? "detached HEAD";
              return (
                <li key={entry.path} className="wt__row" data-main={isMain || undefined}>
                  <div className="wt__identity">
                    <strong>{label}</strong>
                    <code title={entry.path}>{entry.path}</code>
                    <span>{entry.head.slice(0, 10)}{entry.locked ? " · locked" : ""}</span>
                  </div>
                  <div className="wt__actions">
                    <button type="button" className="btn" onClick={() => onOpen(root, entry)}>Open workspace</button>
                    {!isMain && <button type="button" className="btn btn--danger" disabled={busy || entry.locked} onClick={() => void remove(entry)}>Remove</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
