import { useCallback, useEffect, useId, useState } from "react";
import { getPlatform, type ProviderStatus } from "../../platform";

export function KeyVault() {
  const inputId = useId();
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setProviders(await getPlatform().vault.listProviders());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const anthropic = providers.find((p) => p.id === "anthropic");

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await getPlatform().vault.setSecret("anthropic", draft);
      // Clear before anything can re-render with the value still in state.
      setDraft("");
      await refresh();
    } catch (e) {
      // The adapter and the Rust validator both refuse to echo key material,
      // so this message is safe to display verbatim.
      setError(e instanceof Error ? e.message : "Could not save the key.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      await getPlatform().vault.deleteSecret("anthropic");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="key-vault-heading">
      <h2 id="key-vault-heading">API Keys</h2>

      <p>
        Anthropic:{" "}
        <strong>{anthropic?.connected ? "Connected" : "Not connected"}</strong>
      </p>

      <label htmlFor={inputId}>Anthropic API key</label>
      <input
        id={inputId}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        placeholder="sk-ant-..."
        onChange={(e) => setDraft(e.target.value)}
        disabled={busy}
      />

      <button onClick={handleSave} disabled={busy || draft.length === 0}>
        Save key
      </button>

      {anthropic?.connected && (
        <button onClick={handleRemove} disabled={busy}>
          Remove key
        </button>
      )}

      {error && <p role="alert">{error}</p>}

      <p>
        Your key is stored in your operating system&apos;s keychain and is read
        only by JKY Terminal&apos;s background process. It is never sent
        anywhere except to Anthropic, and this interface cannot read it back.
      </p>
    </section>
  );
}
