import { useCallback, useEffect, useId, useState } from "react";
import { getPlatform, type ProviderStatus } from "../../platform";
import "./ProviderVault.css";

export function ProviderVault() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sealingId, setSealingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setProviders(await getPlatform().vault.listProviders());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Count keys, not providers. A local runtime has no key to add, so folding
  // it into this total would overstate what the user has actually set up.
  const keyProviders = providers.filter((p) => p.requiresKey);
  const connectedCount = keyProviders.filter((p) => p.connected).length;

  function handleSealed(id: string) {
    setSealingId(id);
    window.setTimeout(() => setSealingId((s) => (s === id ? null : s)), 700);
  }

  return (
    <div className="vault">
      <header className="vault__mast">
        <h1 className="vault__brand">
          JKY<span>·</span>TERMINAL
        </h1>
        <span className="vault__where">providers</span>
        {/* role=status so the count is announced when a key is added or
            removed, and aria-label so it reads as one phrase rather than
            three fragments split by the emphasis element. */}
        <span
          className="vault__count"
          role="status"
          aria-label={`${connectedCount} of ${keyProviders.length} keys added`}
        >
          <b>{connectedCount}</b> of {keyProviders.length} keys added
        </span>
      </header>

      <section className="vault__seal" aria-label="How your keys are stored">
        <span className="vault__seal-glyph" aria-hidden="true">
          →|
        </span>
        <div>
          <p>
            Keys go into your operating system&apos;s keychain and{" "}
            <strong>do not come back out</strong>. This window can store a key,
            check that one exists, and delete it. There is no command that reads
            one — not a locked one, not a hidden one. It was never built.
          </p>
          <p>
            Requests to providers are made by JKY Terminal&apos;s background
            process. This interface cannot reach the network at all.
          </p>
        </div>
      </section>

      <ul className="vault__list">
        {providers.map((p) => (
          <ProviderRow
            key={p.id}
            provider={p}
            open={openId === p.id}
            sealing={sealingId === p.id}
            onToggle={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
            onChanged={refresh}
            onSealed={() => handleSealed(p.id)}
          />
        ))}
      </ul>
    </div>
  );
}

interface RowProps {
  provider: ProviderStatus;
  open: boolean;
  sealing: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  onSealed: () => void;
}

function ProviderRow({ provider, open, sealing, onToggle, onChanged, onSealed }: RowProps) {
  const keyId = useId();
  const modelId = useId();
  const panelId = useId();

  const [draft, setDraft] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeModel = provider.selectedModel ?? provider.defaultModel;
  const isCustom = !provider.models.some((m) => m.id === activeModel);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (e) {
      // Both the adapter and the Rust validator refuse to echo key material,
      // so this message is safe to render verbatim.
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const connect = () =>
    run(async () => {
      await getPlatform().vault.setSecret(provider.id, draft);
      setDraft("");
      onSealed();
    });

  const disconnect = () =>
    run(() => getPlatform().vault.deleteSecret(provider.id));

  const chooseModel = (model: string) =>
    run(() => getPlatform().settings.setSelectedModel(provider.id, model));

  return (
    <li
      className="prov"
      data-open={open}
      data-connected={provider.connected || !provider.requiresKey}
      data-sealing={sealing}
    >
      <button
        type="button"
        className="prov__line"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="prov__channel" aria-hidden="true" />
        <span className="prov__glyph" aria-hidden="true">
          {provider.connected ? "●" : "○"}
        </span>
        <span className="prov__id">
          <span className="prov__name">{provider.displayName}</span>
          <span className="prov__tag">{provider.tagline}</span>
        </span>
        <span className="prov__state">
          {!provider.requiresKey ? "local" : provider.connected ? "connected" : "no key"}
        </span>
        <span className="prov__model">
          <span>model </span>
          {activeModel}
        </span>
      </button>

      {open && (
        <div className="prov__panel" id={panelId}>
          {provider.requiresKey && (
            <div className="field">
              <label className="field__label" htmlFor={keyId}>
                {provider.displayName} API key
              </label>

              {provider.connected ? (
                <div className="sealed">
                  <span aria-hidden="true">🔒</span>
                  <span>
                    A key is <b>sealed in your keychain</b>. It cannot be
                    displayed. Replace it by disconnecting first.
                  </span>
                </div>
              ) : (
                <div className="field__row">
                  <input
                    id={keyId}
                    className="input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft}
                    placeholder={provider.keyPrefixes[0] ? `${provider.keyPrefixes[0]}…` : "Paste your key"}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={connect}
                    disabled={busy || draft.length === 0}
                  >
                    Connect
                  </button>
                </div>
              )}

              {!provider.connected && (
                <p className="hint">
                  Get a key at{" "}
                  <a href={provider.consoleUrl} target="_blank" rel="noreferrer">
                    {provider.consoleUrl.replace(/^https?:\/\//, "")}
                  </a>
                </p>
              )}
            </div>
          )}

          <div className="field">
            <label className="field__label" htmlFor={modelId}>
              Model
            </label>
            <select
              id={modelId}
              className="select"
              value={isCustom ? "__custom__" : activeModel}
              disabled={busy}
              onChange={(e) => {
                if (e.target.value !== "__custom__") void chooseModel(e.target.value);
              }}
            >
              {provider.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.note}
                </option>
              ))}
              <option value="__custom__">Custom model id…</option>
            </select>

            <div className="field__row">
              <input
                className="input"
                type="text"
                spellCheck={false}
                placeholder={isCustom ? activeModel : "Or type any model id"}
                value={customModel}
                disabled={busy}
                onChange={(e) => setCustomModel(e.target.value)}
              />
              <button
                type="button"
                className="btn"
                disabled={busy || customModel.trim().length === 0}
                onClick={() => void chooseModel(customModel).then(() => setCustomModel(""))}
              >
                Use
              </button>
            </div>
            <p className="hint">
              These lists are starting points. Providers ship new models
              constantly, so any model id you type is accepted.
            </p>
          </div>

          {provider.connected && provider.requiresKey && (
            <div className="field__row">
              <button
                type="button"
                className="btn btn--danger"
                onClick={disconnect}
                disabled={busy}
              >
                Disconnect {provider.displayName}
              </button>
            </div>
          )}

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
