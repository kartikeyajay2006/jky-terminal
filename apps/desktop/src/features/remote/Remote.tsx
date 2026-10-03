import { useCallback, useEffect, useState } from "react";
import { getPlatform, type HostKeyStatus, type RemoteHost, type SshConfigHost } from "../../platform";
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
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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

  /**
   * Save each chosen config host under its alias.
   *
   * The alias is the address, and nothing else is copied: ssh reads
   * `~/.ssh/config` itself on every connection, so HostName, User, Port and
   * ProxyJump come from the one place they are kept and cannot go stale here.
   */
  async function importHosts(aliases: string[]) {
    let saved = 0;
    for (const alias of aliases) {
      try {
        setHosts(await getPlatform().remote.save({ ...blank(), label: alias, address: alias }));
        saved++;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setImporting(false);
    setStatus(`Imported ${saved} ${saved === 1 ? "host" : "hosts"}.`);
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
      {status && (
        <p className="remote__status" role="status">
          {status}
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
            <HostKey host={host} />
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

      {!editing && !importing && (
        <div className="remote__actions">
          <button type="button" className="btn remote__add" onClick={() => setEditing(blank())}>
            + Add host
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setStatus(null);
              setImporting(true);
            }}
          >
            Import from ~/.ssh/config
          </button>
        </div>
      )}

      {importing && (
        <ImportConfig
          saved={hosts.map((h) => h.address)}
          onImport={(aliases) => void importHosts(aliases)}
          onCancel={() => setImporting(false)}
        />
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

/** The hosts in ~/.ssh/config not yet saved, each ticked to import. */
function ImportConfig({
  saved,
  onImport,
  onCancel,
}: {
  saved: string[];
  onImport: (aliases: string[]) => void;
  onCancel: () => void;
}) {
  const [offered, setOffered] = useState<SshConfigHost[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    void getPlatform()
      .remote.configHosts()
      .then((found) => {
        const fresh = found.filter((h) => !saved.includes(h.alias));
        setOffered(fresh);
        setChosen(new Set(fresh.map((h) => h.alias)));
      })
      .catch(() => setOffered([]));
    // Read once, when the panel opens: what is already saved is fixed then.
  }, []);

  if (offered === null) return <p className="remote__empty">Reading ~/.ssh/config…</p>;

  const toggle = (alias: string) =>
    setChosen((now) => {
      const next = new Set(now);
      if (next.has(alias)) next.delete(alias);
      else next.add(alias);
      return next;
    });

  return (
    <fieldset className="remote__import">
      <legend>Hosts in ~/.ssh/config</legend>
      {offered.length === 0 ? (
        <p className="remote__empty">
          No hosts to import — the file names none that are not saved already. Patterns such as{" "}
          <code>Host *</code> name no single machine and are not offered.
        </p>
      ) : (
        <>
          <p className="remote__note">
            Each is saved under its alias. ssh reads the rest from the file on every connection, so
            nothing here is a copy that can go stale.
          </p>
          <ul className="remote__offers">
            {offered.map((h) => (
              <li key={h.alias}>
                <label>
                  <input type="checkbox" checked={chosen.has(h.alias)} onChange={() => toggle(h.alias)} />
                  <span className="remote__name">{h.alias}</span>
                  <span className="remote__where">{whereTo(h)}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="remote__actions">
        {offered.length > 0 && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={chosen.size === 0}
            onClick={() => onImport(offered.filter((h) => chosen.has(h.alias)).map((h) => h.alias))}
          >
            Import {chosen.size} {chosen.size === 1 ? "host" : "hosts"}
          </button>
        )}
        <button type="button" className="btn" onClick={onCancel}>
          {offered.length > 0 ? "Cancel" : "Close"}
        </button>
      </div>
    </fieldset>
  );
}

/** `user@hostname:port via jump`, from what the config file says. */
function whereTo(h: SshConfigHost): string {
  const at = `${h.user ? `${h.user}@` : ""}${h.hostname ?? h.alias}${h.port ? `:${h.port}` : ""}`;
  return h.jump ? `${at} via ${h.jump}` : at;
}

/**
 * Whether this machine already trusts a host's key, asked on demand.
 *
 * On demand because it runs `ssh -G` and `ssh-keygen`; a list that started
 * two processes per host every time it was drawn would be slow for no reason.
 */
function HostKey({ host }: { host: RemoteHost }) {
  const [state, setState] = useState<HostKeyStatus | string | null>(null);
  const name = host.label || host.address;

  if (state === null) {
    return (
      <button
        type="button"
        className="remote__edit"
        aria-label={`Check the host key of ${name}`}
        onClick={() =>
          void getPlatform()
            .remote.hostKey(host.id)
            .then(setState)
            .catch((e: unknown) => setState(e instanceof Error ? e.message : String(e)))
        }
      >
        Host key
      </button>
    );
  }

  if (typeof state === "string") {
    return <p className="remote__key remote__key--warn">{state}</p>;
  }

  if (state.keys.length === 0) {
    return (
      <p className="remote__key remote__key--warn">
        <b>Not in known_hosts</b> as <code>{state.lookup}</code>. On the first connection ssh shows
        the server&rsquo;s fingerprint and asks whether to trust it — compare it with one the
        server&rsquo;s owner gives you before typing <code>yes</code>.
      </p>
    );
  }

  return (
    <div className="remote__key">
      {state.keys.map((key) => (
        <p key={key.fingerprint} className={key.revoked ? "remote__key--warn" : undefined}>
          <b>{key.kind}</b> <code>{key.fingerprint}</code>
          {key.revoked ? " — revoked: ssh will refuse this key" : " — already trusted on this machine"}
        </p>
      ))}
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
