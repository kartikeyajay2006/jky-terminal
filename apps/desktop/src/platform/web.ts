import type { Platform, ProviderStatus, VaultApi } from "./types";

const KNOWN_PROVIDERS: ReadonlyArray<Omit<ProviderStatus, "connected">> = [
  { id: "anthropic", displayName: "Anthropic" },
];

/** Mirrors `ProviderId::validate` in crates/jky-secrets/src/provider.rs. */
function validate(provider: string, value: string): void {
  if (!KNOWN_PROVIDERS.some((p) => p.id === provider)) {
    throw new Error(`unknown provider '${provider}'`);
  }
  if (provider === "anthropic") {
    if (value.trim() !== value || !value.startsWith("sk-ant-") || value.length < 40) {
      throw new Error(`invalid key format for provider '${provider}'`);
    }
  }
}

/**
 * Development-only vault.
 *
 * Values live in a closure and die with the tab. Deliberately NOT localStorage
 * or sessionStorage — the browser build must never write credentials to disk.
 */
export function createWebPlatform(): Platform {
  const store = new Map<string, string>();

  const vault: VaultApi = {
    async setSecret(provider, value) {
      validate(provider, value);
      store.set(provider, value);
    },
    async hasSecret(provider) {
      return store.has(provider);
    },
    async deleteSecret(provider) {
      store.delete(provider);
    },
    async listProviders() {
      return KNOWN_PROVIDERS.map((p) => ({ ...p, connected: store.has(p.id) }));
    },
  };

  return { kind: "web", vault };
}
