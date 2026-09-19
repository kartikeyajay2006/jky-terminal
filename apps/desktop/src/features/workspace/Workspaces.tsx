import { useCallback, useEffect, useState } from "react";
import {
  getPlatform,
  type RemoteHost,
  type SavedWorkspace,
  type Workspaces as Saved,
} from "../../platform";
import { useTabs } from "../../app/tabStore";
import { useNav } from "../../app/navStore";
import { WorkspaceForm } from "./WorkspaceForm";
import { WorktreePanel } from "./WorktreePanel";
import "./Workspaces.css";

/** A workspace with nothing in it, ready to be filled in. */
function blank(): SavedWorkspace {
  return {
    id: `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    folders: [],
    terminal_dir: null,
    terminals: 1,
    host: null,
    note: "",
    last_used: 0,
  };
}

/**
 * What you are working on, saved under a name.
 *
 * Not a folder and not a window: the answer to "put me back where I was on
 * that project". Switching opens the folders it names, points new terminals
 * at its directory, opens the terminals it asks for, and connects to its
 * machine if it has one — all at once, which is the whole point of it having
 * a name.
 *
 * A workspace *names* things; it does not grant them. Opening its folders
 * goes through exactly the checks that opening one by hand does, so a
 * hand-edited file is a wish rather than a way to read the machine.
 */
export function Workspaces() {
  const [saved, setSaved] = useState<Saved>({ workspaces: [], active: null });
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [editing, setEditing] = useState<SavedWorkspace | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    try {
      setSaved(await getPlatform().workspaces.list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Hosts are for the form's picker. A failure costs the picker and not
    // the section: a workspace without a machine is the ordinary case.
    void getPlatform()
      .remote.list()
      .then(setHosts)
      .catch(() => setHosts([]));
    void getPlatform()
      .files.folders()
      .then((folders) => setRoots(folders.filter((folder) => folder.available).map((folder) => folder.root)))
      .catch(() => setRoots([]));
  }, [load]);

  async function save(workspace: SavedWorkspace) {
    try {
      setSaved(await getPlatform().workspaces.save(workspace));
      setEditing(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function forget(id: string) {
    try {
      setSaved(await getPlatform().workspaces.forget(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Switch to a workspace.
   *
   * The folders and the start directory are settings, so Rust applies those.
   * The terminals are windows, so this opens those — and it opens them after,
   * because a terminal started before the start directory was set would start
   * in the wrong place.
   */
  async function activate(workspace: SavedWorkspace) {
    try {
      const applied = await getPlatform().workspaces.activate(workspace.id);
      await load();

      const tabs = useTabs.getState();
      for (let i = 0; i < applied.workspace.terminals; i += 1) {
        tabs.openTab("terminal", `${applied.workspace.name} ${i + 1}`);
      }
      if (applied.workspace.host) {
        const host = hosts.find((h) => h.id === applied.workspace.host);
        if (host) tabs.openRemoteTab(host.id, host.label || host.address);
      }

      // Say what actually happened, including the parts that did not. A
      // start directory that quietly fell back to home is the failure this
      // whole path exists to make visible.
      const trouble = [
        ...applied.missing.map((f) => `folder not there: ${f}`),
        ...(applied.terminal_dir_missing
          ? [`terminals could not start in ${applied.workspace.terminal_dir}`]
          : []),
      ];

      setNote(
        trouble.length > 0
          ? `Opened ${applied.workspace.name} — ${trouble.join("; ")}`
          : applied.terminal_dir
            ? `Opened ${applied.workspace.name}. New terminals start in ${applied.terminal_dir}`
            : `Opened ${applied.workspace.name}`,
      );
      setError(null);

      // Land where the work is. A switch that left you looking at a list of
      // workspaces has only done half of what it said.
      useNav.getState().go(applied.workspace.terminals > 0 ? "terminal" : "editor");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function leave() {
    try {
      setSaved(await getPlatform().workspaces.leave());
      setNote(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Start a new workspace from what is open right now.
   *
   * The common way one gets made: you have already arranged things, and
   * naming that arrangement is the only step left. Nothing is saved yet —
   * the form opens filled in, so it can still be changed before it has a
   * name.
   */
  async function fromWhatIsOpen() {
    const folders = await getPlatform()
      .files.folders()
      .then((found) => found.map((f) => f.root))
      .catch(() => []);

    setEditing({
      ...blank(),
      folders,
      terminals: Math.max(1, useTabs.getState().tabs.length),
    });
  }

  const active = saved.workspaces.find((w) => w.id === saved.active) ?? null;
  const visible = saved.workspaces.filter((workspace) => {
    const words = `${workspace.name} ${workspace.note} ${workspace.folders.join(" ")}`.toLocaleLowerCase();
    return words.includes(query.trim().toLocaleLowerCase());
  });

  async function openWorktree(root: string, worktree: { path: string; branch: string | null }) {
    const branch = worktree.branch ?? "detached";
    const workspace: SavedWorkspace = {
      id: `worktree-${worktree.path}`,
      name: branch,
      folders: [worktree.path],
      terminal_dir: worktree.path,
      terminals: 1,
      host: null,
      note: `Git worktree from ${root}`,
      last_used: 0,
    };
    try {
      await getPlatform().workspaces.save(workspace);
      await activate(workspace);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="board wsp">
      <header className="board__head">
        <p className="board__eyebrow">
          {busy ? (
            <span>reading...</span>
          ) : (
            <>
              <span>
                <b>{saved.workspaces.length}</b>{" "}
                {saved.workspaces.length === 1 ? "workspace" : "workspaces"}
              </span>
              {active && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="wsp__current">in {active.name}</span>
                </>
              )}
            </>
          )}
        </p>
        <h1 className="board__title">Workspaces</h1>
        <p className="board__lede">
          Return to a project exactly where you left it: folders, terminals,
          machine, and its Git worktrees. Everything here is local and can be changed.
        </p>
      </header>

      {error && (
        <p className="hint hint--warn" role="alert">
          {error}
        </p>
      )}
      {note && !error && (
        <p className="hint" role="status">
          {note}
        </p>
      )}

      {active && !editing && (
        <section className="wsp__now" aria-labelledby="current-workspace">
          <div className="wsp__now-copy">
            <p className="wsp__kicker">Current work</p>
            <h2 id="current-workspace">{active.name}</h2>
            <p>{active.note || "A saved local workspace, ready to continue."}</p>
            <span className="wsp__path" title={active.terminal_dir ?? active.folders[0] ?? undefined}>
              {active.terminal_dir ?? active.folders[0] ?? "No starting folder set"}
            </span>
          </div>
          <div className="wsp__now-actions">
            <button type="button" className="btn btn--primary" onClick={() => void activate(active)}>
              Resume workspace
            </button>
            <button type="button" className="btn" onClick={() => setEditing(active)}>Edit</button>
            <button type="button" className="btn" aria-label={`Leave ${active.name}`} onClick={() => void leave()}>Leave</button>
          </div>
        </section>
      )}

      {!editing && (
        <section className="wsp__library" aria-labelledby="workspace-library">
          <div className="wsp__library-head">
            <div>
              <p className="wsp__kicker">Workspace library</p>
              <h2 id="workspace-library">Choose the work to resume</h2>
            </div>
            <div className="wsp__actions">
              {saved.workspaces.length > 0 && (
                <button type="button" className="btn" onClick={() => void fromWhatIsOpen()}>
                  Capture current work
                </button>
              )}
              <button type="button" className="btn btn--primary" onClick={() => setEditing(blank())}>
                + New workspace
              </button>
            </div>
          </div>

          {saved.workspaces.length > 1 && (
            <label className="wsp__search">
              <span className="sr-only">Filter workspaces</span>
              <input
                className="input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by project, purpose, or folder..."
              />
            </label>
          )}

          {!busy && saved.workspaces.length === 0 && (
            <div className="wsp__empty">
              <strong>None yet. Start from the work already open.</strong>
              <span>Capture it once; then Resume brings back its folders, terminal setup, and remote host.</span>
              <button type="button" className="btn btn--primary" onClick={() => void fromWhatIsOpen()}>
                Capture current work
              </button>
            </div>
          )}

          {saved.workspaces.length > 0 && visible.length === 0 && (
            <p className="wsp__empty">No saved workspace matches “{query}”.</p>
          )}

          <ul className="wsp__list">
        {visible.map((workspace) => (
          <li
            key={workspace.id}
            className="wsp__row"
            data-active={workspace.id === saved.active ? "true" : undefined}
          >
            <button
              type="button"
              className="wsp__open"
              onClick={() => void activate(workspace)}
              aria-label={`Switch to ${workspace.name}`}
            >
              <span className="wsp__name">
                {workspace.name}
                {workspace.id === saved.active && (
                  <span className="wsp__badge">active</span>
                )}
              </span>
              {workspace.note && <span className="wsp__note">{workspace.note}</span>}
              {/* What it holds, as chips: the reason you would pick this one,
                  readable without going in. A glyph per kind so the shape of
                  a workspace is recognisable before the words are read. */}
              <span className="wsp__what">
                <span className="wsp__chip" data-kind="folders">
                  <b aria-hidden="true">▤</b>
                  {workspace.folders.length}{" "}
                  {workspace.folders.length === 1 ? "folder" : "folders"}
                </span>
                {workspace.terminals > 0 && (
                  <span className="wsp__chip" data-kind="terminals">
                    <b aria-hidden="true">❯</b>
                    {workspace.terminals}{" "}
                    {workspace.terminals === 1 ? "terminal" : "terminals"}
                  </span>
                )}
                {workspace.terminal_dir && (
                  <span className="wsp__chip" data-kind="dir" title={workspace.terminal_dir}>
                    <b aria-hidden="true">↳</b>
                    {workspace.terminal_dir.replace(/^.*[/\\]/, "") || workspace.terminal_dir}
                  </span>
                )}
                {workspace.host && (
                  <span className="wsp__chip" data-kind="host">
                    <b aria-hidden="true">⇄</b>
                    {hosts.find((h) => h.id === workspace.host)?.label ??
                      hosts.find((h) => h.id === workspace.host)?.address ??
                      "a saved host"}
                  </span>
                )}
              </span>
            </button>

            <button
              type="button"
              className="wsp__edit"
              onClick={() => setEditing(workspace)}
            >
              Edit
            </button>
            <button
              type="button"
              className="wsp__forget"
              aria-label={`Forget ${workspace.name}`}
              onClick={() => void forget(workspace.id)}
            >
              &times;
            </button>
          </li>
        ))}
      </ul>
        </section>
      )}

      <WorktreePanel
        roots={roots}
        onOpen={(root, worktree) => void openWorktree(root, worktree)}
      />

      {editing && (
        <WorkspaceForm
          workspace={editing}
          hosts={hosts}
          onSave={(workspace) => void save(workspace)}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
        />
      )}
    </div>
  );
}
