import { useCallback, useEffect, useState } from "react";
import { getPlatform, type RemoteHost } from "../../platform";
import { useTabs } from "../../app/tabStore";
import { useNav } from "../../app/navStore";
import "./Remote.css";

/** A host with nothing filled in, ready to be edited. */
function blank(): RemoteHost {
  return {
    id: `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: "",
    address: "",
    user: "",
    port: null,
    identity_file: null,
    jump: null,
    last_used: 0,
  };
}

/**
 * Machines you can open a terminal on.
 *
 * There is no password field and no key field, and that is the design rather
 * than an omission: connecting runs the `ssh` this computer already has, so
 * the agent, `~/.ssh/config`, `known_hosts` and keys in use are the ones that
 * already work in every other terminal you own. This app stores no credential
 * and never sees one.
 */
export function Remote() {
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
  const [editing, setEditing] = useState<RemoteHost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    try {
      setHosts(await getPlatform().remote.list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(host: RemoteHost) {
    try {
      setHosts(await getPlatform().remote.save(host));
      setEditing(null);
      setError(null);
    } catch (e) {
      // Refused in Rust, on the way in, so a host that will not connect is
      // never saved and found broken later.
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function forget(id: string) {
    try {
      setHosts(await getPlatform().remote.forget(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function connect(host: RemoteHost) {
    // A tab of its own. The pane spawns ssh when it mounts, so a failure to
    // connect is shown where every other command's output is — in a terminal,
    // in ssh's own words, rather than translated into a dialog.
    useTabs.getState().openRemoteTab(host.id, host.label || host.address);
    useNav.getState().go("terminal");
    void load();
  }

  return (
    <div className="board remote">
      <header className="board__head">
        <p className="board__eyebrow">
          {busy ? (
            <span>reading…</span>
          ) : (
            <span>
              <b>{hosts.length}</b> {hosts.length === 1 ? "host" : "hosts"}
            </span>
          )}
        </p>
        <h1 className="board__title">Remote</h1>
        <p className="board__lede">
          Opens a terminal over the <code>ssh</code> already on this machine,
          so your agent, <code>~/.ssh/config</code>, <code>known_hosts</code>{" "}
          and keys are the ones in use. No password or key is stored here, and
          none is asked for.
        </p>
      </header>

      {error && (
        <p className="hint hint--warn" role="alert">
          {error}
        </p>
      )}

      {!busy && hosts.length === 0 && !editing && (
        <p className="remote__empty">
          No hosts yet. Add one and it opens in a terminal tab of its own.
        </p>
      )}

      <ul className="remote__list">
        {hosts.map((host) => (
          <li key={host.id} className="remote__row">
            <button
              type="button"
              className="remote__connect"
              onClick={() => connect(host)}
              aria-label={`Open a terminal on ${host.label || host.address}`}
            >
              <span className="remote__name">{host.label || host.address}</span>
              <span className="remote__where">
                {host.user ? `${host.user}@` : ""}
                {host.address}
                {host.port ? `:${host.port}` : ""}
                {host.jump ? ` via ${host.jump}` : ""}
              </span>
            </button>
            <button type="button" className="remote__edit" onClick={() => setEditing(host)}>
              Edit
            </button>
            <button
              type="button"
              className="remote__forget"
              aria-label={`Forget ${host.label || host.address}`}
              onClick={() => void forget(host.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {!editing && (
        <button type="button" className="btn remote__add" onClick={() => setEditing(blank())}>
          + Add host
        </button>
      )}

      {editing && (
        <HostForm
          host={editing}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
          onSave={(host) => void save(host)}
        />
      )}
    </div>
  );
}

function HostForm({
  host,
  onSave,
  onCancel,
}: {
  host: RemoteHost;
  onSave: (host: RemoteHost) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(host);
  const set = (patch: Partial<RemoteHost>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <form
      className="remote__form"
      aria-label="Host details"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <label className="remote__field">
        <span className="field__label">Name</span>
        <input
          className="input"
          value={draft.label}
          placeholder="production"
          onChange={(e) => set({ label: e.target.value })}
        />
      </label>

      <label className="remote__field">
        <span className="field__label">Address</span>
        <input
          className="input"
          required
          value={draft.address}
          placeholder="example.com, or a name from ~/.ssh/config"
          onChange={(e) => set({ address: e.target.value })}
        />
      </label>

      <label className="remote__field">
        <span className="field__label">User</span>
        <input
          className="input"
          value={draft.user}
          placeholder="whatever ssh would use"
          onChange={(e) => set({ user: e.target.value })}
        />
      </label>

      <label className="remote__field">
        <span className="field__label">Port</span>
        <input
          className="input"
          type="number"
          min={1}
          max={65535}
          value={draft.port ?? ""}
          placeholder="22"
          // Empty means "whatever ssh would use", which is not the same as 22
          // — a Port in ~/.ssh/config should still win.
          onChange={(e) => set({ port: e.target.value ? Number(e.target.value) : null })}
        />
      </label>

      <label className="remote__field">
        <span className="field__label">Key file</span>
        <input
          className="input"
          value={draft.identity_file ?? ""}
          placeholder="only when the agent is not enough"
          onChange={(e) => set({ identity_file: e.target.value || null })}
        />
      </label>

      <label className="remote__field">
        <span className="field__label">Via</span>
        <input
          className="input"
          value={draft.jump ?? ""}
          placeholder="bastion.example.com"
          onChange={(e) => set({ jump: e.target.value || null })}
        />
      </label>

      <div className="remote__actions">
        <button type="submit" className="btn btn--primary">
          Save
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
